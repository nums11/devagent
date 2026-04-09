import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getCodexAppServerClient, type AppServerNotification } from './codexAppServer.js';
import {
  addMessage,
  completeRun,
  createRun,
  failRun,
  getConversation,
  listMessages,
  recordRunEvent,
  updateConversationThread,
  updateConversationTitle,
  upsertActivity
} from './db.js';
import type { MessageAttachment, SocketServerEvent } from './types.js';

type Emit = (event: SocketServerEvent) => void;
type ImageAttachment = {
  id: string;
  fileName: string;
  uploadedPath: string;
  previewUrl: string;
  mimeType?: string | null;
};

type AppServerUserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string };

type SessionOutcome =
  | { status: 'completed'; finalResponse: string }
  | { status: 'interrupted'; reason: string }
  | { status: 'failed'; error: string };

type ActiveTurnSession = {
  conversationId: string;
  runId: string;
  threadId: string;
  turnId: string | null;
  emit: Emit;
  sequence: number;
  finalResponse: string;
  commandState: Map<string, { command: string; cwd: string; output: string; status: 'running' | 'completed' | 'failed' }>;
  resolve: (outcome: SessionOutcome) => void;
  reject: (error: Error) => void;
  completion: Promise<SessionOutcome>;
  settled: boolean;
};

const UNTITLED_CONVERSATION = 'New Codex Chat';
const codexBridgeDir = path.dirname(fileURLToPath(import.meta.url));
const devAgentRoot = path.resolve(codexBridgeDir, '../../..');
const appServer = getCodexAppServerClient();
const activeSessionsByRunId = new Map<string, ActiveTurnSession>();
const activeSessionsByConversationId = new Map<string, ActiveTurnSession>();
const activeSessionsByThreadId = new Map<string, ActiveTurnSession>();
const activeSessionsByTurnId = new Map<string, ActiveTurnSession>();

function logBridgeWarning(message: string, error: unknown, context: Record<string, unknown> = {}) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[codex bridge] ${message}: ${detail}`, context);
}

function ensureWorkspacePath(workspacePath: string | null): string | undefined {
  if (!workspacePath) {
    return undefined;
  }

  const resolved = path.resolve(workspacePath);
  if (!resolved.startsWith(config.workspaceRoot)) {
    throw new Error(`Workspace path is outside CODEX_WORKSPACE_ROOT: ${resolved}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }

  return resolved;
}

function deriveConversationTitle(prompt: string): string {
  const normalized = prompt
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!normalized) {
    return UNTITLED_CONVERSATION;
  }

  const cleaned = normalized
    .replace(/^(please|can you|could you|would you|hey codex|codex)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim();

  const collapsed = cleaned || normalized;
  return collapsed.length > 44 ? `${collapsed.slice(0, 41).trimEnd()}...` : collapsed;
}

function deriveUserMessageContent(prompt: string): string {
  return prompt.trim();
}

