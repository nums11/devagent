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
import { createConversationSchema, publishProofVideoSchema, validateWorkspaceSchema, websocketClientMessageSchema } from './schemas.js';
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
const sockets = new Set<WebSocket>();

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
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
  const parsed = publishProofVideoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid proof video payload.',
      issues: parsed.error.flatten()
    });
    return;
  }

  try {
    const conversation = await getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const localPath = path.resolve(parsed.data.localPath);
    const stats = fs.statSync(localPath);
    if (!stats.isFile()) {
      res.status(400).json({ error: 'Proof video path must point to a file.' });
      return;
    }

    const extension = path.extname(localPath).toLowerCase() || '.mp4';
    const mimeType =
      extension === '.mov'
        ? 'video/quicktime'
        : extension === '.m4v'
          ? 'video/x-m4v'
          : 'video/mp4';
    const fileName = sanitizeFileName(parsed.data.fileName || path.basename(localPath));
    const storagePath = `${conversation.id}/${Date.now()}-${fileName}`;
    const fileBuffer = fs.readFileSync(localPath);
    const supabase = getSupabaseAdmin();
    const uploadResult = await supabase.storage.from(proofVideoBucket).upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false
    });

    if (uploadResult.error) {
      throw new Error(`Failed to upload proof video: ${uploadResult.error.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from(proofVideoBucket).getPublicUrl(storagePath);
    const publicUrl = publicUrlData.publicUrl;
    const message = await addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: parsed.data.content || 'Feature verified successfully. Proof video attached.',
      attachments: [
        {
          id: storagePath,
          type: 'video',
          fileName,
          mimeType,
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

    res.status(201).json({
      message,
      storagePath,
      publicUrl
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to publish proof video.'
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
