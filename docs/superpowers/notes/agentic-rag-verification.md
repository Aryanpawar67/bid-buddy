# Agentic RAG — Verification Checklist

Track browser verification for each phase before proceeding to the next.

---

## Phase A — Hybrid Search RPC

- [ ] Migration `20260606120000_hybrid_search.sql` applied in Supabase SQL Editor
- [ ] Confirm RPC exists:
  ```sql
  select proname from pg_proc where proname = 'hybrid_search_chunks';
  -- expect: 1 row
  ```
- [ ] `fts` column present on `bid_document_chunks` table
- [ ] GIN index `bid_document_chunks_fts_idx` present
- [ ] Bid session with an indexed doc → ask a doc-specific question → answer includes `[Doc Name]` header before excerpt
- [ ] No retrieval error in a global session (global mode bypasses retrieval today — just confirm no crash)

---

## Phase B — Agentic Tool-Use Loop

- [ ] `bun run build:dev` exits 0 ✓ (done)
- [ ] Bid session → doc-specific question → correct answer cited with `[Doc Name]`; no raw `\x1fSTATUS\x1f` sentinel visible in the UI
- [ ] Conversational follow-up ("what about the deadline for that?") → model rewrites into standalone query and retrieves correctly
- [ ] **Global session** → ask a question whose answer is in a global/template doc → retrieval works (was broken before Phase B)
- [ ] Pure strategy question ("what win themes could we use?") → model answers without calling the search tool
- [ ] Multi-turn: check server logs for `cache_read_input_tokens > 0` on turn 2 (confirms prompt caching is active)
- [ ] After all above pass → drop old RPC:
  ```sql
  drop function if exists public.match_bid_document_chunks;
  ```

---

## Phase C — Ingest Improvements

- [ ] `bun run build:dev` exits 0 ✓ (done)
- [ ] Upload a new test doc → inspect a `bid_document_chunks` row → `chunk_text` begins with a 1-2 sentence context blurb
- [ ] No mid-sentence cuts in any chunk
- [ ] Call `reindexAll` against dev DB → all docs re-indexed (check logs for count)

> **Before moving to Phase D**, tick off all items above:
> 1. Upload a new test doc → inspect a `bid_document_chunks` row → confirm `chunk_text` starts with a context sentence
> 2. No mid-sentence cuts visible in chunk boundaries
> 3. Call `reindexAll` to refresh existing docs (from a dev route or directly via server function)

---

## Phase D — Reranking

- [ ] `bun run build:dev` exits 0 ✓ (done)
- [ ] Ask a question where the best passage is not at the top of RRF order → confirm reranked answer is better
- [ ] Check Voyage API logs: `rerank-2.5` calls present, no 4xx errors
- [ ] Fallback works: temporarily break `VOYAGE_API_KEY` → confirm answer still returns (falls back to RRF top-8)

> **Phase D browser checklist:**
> 1. Ask a question where the best passage isn't at the top of RRF order — confirm reranked answer is better
> 2. Check that `rerank-2.5` calls appear in Voyage API logs with no 4xx errors
> 3. Break `VOYAGE_API_KEY` temporarily → confirm answer still returns (fallback to RRF top-8)

---

## HNSW Index (deferred — memory constraint)

Supabase free tier `maintenance_work_mem` is 32 MB; HNSW requires ~41 MB.

To apply when `maintenance_work_mem` can be raised:
1. Supabase Dashboard → Database → Configuration → Parameters → set `maintenance_work_mem` to `65536` (KB)
2. Run in SQL Editor:
   ```sql
   drop index if exists bid_document_chunks_embedding_idx;
   create index bid_document_chunks_embedding_hnsw_idx
     on public.bid_document_chunks using hnsw (embedding vector_cosine_ops)
     with (m = 8, ef_construction = 64);
   ```