function buildWorkspaceContextBlock(conversation: {
  workspaceName: string | null;
  workspaceSlug: string | null;
  workspacePath: string | null;
  repoProfileName: string | null;
  repoProfileSlug: string | null;
  workspaceBranchName: string | null;
  workspaceSimulatorName: string | null;
  workspaceSimulatorUdid: string | null;
  workspaceMetroPort: number | null;
  workspaceEnvLabel: string | null;
  workspaceSupabaseProjectRef: string | null;
  workspaceSyncStatus: string | null;
}): string | null {
  if (!conversation.workspacePath) {
    return null;
  }

  const lines = [
    'Workspace execution context:',
    `- workspace: ${conversation.workspaceName || conversation.workspaceSlug || 'workspace'}`,
    `- local path: ${conversation.workspacePath}`,
    conversation.repoProfileName || conversation.repoProfileSlug
      ? `- repo profile: ${conversation.repoProfileName || conversation.repoProfileSlug}`
      : null,
    conversation.workspaceBranchName ? `- branch: ${conversation.workspaceBranchName}` : null,
    conversation.workspaceSimulatorName
      ? `- simulator: ${conversation.workspaceSimulatorName}${conversation.workspaceSimulatorUdid ? ` (${conversation.workspaceSimulatorUdid})` : ''}`
      : null,
    conversation.workspaceMetroPort ? `- metro port: ${conversation.workspaceMetroPort}` : null,
    conversation.workspaceSimulatorName && conversation.workspaceMetroPort
      ? `- example iOS launch command: npm run ios -- --port ${conversation.workspaceMetroPort} --device "${conversation.workspaceSimulatorName}"`
      : null,
    conversation.workspaceEnvLabel ? `- env label: ${conversation.workspaceEnvLabel}` : null,
    conversation.workspaceSupabaseProjectRef
      ? `- assigned Supabase project: ${conversation.workspaceSupabaseProjectRef}`
      : null,
    conversation.workspaceSupabaseProjectRef
      ? '- backend targeting may also be defined in repo env files like .env or .env.local and loaded through the repo env config; inspect those files and config before changing Supabase targets.'
      : null,
    conversation.workspaceSyncStatus ? `- sync status: ${conversation.workspaceSyncStatus}` : null,
    '- Android verification is supported too when the repo supports it.',
    '- no dedicated Android emulator is assigned for this workspace by default; if Android work is requested, use the repo\'s standard Android run/verify commands and a shared or default emulator unless the user explicitly asks for something else.',
    'Use these assigned workspace resources by default for commands, simulator launches, Android emulator launches, and local app verification unless the user explicitly asks for something else.',
    conversation.workspaceSupabaseProjectRef
      ? `You are allowed to make Supabase changes for this workspace, including editing schema or edge-function files in the repo and applying migrations or function deploys to project ${conversation.workspaceSupabaseProjectRef} when the task calls for it. Prefer this assigned Supabase project over production unless the user explicitly asks otherwise.`
      : null
  ].filter(Boolean);

  return lines.join('\n');
}

function buildConversationCapabilityBlock(conversationId: string): string {
  const publishImageScript = path.join(devAgentRoot, 'scripts/publish-proof-image.mjs');
  const publishVideoScript = path.join(devAgentRoot, 'scripts/publish-proof-video.mjs');
  const apiUrl = `http://localhost:${config.port}`;

  return [
    'Dev Agent chat capabilities:',
    `- current conversation id: ${conversationId}`,
    '- you can publish proof media back into this exact chat from any workspace on this machine',
    `- publish screenshot command: DEV_AGENT_API_URL=${apiUrl} node ${publishImageScript} ${conversationId} <localPath> [message]`,
    `- publish video command: DEV_AGENT_API_URL=${apiUrl} node ${publishVideoScript} ${conversationId} <localPath> [message]`,
    '- use the screenshot command for simulator screenshots or still images',
    '- use the video command for proof videos or screen recordings'
  ].join('\n');
}

function toMessageAttachments(attachments: ImageAttachment[]): MessageAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    type: 'image',
    fileName: attachment.fileName,
    mimeType: attachment.mimeType || null,
    uploadedPath: attachment.uploadedPath,
    previewUrl: attachment.previewUrl,
    mediaUrl: attachment.previewUrl
  }));
}

function buildRunInput(
  conversationId: string,
  prompt: string,
  attachments: ImageAttachment[],
  workspaceContext: string | null
): AppServerUserInput[] {
  const trimmedPrompt = prompt.trim();
  const textSections = [
    buildConversationCapabilityBlock(conversationId),
    workspaceContext,
    trimmedPrompt
      ? `User request:\n${trimmedPrompt}`
      : attachments.length
        ? 'User request:\nReview the attached image inputs and respond based on them.'
        : null
  ].filter(Boolean);
  const runText = textSections.join('\n\n').trim();

  const items: AppServerUserInput[] = [];
  if (runText) {
    items.push({
      type: 'text',
      text: runText,
      text_elements: []
    });
  }

  for (const attachment of attachments) {
    items.push({
      type: 'localImage',
      path: attachment.uploadedPath
    });
  }

  return items;
}

