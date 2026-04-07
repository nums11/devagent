import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Codex, type Input, type ThreadEvent } from '@openai/codex-sdk';
import { deriveActivityDrafts } from './activity.js';
import { config } from './config.js';
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

const UNTITLED_CONVERSATION = 'New Codex Chat';
const activeRunControllers = new Map<string, AbortController>();
const codexBridgeDir = path.dirname(fileURLToPath(import.meta.url));
const devAgentRoot = path.resolve(codexBridgeDir, '../../..');

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
    conversation.workspaceEnvLabel ? `- env label: ${conversation.workspaceEnvLabel}` : null,
    conversation.workspaceSyncStatus ? `- sync status: ${conversation.workspaceSyncStatus}` : null,
    'Use these assigned workspace resources by default for commands, simulator launches, and local app verification unless the user explicitly asks for something else.'
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
): Input {
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

  if (!attachments.length) {
    return runText;
  }

  const items: Extract<Input, unknown[]> = [];
  if (runText) {
    items.push({
      type: 'text',
      text: runText
    });
  }

  for (const attachment of attachments) {
    items.push({
      type: 'local_image',
      path: attachment.uploadedPath
    });
  }

  return items;
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

  const abortController = new AbortController();
  activeRunControllers.set(run.id, abortController);

  try {
    const codex = new Codex();
    const workingDirectory = ensureWorkspacePath(conversation.workspacePath);
    const workspaceContext = buildWorkspaceContextBlock(conversation);

    const thread = conversation.codexThreadId
      ? codex.resumeThread(conversation.codexThreadId, {
          model: config.defaultModel,
          modelReasoningEffort: config.reasoningEffort,
          sandboxMode: config.sandboxMode,
          approvalPolicy: config.approvalPolicy,
          networkAccessEnabled: config.networkAccessEnabled,
          workingDirectory,
          skipGitRepoCheck: !conversation.workspacePath
        })
      : codex.startThread({
          model: config.defaultModel,
          modelReasoningEffort: config.reasoningEffort,
          sandboxMode: config.sandboxMode,
          approvalPolicy: config.approvalPolicy,
          networkAccessEnabled: config.networkAccessEnabled,
          workingDirectory,
          skipGitRepoCheck: !conversation.workspacePath
        });

    const streamed = await thread.runStreamed(buildRunInput(conversationId, prompt, attachments, workspaceContext), {
      signal: abortController.signal
    });
    let finalResponse = '';
    let sequence = 0;

    const persistStreamEvent = async (event: ThreadEvent) => {
      sequence += 1;
      await recordRunEvent({
        runId: run.id,
        conversationId,
        sequence,
        eventType: event.type,
        payload: event
      });

      const drafts = deriveActivityDrafts(event);
      for (const draft of drafts) {
        const activity = await upsertActivity({
          runId: run.id,
          conversationId,
          ...draft
        });

        emit({
          type: 'conversation.run.activity',
          conversationId,
          runId: run.id,
          activity
        });
      }
    };

    for await (const event of streamed.events) {
      if (event.type === 'thread.started' && event.thread_id) {
        await updateConversationThread(conversationId, event.thread_id);
      }

      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        finalResponse = event.item.text || finalResponse;
      }

      await persistStreamEvent(event);

      emit({
        type: 'conversation.run.event',
        conversationId,
        runId: run.id,
        event
      });
    }

    await addMessage({
      conversationId,
      role: 'assistant',
      content: finalResponse
    });
    await completeRun(run.id, conversationId, finalResponse);
    const updatedConversation = await getConversation(conversationId);
    if (updatedConversation) {
      emit({
        type: 'conversation.updated',
        conversation: updatedConversation
      });
    }

    emit({
      type: 'conversation.run.completed',
      conversationId,
      runId: run.id,
      finalResponse
    });
  } catch (error) {
    await failRun(run.id, conversationId);
    const wasCancelled = abortController.signal.aborted;
    const message = wasCancelled
      ? 'Run stopped by user.'
      : error instanceof Error
        ? error.message
        : 'Unknown Codex bridge error';
    const activity = await upsertActivity({
      runId: run.id,
      conversationId,
      sourceKey: wasCancelled ? `run-cancelled:${run.id}` : `bridge-error:${run.id}`,
      kind: wasCancelled ? 'thinking' : 'error',
      title: wasCancelled ? 'Run stopped' : 'Bridge error',
      detail: message,
      status: wasCancelled ? 'completed' : 'failed',
      metadata: {
        message
      }
    });
    emit({
      type: 'conversation.run.activity',
      conversationId,
      runId: run.id,
      activity
    });
    const shouldResetThread =
      wasCancelled || message.includes('no rollout found for thread id');
    if (shouldResetThread) {
      await updateConversationThread(conversationId, null);
    }
    const updatedConversation = await getConversation(conversationId);
    if (updatedConversation) {
      emit({
        type: 'conversation.updated',
        conversation: updatedConversation
      });
    }
    if (wasCancelled) {
      emit({
        type: 'conversation.run.cancelled',
        conversationId,
        runId: run.id,
        reason: message
      });
    } else {
      emit({
        type: 'conversation.run.failed',
        conversationId,
        runId: run.id,
        error: message
      });
    }
    throw error;
  } finally {
    activeRunControllers.delete(run.id);
  }
}

export function cancelRun(runId: string): boolean {
  const controller = activeRunControllers.get(runId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}
