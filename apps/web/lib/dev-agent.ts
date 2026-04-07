export type Conversation = {
  id: string;
  title: string;
  mode: 'chat' | 'workspace' | 'harness';
  attentionState?: 'idle' | 'running' | 'unread';
  workspaceId?: string | null;
  workspacePath?: string | null;
  workspaceName?: string | null;
  workspaceSlug?: string | null;
  workspaceBranchName?: string | null;
  workspaceSimulatorName?: string | null;
  workspaceSimulatorUdid?: string | null;
  workspaceMetroPort?: number | null;
  workspaceEnvLabel?: string | null;
  workspaceSyncStatus?: 'fresh' | 'stale' | 'syncing' | 'conflicted' | null;
  repoProfileSlug?: string | null;
  repoProfileName?: string | null;
  lastViewedAt?: string | null;
  lastAgentUpdateAt?: string | null;
  activeRunStartedAt?: string | null;
};

export type MessageAttachment = {
  id: string;
  type?: 'image' | 'video';
  fileName: string;
  mimeType: string | null;
  uploadedPath?: string | null;
  previewUrl: string;
  mediaUrl?: string | null;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  attachments: MessageAttachment[];
  createdAt: string;
};

export type SelectedImage = {
  id: string;
  fileName: string;
  file: File;
  mimeType: string | null;
  previewUrl: string;
};

export type UploadedImageAttachment = {
  id: string;
  type?: 'image' | 'video';
  fileName: string;
  uploadedPath: string;
  previewUrl: string;
  mediaUrl?: string | null;
  mimeType: string | null;
};

export type QueuedTurn = {
  prompt: string;
  selectedImages: SelectedImage[];
};

export type ActivityItem = {
  id: string;
  runId: string;
  conversationId: string;
  sourceKey: string;
  kind: 'thinking' | 'search' | 'file_read' | 'command' | 'file_change' | 'tool_call' | 'todo' | 'error';
  title: string;
  detail: string | null;
  status: 'running' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RunRecord = {
  id: string;
  conversationId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  finalResponse: string | null;
};

export type RuntimeConfig = {
  model: string;
  reasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
};

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  localPath: string;
  branchName: string | null;
  simulatorName: string | null;
  simulatorUdid: string | null;
  metroPort: number | null;
  envLabel: string | null;
  supabaseProjectRef?: string | null;
  state?: 'active' | 'archived';
  syncStatus?: 'fresh' | 'stale' | 'syncing' | 'conflicted';
  behindCount?: number;
  aheadCount?: number;
  repoProfile?: {
    id: string;
    slug: string;
    name: string;
    baseLocalPath: string;
    defaultBranch: string;
  } | null;
};

export type ServerRunEvent =
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'conversation.message.created'; conversationId: string; message: Message }
  | { type: 'conversation.run.started'; conversationId: string; runId: string; startedAt: string }
  | { type: 'conversation.run.activity'; conversationId: string; runId: string; activity: ActivityItem }
  | { type: 'conversation.run.event'; conversationId: string; runId: string; event: unknown }
  | { type: 'conversation.run.cancelled'; conversationId: string; runId: string; reason: string }
  | { type: 'conversation.run.completed'; conversationId: string; runId: string; finalResponse: string }
  | { type: 'conversation.run.failed'; conversationId: string | null; runId: string | null; error: string }
  | { type: 'connection.ready'; runtime: RuntimeConfig };

export type ThemeMode = 'dark' | 'light';
export type ViewMode = 'chat' | 'settings';
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function summarizeResponseText(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return '';
  }

  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

export async function readResponsePayload<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  if (!rawBody) {
    return {} as T;
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    const responseSummary = summarizeResponseText(rawBody);
    if (!response.ok) {
      throw new Error(
        responseSummary
          ? `Dev Agent server returned ${response.status}: ${responseSummary}`
          : `Dev Agent server returned ${response.status}.`
      );
    }

    throw new Error('Dev Agent server returned an unexpected response.');
  }
}

