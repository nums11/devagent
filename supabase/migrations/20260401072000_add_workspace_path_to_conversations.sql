alter table public.dev_agent_conversations
add column if not exists workspace_path text;
