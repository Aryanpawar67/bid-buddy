# ⚡ Graph-Based RAG — Adoption Plan for BidTrack

> **TL;DR:** Current RAG silently drops relevant information every time it ranks chunks and cuts off at top-8. Graph RAG replaces the chunk-ranking step with a knowledge graph traversal — so relationships between facts are *never* lost, no matter how many documents they span.

---

## 🔴 The Problem With Current Chunk RAG

```
Current pipeline:
  Document → split into chunks → embed each chunk → store 1024-dim vectors

Retrieval:
  Query → embed → cosine search → RRF top-50 → rerank top-8 → model answers

                          ⚠️ EVERYTHING RANKED BELOW #8 IS SILENTLY DROPPED ⚠️
```

**What gets lost:**

| Scenario | What happens today | What should happen |
|---|---|---|
| Answer is split across 3 docs | At most 1-2 chunks per doc reach top-8 | All 3 fragments retrieved and connected |
| Two facts need to be combined ("iMocha is ISO 27001 certified" + "ISO 27001 covers AES-256 encryption") | Both chunks exist but are ranked independently — the *relationship* is invisible | Graph edge: `iMocha → has_certification → ISO 27001 → implies → AES-256` |
| Client asks "which policies together cover their compliance section?" | Model sees disconnected chunks, often misses | Graph traversal finds the connected subgraph across policy docs |
| Requirement marked NOT SUPPORTED | KB had the info but it was in chunk #12 which was cut | Graph traversal reaches it via entity path |

---

## 🧠 What Is Graph RAG?

Instead of chunking and embedding, an LLM reads documents and extracts a **knowledge graph**:

```
iMocha ──has_certification──► ISO 27001:2022
iMocha ──has_certification──► SOC 2 Type II
iMocha ──uses_model──────────► Azure OpenAI GPT-4o
iMocha ──has_feature──────────► Gap Analysis
Gap Analysis ──applies_to──────► Talent Management (SI)
Gap Analysis ──applies_to──────► Talent Acquisition (TA)
ISO 27001:2022 ──implies──────► AES-256 encryption at rest
ISO 27001:2022 ──implies──────► TLS 1.2+ in transit
Self-Assessment ──part_of──────► Skills Intelligence (SI)
```

**Retrieval** then starts from the query's entities and **traverses edges** — collecting facts that span multiple documents in one hop, instead of hoping they all land in the top-8 chunks.

---

## 📦 Framework Comparison

| Framework | Retrieval method | Best for | Infra cost |
|---|---|---|---|
| **Microsoft GraphRAG** | Leiden community detection + hierarchical summaries | Global thematic queries ("what are the main strengths of iMocha?") | High — needs LLM calls to build summaries |
| **HippoRAG** | Personalized PageRank on entity graph | Multi-hop factual retrieval — connecting facts spread across docs | Medium |
| **LightRAG** | Dual-level: local entity + global relationship retrieval | Balance of quality + cost + incremental updates | Low-Medium |

### ✅ Recommendation for BidTrack: **LightRAG**

- BidTrack's queries are mostly **factual and multi-hop** ("does iMocha support X, Y, and Z together?"), not thematic summaries → HippoRAG / LightRAG fit better than GraphRAG
- LightRAG supports **incremental document ingestion** — new docs added to Knowledge Hub get grafted into the graph without full rebuild
- LightRAG can run **alongside** the existing vector retrieval — hybrid graph+vector is possible and better than either alone
- GraphRAG requires rebuilding the entire graph per corpus change → too slow for BidTrack's live upload workflow

---

## 🏗️ What Needs to Be Built

### New Database Tables

