-- ── ai_sessions ───────────────────────────────────────────────────────────────
create table if not exists public.ai_sessions (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid references public.bids(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  model       text not null,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.ai_sessions enable row level security;

create policy "Users manage own sessions"
  on public.ai_sessions for all
  using (user_id = auth.uid());

-- ── match_bid_document_chunks RPC ─────────────────────────────────────────────
-- Requires pgvector (already enabled from Knowledge Hub migration 20260605140000)
create or replace function public.match_bid_document_chunks(
  query_embedding vector(1024),
  match_bid_id    uuid,
  match_count     int default 8
)
returns table (chunk_text text, similarity float)
language sql stable as $$
  select chunk_text, 1 - (embedding <=> query_embedding) as similarity
  from public.bid_document_chunks
  where document_id in (
    select id from public.bid_documents where bid_id = match_bid_id
  )
  order by embedding <=> query_embedding
  limit match_count;
$$;
