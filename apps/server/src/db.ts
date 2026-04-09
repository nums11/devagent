import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabaseAdmin.js';
import type {
  ActivityKind,
  ActivityRecord,
  ActivityStatus,
  ConversationAttentionState,
  ConversationMode,
  ConversationRecord,
  MessageAttachment,
  MessageRecord,
  RepoProfileRecord,
  RunEventRecord,
  RunRecord,
  WorkspaceRecord
} from './types.js';

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function requireData<T>(error: Error | null, data: T | null, context: string): T {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${context}: missing data`);
  }

  return data;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] || null : value;
}

const REPO_PROFILE_SELECT = 'id,slug,name,base_local_path,default_branch';
const WORKSPACE_SELECT = `
  id,
  slug,
  name,
  local_path,
  branch_name,
  simulator_name,
  simulator_udid,
  metro_port,
  env_label,
  supabase_project_ref,
  state,
  sync_status,
  behind_count,
  ahead_count,
  last_synced_main_sha,
  last_sync_checked_at,
  sort_order,
  repo_profile:dev_agent_repo_profiles!dev_agent_workspaces_repo_profile_id_fkey(${REPO_PROFILE_SELECT})
`;
const CONVERSATION_SELECT = `
  id,
  title,
  mode,
  workspace_id,
  workspace_path,
  last_viewed_at,
  last_agent_update_at,
  active_run_started_at,
  codex_thread_id,
  created_at,
  updated_at,
  workspace:dev_agent_workspaces!dev_agent_conversations_workspace_id_fkey(${WORKSPACE_SELECT})
`;

function deriveConversationAttentionState(input: {
  lastViewedAt: string | null;
  lastAgentUpdateAt: string | null;
  activeRunStartedAt: string | null;
}): ConversationAttentionState {
  if (input.activeRunStartedAt) {
    return 'running';
  }

  if (!input.lastAgentUpdateAt) {
    return 'idle';
  }

  if (!input.lastViewedAt) {
    return 'unread';
  }

  return new Date(input.lastAgentUpdateAt).getTime() > new Date(input.lastViewedAt).getTime()
    ? 'unread'
    : 'idle';
}

function mapRepoProfile(row: {
  id: string;
  slug: string;
  name: string;
  base_local_path: string;
  default_branch: string;
} | {
  id: string;
  slug: string;
  name: string;
  base_local_path: string;
  default_branch: string;
}[] | null | undefined): RepoProfileRecord | null {
  const profile = firstRelation(row);
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    baseLocalPath: profile.base_local_path,
    defaultBranch: profile.default_branch
  };
}

function mapWorkspace(row: {
  id: string;
  slug: string;
  name: string;
  local_path: string;
  branch_name: string | null;
  simulator_name: string | null;
  simulator_udid: string | null;
  metro_port: number | null;
  env_label: string | null;
  supabase_project_ref: string | null;
  state: WorkspaceRecord['state'];
  sync_status: WorkspaceRecord['syncStatus'];
  behind_count: number | null;
  ahead_count: number | null;
  last_synced_main_sha: string | null;
  last_sync_checked_at: string | null;
  sort_order: number | null;
  repo_profile?: {
    id: string;
    slug: string;
    name: string;
    base_local_path: string;
    default_branch: string;
  } | {
    id: string;
    slug: string;
    name: string;
    base_local_path: string;
    default_branch: string;
  }[] | null;
} | {
  id: string;
  slug: string;
  name: string;
  local_path: string;
  branch_name: string | null;
  simulator_name: string | null;
  simulator_udid: string | null;
  metro_port: number | null;
  env_label: string | null;
  supabase_project_ref: string | null;
  state: WorkspaceRecord['state'];
  sync_status: WorkspaceRecord['syncStatus'];
  behind_count: number | null;
  ahead_count: number | null;
  last_synced_main_sha: string | null;
  last_sync_checked_at: string | null;
  sort_order: number | null;
  repo_profile?: {
    id: string;
    slug: string;
    name: string;
    base_local_path: string;
    default_branch: string;
  } | {
    id: string;
    slug: string;
    name: string;
    base_local_path: string;
    default_branch: string;
  }[] | null;
}[] | null | undefined): WorkspaceRecord | null {
  const workspace = firstRelation(row);
  if (!workspace) {
    return null;
  }

  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    localPath: workspace.local_path,
    branchName: workspace.branch_name,
    simulatorName: workspace.simulator_name,
    simulatorUdid: workspace.simulator_udid,
    metroPort: workspace.metro_port,
    envLabel: workspace.env_label,
    supabaseProjectRef: workspace.supabase_project_ref,
    state: workspace.state,
    syncStatus: workspace.sync_status,
    behindCount: workspace.behind_count || 0,
    aheadCount: workspace.ahead_count || 0,
    lastSyncedMainSha: workspace.last_synced_main_sha,
    lastSyncCheckedAt: workspace.last_sync_checked_at,
    sortOrder: workspace.sort_order || 0,
    repoProfile: mapRepoProfile(workspace.repo_profile)
  };
}

function mapConversation(row: {
  id: string;
  title: string;
  mode: ConversationMode;
  workspace_id: string | null;
  workspace_path: string | null;
  last_viewed_at: string | null;
  last_agent_update_at: string | null;
  active_run_started_at: string | null;
  codex_thread_id: string | null;
  created_at: string;
  updated_at: string;
  workspace?: {
    id: string;
    slug: string;
    name: string;
    local_path: string;
    branch_name: string | null;
    simulator_name: string | null;
    simulator_udid: string | null;
    metro_port: number | null;
    env_label: string | null;
    supabase_project_ref: string | null;
    state: WorkspaceRecord['state'];
    sync_status: WorkspaceRecord['syncStatus'];
    behind_count: number | null;
    ahead_count: number | null;
    last_synced_main_sha: string | null;
    last_sync_checked_at: string | null;
    sort_order: number | null;
    repo_profile?: {
      id: string;
      slug: string;
      name: string;
      base_local_path: string;
      default_branch: string;
    } | {
      id: string;
      slug: string;
      name: string;
      base_local_path: string;
      default_branch: string;
    }[] | null;
  } | {
    id: string;
    slug: string;
    name: string;
    local_path: string;
    branch_name: string | null;
    simulator_name: string | null;
    simulator_udid: string | null;
    metro_port: number | null;
    env_label: string | null;
    supabase_project_ref: string | null;
    state: WorkspaceRecord['state'];
    sync_status: WorkspaceRecord['syncStatus'];
    behind_count: number | null;
    ahead_count: number | null;
    last_synced_main_sha: string | null;
    last_sync_checked_at: string | null;
    sort_order: number | null;
    repo_profile?: {
      id: string;
      slug: string;
      name: string;
      base_local_path: string;
      default_branch: string;
    } | {
      id: string;
      slug: string;
      name: string;
      base_local_path: string;
      default_branch: string;
    }[] | null;
  }[] | null;
}): ConversationRecord {
  const workspace = mapWorkspace(row.workspace);

  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    attentionState: deriveConversationAttentionState({
      lastViewedAt: row.last_viewed_at,
      lastAgentUpdateAt: row.last_agent_update_at,
      activeRunStartedAt: row.active_run_started_at
    }),
    workspaceId: row.workspace_id,
    workspacePath: row.workspace_path,
    workspaceName: workspace?.name || null,
    workspaceSlug: workspace?.slug || null,
    workspaceBranchName: workspace?.branchName || null,
    workspaceSimulatorName: workspace?.simulatorName || null,
    workspaceSimulatorUdid: workspace?.simulatorUdid || null,
    workspaceMetroPort: workspace?.metroPort || null,
    workspaceEnvLabel: workspace?.envLabel || null,
    workspaceSupabaseProjectRef: workspace?.supabaseProjectRef || null,
    workspaceSyncStatus: workspace?.syncStatus || null,
    repoProfileSlug: workspace?.repoProfile?.slug || null,
    repoProfileName: workspace?.repoProfile?.name || null,
    lastViewedAt: row.last_viewed_at,
    lastAgentUpdateAt: row.last_agent_update_at,
    activeRunStartedAt: row.active_run_started_at,
    codexThreadId: row.codex_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAttachments(attachments: MessageAttachment[] | undefined): MessageAttachment[] {
  return (attachments || []).map((attachment) => ({
    ...attachment,
    type:
      attachment.type ||
      (attachment.mimeType?.startsWith('video/') ? 'video' : 'image'),
    mediaUrl: attachment.mediaUrl || attachment.previewUrl
  }));
}

function mapMessage(row: {
  id: string;
  conversation_id: string;
  role: MessageRecord['role'];
  content: string;
  metadata: { attachments?: MessageAttachment[] } | null;
  created_at: string;
}): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    attachments: normalizeAttachments(row.metadata?.attachments),
    createdAt: row.created_at
  };
}

function mapRun(row: {
  id: string;
  conversation_id: string;
  prompt: string;
  status: RunRecord['status'];
  started_at: string;
  completed_at: string | null;
  final_response: string | null;
}): RunRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    prompt: row.prompt,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    finalResponse: row.final_response
  };
}

function mapRunEvent(row: {
  id: string;
  run_id: string;
  conversation_id: string;
  sequence: number;
  event_type: string;
  payload: unknown;
  created_at: string;
}): RunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at
  };
}

function mapActivity(row: {
  id: string;
  run_id: string;
  conversation_id: string;
  source_key: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  status: ActivityStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}): ActivityRecord {
  return {
    id: row.id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    sourceKey: row.source_key,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .select(CONVERSATION_SELECT)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`);
  }

  return (data || []).map(mapConversation);
}