```sql
-- Entities extracted from documents
create table public.kg_entities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,           -- "ISO 27001:2022", "Gap Analysis", "iMocha"
  type          text not null,           -- "certification", "feature", "product", "policy", "integration"
  description   text,                    -- LLM-generated summary of this entity
  embedding     vector(1024),            -- entity-level embedding for semantic entity lookup
  bid_id        uuid references bids(id) on delete cascade,   -- null = global
  created_at    timestamptz default now()
);

-- Relationships between entities (directed edges)
create table public.kg_relationships (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references kg_entities(id) on delete cascade not null,
  target_id     uuid references kg_entities(id) on delete cascade not null,
  relation_type text not null,           -- "has_certification", "implies", "applies_to", "uses_model", "part_of"
  weight        float default 1.0,       -- edge strength (can be boosted by frequency)
  source_doc_id uuid references bid_documents(id) on delete cascade,
  created_at    timestamptz default now()
);

-- Map chunks to the entities they mention (bridge table)
create table public.kg_chunk_entities (
  chunk_id   uuid references bid_document_chunks(id) on delete cascade,
  entity_id  uuid references kg_entities(id) on delete cascade,
  primary key (chunk_id, entity_id)
);
```

> **No changes to `bid_document_chunks` or `bid_documents`** — existing tables remain untouched. Graph is additive.

---

### Updated Ingestion Pipeline

**Current** (`doc-functions.ts`):
```
extractText → chunkText → contextualiseChunks (Haiku) → embedBatch (voyage-3) → insert bid_document_chunks
```

**With Graph RAG** (new step after embedding):
```
extractText → chunkText → contextualiseChunks (Haiku) → embedBatch (voyage-3) → insert bid_document_chunks
                                                                                         │
                                                                               NEW ──────▼──────
                                                                               extractEntitiesAndRelationships (Sonnet/Haiku)
                                                                               → upsert kg_entities
                                                                               → insert kg_relationships
                                                                               → link chunks → kg_chunk_entities
```

**New function: `extractEntitiesAndRelationships(fullDocText, documentId, bidId)`**

```ts
// Called after indexDocument completes chunk insertion
// Uses claude-haiku-4-5-20251001 for cost efficiency (full doc cached as system block)

const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 4096,
  system: [{ type: "text", text: fullDocText, cache_control: { type: "ephemeral" } }],
  messages: [{
    role: "user",
    content: `Extract all entities and relationships from this document.
Return JSON:
{
  "entities": [{ "name": string, "type": string, "description": string }],
  "relationships": [{ "source": string, "target": string, "relation_type": string, "weight": number }]
}
Entity types: certification, feature, product, policy, integration, standard, metric, tool
Relation types: has_certification, implies, applies_to, uses_model, part_of, supports, requires, complies_with`
  }]
});

// Parse → upsert entities (dedup by name+type) → insert relationships → link to chunks
```

---

### Updated Retrieval Pipeline

**New function: `runGraphSearch(query, bidId)`** — called inside the existing `search_knowledge_base` tool alongside `runSearch`:

```
Query
  │
  ├─ runSearch (existing) ────► top-8 chunks via hybrid FTS+vector+rerank
  │
  └─ runGraphSearch (new) ────► entity lookup (embed query → cosine match on kg_entities.embedding)
                                 → Personalized PageRank / BFS from matched entities
                                 → collect all related entities within 2-3 hops
                                 → fetch the chunks linked to those entities (kg_chunk_entities)
                                 → merge with runSearch results, deduplicate
                                 → rerank combined set with rerank-2.5
                                 ► top-8 from merged pool
```

**The key upgrade:** Instead of ranking 50 chunks from a fixed retrieval pool, the model now gets chunks that the **graph proved are connected** to the query entities — even if they scored low in pure cosine distance.

---

### Integration with Existing Agentic Loop

**No changes needed to the agentic loop or SEARCH_TOOL definition** in `stream-chat.ts`.

Only `runSearch` is updated to call both paths internally and merge results before reranking:

