-- Add pinned_doc_ids to ai_sessions so attached documents remain in context
-- across all turns and browser sessions for the lifetime of the chat session.
alter table public.ai_sessions
  add column if not exists pinned_doc_ids uuid[] not null default '{}';
