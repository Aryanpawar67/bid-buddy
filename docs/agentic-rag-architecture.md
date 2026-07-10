# RFx Responder — Architecture & How It Works

> **Audience:** Pre-sales, engineering, and stakeholder demo context.
> **Current status:** Live and production-ready. All features described below are built and running.

---

## What Is the RFx Responder?

The RFx Responder is BidPursuit's AI-powered bid assistant. It gives the pre-sales team a chat interface that can answer RFP/RFI questions, analyse client requirements, map them to iMocha's capabilities, draft response sections, and export content — all grounded strictly in iMocha's indexed knowledge base, with no hallucination from general AI knowledge.

It lives at `/ai` in the app and appears in the sidebar under **RFx Responder**.

---

## What It Can Do (Demo-ready)

| Capability                             | How to show it                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Answer KB-grounded questions** | Ask anything about iMocha's capabilities — the model searches the KB and cites sources                                                           |
| **Requirement analysis**         | Paste client requirements → get a structured table: Requirement\| Status (SUPPORTED / PARTIAL / NOT SUPPORTED) \| iMocha Capability \| KB Source |
| **Export to DOCX**               | Ask "export this as a file" → download chip appears, click to download a formatted .docx                                                         |
| **@-mention documents**          | Type`@` in the chat input to attach a specific indexed document directly into context                                                           |
| **Bid-scoped vs. global**        | Switch between a specific bid's docs and the global KB (templates, product docs)                                                                  |
| **Model selector**               | Choose Claude Opus (highest quality + adaptive thinking), Claude Sonnet (default), Claude Haiku (fast), or Azure GPT-5.4 / OSS-120B               |
| **Live search indicators**       | While the model searches, animated status chips show "Searching: [query]" in real time                                                            |
| **Extended thinking indicator**  | When Opus reasons deeply, a pulsing brain icon appears so the user knows it's working                                                             |
| **Session management**           | Multiple chat sessions per bid — rename, delete, switch between them                                                                             |
| **Quick actions**                | One-click prompts: Analyse requirements, Map to KB, Security & compliance, Draft response section                                                 |

---

## Architecture Overview

```
User types a message
        │
        ▼
  AiChatPanel.tsx  ──────────────────────────────────────────────────────────
  (Browser)                                                                  │
  • Model selector (Opus / Sonnet / Haiku / Azure)                          │
  • Quick action chips (Analyse requirements, Map to KB, …)                 │
  • @-mention picker (attach docs by name)                                  │
  • Streaming message list (react-markdown + remark-gfm)                    │
  • Search status chips + Extended thinking indicator                        │
  • Download chip (appears when EXPORT detected in stream)                  │
        │  POST streamChat (sessionId, bidId, messages, model, mentionedDocIds)
        ▼
  stream-chat.ts  ────────────────────────────────────────────────────────────
  (TanStack Start server fn — Bun runtime)                                   │
        │                                                                    │
        ├─ buildSystemBlocks()                                               │
        │   • Loads bid context from Supabase (client, stage, deadline,      │
        │     questions, deliverables)                                        │
        │   • Loads active system prompt from prompt_versions table          │
        │     (falls back to hardcoded RFI_RFP_PERSONA)                     │
        │   • Assembles system block array with prompt caching               │
        │   • If @-mentioned docs → fetchPinnedChunks() (up to 15           │
        │     chunks per doc) injected as FILE CONTENTS block                │
        │                                                                    │
        └─ Agentic loop (max 5 rounds)                                       │
                │                                                            │
                ├─ Round N: stream to Claude with search_knowledge_base tool │
                │                                                            │
                │   Claude decides: do I need to search?                     │
                │                                                            │
                │   stop_reason = tool_use                                   │
                │     → emit \x1fSTATUS\x1f sentinel (search chip in UI)    │
                │     → runSearch(query, bidId)                              │
                │         1. embedText(query) → Voyage voyage-3 (1024-dim)  │
                │         2. hybrid_search_chunks RPC                        │
                │            (FTS ts_rank_cd + vector cosine, RRF top-50)   │
                │         3. rerank → Voyage rerank-2.5 → top-8             │
                │     → tool_result → next round                             │
                │                                                            │
                │   stop_reason = end_turn                                   │
                │     → stream text deltas directly to browser               │
                │     → if user asked to export:                             │
                │         model prepends EXPORT{...} line                    │
                │         client detects + strips it + shows Download chip   │
                │                                                            │
  ai-queries.ts (useAiChat hook) ─────────────────────────────────────────────
  (Browser — stream reader)
  • Reads ReadableStream from server
  • Strips \x1fSTATUS\x1f sentinels → updates search chip UI
  • Strips EXPORT{...} line → stores exportMeta → shows Download chip
  • Strips \x1fCLEAR\x1f → retracts any pre-tool narration text
  • Appends text deltas → live streaming message
  • Persists final messages + pinned doc IDs to ai_sessions in Supabase
```