function registerSession(session: ActiveTurnSession) {
  activeSessionsByRunId.set(session.runId, session);
  activeSessionsByConversationId.set(session.conversationId, session);
  activeSessionsByThreadId.set(session.threadId, session);
  if (session.turnId) {
    activeSessionsByTurnId.set(session.turnId, session);
  }
}

function unregisterSession(session: ActiveTurnSession) {
  activeSessionsByRunId.delete(session.runId);
  const activeConversationSession = activeSessionsByConversationId.get(session.conversationId);
  if (activeConversationSession?.runId === session.runId) {
    activeSessionsByConversationId.delete(session.conversationId);
  }
  const activeThreadSession = activeSessionsByThreadId.get(session.threadId);
  if (activeThreadSession?.runId === session.runId) {
    activeSessionsByThreadId.delete(session.threadId);
  }
  if (session.turnId) {
    const activeTurnSession = activeSessionsByTurnId.get(session.turnId);
    if (activeTurnSession?.runId === session.runId) {
      activeSessionsByTurnId.delete(session.turnId);
    }
  }
}

function setSessionTurnId(session: ActiveTurnSession, turnId: string | null) {
  if (session.turnId) {
    const activeTurnSession = activeSessionsByTurnId.get(session.turnId);
    if (activeTurnSession?.runId === session.runId) {
      activeSessionsByTurnId.delete(session.turnId);
    }
  }

  session.turnId = turnId;
  if (turnId) {
    activeSessionsByTurnId.set(turnId, session);
  }
}

function getSessionForNotification(notification: AppServerNotification): ActiveTurnSession | null {
  const params = notification.params as
    | { threadId?: string; turnId?: string }
    | undefined;
  const turnId = typeof params?.turnId === 'string' ? params.turnId : null;
  if (turnId) {
    const sessionByTurn = activeSessionsByTurnId.get(turnId);
    if (sessionByTurn) {
      return sessionByTurn;
    }
  }

  const threadId = typeof params?.threadId === 'string' ? params.threadId : null;
  if (threadId) {
    return activeSessionsByThreadId.get(threadId) || null;
  }

  return null;
}

function createSession(input: {
  conversationId: string;
  runId: string;
  threadId: string;
  emit: Emit;
}): ActiveTurnSession {
  let resolve!: (outcome: SessionOutcome) => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<SessionOutcome>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    conversationId: input.conversationId,
    runId: input.runId,
    threadId: input.threadId,
    turnId: null,
    emit: input.emit,
    sequence: 0,
    finalResponse: '',
    commandState: new Map(),
    resolve,
    reject,
    completion,
    settled: false
  };
}

function finishSession(session: ActiveTurnSession, outcome: SessionOutcome) {
  if (session.settled) {
    return;
  }

  session.settled = true;
  unregisterSession(session);
  session.resolve(outcome);
}