```ts
// stream-chat.ts — runSearch update
async function runSearch(query: string, bidId: string | null): Promise<ChunkRow[]> {
  const [vectorChunks, graphChunks] = await Promise.all([
    runVectorSearch(query, bidId),      // existing hybrid_search_chunks RPC
    runGraphSearch(query, bidId),       // NEW: entity graph traversal
  ]);

  const merged = deduplicateByChunkId([...vectorChunks, ...graphChunks]);
  return await rerank(query, merged);  // existing Voyage rerank-2.5 on merged set
}
```

Claude still calls `search_knowledge_base` exactly as before. The upgrade is invisible to the prompt layer.

---

## 📋 Implementation Steps

### Step 1 — Database Migration
- [ ] Write migration: `kg_entities`, `kg_relationships`, `kg_chunk_entities` tables
- [ ] Add `gin` index on `kg_entities.name` for fast dedup lookup
- [ ] Add vector index on `kg_entities.embedding` for entity lookup by query

### Step 2 — Entity Extraction During Ingestion
- [ ] Write `extractEntitiesAndRelationships()` in `doc-functions.ts`
- [ ] Call it at the end of `indexDocument()` after chunk insertion
- [ ] Entity dedup: upsert on `(name, type)` — same entity appearing in multiple docs gets one node, multiple edges
- [ ] Link chunks to entities via `kg_chunk_entities`

### Step 3 — Graph Retrieval Function
- [ ] Write `runGraphSearch(query, bidId)` in `stream-chat.ts`
- [ ] Entity lookup: embed query → cosine match on `kg_entities.embedding` → top-5 entity seeds
- [ ] Graph traversal: BFS or Personalized PageRank up to depth 2 via `kg_relationships`
- [ ] Collect linked chunk IDs from `kg_chunk_entities`
- [ ] Fetch chunk text + doc name → return as `ChunkRow[]`

### Step 4 — Merge Into `runSearch`
- [ ] Run `runVectorSearch` and `runGraphSearch` in parallel (`Promise.all`)
- [ ] Deduplicate by chunk ID
- [ ] Pass merged pool to `rerank()` — Voyage rerank-2.5 re-scores the combined set
- [ ] Return top-8 as before

### Step 5 — Reindex Existing KB
- [ ] Run `reindexAll` (already exists in `doc-functions.ts`) — this re-runs `indexDocument` which will now also call `extractEntitiesAndRelationships` for each doc
- [ ] Monitor entity count and relationship count after reindex

### Step 6 — Verify
- [ ] Query: *"Which of iMocha's certifications cover data-at-rest encryption?"* → should now connect ISO 27001 → AES-256 chain
- [ ] Query: *"Does iMocha support gap analysis for both TA and TM?"* → should traverse `Gap Analysis → applies_to → TA/SI` edges
- [ ] Compare NOT SUPPORTED rate before/after on a test set of Axens requirements

---

## 💰 Cost Estimate

| Step | Model | Cost driver |
|---|---|---|
| Entity extraction at ingestion | Haiku | ~$0.002 per document (full doc cached as system, 4K output) |
| Graph traversal at query time | None (SQL BFS/PPR) | Pure Postgres — no LLM cost |
| Reranking merged pool | Voyage rerank-2.5 | Same as today — just reranking a slightly larger set |

**Entity extraction is a one-time ingestion cost, not a per-query cost.** Query time adds only a SQL graph traversal — effectively free.

---

## 🔗 Related Files

| File | What changes |
|---|---|
| `src/lib/api/doc-functions.ts` | Add `extractEntitiesAndRelationships()`, call from `indexDocument()` |
| `src/lib/api/stream-chat.ts` | Split `runSearch` into `runVectorSearch + runGraphSearch`, merge + rerank |
| `supabase/migrations/` | New migration for `kg_entities`, `kg_relationships`, `kg_chunk_entities` |
| `docs/agentic-rag-architecture.md` | Update retrieval pipeline diagram and future improvements table |

---

> **When to adopt:** After HNSW index is unblocked (Supabase tier upgrade) — the two improvements compound: HNSW gives faster vector recall, graph traversal adds the multi-hop layer that vector search structurally cannot provide.
