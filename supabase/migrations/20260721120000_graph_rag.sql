-- ── Graph RAG: knowledge graph tables ────────────────────────────────────────
-- kg_entities  — named entities extracted from indexed documents
-- kg_relationships — directed edges between entities
-- kg_chunk_entities — junction: which chunks mention which entities

create table if not exists public.kg_entities (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.bid_documents(id) on delete cascade,
  name          text not null,
  type          text not null,   -- STANDARD|FEATURE|INTEGRATION|CONCEPT|PRODUCT|POLICY|METRIC|ORG
  description   text,
  embedding     vector(1024),
  fts           tsvector generated always as (
                  to_tsvector('english', name || ' ' || coalesce(description, ''))
                ) stored,
  created_at    timestamptz default now()
);

create index if not exists kg_entities_doc_idx      on public.kg_entities(document_id);
create index if not exists kg_entities_fts_idx      on public.kg_entities using gin(fts);

create table if not exists public.kg_relationships (
  id                 uuid primary key default gen_random_uuid(),
  source_entity_id   uuid not null references public.kg_entities(id) on delete cascade,
  target_entity_id   uuid not null references public.kg_entities(id) on delete cascade,
  relationship_type  text not null,  -- REQUIRES|SUPPORTS|PART_OF|INTEGRATES_WITH|USES|COMPLIES_WITH|MEASURES
  description        text,
  document_id        uuid references public.bid_documents(id) on delete cascade,
  created_at         timestamptz default now()
);

create index if not exists kg_relationships_source_idx on public.kg_relationships(source_entity_id);
create index if not exists kg_relationships_target_idx on public.kg_relationships(target_entity_id);

-- Uses document_id + chunk_index to identify chunks (matches how chunks are inserted)
create table if not exists public.kg_chunk_entities (
  document_id   uuid not null references public.bid_documents(id) on delete cascade,
  chunk_index   int not null,
  entity_id     uuid not null references public.kg_entities(id) on delete cascade,
  primary key (document_id, chunk_index, entity_id)
);

create index if not exists kg_chunk_entities_entity_idx on public.kg_chunk_entities(entity_id);
create index if not exists kg_chunk_entities_doc_idx    on public.kg_chunk_entities(document_id);

-- RLS: service role bypasses; org members can read
alter table public.kg_entities       enable row level security;
alter table public.kg_relationships  enable row level security;
alter table public.kg_chunk_entities enable row level security;

create policy "org members read kg_entities"
  on public.kg_entities for select using (auth.uid() is not null);
create policy "service role kg_entities"
  on public.kg_entities for all to service_role using (true);

create policy "org members read kg_relationships"
  on public.kg_relationships for select using (auth.uid() is not null);
create policy "service role kg_relationships"
  on public.kg_relationships for all to service_role using (true);

create policy "org members read kg_chunk_entities"
  on public.kg_chunk_entities for select using (auth.uid() is not null);
create policy "service role kg_chunk_entities"
  on public.kg_chunk_entities for all to service_role using (true);