---

## Retrieval Pipeline (How It Finds Answers)

Every time Claude calls the `search_knowledge_base` tool, this pipeline runs:

```
User query (or Claude's rephrased sub-query)
        │
        ▼
  embedText(query)
  → Voyage voyage-3 → 1024-dimensional vector
        │
        ▼
  hybrid_search_chunks RPC  (Postgres / Supabase)
  ┌─────────────────────────────────────────────────────────────┐
  │  FTS arm:  websearch_to_tsquery → ts_rank_cd on fts column │
  │  Vec arm:  embedding <=> query_vector (cosine distance)     │
  │  Scope:    bid_id = this bid  OR  bid_id IS NULL (global)   │
  │  Fusion:   RRF (k=50) → top-50 candidates                  │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  rerank-2.5  (Voyage cross-encoder)
  → top-8 passages, re-scored by semantic relevance to query
        │
        ▼
  tool_result → back to Claude as context for this round
```

**Why hybrid?** Vector search finds semantically similar passages; FTS finds exact keyword matches (product names, spec numbers, compliance codes). RRF fusion ensures neither misses what the other catches.

**Why rerank after RRF?** The bi-encoder (vector) scores are approximate. The cross-encoder (rerank-2.5) reads the full query + each passage together — much more accurate, but too slow to run on 50 candidates. So: RRF narrows to 50, rerank picks the best 8.

---

## Document Ingestion (How the KB Gets Built)

When a document is uploaded to the Knowledge Hub:

```
PDF / DOCX / XLSX uploaded
        │
        ▼
  extractText()
  → pdf-parse / mammoth / xlsx depending on file type
        │
        ▼
  chunkText()
  → Sentence-aware chunking (~1800 chars, ~180 char overlap)
  → Preserves sentence boundaries — no mid-sentence splits
        │
        ▼
  contextualiseChunks()   [Haiku]
  → Full document text cached as system block (one API call per doc)
  → Haiku writes a 1–2 sentence situating blurb per chunk:
    "This chunk is from section X of document Y and covers Z"
  → Blurb prepended to chunk_text before embedding
  → Result: retrieval is context-aware, not just term-aware
        │
        ▼
  embedBatch()   [Voyage voyage-3]
  → 128 chunks per batch
  → 429 retry with exponential backoff (up to 4×, 20s base)
        │
        ▼
  Supabase: bid_document_chunks
  → chunk_text, embedding vector(1024)
  → fts tsvector (GENERATED column + GIN index — auto-kept in sync)
```

---

## Prompt Architecture

The system prompt is a multi-block array with Anthropic's prompt caching applied:

| Block                   | Content                                              | Cache behaviour                                                 |
| ----------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Block 1                 | Persona + KB rules + response rules                  | Cached — survives across all turns in a session                |
| Block 2                 | Bid context (client, stage, questions, deliverables) | Cached — survives across turns within the same session         |
| Block 3                 | Export instruction                                   | Small, no cache                                                 |
| Block 4*(if @-mention)* | Full text of @-mentioned docs (up to 15 chunks/doc)  | Not cached — injected only on the turn where @-mention is used |

**What prompt caching does:** On every turn after the first, Blocks 1 and 2 are served from Anthropic's cache (5-min TTL) rather than re-processed. This cuts input token cost ~80% on long sessions and reduces time-to-first-token.

---

## Sentinel Protocol (How the Stream Is Multiplexed)

A single HTTP streaming response carries three types of content simultaneously using ASCII control characters that never appear in normal prose:

| Signal       | Character                 | Format                                                | What the client does                                       |
| ------------ | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `STATUS`   | `\x1f` (Unit Separator) | `\x1fSTATUS\x1f{"kind":"search","query":"..."}\n`   | Shows animated search chip in the message                  |
| `THINKING` | `\x1f`                  | `\x1fSTATUS\x1f{"kind":"thinking","query":"..."}\n` | Shows pulsing brain icon (Opus extended thinking)          |
| `CLEAR`    | `\x1f`                  | `\x1fCLEAR\x1f\n`                                   | Retracts any pre-tool narration text already streamed      |
| `EXPORT`   | plain text                | `EXPORT{"format":"docx","filename":"name.docx"}\n`  | Strips from render, stores exportMeta, shows Download chip |

All sentinel lines are stripped from the rendered chat bubble — users only see clean prose.

---

## Response Behaviour Rules (What the Model Is Told)

