alter table public.dev_agent_conversations
  add column if not exists last_viewed_at timestamptz,
  add column if not exists last_agent_update_at timestamptz,
  add column if not exists active_run_started_at timestamptz;

with latest_assistant_messages as (
  select
    conversation_id,
    max(created_at) as last_assistant_at
  from public.dev_agent_messages
  where role = 'assistant'
  group by conversation_id
)
update public.dev_agent_conversations conversations
set
  last_agent_update_at = coalesce(conversations.last_agent_update_at, latest_assistant_messages.last_assistant_at, conversations.updated_at),
  last_viewed_at = coalesce(conversations.last_viewed_at, latest_assistant_messages.last_assistant_at, conversations.updated_at),
  active_run_started_at = null
from latest_assistant_messages
where conversations.id = latest_assistant_messages.conversation_id;

update public.dev_agent_conversations
set
  last_agent_update_at = coalesce(last_agent_update_at, updated_at),
  last_viewed_at = coalesce(last_viewed_at, updated_at),
  active_run_started_at = null
where last_agent_update_at is null
   or last_viewed_at is null
   or active_run_started_at is distinct from null;
