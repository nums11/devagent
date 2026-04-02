create table if not exists public.dev_agent_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local_path text not null,
  mode text not null default 'workspace',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid references public.dev_agent_workspaces(id) on delete set null,
  title text not null,
  mode text not null default 'chat',
  codex_thread_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dev_agent_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_agent_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dev_agent_conversations(id) on delete cascade,
  status text not null,
  prompt text not null,
  final_response text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.dev_agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dev_agent_runs(id) on delete cascade,
  artifact_kind text not null,
  storage_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.dev_agent_workspaces enable row level security;
alter table public.dev_agent_conversations enable row level security;
alter table public.dev_agent_messages enable row level security;
alter table public.dev_agent_runs enable row level security;
alter table public.dev_agent_artifacts enable row level security;

