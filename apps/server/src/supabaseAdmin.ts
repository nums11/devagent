import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

let client: SupabaseClient | null = null;

function requireConfig(name: string, value: string): string {
  if (!value) {
    throw new Error(`Missing required server config: ${name}`);
  }

  return value;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  client = createClient(
    requireConfig('SUPABASE_URL', config.supabaseUrl),
    requireConfig('SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceRoleKey),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  return client;
}
