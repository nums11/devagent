import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import {
  addMessage,
  createConversation,
  getConversation,
  getWorkspace,
  listActivities,
  listConversations,
  listMessages,
  listRuns,
  listWorkspaces
} from './db.js';
import { createConversationSchema, publishProofMediaSchema, validateWorkspaceSchema, websocketClientMessageSchema } from './schemas.js';
import { cancelRun, runConversationTurn } from './codexBridge.js';
import { refreshAllWorkspaceSyncStatuses, syncWorkspaceFromMain } from './workspaceSync.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';
import type { RuntimeConfig, SocketServerEvent } from './types.js';

const app = express();
app.use(cors({ origin: config.allowedOrigin === '*' ? true : config.allowedOrigin }));
app.use(express.json({ limit: '2mb' }));

const uploadDir = fileURLToPath(new URL('../data/uploads', import.meta.url));
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname) || '.jpg';
      cb(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

app.use('/uploads', express.static(uploadDir));

const proofVideoBucket = 'proof-videos';
const proofImageBucket = 'proof-images';
const sockets = new Set<WebSocket>();

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function inferProofMediaMetadata(localPath: string, fallbackName?: string): {
  fileName: string;
  mimeType: string;
  attachmentType: 'image' | 'video';
} {
  const extension = path.extname(localPath).toLowerCase();
  const fileName = sanitizeFileName(fallbackName || path.basename(localPath));

  if (extension === '.mov') {
    return {
      fileName,
      mimeType: 'video/quicktime',
      attachmentType: 'video'
    };
  }

  if (extension === '.m4v') {
    return {
      fileName,
      mimeType: 'video/x-m4v',
      attachmentType: 'video'
    };
  }

  if (extension === '.png') {
    return {
      fileName,
      mimeType: 'image/png',
      attachmentType: 'image'
    };
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return {
      fileName,
      mimeType: 'image/jpeg',
      attachmentType: 'image'
    };
  }

  if (extension === '.webp') {
    return {
      fileName,
      mimeType: 'image/webp',
      attachmentType: 'image'
    };
  }

  if (extension === '.gif') {
    return {
      fileName,
      mimeType: 'image/gif',
      attachmentType: 'image'
    };
  }

  return {
    fileName,
    mimeType: 'video/mp4',
    attachmentType: 'video'
  };
}

async function publishProofMedia(params: {
  conversationId: string;
  localPath: string;
  content?: string;
  fileName?: string;
  defaultContent: string;
  bucketName: string;
  allowTypes: Array<'image' | 'video'>;
}) {
  const conversation = await getConversation(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found.');
  }

  const localPath = path.resolve(params.localPath);
  const stats = fs.statSync(localPath);
  if (!stats.isFile()) {
    throw new Error('Proof media path must point to a file.');
  }

  const metadata = inferProofMediaMetadata(localPath, params.fileName);
  if (!params.allowTypes.includes(metadata.attachmentType)) {
    throw new Error(
      params.allowTypes.length === 1 && params.allowTypes[0] === 'image'
        ? 'Proof image path must point to a supported image file.'
        : 'Proof media type is not supported for this endpoint.'
    );
  }

  const storagePath = `${conversation.id}/${Date.now()}-${metadata.fileName}`;
  const fileBuffer = fs.readFileSync(localPath);
  const supabase = getSupabaseAdmin();
  let uploadResult = await supabase.storage.from(params.bucketName).upload(storagePath, fileBuffer, {
    contentType: metadata.mimeType,
    upsert: false
  });

  if (uploadResult.error && /bucket/i.test(uploadResult.error.message) && /not found/i.test(uploadResult.error.message)) {
    const createBucketResult = await supabase.storage.createBucket(params.bucketName, {
      public: true
    });

    if (createBucketResult.error && !/already exists/i.test(createBucketResult.error.message)) {
      throw new Error(`Failed to create proof media bucket: ${createBucketResult.error.message}`);
    }

    uploadResult = await supabase.storage.from(params.bucketName).upload(storagePath, fileBuffer, {
      contentType: metadata.mimeType,
      upsert: false
    });
  }

  if (uploadResult.error) {
    throw new Error(`Failed to upload proof media: ${uploadResult.error.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from(params.bucketName).getPublicUrl(storagePath);
  const publicUrl = publicUrlData.publicUrl;
  const message = await addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: params.content || params.defaultContent,
    attachments: [
      {
        id: storagePath,
        type: metadata.attachmentType,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        uploadedPath: storagePath,
        previewUrl: publicUrl,
        mediaUrl: publicUrl
      }
    ]
  });

  const updatedConversation = await getConversation(conversation.id);
  if (updatedConversation) {
    broadcast({
      type: 'conversation.updated',
      conversation: updatedConversation
    });
  }
  broadcast({
    type: 'conversation.message.created',
    conversationId: conversation.id,
    message
  });

  return {
    message,
    storagePath,
    publicUrl
  };
}

function broadcast(event: SocketServerEvent) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

function getRuntimeConfig(): RuntimeConfig {
  return {
    model: config.defaultModel,
    reasoningEffort: config.reasoningEffort,
    sandboxMode: config.sandboxMode,
    approvalPolicy: config.approvalPolicy,
    networkAccessEnabled: config.networkAccessEnabled
  };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'dev-agent-server',
    runtime: getRuntimeConfig()
  });
});

app.get('/api/runtime-config', (_req, res) => {
  res.json({
    runtime: getRuntimeConfig()
  });
});

app.get('/api/conversations', (_req, res) => {
  listConversations()
    .then((conversations) => {
      res.json({ conversations });
    })
    .catch((error) => {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load conversations.'
      });
    });
});

app.get('/api/workspaces', (_req, res) => {
  const shouldRefresh = _req.query.refresh === '1' || _req.query.refresh === 'true';
  (shouldRefresh ? refreshAllWorkspaceSyncStatuses() : listWorkspaces())
    .then((workspaces) => {
      res.json({ workspaces });
    })
    .catch((error) => {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load workspaces.'
      });
    });
});

app.post('/api/workspaces/:workspaceId/sync', async (req, res) => {
  try {
    const workspace = await syncWorkspaceFromMain(req.params.workspaceId);
    res.json({ workspace });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to sync workspace.'
    });
  }
});

app.post('/api/conversations', async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid conversation payload.',
      issues: parsed.error.flatten()
    });
    return;
  }

  try {
    let workspaceId: string | null = parsed.data.workspaceId || null;
    let workspacePath: string | null = parsed.data.workspacePath || null;
    let mode = parsed.data.mode;

    if (workspaceId) {
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found.' });
        return;
      }

      workspacePath = workspace.localPath;
      mode = 'workspace';
    } else {
      workspaceId = null;
      if (mode === 'workspace' && !workspacePath) {
        mode = 'chat';
      }
    }

    const conversation = await createConversation({
      title: parsed.data.title,
      mode,
      workspaceId,
      workspacePath
    });

    res.status(201).json({ conversation });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create conversation.'
    });
  }
});

app.post('/api/workspaces/validate', (req, res) => {
  const parsed = validateWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid workspace validation payload.',
      issues: parsed.error.flatten()
    });
    return;
  }

  const resolvedPath = path.resolve(parsed.data.directoryPath);

  try {
    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({
        valid: false,
        exists: false,
        isDirectory: false,
        resolvedPath,
        message: 'Directory does not exist.'
      });
      return;
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      res.status(400).json({
        valid: false,
        exists: true,
        isDirectory: false,
        resolvedPath,
        message: 'Path exists but is not a directory.'
      });
      return;
    }

    const isGitRepo = fs.existsSync(path.join(resolvedPath, '.git'));
    res.json({
      valid: true,
      exists: true,
      isDirectory: true,
      isGitRepo,
      resolvedPath,
      name: path.basename(resolvedPath),
      message: isGitRepo ? 'Directory is ready and looks like a git repo.' : 'Directory is ready.'
    });
  } catch (error) {
    res.status(500).json({
      valid: false,
      exists: false,
      isDirectory: false,
      resolvedPath,
      message: error instanceof Error ? error.message : 'Failed to validate directory.'
    });
  }
});

app.post('/api/uploads/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Image file is required.' });
    return;
  }

  res.status(201).json({
    attachment: {
      id: req.file.filename,
      type: 'image',
      fileName: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype || null,
      uploadedPath: req.file.path,
      previewUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`,
      mediaUrl: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
    }
  });
});