async function emitActivityFromNotification(
  session: ActiveTurnSession,
  notification: AppServerNotification
): Promise<void> {
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const itemNotification = notification as Extract<AppServerNotification, { method: 'item/started' | 'item/completed' }>;
    const item = itemNotification.params.item;

    if (item.type === 'commandExecution') {
      const previous = session.commandState.get(item.id) || {
        command: typeof item.command === 'string' ? item.command : 'Command',
        cwd: typeof item.cwd === 'string' ? item.cwd : '',
        output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '',
        status: 'running' as const
      };
      const nextState: { command: string; cwd: string; output: string; status: 'running' | 'completed' | 'failed' } = {
        command: typeof item.command === 'string' ? item.command : previous.command,
        cwd: typeof item.cwd === 'string' ? item.cwd : previous.cwd,
        output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : previous.output,
        status:
          notification.method === 'item/completed'
            ? item.status === 'failed'
              ? 'failed'
              : 'completed'
            : 'running'
      };
      session.commandState.set(item.id, nextState);

      const activity = await upsertActivity({
        runId: session.runId,
        conversationId: session.conversationId,
        sourceKey: `command:${item.id}`,
        kind: 'command',
        title: nextState.command,
        detail: nextState.command,
        status: nextState.status,
        metadata: {
          cwd: nextState.cwd,
          outputPreview: nextState.output.slice(-4000)
        }
      });

      session.emit({
        type: 'conversation.run.activity',
        conversationId: session.conversationId,
        runId: session.runId,
        activity
      });
      return;
    }

    if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
      const toolName =
        item.type === 'mcpToolCall'
          ? `${String(item.server)}:${String(item.tool)}`
          : String(item.tool);
      const activity = await upsertActivity({
        runId: session.runId,
        conversationId: session.conversationId,
        sourceKey: `${item.type}:${item.id}`,
        kind: 'tool_call',
        title: toolName,
        detail: toolName,
        status: notification.method === 'item/completed' ? 'completed' : 'running',
        metadata: {}
      });

      session.emit({
        type: 'conversation.run.activity',
        conversationId: session.conversationId,
        runId: session.runId,
        activity
      });
      return;
    }

    if (item.type === 'fileChange') {
      const activity = await upsertActivity({
        runId: session.runId,
        conversationId: session.conversationId,
        sourceKey: `file-change:${item.id}`,
        kind: 'file_change',
        title: 'Updated files',
        detail: Array.isArray(item.changes) ? `${item.changes.length} file change${item.changes.length === 1 ? '' : 's'}` : null,
        status: notification.method === 'item/completed' ? 'completed' : 'running',
        metadata: {}
      });

      session.emit({
        type: 'conversation.run.activity',
        conversationId: session.conversationId,
        runId: session.runId,
        activity
      });
      return;
    }
  }

  if (notification.method === 'error') {
    const errorNotification = notification as Extract<AppServerNotification, { method: 'error' }>;
    const activity = await upsertActivity({
      runId: session.runId,
      conversationId: session.conversationId,
      sourceKey: `bridge-error:${session.runId}`,
      kind: 'error',
      title: 'Bridge error',
      detail: errorNotification.params.error.message,
      status: 'failed',
      metadata: {
        message: errorNotification.params.error.message
      }
    });

    session.emit({
      type: 'conversation.run.activity',
      conversationId: session.conversationId,
      runId: session.runId,
      activity
    });
  }
}

async function handleNotification(notification: AppServerNotification): Promise<void> {
  const session = getSessionForNotification(notification);
  if (!session) {
    return;
  }

  session.sequence += 1;
  try {
    await recordRunEvent({
      runId: session.runId,
      conversationId: session.conversationId,
      sequence: session.sequence,
      eventType: notification.method,
      payload: notification
    });
  } catch (error) {
    logBridgeWarning('Failed to persist run event', error, {
      runId: session.runId,
      conversationId: session.conversationId,
      eventType: notification.method,
      sequence: session.sequence
    });
  }

  session.emit({
    type: 'conversation.run.event',
    conversationId: session.conversationId,
    runId: session.runId,
    event: notification
  });

  try {
    await emitActivityFromNotification(session, notification);
  } catch (error) {
    logBridgeWarning('Failed to persist activity from notification', error, {
      runId: session.runId,
      conversationId: session.conversationId,
      eventType: notification.method,
      sequence: session.sequence
    });
  }

  if (notification.method === 'turn/started') {
    const turnStarted = notification as Extract<AppServerNotification, { method: 'turn/started' }>;
    setSessionTurnId(session, turnStarted.params.turn.id);
    return;
  }

  if (notification.method === 'item/agentMessage/delta') {
    const messageDelta = notification as Extract<AppServerNotification, { method: 'item/agentMessage/delta' }>;
    session.finalResponse += messageDelta.params.delta;
    return;
  }

  if (notification.method === 'item/completed') {
    const completedItem = notification as { params: { item: Record<string, unknown> & { id: string; type: string } } };
    const item = completedItem.params.item;
    if (item.type === 'agentMessage') {
      session.finalResponse = typeof item.text === 'string' && item.text ? item.text : session.finalResponse;
    }
    return;
  }

  if (notification.method === 'turn/completed') {
    const completedTurn = notification as Extract<AppServerNotification, { method: 'turn/completed' }>;
    setSessionTurnId(session, completedTurn.params.turn.id);
    const turn = completedTurn.params.turn;
    if (turn.status === 'completed') {
      finishSession(session, {
        status: 'completed',
        finalResponse: session.finalResponse
      });
      return;
    }

    if (turn.status === 'interrupted') {
      finishSession(session, {
        status: 'interrupted',
        reason: turn.error?.message || 'Run stopped by user.'
      });
      return;
    }

    finishSession(session, {
      status: 'failed',
      error: turn.error?.message || 'Codex app-server turn failed.'
    });
    return;
  }
}