export async function getConversation(conversationId: string): Promise<ConversationRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get conversation: ${error.message}`);
  }

  return data ? mapConversation(data) : null;
}

export async function createConversation(input: {
  title: string;
  mode: ConversationMode;
  workspaceId?: string | null;
  workspacePath?: string | null;
}): Promise<ConversationRecord> {
  const supabase = getSupabaseAdmin();
  const record = {
    id: id(),
    title: input.title,
    mode: input.mode,
    workspace_id: input.workspaceId || null,
    workspace_path: input.workspacePath || null,
    last_viewed_at: now(),
    last_agent_update_at: null,
    active_run_started_at: null,
    codex_thread_id: null,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .insert(record)
    .select(CONVERSATION_SELECT)
    .single();

  return mapConversation(requireData(error, data, 'Failed to create conversation'));
}

export async function updateConversationThread(
  conversationId: string,
  threadId: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dev_agent_conversations')
    .update({
      codex_thread_id: threadId,
      updated_at: now()
    })
    .eq('id', conversationId);

  if (error) {
    throw new Error(`Failed to update conversation thread: ${error.message}`);
  }
}

export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<ConversationRecord> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .update({
      title,
      updated_at: now()
    })
    .eq('id', conversationId)
    .select(CONVERSATION_SELECT)
    .single();

  return mapConversation(requireData(error, data, 'Failed to update conversation title'));
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_workspaces')
    .select(WORKSPACE_SELECT)
    .eq('state', 'active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to list workspaces: ${error.message}`);
  }

  return (data || []).map((row) => mapWorkspace(row)).filter((row): row is WorkspaceRecord => Boolean(row));
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_workspaces')
    .select(WORKSPACE_SELECT)
    .eq('id', workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get workspace: ${error.message}`);
  }

  return mapWorkspace(data);
}

export async function updateWorkspaceSyncState(input: {
  workspaceId: string;
  syncStatus: WorkspaceRecord['syncStatus'];
  behindCount: number;
  aheadCount: number;
  lastSyncedMainSha?: string | null;
  lastSyncCheckedAt?: string | null;
}): Promise<WorkspaceRecord> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_workspaces')
    .update({
      sync_status: input.syncStatus,
      behind_count: input.behindCount,
      ahead_count: input.aheadCount,
      last_synced_main_sha: input.lastSyncedMainSha ?? null,
      last_sync_checked_at: input.lastSyncCheckedAt ?? now(),
      updated_at: now()
    })
    .eq('id', input.workspaceId)
    .select(WORKSPACE_SELECT)
    .single();

  const workspace = mapWorkspace(requireData(error, data, 'Failed to update workspace sync state'));
  if (!workspace) {
    throw new Error('Failed to update workspace sync state: missing workspace');
  }
  return workspace;
}

export async function workspaceHasActiveRuns(workspaceId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data: conversationRows, error: conversationError } = await supabase
    .from('dev_agent_conversations')
    .select('id')
    .eq('workspace_id', workspaceId);

  if (conversationError) {
    throw new Error(`Failed to load workspace conversations: ${conversationError.message}`);
  }

  const conversationIds = (conversationRows || []).map((row) => row.id);
  if (!conversationIds.length) {
    return false;
  }

  const { data: runRows, error: runError } = await supabase
    .from('dev_agent_runs')
    .select('id')
    .in('conversation_id', conversationIds)
    .eq('status', 'running')
    .is('completed_at', null)
    .limit(1);

  if (runError) {
    throw new Error(`Failed to load workspace runs: ${runError.message}`);
  }

  return Boolean(runRows?.length);
}

export async function touchConversation(
  conversationId: string,
  extra: Partial<{
    last_viewed_at: string | null;
    last_agent_update_at: string | null;
    active_run_started_at: string | null;
  }> = {}
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dev_agent_conversations')
    .update({
      updated_at: now(),
      ...extra
    })
    .eq('id', conversationId);

  if (error) {
    throw new Error(`Failed to touch conversation: ${error.message}`);
  }
}

export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_messages')
    .select('id,conversation_id,role,content,metadata,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list messages: ${error.message}`);
  }

  return (data || []).map(mapMessage);
}

