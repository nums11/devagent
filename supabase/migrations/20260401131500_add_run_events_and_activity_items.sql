create table if not exists public.dev_agent_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dev_agent_runs(id) on delete cascade,
  sequence integer not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists dev_agent_run_events_run_id_sequence_idx
on public.dev_agent_run_events (run_id, sequence);

create table if not exists public.dev_agent_run_activity_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dev_agent_runs(id) on delete cascade,
  source_key text not null,
  sequence integer not null,
  activity_kind text not null,
  status text not null default 'completed',
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint dev_agent_run_activity_items_run_id_source_key_key unique (run_id, source_key)
);

create index if not exists dev_agent_run_activity_items_run_id_sequence_idx
on public.dev_agent_run_activity_items (run_id, sequence);

alter table public.dev_agent_run_events enable row level security;
alter table public.dev_agent_run_activity_items enable row level security;
