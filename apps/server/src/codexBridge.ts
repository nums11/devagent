import fs from 'node:fs';
import path from 'node:path';
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

function buildRunInput(prompt: string, attachments: ImageAttachment[]): Input {
  if (!attachments.length) {
    return prompt;
  }

  const items: Extract<Input, unknown[]> = [];
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) {
    items.push({
      type: 'text',
      text: trimmedPrompt
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

    const streamed = await thread.runStreamed(buildRunInput(prompt, attachments), {
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
    await completeRun(run.id, finalResponse);

    emit({
      type: 'conversation.run.completed',
      conversationId,
      runId: run.id,
      finalResponse
    });
  } catch (error) {
    await failRun(run.id);
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