function handleFatalError(error: Error) {
  for (const session of [...activeSessionsByRunId.values()]) {
    if (session.settled) {
      continue;
    }

    session.settled = true;
    unregisterSession(session);
    session.reject(error);
  }
}

appServer.on('notification', (notification) => {
  void handleNotification(notification).catch((error) => {
    logBridgeWarning('Unhandled notification processing error', error, {
      eventType: notification.method
    });
  });
});

appServer.on('fatal-error', (error) => {
  handleFatalError(error instanceof Error ? error : new Error(String(error)));
});

async function startOrResumeThread(params: {
  conversationId: string;
  existingThreadId: string | null;
  workingDirectory: string | undefined;
}): Promise<{ threadId: string }> {
  if (params.existingThreadId) {
    try {
      const resumed = await appServer.resumeThread({
        threadId: params.existingThreadId,
        cwd: params.workingDirectory ?? null,
        model: config.defaultModel,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode
      });
      return { threadId: resumed.thread.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no rollout found/i.test(message)) {
        throw error;
      }

      await updateConversationThread(params.conversationId, null);
    }
  }

  const started = await appServer.startThread({
    cwd: params.workingDirectory ?? null,
    model: config.defaultModel,
    approvalPolicy: config.approvalPolicy,
    sandbox: config.sandboxMode
  });
  await updateConversationThread(params.conversationId, started.thread.id);
  return { threadId: started.thread.id };
}

async function finalizeSuccessfulRun(params: {
  session: ActiveTurnSession;
  finalResponse: string;
}) {
  await addMessage({
    conversationId: params.session.conversationId,
    role: 'assistant',
    content: params.finalResponse
  });
  await completeRun(params.session.runId, params.session.conversationId, params.finalResponse);
  const updatedConversation = await getConversation(params.session.conversationId);
  if (updatedConversation) {
    params.session.emit({
      type: 'conversation.updated',
      conversation: updatedConversation
    });
  }

  params.session.emit({
    type: 'conversation.run.completed',
    conversationId: params.session.conversationId,
    runId: params.session.runId,
    finalResponse: params.finalResponse
  });
}

async function finalizeFailedRun(params: {
  session: ActiveTurnSession;
  reason: string;
  wasCancelled: boolean;
}) {
  await failRun(params.session.runId, params.session.conversationId);
  const updatedConversation = await getConversation(params.session.conversationId);
  if (updatedConversation) {
    params.session.emit({
      type: 'conversation.updated',
      conversation: updatedConversation
    });
  }

  if (params.wasCancelled) {
    params.session.emit({
      type: 'conversation.run.cancelled',
      conversationId: params.session.conversationId,
      runId: params.session.runId,
      reason: params.reason
    });
    return;
  }

  params.session.emit({
    type: 'conversation.run.failed',
    conversationId: params.session.conversationId,
    runId: params.session.runId,
    error: params.reason
  });
}

