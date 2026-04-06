import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspace, listWorkspaces, updateWorkspaceSyncState, workspaceHasActiveRuns } from './db.js';
import type { WorkspaceRecord } from './types.js';

const execFileAsync = promisify(execFile);
const REFRESH_CACHE_MS = 60_000;

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    maxBuffer: 8 * 1024 * 1024
  });
  return String(stdout || '').trim();
}

function shouldReuseRecentSyncCheck(workspace: WorkspaceRecord, force: boolean): boolean {
  if (force || !workspace.lastSyncCheckedAt) {
    return false;
  }

  const lastCheckedAt = Date.parse(workspace.lastSyncCheckedAt);
  if (!Number.isFinite(lastCheckedAt)) {
    return false;
  }

  return Date.now() - lastCheckedAt < REFRESH_CACHE_MS;
}

function getDefaultBranchRef(workspace: WorkspaceRecord): string {
  return `origin/${workspace.repoProfile?.defaultBranch || 'main'}`;
}

function getRepoFetchPath(workspace: WorkspaceRecord): string {
  return workspace.repoProfile?.baseLocalPath || workspace.localPath;
}

function hasConflictMarkers(statusOutput: string): boolean {
  return statusOutput
    .split('\n')
    .some((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD') || line.startsWith('AU') || line.startsWith('UA'));
}

async function collectWorkspaceGitState(workspace: WorkspaceRecord): Promise<{
  behindCount: number;
  aheadCount: number;
  isDirty: boolean;
  hasConflicts: boolean;
  mainSha: string | null;
}> {
  const workspacePath = path.resolve(workspace.localPath);
  if (!fs.existsSync(workspacePath)) {
    throw new Error(`Workspace path does not exist: ${workspacePath}`);
  }

  const fetchPath = path.resolve(getRepoFetchPath(workspace));
  await runGit(['fetch', 'origin'], fetchPath);

  const defaultBranchRef = getDefaultBranchRef(workspace);
  const countsOutput = await runGit(['rev-list', '--left-right', '--count', `${defaultBranchRef}...HEAD`], workspacePath);
  const [behindRaw, aheadRaw] = countsOutput.split(/\s+/);
  const behindCount = Number.parseInt(behindRaw || '0', 10) || 0;
  const aheadCount = Number.parseInt(aheadRaw || '0', 10) || 0;
  const statusOutput = await runGit(['status', '--porcelain'], workspacePath);
  const isDirty = statusOutput.length > 0;
  const hasConflicts = hasConflictMarkers(statusOutput);
  const mainSha = await runGit(['rev-parse', defaultBranchRef], workspacePath).catch(() => null);

  return {
    behindCount,
    aheadCount,
    isDirty,
    hasConflicts,
    mainSha
  };
}

export async function refreshWorkspaceSyncStatus(
  workspaceOrId: WorkspaceRecord | string,
  options: { force?: boolean } = {}
): Promise<WorkspaceRecord> {
  const workspace =
    typeof workspaceOrId === 'string'
      ? await getWorkspace(workspaceOrId)
      : workspaceOrId;

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  if (!workspace.repoProfile) {
    return updateWorkspaceSyncState({
      workspaceId: workspace.id,
      syncStatus: 'fresh',
      behindCount: 0,
      aheadCount: 0,
      lastSyncedMainSha: workspace.lastSyncedMainSha,
      lastSyncCheckedAt: new Date().toISOString()
    });
  }

  if (shouldReuseRecentSyncCheck(workspace, Boolean(options.force))) {
    return workspace;
  }

  const gitState = await collectWorkspaceGitState(workspace);
  const syncStatus: WorkspaceRecord['syncStatus'] =
    gitState.hasConflicts
      ? 'conflicted'
      : gitState.isDirty || gitState.behindCount > 0
        ? 'stale'
        : 'fresh';

  return updateWorkspaceSyncState({
    workspaceId: workspace.id,
    syncStatus,
    behindCount: gitState.behindCount,
    aheadCount: gitState.aheadCount,
    lastSyncedMainSha: syncStatus === 'fresh' ? gitState.mainSha : workspace.lastSyncedMainSha,
    lastSyncCheckedAt: new Date().toISOString()
  });
}

export async function refreshAllWorkspaceSyncStatuses(
  options: { force?: boolean } = {}
): Promise<WorkspaceRecord[]> {
  const workspaces = await listWorkspaces();
  const refreshed = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        return await refreshWorkspaceSyncStatus(workspace, options);
      } catch {
        return workspace;
      }
    })
  );

  return refreshed.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export async function syncWorkspaceFromMain(workspaceId: string): Promise<WorkspaceRecord> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  if (!workspace.repoProfile) {
    throw new Error('Workspace is missing a repo profile.');
  }

  if (await workspaceHasActiveRuns(workspace.id)) {
    throw new Error('Cannot sync this workspace while a run is active.');
  }

  await updateWorkspaceSyncState({
    workspaceId: workspace.id,
    syncStatus: 'syncing',
    behindCount: workspace.behindCount,
    aheadCount: workspace.aheadCount,
    lastSyncedMainSha: workspace.lastSyncedMainSha,
    lastSyncCheckedAt: new Date().toISOString()
  });

  const workspacePath = path.resolve(workspace.localPath);
  const defaultBranchRef = getDefaultBranchRef(workspace);
  const fetchPath = path.resolve(getRepoFetchPath(workspace));

  try {
    const preflight = await collectWorkspaceGitState(workspace);
    if (preflight.hasConflicts) {
      await updateWorkspaceSyncState({
        workspaceId: workspace.id,
        syncStatus: 'conflicted',
        behindCount: preflight.behindCount,
        aheadCount: preflight.aheadCount,
        lastSyncedMainSha: workspace.lastSyncedMainSha,
        lastSyncCheckedAt: new Date().toISOString()
      });
      throw new Error('Workspace has merge conflicts. Resolve them before syncing.');
    }

    if (preflight.isDirty) {
      await updateWorkspaceSyncState({
        workspaceId: workspace.id,
        syncStatus: 'stale',
        behindCount: preflight.behindCount,
        aheadCount: preflight.aheadCount,
        lastSyncedMainSha: workspace.lastSyncedMainSha,
        lastSyncCheckedAt: new Date().toISOString()
      });
      throw new Error('Workspace has uncommitted changes. Commit or stash them before syncing.');
    }

    if (preflight.behindCount === 0) {
      return refreshWorkspaceSyncStatus(workspace, { force: true });
    }

    await runGit(['fetch', 'origin'], fetchPath);
    await runGit(['rebase', defaultBranchRef], workspacePath);
    return refreshWorkspaceSyncStatus(workspace.id, { force: true });
  } catch (error) {
    const refreshed = await refreshWorkspaceSyncStatus(workspace.id, { force: true }).catch(() => null);
    if (refreshed?.syncStatus === 'fresh') {
      return refreshed;
    }
    throw error instanceof Error ? error : new Error('Failed to sync workspace.');
  }
}
