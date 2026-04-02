export type ConversationMode = 'chat' | 'workspace' | 'harness';

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
  workspacePath: string | null;
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