export async function runConversationTurn(
  conversationId: string,
  prompt: string,
  attachments: ImageAttachment[],
  emit: Emit
): Promise<void> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const existingMessages = await listMessages(conversationId);
  const shouldAutotitle =
    existingMessages.length === 0 && conversation.title.trim() === UNTITLED_CONVERSATION;

  if (shouldAutotitle) {
    const updatedConversation = await updateConversationTitle(
      conversationId,
      prompt.trim() ? deriveConversationTitle(prompt) : 'Image request'
    );
    emit({
      type: 'conversation.updated',
      conversation: updatedConversation
    });
  }

  await addMessage({
    conversationId,
    role: 'user',
    content: deriveUserMessageContent(prompt),
    attachments: toMessageAttachments(attachments)
  });

  const run = await createRun({
    conversationId,
    prompt: prompt.trim() || `[${attachments.length} image attachment${attachments.length === 1 ? '' : 's'}]`
  });
  const runningConversation = await getConversation(conversationId);
  if (runningConversation) {
    emit({
      type: 'conversation.updated',
      conversation: runningConversation
    });
  }

  emit({
    type: 'conversation.run.started',
    conversationId,
    runId: run.id,
    startedAt: run.startedAt
  });

  let session: ActiveTurnSession | null = null;
  try {
    const workingDirectory = ensureWorkspacePath(conversation.workspacePath);
    const workspaceContext = buildWorkspaceContextBlock(conversation);
    const { threadId } = await startOrResumeThread({
      conversationId,
      existingThreadId: conversation.codexThreadId,
      workingDirectory
    });

    session = createSession({
      conversationId,
      runId: run.id,
      threadId,
      emit
    });
    registerSession(session);

    const turnResponse = await appServer.startTurn({
      threadId,
      input: buildRunInput(conversationId, prompt, attachments, workspaceContext),
      cwd: workingDirectory ?? null,
      model: config.defaultModel,
      approvalPolicy: config.approvalPolicy,
      effort: config.reasoningEffort
    });
    setSessionTurnId(session, turnResponse.turn.id);

    const outcome = await session.completion;
    if (outcome.status === 'completed') {
      await finalizeSuccessfulRun({
        session,
        finalResponse: outcome.finalResponse
      });
      return;
    }

    await finalizeFailedRun({
      session,
      reason: outcome.status === 'interrupted' ? outcome.reason : outcome.error,
      wasCancelled: outcome.status === 'interrupted'
    });
    return;
  } catch (error) {
    if (session && !session.settled) {
      unregisterSession(session);
    }

    const message =
      error instanceof Error ? error.message : 'Unknown Codex bridge error';
    if (session) {
      await finalizeFailedRun({
        session,
        reason: message,
        wasCancelled: false
      });
    } else {
      await failRun(run.id, conversationId);
      emit({
        type: 'conversation.run.failed',
        conversationId,
        runId: run.id,
        error: message
      });
    }
    throw error;
  }
}

export async function steerConversationTurn(
  conversationId: string,
  prompt: string,
  attachments: ImageAttachment[]
): Promise<{ runId: string }> {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const session = activeSessionsByConversationId.get(conversationId);
  if (!session || !session.turnId) {
    throw new Error('Run is no longer active.');
  }

  const workingDirectory = ensureWorkspacePath(conversation.workspacePath);
  const workspaceContext = buildWorkspaceContextBlock(conversation);
  try {
    const response = await appServer.steerTurn({
      threadId: session.threadId,
      turnId: session.turnId,
      input: buildRunInput(conversationId, prompt, attachments, workspaceContext)
    });
    setSessionTurnId(session, response.turnId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/activeTurnNotSteerable/i.test(message)) {
      throw new Error('This turn can no longer be steered. Wait for it to finish and send a new message.');
    }

    throw error;
  }

  await addMessage({
    conversationId,
    role: 'user',
    content: deriveUserMessageContent(prompt),
    attachments: toMessageAttachments(attachments)
  });

  return {
    runId: session.runId
  };
}

export async function cancelRun(runId: string): Promise<boolean> {
  const session = activeSessionsByRunId.get(runId);
  if (!session || !session.turnId) {
    return false;
  }

  await appServer.interruptTurn({
    threadId: session.threadId,
    turnId: session.turnId
  });
  return true;
}
