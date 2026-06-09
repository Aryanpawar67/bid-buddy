-- 1. Drop ivfflat FIRST so the table-rewrite triggered by adding the stored
--    generated column below does not try to rebuild it (that rebuild is what
--    requires 41 MB and exceeds Supabase's 32 MB maintenance_work_mem cap).
--    HNSW will be added manually once maintenance_work_mem can be raised.
drop index if exists bid_document_chunks_embedding_idx;

-- 2. Add generated FTS column — now the table rewrite has no heavy index to rebuild.
alter table public.bid_document_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', chunk_text)) stored;

-- GIN index on tsvector is small and builds well within 32 MB.
create index if not exists bid_document_chunks_fts_idx
  on public.bid_document_chunks using gin (fts);

-- 3. HNSW deferred — apply manually after raising maintenance_work_mem to 64 MB
--    via Supabase dashboard → Database → Configuration → Parameters.
--
-- create index bid_document_chunks_embedding_hnsw_idx
--   on public.bid_document_chunks using hnsw (embedding vector_cosine_ops)
--   with (m = 8, ef_construction = 64);

-- 3. Hybrid search RPC
--    match_bid_id NULL  => global docs only
--    match_bid_id set   => that bid's docs + global templates (bid_id IS NULL)
create or replace function public.hybrid_search_chunks(
  query_text       text,
  query_embedding  vector(1024),
  match_bid_id     uuid    default null,
  match_count      int     default 8,
  rrf_k            int     default 50,
  full_text_weight float   default 1.0,
  semantic_weight  float   default 1.0,
  min_similarity   float   default 0.0
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  doc_name    text,
  bid_id      uuid,
  chunk_index int,
  chunk_text  text,
  similarity  float,
  rrf_score   float
)
language sql stable as $$
with scope as (
  select id, name, bid_id from public.bid_documents
  where (match_bid_id is null and bid_id is null)
     or (match_bid_id is not null
         and (bid_id = match_bid_id or bid_id is null))
),
fts as (
  select c.id,
         row_number() over (
           order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
         ) as rank
  from public.bid_document_chunks c
  join scope s on s.id = c.document_id
  where c.fts @@ websearch_to_tsquery('english', query_text)
  order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
  limit least(match_count * 6, 60)
),
vec as (
  select c.id,
         1 - (c.embedding <=> query_embedding) as similarity,
         row_number() over (order by c.embedding <=> query_embedding) as rank
  from public.bid_document_chunks c
  join scope s on s.id = c.document_id
  where 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(match_count * 6, 60)
)
select
  c.id                                                         as chunk_id,
  c.document_id,
  s.name                                                       as doc_name,
  s.bid_id,
  c.chunk_index,
  c.chunk_text,
  coalesce(v.similarity, 0)                                    as similarity,
  (coalesce(1.0 / (rrf_k + f.rank), 0.0) * full_text_weight
   + coalesce(1.0 / (rrf_k + v.rank), 0.0) * semantic_weight) as rrf_score
from fts f
full outer join vec v on v.id = f.id
join public.bid_document_chunks c on c.id = coalesce(f.id, v.id)
join scope s on s.id = c.document_id
order by rrf_score desc
limit match_count;
$$;

-- NOTE: match_bid_document_chunks is intentionally NOT dropped here.
-- It is the rollback anchor for Phase B. Drop it after Phase B is browser-verified.
