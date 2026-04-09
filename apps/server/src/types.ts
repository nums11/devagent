export type ConversationMode = 'chat' | 'workspace' | 'harness';
export type ConversationAttentionState = 'idle' | 'running' | 'unread';

export type RepoProfileRecord = {
  id: string;
  slug: string;
  name: string;
  baseLocalPath: string;
  defaultBranch: string;
};

export type WorkspaceState = 'active' | 'archived';
export type WorkspaceSyncStatus = 'fresh' | 'stale' | 'syncing' | 'conflicted';

export type WorkspaceRecord = {
  id: string;
  slug: string;
  name: string;
  localPath: string;
  branchName: string | null;
  simulatorName: string | null;
  simulatorUdid: string | null;
  metroPort: number | null;
  envLabel: string | null;
  supabaseProjectRef: string | null;
  state: WorkspaceState;
  syncStatus: WorkspaceSyncStatus;
  behindCount: number;
  aheadCount: number;
  lastSyncedMainSha: string | null;
  lastSyncCheckedAt: string | null;
  sortOrder: number;
  repoProfile: RepoProfileRecord | null;
};

export type MessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  type?: 'image' | 'video';
  uploadedPath?: string | null;
  previewUrl: string;
  mediaUrl?: string | null;
};

export type ConversationRecord = {
  id: string;
  title: string;
  mode: ConversationMode;
  attentionState: ConversationAttentionState;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceName: string | null;
  workspaceSlug: string | null;
  workspaceBranchName: string | null;
  workspaceSimulatorName: string | null;
  workspaceSimulatorUdid: string | null;
  workspaceMetroPort: number | null;
  workspaceEnvLabel: string | null;
  workspaceSupabaseProjectRef: string | null;
  workspaceSyncStatus: WorkspaceSyncStatus | null;
  repoProfileSlug: string | null;
  repoProfileName: string | null;
  lastViewedAt: string | null;
  lastAgentUpdateAt: string | null;
  activeRunStartedAt: string | null;
  codexThreadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  attachments: MessageAttachment[];
  createdAt: string;
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

export type RunEventRecord = {
  id: string;
  runId: string;
  conversationId: string;
  sequence: number;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

export type ActivityKind =
  | 'thinking'
  | 'search'
  | 'file_read'
  | 'command'
  | 'file_change'
  | 'tool_call'
  | 'todo'
  | 'error';

export type ActivityStatus = 'running' | 'completed' | 'failed';

export type ActivityRecord = {
  id: string;
  runId: string;
  conversationId: string;
  sourceKey: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  status: ActivityStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeConfig = {
  model: string;
  reasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
};

export type SocketServerEvent =
  | { type: 'connection.ready'; runtime: RuntimeConfig }
  | { type: 'conversation.updated'; conversation: ConversationRecord }
  | { type: 'conversation.message.created'; conversationId: string; message: MessageRecord }
  | { type: 'conversation.run.started'; conversationId: string; runId: string; startedAt: string }
  | { type: 'conversation.run.activity'; conversationId: string; runId: string; activity: ActivityRecord }
  | { type: 'conversation.run.event'; conversationId: string; runId: string; event: unknown }
  | { type: 'conversation.run.cancelled'; conversationId: string; runId: string; reason: string }
  | { type: 'conversation.run.completed'; conversationId: string; runId: string; finalResponse: string }
  | { type: 'conversation.run.failed'; conversationId: string; runId: string; error: string };
