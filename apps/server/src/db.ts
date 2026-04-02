import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabaseAdmin.js';
import type {
  ActivityKind,
  ActivityRecord,
  ActivityStatus,
  ConversationMode,
  ConversationRecord,
  MessageAttachment,
  MessageRecord,
  RunEventRecord,
  RunRecord
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

function mapConversation(row: {
  id: string;
  title: string;
  mode: ConversationMode;
  workspace_path: string | null;
  codex_thread_id: string | null;
  created_at: string;
  updated_at: string;
}): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    workspacePath: row.workspace_path,
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
    .select('id,title,mode,workspace_path,codex_thread_id,created_at,updated_at')
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
    .select('id,title,mode,workspace_path,codex_thread_id,created_at,updated_at')
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
  workspacePath?: string | null;
}): Promise<ConversationRecord> {
  const supabase = getSupabaseAdmin();
  const record = {
    id: id(),
    title: input.title,
    mode: input.mode,
    workspace_path: input.workspacePath || null,
    codex_thread_id: null,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from('dev_agent_conversations')
    .insert(record)
    .select('id,title,mode,workspace_path,codex_thread_id,created_at,updated_at')
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
    .select('id,title,mode,workspace_path,codex_thread_id,created_at,updated_at')
    .single();

  return mapConversation(requireData(error, data, 'Failed to update conversation title'));
}

export async function touchConversation(conversationId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dev_agent_conversations')
    .update({
      updated_at: now()
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

  await touchConversation(input.conversationId);
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

  await touchConversation(input.conversationId);
  return mapRun(requireData(error, data, 'Failed to create run'));
}

export async function completeRun(runId: string, finalResponse: string): Promise<void> {
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
}

export async function failRun(runId: string): Promise<void> {
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