These are enforced in the system prompt:

- **KB-only:** Every claim must be traceable to the indexed knowledge base. General AI knowledge is explicitly forbidden.
- **No fixed format by default:** The model responds in plain prose unless the user asks for a specific structure.
- **Requirement analysis = always tabular:** When analysing client requirements, output is always `Requirement | Status | iMocha Capability | KB Source`.
- **NOT SUPPORTED accuracy:** Before marking anything NOT SUPPORTED, the model must search with multiple phrasings. A single failed search is not sufficient. Ambiguous cases get `⚠️ PARTIAL` with a note to verify with the product team.
- **Export = content only:** When asked to export, the model outputs only the EXPORT line + document content. No "your file is ready" message.
- **Product scoping:** TA vs. SI requirements are not cross-assumed unless the client doc specifies. General capabilities (gap analysis, self-assessment, proficiency scoring) apply to both products.

---

## Data Model (Relevant Tables)

| Table                   | Purpose                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `bid_documents`       | One row per uploaded/generated file.`bid_id` is null for global KB docs.                           |
| `bid_document_chunks` | Chunked + contextualised + embedded text.`fts` column auto-generated for FTS.                      |
| `ai_sessions`         | Full chat history per session. Includes`messages` JSONB, `model`, `title`, `pinned_doc_ids`. |
| `prompt_versions`     | Active system prompt override (admin-editable). Falls back to hardcoded persona if none active.      |

---

## Key Engineering Decisions

| Decision                                            | Why                                                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool-use loop, not pre-stuffed context**    | Claude decides when and what to search. Pre-stuffing 50 pages kills context budget in 2 turns.                                                                                                |
| **Max 5 search rounds**                       | Enough for complex multi-part questions; prevents runaway loops on adversarial input.                                                                                                         |
| **Hybrid FTS + vector with RRF**              | Keyword precision (product names, spec codes) + semantic recall. Neither alone covers all query types.                                                                                        |
| **Voyage rerank-2.5 cross-encoder**           | Bi-encoder scores are approximate. Cross-encoder rescoring on top-50 → top-8 is significantly more accurate.                                                                                 |
| **Contextual Retrieval via Haiku**            | A chunk without context ("The retention period is 90 days") is ambiguous. Haiku situates it: "From iMocha's AI Interview data retention policy…". Retrieval hit rate improves substantially. |
| **Per-doc chunk cap (15) for @-mentions**     | A full 50-page RFP injected every turn = 40K+ tokens, exhausting 200K context in ~4 turns. 15 chunks ≈ 6,750 tokens — enough for context, leaves room for history.                          |
| **History window (last 30 messages)**         | Prevents context exhaustion on long sessions. Full history persisted in DB; window is only what's sent to the API.                                                                            |
| **Prompt caching on system blocks**           | ~80% input token cost reduction on multi-turn sessions. Critical for Opus which is expensive per token.                                                                                       |
| **Plain-text EXPORT line (not control char)** | LLMs can't reliably emit`\x1e` (ASCII 30). Model outputs `EXPORT{...}` as plain text; client detects + strips both formats.                                                               |
| **`bid_id IS NULL` = global scope**         | Global KB docs (product docs, templates, security) surface in every bid session automatically without re-uploading.                                                                           |

---

## Is This Agentic RAG?

**Yes — and the term is accurate, not a marketing stretch.**

The three criteria that define Agentic RAG:

| Criterion                                    | What it means                                                                               | Do we have it?                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Autonomous retrieval decision**      | The model decides*whether* to search, not the system                                      | ✅ Claude calls`search_knowledge_base` only when it judges retrieval is needed        |
| **Autonomous query formulation**       | The model decides*what* to search for, rephrasing user questions into focused sub-queries | ✅ Claude rewrites conversational follow-ups into standalone queries before each search |
| **Multi-step retrieval feedback loop** | Retrieved results inform subsequent searches in the same turn                               | ✅ Up to 5 rounds; each tool_result is part of the next round's context                 |

What separates this from standard RAG (where chunks are pre-stuffed into the prompt before the model ever responds) is that the model drives retrieval as a live decision. It can choose not to search, search once, or search five times — depending on the question.

---

## What Would Make It More Agentic (Future Improvements)

These are enhancements, not gaps — the current system is production-ready. These represent the next frontier.

### 1. Multiple Retrieval Tools *(High impact)*

> Currently there is one tool: `search_knowledge_base`. Claude has no way to distinguish *where* to look — it searches everything.

**What to build:** Give Claude separate, scoped tools:

- `search_product_kb` — iMocha capability docs only
- `search_bid_documents` — client-uploaded RFP/RFI only
- `search_security_compliance` — security, certifications, policy docs only
- `search_integrations` — integration and technical spec docs only

