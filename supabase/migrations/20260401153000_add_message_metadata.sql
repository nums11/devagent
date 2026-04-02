alter table public.dev_agent_messages
add column if not exists metadata jsonb not null default '{}'::jsonb;
