import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { ApprovalMode, ModelReasoningEffort, SandboxMode } from '@openai/codex-sdk';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, '../.env') });

const DEFAULT_PORT = 4242;

function readEnv(name: string, fallback = ''): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value);
}

export const config = {
  port: Number(process.env.PORT || DEFAULT_PORT),
  allowedOrigin: readEnv('DEV_AGENT_ALLOWED_ORIGIN', '*'),
  workspaceRoot: readEnv('CODEX_WORKSPACE_ROOT', '/Users/team7agent'),
  defaultModel: readEnv('CODEX_DEFAULT_MODEL', 'gpt-5.4'),
  reasoningEffort: readEnv('CODEX_REASONING_EFFORT', 'high') as ModelReasoningEffort,
  sandboxMode: readEnv('CODEX_SANDBOX_MODE', 'danger-full-access') as SandboxMode,
  approvalPolicy: readEnv('CODEX_APPROVAL_POLICY', 'never') as ApprovalMode,
  networkAccessEnabled: readBooleanEnv('CODEX_NETWORK_ACCESS', true),
  supabaseUrl: readEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY')
};