Claude would then *route* between tools based on the question type — dramatically improving precision on targeted queries.

---

### 2. Parallel Tool Calls *(Medium impact, low effort)*

> Currently searches are sequential — round 1 finishes before round 2 starts.

**What to build:** Anthropic's API supports multiple `tool_use` blocks in a single response. Claude could issue 3 searches simultaneously for a complex multi-part question and get all results back in one round instead of three.

**Effort:** Modify the tool-result assembly loop in `stream-chat.ts` to batch all tool calls from a single response before advancing to the next round. Already partially structured this way — the `toolResults` array handles multiple blocks.

---

### 3. Explicit Self-Critique / Sufficiency Check *(High impact)*

> The model currently decides implicitly whether retrieved results are good enough. There's no structured reflection step.

**What to build:** After the final search round, run a structured evaluation:

- "Did the retrieved passages fully answer the requirement?"
- "Is there a gap that should be flagged as NOT CONFIRMED rather than NOT SUPPORTED?"

This reduces false NOT SUPPORTED verdicts further and surfaces "I found something related but not exact" as a distinct signal rather than collapsing it into a binary.

---

### 4. Write-Back / KB Gap Flagging *(Medium impact)*

> When the model can't find something, that signal disappears — no one knows the KB has a gap.

**What to build:** A `flag_kb_gap` tool the model can call when it exhausts searches with no result. Flags get written to a `kb_gaps` table, surfaced to the admin as: "These requirements were asked about but not found in the KB — consider adding documentation."

Closes the feedback loop between what clients ask and what the KB covers.

---

### 5. HNSW Vector Index *(Performance)*

> Currently using IVFFlat for vector search. HNSW gives significantly better recall at high query volumes.

**Why deferred:** Requires `maintenance_work_mem ≥ 64 MB`. Supabase free tier caps at 32 MB. Needs a paid plan or manual `SET` before index creation. See `docs/superpowers/notes/agentic-rag-verification.md` for apply instructions.

---

### 6. ⚡ Graph-Based RAG — The Next Paradigm *(Very High Impact)*

> **This is the biggest architectural leap available.** See the full adoption plan at [`docs/superpowers/notes/graph-rag-adoption.md`](./superpowers/notes/graph-rag-adoption.md).

**The fundamental problem with current chunk-based RAG:**
When you rank chunks and keep only top-8, any relevant information in chunk #9, #15, or #40 is silently dropped. Worse — *relationships between facts* spread across documents are never captured at all. A chunk containing "iMocha is ISO 27001 certified" and a chunk containing "ISO 27001 covers data-at-rest encryption" are two separate vectors. The connection is lost.

**What Graph RAG does instead:**
Rather than splitting documents into chunks and embedding them, an LLM reads the documents and extracts a **knowledge graph** — entities (iMocha, ISO 27001, Gap Analysis, Voyage AI) and typed relationships (isMocha → *has_certification* → ISO 27001). Retrieval then traverses the graph from a query entity, following relationship edges, collecting multi-hop facts that no single chunk ever contained.

**Frameworks:**

- **Microsoft GraphRAG** — community detection (Leiden algorithm) + hierarchical summaries. Best for global "themes across all docs" queries.
- **HippoRAG** — Personalized PageRank traversal over entity graph. Best for multi-hop factual retrieval (closest to what BidTrack needs).
- **LightRAG** — dual-level (local entity + global relationship) retrieval. Cheaper, incremental, easier to adopt alongside existing vector search.

**What this fixes for BidPursuit specifically:**

- *"Which of iMocha's certifications, integrations, and AI-governance policies together satisfy this client's compliance section?"* — today this fails because the answer spans 4 docs with no single chunk connecting them. Graph RAG traverses the relationship path.
- Requirement analysis false-negatives (NOT SUPPORTED when it should be PARTIAL) — the model couldn't find the connection because the retrieval dropped it at ranking time.

---

### Summary

| Improvement                                      | Impact              | Effort            | Status                                 |
| ------------------------------------------------ | ------------------- | ----------------- | -------------------------------------- |
| Multiple retrieval tools (scoped)                | High                | Medium            | Not started                            |
| Parallel tool calls                              | Medium              | Low               | Not started                            |
| Self-critique / sufficiency check                | High                | Medium            | Not started                            |
| KB gap write-back                                | Medium              | Medium            | Not started                            |
| HNSW index                                       | Performance         | Low (needs infra) | Blocked on Supabase tier               |
| **⚡ Graph-based RAG (HippoRAG/LightRAG)** | **Very High** | **High**    | **Planned — see adoption note** |
