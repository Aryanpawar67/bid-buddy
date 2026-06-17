# Agentic RAG — Design Spec
_Feature: 2.6 · Route: `/ai` (upgrade) · Date: 2026-06-06_

---

## Overview

Upgrade the AI Command Center's retrieval pipeline from classic single-shot RAG to **Agentic RAG**: Claude drives retrieval via a `search_knowledge_base` tool in a capped loop rather than having chunks blindly stuffed into the system prompt before the model is called. The upgrade is additive — the UI and session storage are unchanged; only the server-side inference path and document ingestion are replaced.

---

## What's Wrong Today

| Gap | Location | Impact |
|---|---|---|
| Global mode has zero retrieval | `stream-chat.ts:127-130` | Global sessions answer purely from model knowledge |
| Raw last message embedded (no query rewriting) | `stream-chat.ts:95` | Conversational follow-ups ("what about that deadline?") retrieve junk |
| No similarity threshold | `match_bid_document_chunks` RPC | Low-relevance chunks pollute the context |
| Vector-only retrieval | `20260605140000_knowledge_hub.sql` | Misses keyword-heavy RFP clauses that FTS would catch |
| No doc-name/source in retrieval result | RPC returns `(chunk_text, similarity)` only | Model cannot cite sources |
| Global/template docs (`bid_id IS NULL`) never retrievable | RPC filters `bid_id = match_bid_id` | Reference templates are invisible to the assistant |
| Fixed character-slice chunking | `doc-functions.ts:7-15` | Splits mid-sentence; semantics lost at boundaries |
| No contextual enrichment at ingest | — | Isolated chunks lack situating context, degrading recall |
| Single-shot — model cannot search again | `stream-chat.ts:141-173` | Multi-hop questions or follow-up queries cannot be answered from docs |
| No prompt caching | — | Repeated system prompt re-prefilled on every turn |

---

## Architecture

### Retrieval Path (per message)

```
User message
     │
     ▼
[Agentic loop — max 3 rounds]
     │
     ├─ anthropic.messages.stream({tools: [search_knowledge_base], ...})
     │         │
     │         ├─ stop_reason === "tool_use"  ─► emit status line ─► runSearch ─► tool_result ─► loop
     │         │
     │         └─ stop_reason === "end_turn"  ─► stream text deltas to client ─► done
     │
     └─ round cap → reissue with tool_choice:"none" → stream final answer
```

### `search_knowledge_base` Tool

The model calls this tool with a **rewritten, self-contained query** (it resolves pronouns and follow-up context from the conversation). The tool:

1. Embeds the query via Voyage AI (`voyage-3`, 1024-dim).
2. Calls the new `hybrid_search_chunks` Postgres RPC (vector CTE + FTS CTE fused with RRF).
3. Returns formatted passages tagged with their source document name.

Model decides when to search, what to search for, and whether to search again — up to 3 rounds.

### Hybrid Search RPC (`hybrid_search_chunks`)

Replaces `match_bid_document_chunks`. Two ranked CTEs:

- **Vector arm:** pgvector cosine similarity with a `min_similarity` floor (0.4 in practice). HNSW index (replaces ivfflat).
- **FTS arm:** Postgres `websearch_to_tsquery` + `ts_rank_cd` on a generated `fts tsvector` column. GIN index.

Fused with **Reciprocal Rank Fusion** (`1/(k+rank)`, k=50) — scores never need normalizing. Returns `(chunk_id, document_id, doc_name, bid_id, chunk_index, chunk_text, similarity, rrf_score)`.

**Scope logic:**
- `match_bid_id IS NULL` → global/template docs only (global mode).
- `match_bid_id` set → that bid's documents **plus** global templates. Reference docs serve every bid.

### Streaming Protocol

The server returns the same `text/plain` UTF-8 stream as today. Status lines use an unambiguous sentinel:

```
\x1fSTATUS\x1f{"kind":"search","query":"..."}\n
```

`\x1f` (ASCII Unit Separator) never appears in model prose or document text. The client strips complete sentinel records before appending to `assistantContent`; unrecognised records are silently dropped. A transient "Searching: …" indicator in the chat panel is optional polish.

### Prompt Caching