app.post('/api/conversations/:conversationId/proof-video', async (req, res) => {
  const parsed = publishProofMediaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid proof video payload.',
      issues: parsed.error.flatten()
    });
    return;
  }

  try {
    const result = await publishProofMedia({
      conversationId: req.params.conversationId,
      localPath: parsed.data.localPath,
      fileName: parsed.data.fileName,
      content: parsed.data.content,
      defaultContent: 'Feature verified successfully. Proof video attached.',
      bucketName: proofVideoBucket,
      allowTypes: ['video']
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to publish proof video.'
    });
  }
});

app.post('/api/conversations/:conversationId/proof-image', async (req, res) => {
  const parsed = publishProofMediaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid proof image payload.',
      issues: parsed.error.flatten()
    });
    return;
  }

  try {
    const result = await publishProofMedia({
      conversationId: req.params.conversationId,
      localPath: parsed.data.localPath,
      fileName: parsed.data.fileName,
      content: parsed.data.content,
      defaultContent: 'Simulator screenshot attached.',
      bucketName: proofImageBucket,
      allowTypes: ['image']
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to publish proof image.'
    });
  }
});

app.get('/api/conversations/:conversationId', (req, res) => {
  getConversation(req.params.conversationId)
    .then(async (conversation) => {
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      res.json({
        conversation,
        messages: await listMessages(conversation.id),
        activities: await listActivities(conversation.id),
        runs: await listRuns(conversation.id)
      });
    })
    .catch((error) => {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load conversation.'
      });
    });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  sockets.add(socket);
  socket.send(JSON.stringify({
    type: 'connection.ready',
    runtime: getRuntimeConfig()
  }));

  socket.on('message', async (payload) => {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(String(payload));
    } catch {
      socket.send(JSON.stringify({
        type: 'conversation.run.failed',
        conversationId: null,
        runId: null,
        error: 'Invalid JSON payload.'
      }));
      return;
    }

    const parsedMessage = websocketClientMessageSchema.safeParse(parsedPayload);
    if (!parsedMessage.success) {
      socket.send(JSON.stringify({
        type: 'conversation.run.failed',
        conversationId: null,
        runId: null,
        error: 'Unsupported socket message.'
      }));
      return;
    }

    if (parsedMessage.data.type === 'conversation.run') {
      const trimmedPrompt = parsedMessage.data.prompt.trim();
      if (!trimmedPrompt && parsedMessage.data.attachments.length === 0) {
        socket.send(JSON.stringify({
          type: 'conversation.run.failed',
          conversationId: parsedMessage.data.conversationId,
          runId: null,
          error: 'Add a message or at least one image.'
        }));
        return;
      }

      const emit = (event: SocketServerEvent) => {
        broadcast(event);
      };

      try {
        await runConversationTurn(
          parsedMessage.data.conversationId,
          parsedMessage.data.prompt,
          parsedMessage.data.attachments,
          emit
        );
      } catch {
        // runConversationTurn already emitted a structured failure event
      }
      return;
    }

    if (parsedMessage.data.type === 'conversation.run.cancel') {
      const cancelled = cancelRun(parsedMessage.data.runId);
      if (!cancelled) {
        socket.send(JSON.stringify({
          type: 'conversation.run.failed',
          conversationId: parsedMessage.data.conversationId,
          runId: parsedMessage.data.runId,
          error: 'Run is no longer active.'
        }));
      }
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
  });
});

server.listen(config.port, () => {
  console.log(`dev-agent server listening on http://localhost:${config.port}`);
});
