create table if not exists public.dev_agent_repo_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  base_local_path text not null,
  default_branch text not null default 'main',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.dev_agent_repo_profiles enable row level security;

alter table public.dev_agent_workspaces
  add column if not exists slug text,
  add column if not exists repo_profile_id uuid references public.dev_agent_repo_profiles(id) on delete set null,
  add column if not exists branch_name text,
  add column if not exists simulator_name text,
  add column if not exists simulator_udid text,
  add column if not exists metro_port integer,
  add column if not exists env_label text,
  add column if not exists supabase_project_ref text,
  add column if not exists state text not null default 'active',
  add column if not exists sync_status text not null default 'fresh',
  add column if not exists behind_count integer not null default 0,
  add column if not exists ahead_count integer not null default 0,
  add column if not exists last_synced_main_sha text,
  add column if not exists last_sync_checked_at timestamptz,
  add column if not exists sort_order integer not null default 0;

update public.dev_agent_workspaces
set slug = concat(
  'workspace-',
  substr(replace(id::text, '-', ''), 1, 8)
)
where slug is null or btrim(slug) = '';

update public.dev_agent_workspaces
set slug = concat(
  coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'workspace'),
  '-',
  substr(replace(id::text, '-', ''), 1, 8)
)
where slug like 'workspace-%';

alter table public.dev_agent_workspaces
  alter column slug set not null,
  alter column slug set default concat(
    'workspace-',
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );

create unique index if not exists dev_agent_workspaces_slug_key on public.dev_agent_workspaces(slug);
create index if not exists dev_agent_workspaces_repo_profile_id_idx on public.dev_agent_workspaces(repo_profile_id);
create index if not exists dev_agent_workspaces_state_sort_order_idx
  on public.dev_agent_workspaces(state, sort_order, name);
