insert into public.dev_agent_repo_profiles (
  slug,
  name,
  base_local_path,
  default_branch
)
values
  ('dev-agent', 'Dev Agent', '/Users/team7agent/dev-agent', 'main'),
  ('stick2it', 'Stick2It', '/Users/team7agent/stick2it', 'main')
on conflict (slug) do update
set
  name = excluded.name,
  base_local_path = excluded.base_local_path,
  default_branch = excluded.default_branch,
  updated_at = timezone('utc', now());

insert into public.dev_agent_workspaces (
  slug,
  name,
  local_path,
  mode,
  repo_profile_id,
  branch_name,
  simulator_name,
  simulator_udid,
  metro_port,
  env_label,
  supabase_project_ref,
  state,
  sync_status,
  sort_order,
  updated_at
)
values
  (
    'dev-agent-main',
    'Dev Agent Main',
    '/Users/team7agent/dev-agent',
    'workspace',
    (select id from public.dev_agent_repo_profiles where slug = 'dev-agent'),
    'main',
    'iPhone 17 Pro',
    '8657A45D-D490-4DB2-9CE5-D3463D0CF7A0',
    8081,
    'local',
    'jwlufexthvvqboiambgd',
    'active',
    'fresh',
    10,
    timezone('utc', now())
  ),
  (
    'stick2it-feature-a',
    'Stick2It Feature A',
    '/Users/team7agent/worktrees/stick2it/feature-a',
    'workspace',
    (select id from public.dev_agent_repo_profiles where slug = 'stick2it'),
    'agent/feature-a',
    'iPhone 17',
    'D6CAAC93-11DE-4EDF-A684-A76E6A01285F',
    8082,
    'test',
    'zxelwjziupmjtdvutbsv',
    'active',
    'fresh',
    20,
    timezone('utc', now())
  ),
  (
    'stick2it-feature-b',
    'Stick2It Feature B',
    '/Users/team7agent/worktrees/stick2it/feature-b',
    'workspace',
    (select id from public.dev_agent_repo_profiles where slug = 'stick2it'),
    'agent/feature-b',
    'iPhone 16 Pro',
    'A6550F0E-0B93-425E-9438-19D6974B724D',
    8083,
    'test-b-pending',
    null,
    'active',
    'fresh',
    30,
    timezone('utc', now())
  )
on conflict (slug) do update
set
  name = excluded.name,
  local_path = excluded.local_path,
  mode = excluded.mode,
  repo_profile_id = excluded.repo_profile_id,
  branch_name = excluded.branch_name,
  simulator_name = excluded.simulator_name,
  simulator_udid = excluded.simulator_udid,
  metro_port = excluded.metro_port,
  env_label = excluded.env_label,
  supabase_project_ref = excluded.supabase_project_ref,
  state = excluded.state,
  sync_status = excluded.sync_status,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());
