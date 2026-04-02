create table if not exists public.dev_agent_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dev_agent_runs(id) on delete cascade,
  conversation_id uuid not null references public.dev_agent_conversations(id) on delete cascade,
  sequence integer not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (run_id, sequence)
);

create table if not exists public.dev_agent_activity_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dev_agent_runs(id) on delete cascade,
  conversation_id uuid not null references public.dev_agent_conversations(id) on delete cascade,
  source_key text not null,
  kind text not null,
  title text not null,
  detail text,
  status text not null default 'completed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (run_id, source_key)
);

create index if not exists dev_agent_run_events_conversation_id_idx
on public.dev_agent_run_events (conversation_id, created_at);

create index if not exists dev_agent_activity_items_conversation_id_idx
on public.dev_agent_activity_items (conversation_id, created_at);

alter table public.dev_agent_run_events enable row level security;
alter table public.dev_agent_activity_items enable row level security;
