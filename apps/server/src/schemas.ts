import { z } from 'zod';

export const imageAttachmentSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  uploadedPath: z.string().min(1),
  previewUrl: z.string().min(1),
  mimeType: z.string().min(1).optional().nullable(),
  type: z.enum(['image', 'video']).optional(),
  mediaUrl: z.string().min(1).optional().nullable()
});

export const publishProofVideoSchema = z.object({
  localPath: z.string().min(1),
  fileName: z.string().min(1).optional(),
  content: z.string().trim().max(1000).optional()
});

export const createConversationSchema = z.object({
  title: z.string().min(1).max(160),
  mode: z.enum(['chat', 'workspace', 'harness']).default('chat'),
  workspacePath: z.string().trim().min(1).optional().nullable()
});

export const validateWorkspaceSchema = z.object({
  directoryPath: z.string().trim().min(1)
});

export const websocketClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation.run'),
    conversationId: z.string().min(1),
    prompt: z.string(),
    attachments: z.array(imageAttachmentSchema).default([])
  }),
  z.object({
    type: z.literal('conversation.run.cancel'),
    conversationId: z.string().min(1),
    runId: z.string().min(1)
  })
]);
