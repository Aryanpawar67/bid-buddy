-- Feature A: named sessions
alter table public.ai_sessions
  add column if not exists title text;

-- Feature C: track generated vs uploaded documents
alter table public.bid_documents
  add column if not exists source text not null default 'uploaded'
    check (source in ('uploaded', 'generated'));