export async function addMessage(input: {
  conversationId: string;
  role: MessageRecord['role'];
  content: string;
  attachments?: MessageAttachment[];
}): Promise<MessageRecord> {
  const supabase = getSupabaseAdmin();
  const record = {
    id: id(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    metadata: {
      attachments: normalizeAttachments(input.attachments)
    },
    created_at: now()
  };

  const { data, error } = await supabase
    .from('dev_agent_messages')
    .insert(record)
    .select('id,conversation_id,role,content,metadata,created_at')
    .single();

  await touchConversation(
    input.conversationId,
    input.role === 'assistant'
      ? {
          last_agent_update_at: record.created_at
        }
      : {}
  );
  return mapMessage(requireData(error, data, 'Failed to add message'));
}

export async function createRun(input: {
  conversationId: string;
  prompt: string;
}): Promise<RunRecord> {
  const supabase = getSupabaseAdmin();
  const record = {
    id: id(),
    conversation_id: input.conversationId,
    prompt: input.prompt,
    status: 'running' as const,
    started_at: now(),
    completed_at: null,
    final_response: null
  };

  const { data, error } = await supabase
    .from('dev_agent_runs')
    .insert(record)
    .select('id,conversation_id,prompt,status,started_at,completed_at,final_response')
    .single();

  await touchConversation(input.conversationId, {
    active_run_started_at: record.started_at
  });
  return mapRun(requireData(error, data, 'Failed to create run'));
}

export async function completeRun(
  runId: string,
  conversationId: string,
  finalResponse: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dev_agent_runs')
    .update({
      status: 'completed',
      completed_at: now(),
      final_response: finalResponse
    })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to complete run: ${error.message}`);
  }

  await touchConversation(conversationId, {
    last_agent_update_at: now(),
    active_run_started_at: null
  });
}

export async function failRun(runId: string, conversationId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dev_agent_runs')
    .update({
      status: 'failed',
      completed_at: now()
    })
    .eq('id', runId);

  if (error) {
    throw new Error(`Failed to mark run failed: ${error.message}`);
  }

  await touchConversation(conversationId, {
    last_agent_update_at: now(),
    active_run_started_at: null
  });
}

export async function reconcileOrphanedRuns(): Promise<{
  failedRunIds: string[];
  clearedConversationIds: string[];
}> {
  const supabase = getSupabaseAdmin();
  const completedAt = now();

  const { data: staleRuns, error: staleRunsError } = await supabase
    .from('dev_agent_runs')
    .select('id,conversation_id')
    .eq('status', 'running')
    .is('completed_at', null);

  if (staleRunsError) {
    throw new Error(`Failed to load orphaned runs: ${staleRunsError.message}`);
  }

  const failedRunIds = staleRuns?.map((run) => run.id) || [];
  const candidateConversationIds = new Set((staleRuns || []).map((run) => run.conversation_id));

  if (failedRunIds.length) {
    const { error: updateRunsError } = await supabase
      .from('dev_agent_runs')
      .update({
        status: 'failed',
        completed_at: completedAt
      })
      .in('id', failedRunIds);

    if (updateRunsError) {
      throw new Error(`Failed to mark orphaned runs failed: ${updateRunsError.message}`);
    }
  }

  const { data: activeConversations, error: activeConversationsError } = await supabase
    .from('dev_agent_conversations')
    .select('id')
    .not('active_run_started_at', 'is', null);

  if (activeConversationsError) {
    throw new Error(`Failed to load active conversations for reconciliation: ${activeConversationsError.message}`);
  }

  for (const conversation of activeConversations || []) {
    candidateConversationIds.add(conversation.id);
  }

  const clearedConversationIds: string[] = [];
  for (const conversationId of candidateConversationIds) {
    const { data: remainingRunningRows, error: remainingRunningError } = await supabase
      .from('dev_agent_runs')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'running')
      .is('completed_at', null)
      .limit(1);

    if (remainingRunningError) {
      throw new Error(`Failed to check remaining running runs: ${remainingRunningError.message}`);
    }

    if (remainingRunningRows?.length) {
      continue;
    }

    await touchConversation(conversationId, {
      active_run_started_at: null
    });
    clearedConversationIds.push(conversationId);
  }

  return {
    failedRunIds,
    clearedConversationIds
  };
}

export async function markConversationViewed(conversationId: string): Promise<ConversationRecord> {
  const supabase = getSupabaseAdmin();
  const viewedAt = now();
  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .update({
      last_viewed_at: viewedAt
    })
    .eq('id', conversationId)
    .select(CONVERSATION_SELECT)
    .single();

  return mapConversation(requireData(error, data, 'Failed to mark conversation viewed'));
}

export async function listRuns(conversationId: string): Promise<RunRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_runs')
    .select('id,conversation_id,prompt,status,started_at,completed_at,final_response')
    .eq('conversation_id', conversationId)
    .order('started_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list runs: ${error.message}`);
  }

  return (data || []).map(mapRun);
}