`system` is passed as a block array; `cache_control: {type:"ephemeral"}` is set on the last block. Tool schemas and the stable system prefix are cached; retrieved chunk tool_results live in `messages` after the breakpoint. Minimum cacheable prefix for Opus 4.8 is 4096 tokens — silently a no-op on small bids, harmless.

### Ingest Path (Phase C)

1. **Sentence-aware chunking** — split on paragraph breaks then sentence boundaries, greedy-pack to ~1800 chars with ~180-char overlap. Eliminates mid-sentence cuts.
2. **Contextual Retrieval** — per chunk, generate a 50–100 token situating blurb with `claude-haiku-4-5` (full document cached as a system block, ~$1/1M doc tokens one-time). Prepend blurb to `chunk_text` before embedding and storage (the generated `fts` tsvector column picks it up automatically).
3. **Re-index on upgrade** — `reindexAll` server fn iterates all `bid_documents`, calls `indexDocument` (idempotent: deletes stale chunks, re-extracts, re-chunks, re-contextualises, re-embeds). Mixed state during rollout is safe (same 1024-dim voyage-3 vectors).

### Reranking (Phase D)

After hybrid RPC returns ~50 candidates, call Voyage `rerank-2.5` (`top_k: 8`). Uses the same `VOYAGE_API_KEY`. Failure → fall back to RRF order. `rerank-2.5-lite` is the latency-escape-hatch swap.

---

## Mode Behaviour (updated)

| | Bid mode | Global mode |
|---|---|---|
| System prompt | Bid fields + questions/deliverables + tool | Tool + persona only |
| Retrieval | Bid docs + global templates (via tool) | Global/template docs (via tool) |
| Rounds | 0–3 | 0–3 |
| Status lines | Emitted per search | Emitted per search |
| Quick actions | Bid-scoped (unchanged) | Hidden (unchanged) |
| Session storage | Unchanged | Unchanged |

---

## Latency Profile

| Phase | TTFT impact | Notes |
|---|---|---|
| A (hybrid RPC) | Neutral | Extra FTS CTE on GIN index ≈ single-digit ms |
| B (agentic loop) | Neutral (no-search path); +bounded on search path | Status lines fill wait time; capped at 3 rounds; caching reduces prefill |
| C (ingest) | None | Ingest-only change |
| D (reranking) | +100–400ms per search | Inside "Searching…" window; `-lite` variant as escape hatch |

---

## Data Changes

### New migration: `20260606120000_hybrid_search.sql`

- `bid_document_chunks.fts` — generated `tsvector` column + GIN index.
- Replace ivfflat embedding index with HNSW (`vector_cosine_ops`).
- New RPC `hybrid_search_chunks(query_text, query_embedding, match_bid_id, match_count, rrf_k, full_text_weight, semantic_weight, min_similarity)`.
- **Old RPC `match_bid_document_chunks` kept** until Phase B is browser-verified, then dropped in a follow-up migration.

No changes to `ai_sessions`, `bid_documents`, or `bid_document_chunks` table columns (the generated `fts` column and index are additive).

---

## Environment Variables

No new variables. `ANTHROPIC_API_KEY` (loop + Haiku contextualiser) and `VOYAGE_API_KEY` (embed + rerank) are already set.

---

## Security

All unchanged from 2.5: `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` accessed only inside `createServerFn` handlers, input validated with Zod, model string validated against allowlist, `ai_sessions` RLS policy unchanged.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/20260606120000_hybrid_search.sql` | New — FTS column, HNSW index, `hybrid_search_chunks` RPC |
| `src/lib/api/stream-chat.ts` | Rewrite handler — agentic loop, tool, runSearch, status protocol, caching |
| `src/lib/ai-queries.ts` | Update stream reader — strip `\x1f` status records, optional status state |
| `src/lib/api/doc-functions.ts` | Update `indexDocument` — sentence chunking, Haiku contextualiser, `reindexAll` fn |
| `src/components/ai/AiChatPanel.tsx` | Optional — transient "Searching: …" indicator |

---

## Out of Scope

- Multi-agent or graph RAG orchestration (overkill; 3–10× tokens for marginal gain on this dataset).
- Separate vector database (pgvector on Supabase is sufficient at this scale).
- Per-org or per-bid retrieval tuning dashboards.
- Streaming tool-use reasoning steps to the client (thinking blocks stay omitted).
- Hard per-user rate limits on search rounds (informational counter unchanged from 2.5).
