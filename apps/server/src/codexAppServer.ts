import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

type RequestId = number;

type JsonRpcSuccess = {
  id: RequestId;
  result: unknown;
};

type JsonRpcError = {
  id: RequestId;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcRequest = {
  id: RequestId;
  method: string;
  params?: unknown;
};

export type AppServerTurn = {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: {
    message: string;
    additionalDetails?: string | null;
    codexErrorInfo?: unknown;
  } | null;
};

export type AppServerThread = {
  id: string;
  cwd: string;
  preview: string;
};

export type AppServerNotification =
  | { method: 'turn/started'; params: { threadId: string; turn: AppServerTurn } }
  | { method: 'turn/completed'; params: { threadId: string; turn: AppServerTurn } }
  | {
      method: 'item/started' | 'item/completed';
      params: { threadId: string; turnId: string; item: Record<string, unknown> & { id: string; type: string } };
    }
  | { method: 'item/agentMessage/delta'; params: { threadId: string; turnId: string; itemId: string; delta: string } }
  | {
      method:
        | 'item/reasoning/textDelta'
        | 'item/reasoning/summaryTextDelta'
        | 'item/reasoning/summaryPartAdded';
      params: { threadId: string; turnId: string; itemId: string; delta?: string; contentIndex?: number; summaryIndex?: number };
    }
  | {
      method: 'item/commandExecution/outputDelta' | 'command/exec/outputDelta';
      params: { threadId: string; turnId: string; itemId: string; delta: string };
    }
  | {
      method: 'item/commandExecution/terminalInteraction';
      params: { threadId: string; turnId: string; itemId: string; stdin: string };
    }
  | {
      method: 'error';
      params: {
        threadId: string;
        turnId: string;
        willRetry: boolean;
        error: {
          message: string;
          additionalDetails?: string | null;
          codexErrorInfo?: unknown;
        };
      };
    }
  | { method: string; params?: unknown };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function resolveCodexBinary(): string {
  const envOverride = process.env.CODEX_APP_SERVER_BIN?.trim();
  if (envOverride) {
    return envOverride;
  }

  const desktopBinary = '/Applications/Codex.app/Contents/Resources/codex';
  if (existsSync(desktopBinary)) {
    return desktopBinary;
  }

  return 'codex';
}

function isJsonRpcResponse(value: unknown): value is JsonRpcSuccess | JsonRpcError {
  return typeof value === 'object' && value !== null && 'id' in value && ('result' in value || 'error' in value);
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === 'object' && value !== null && 'id' in value && 'method' in value;
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return typeof value === 'object' && value !== null && 'method' in value && !('id' in value);
}

class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private pending = new Map<RequestId, PendingRequest>();
  private nextRequestId = 1;
  private readyPromise: Promise<void> | null = null;

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.start();
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  async startThread(params: {
    cwd?: string | null;
    model?: string | null;
    approvalPolicy?: string | null;
    sandbox?: string | null;
    developerInstructions?: string | null;
    baseInstructions?: string | null;
    config?: Record<string, unknown> | null;
  }): Promise<{ thread: AppServerThread }> {
    const result = await this.request('thread/start', {
      model: params.model ?? null,
      cwd: params.cwd ?? null,
      approvalPolicy: params.approvalPolicy ?? null,
      sandbox: params.sandbox ?? null,
      developerInstructions: params.developerInstructions ?? null,
      baseInstructions: params.baseInstructions ?? null,
      config: params.config ?? null,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });

    return result as { thread: AppServerThread };
  }

  async resumeThread(params: {
    threadId: string;
    cwd?: string | null;
    model?: string | null;
    approvalPolicy?: string | null;
    sandbox?: string | null;
    developerInstructions?: string | null;
    baseInstructions?: string | null;
    config?: Record<string, unknown> | null;
  }): Promise<{ thread: AppServerThread }> {
    const result = await this.request('thread/resume', {
      threadId: params.threadId,
      model: params.model ?? null,
      cwd: params.cwd ?? null,
      approvalPolicy: params.approvalPolicy ?? null,
      sandbox: params.sandbox ?? null,
      developerInstructions: params.developerInstructions ?? null,
      baseInstructions: params.baseInstructions ?? null,
      config: params.config ?? null,
      persistExtendedHistory: true
    });

    return result as { thread: AppServerThread };
  }

  async startTurn(params: {
    threadId: string;
    input: Array<Record<string, unknown>>;
    cwd?: string | null;
    model?: string | null;
    approvalPolicy?: string | null;
    effort?: string | null;
    outputSchema?: unknown;
  }): Promise<{ turn: AppServerTurn }> {
    const result = await this.request('turn/start', {
      threadId: params.threadId,
      input: params.input,
      cwd: params.cwd ?? null,
      model: params.model ?? null,
      approvalPolicy: params.approvalPolicy ?? null,
      effort: params.effort ?? null,
      outputSchema: params.outputSchema ?? null
    });

    return result as { turn: AppServerTurn };
  }

  async steerTurn(params: {
    threadId: string;
    turnId: string;
    input: Array<Record<string, unknown>>;
  }): Promise<{ turnId: string }> {
    const result = await this.request('turn/steer', {
      threadId: params.threadId,
      expectedTurnId: params.turnId,
      input: params.input
    });

    return result as { turnId: string };
  }

  async interruptTurn(params: { threadId: string; turnId: string }): Promise<void> {
    await this.request('turn/interrupt', {
      threadId: params.threadId,
      turnId: params.turnId
    });
  }

  private async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const binary = resolveCodexBinary();
    const child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: process.env
    });

    this.child = child;
    this.reader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    this.reader.on('line', (line) => {
      void this.handleLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.error(`[codex app-server] ${message}`);
      }
    });

    child.on('error', (error) => {
      this.handleFatalError(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('close', () => {
      this.handleFatalError(new Error('Codex app-server closed unexpectedly.'));
    });

    await this.sendRequest('initialize', {
      clientInfo: {
        name: 'dev-agent',
        version: '0.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  private handleFatalError(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.reader?.close();
    this.reader = null;
    this.child = null;
    this.readyPromise = null;
    this.emit('fatal-error', error);
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      console.error('[codex app-server] Failed to parse JSON line:', trimmed, error);
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }

      this.pending.delete(parsed.id);
      if ('error' in parsed) {
        pending.reject(new Error(parsed.error?.message || 'Codex app-server request failed.'));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    if (isJsonRpcRequest(parsed)) {
      await this.respondToServerRequest(parsed);
      return;
    }

    if (isJsonRpcNotification(parsed)) {
      this.emit('notification', parsed as AppServerNotification);
    }
  }

  private async respondToServerRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.child?.stdin.writable) {
      return;
    }

    const response = {
      id: request.id,
      error: {
        code: -32601,
        message: `Unsupported app-server request in Dev Agent: ${request.method}`
      }
    };
    this.child.stdin.write(`${JSON.stringify(response)}\n`);
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureReady();

    return this.sendRequest(method, params);
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.child && method !== 'initialize') {
      await this.ensureReady();
    }

    if (!this.child?.stdin.writable) {
      throw new Error('Codex app-server stdin is not writable.');
    }

    const id = this.nextRequestId++;
    const payload = {
      id,
      method,
      params
    };

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return responsePromise;
  }
}

let singletonClient: CodexAppServerClient | null = null;

export function getCodexAppServerClient(): CodexAppServerClient {
  if (!singletonClient) {
    singletonClient = new CodexAppServerClient();
  }

  return singletonClient;
}