export function deriveBridgeUrls(): { apiUrl: string; wsUrl: string } {
  if (typeof window === 'undefined') {
    return {
      apiUrl: process.env.NEXT_PUBLIC_DEV_AGENT_API_URL || 'http://localhost:4242',
      wsUrl: process.env.NEXT_PUBLIC_DEV_AGENT_WS_URL || 'ws://localhost:4242/ws'
    };
  }

  const apiOverride = process.env.NEXT_PUBLIC_DEV_AGENT_API_URL;
  const wsOverride = process.env.NEXT_PUBLIC_DEV_AGENT_WS_URL;
  if (apiOverride && wsOverride) {
    return {
      apiUrl: apiOverride.replace(/\/+$/, ''),
      wsUrl: wsOverride
    };
  }

  const { protocol, hostname } = window.location;
  const apiProtocol = protocol === 'https:' ? 'https:' : 'http:';
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';

  return {
    apiUrl: (apiOverride || `${apiProtocol}//${hostname}:4242`).replace(/\/+$/, ''),
    wsUrl: wsOverride || `${wsProtocol}//${hostname}:4242/ws`
  };
}

export function formatModeLabel(mode: Conversation['mode']): string {
  if (mode === 'workspace') {
    return 'Workspace';
  }

  if (mode === 'harness') {
    return 'Harness';
  }

  return 'General';
}

export function formatWorkspaceLabel(conversation: Conversation): string {
  if (conversation.workspaceName) {
    return conversation.workspaceName;
  }

  if (!conversation.workspacePath) {
    return 'General chat';
  }

  const segments = conversation.workspacePath.split('/').filter(Boolean);
  return segments[segments.length - 1] || conversation.workspacePath;
}

export function formatConversationMeta(conversation: Conversation): string {
  const workspaceLabel = formatWorkspaceLabel(conversation);
  const detailParts = [
    conversation.workspaceBranchName ? `branch ${conversation.workspaceBranchName}` : null,
    conversation.workspaceMetroPort ? `port ${conversation.workspaceMetroPort}` : null,
    conversation.workspaceSimulatorName || null,
    conversation.workspaceEnvLabel ? `env ${conversation.workspaceEnvLabel}` : null
  ].filter(Boolean);

  if (!detailParts.length) {
    return workspaceLabel;
  }

  return `${workspaceLabel} • ${detailParts.join(' • ')}`;
}

export function formatWorkspaceSubtitle(workspace: Workspace): string {
  const parts = [
    workspace.repoProfile?.name || null,
    workspace.branchName ? `branch ${workspace.branchName}` : null,
    workspace.metroPort ? `port ${workspace.metroPort}` : null,
    workspace.simulatorName || null,
    workspace.envLabel ? `env ${workspace.envLabel}` : null
  ].filter(Boolean);

  return parts.join(' • ') || workspace.localPath;
}

export function formatWorkspaceSyncSummary(workspace: Pick<Workspace, 'syncStatus' | 'behindCount' | 'aheadCount'>): string {
  if (workspace.syncStatus === 'syncing') {
    return 'Sync in progress';
  }

  if (workspace.syncStatus === 'conflicted') {
    return 'Needs manual conflict resolution';
  }

  if ((workspace.behindCount || 0) > 0) {
    const behindCount = workspace.behindCount || 0;
    return `Behind main by ${behindCount}`;
  }

  if (workspace.syncStatus === 'stale') {
    return 'Sync check needed';
  }

  const aheadCount = workspace.aheadCount || 0;
  return aheadCount > 0 ? `Ahead of main by ${aheadCount}` : 'Fresh with main';
}

export function shouldOfferWorkspaceSync(workspace: Pick<Workspace, 'syncStatus' | 'behindCount'> | null | undefined): boolean {
  if (!workspace) {
    return false;
  }

  return workspace.syncStatus === 'conflicted' || workspace.syncStatus === 'stale' || (workspace.behindCount || 0) > 0;
}

export function formatSandboxModeLabel(mode?: string | null): string {
  if (!mode) {
    return 'Sandbox';
  }

  if (mode === 'danger-full-access') {
    return 'Full access';
  }

  if (mode === 'workspace-write') {
    return 'Workspace write';
  }

  return mode.replace(/-/g, ' ');
}

export function formatElapsedLabel(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function summarizeActivity(activity: ActivityItem): string {
  if (activity.kind === 'command') {
    return `Command • ${activity.detail || activity.title}`;
  }

  if (activity.detail) {
    return `${activity.title} • ${activity.detail}`;
  }

  return activity.title;
}

export function deriveUserMessageContent(prompt: string): string {
  return prompt.trim();
}

export function upsertActivity(current: ActivityItem[], nextItem: ActivityItem): ActivityItem[] {
  const existingIndex = current.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...current, nextItem];
  }

  const next = [...current];
  next[existingIndex] = nextItem;
  return next;
}