export async function recordRunEvent(input: {
  runId: string;
  conversationId: string;
  sequence: number;
  eventType: string;
  payload: unknown;
}): Promise<RunEventRecord> {
  const supabase = getSupabaseAdmin();
  const record = {
    id: id(),
    run_id: input.runId,
    conversation_id: input.conversationId,
    sequence: input.sequence,
    event_type: input.eventType,
    payload: input.payload,
    created_at: now()
  };

  const { data, error } = await supabase
    .from('dev_agent_run_events')
    .insert(record)
    .select('id,run_id,conversation_id,sequence,event_type,payload,created_at')
    .single();

  return mapRunEvent(requireData(error, data, 'Failed to record run event'));
}

export async function listActivities(conversationId: string): Promise<ActivityRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('dev_agent_activity_items')
    .select(
      'id,run_id,conversation_id,source_key,kind,title,detail,status,metadata,created_at,updated_at'
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('updated_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to list activities: ${error.message}`);
  }

  return (data || []).map(mapActivity);
}

export async function upsertActivity(input: {
  runId: string;
  conversationId: string;
  sourceKey: string;
  kind: ActivityKind;
  title: string;
  detail?: string | null;
  status: ActivityStatus;
  metadata?: Record<string, unknown>;
}): Promise<ActivityRecord> {
  const supabase = getSupabaseAdmin();
  const timestamp = now();
  const record = {
    run_id: input.runId,
    conversation_id: input.conversationId,
    source_key: input.sourceKey,
    kind: input.kind,
    title: input.title,
    detail: input.detail || null,
    status: input.status,
    metadata: input.metadata || {},
    updated_at: timestamp
  };

  const { data, error } = await supabase
    .from('dev_agent_activity_items')
    .upsert(
      {
        id: id(),
        ...record,
        created_at: timestamp
      },
      {
        onConflict: 'run_id,source_key'
      }
    )
    .select(
      'id,run_id,conversation_id,source_key,kind,title,detail,status,metadata,created_at,updated_at'
    )
    .single();

  return mapActivity(requireData(error, data, 'Failed to upsert activity'));
}
