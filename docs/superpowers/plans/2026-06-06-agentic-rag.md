# Agentic RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the AI Command Center from single-shot RAG to Agentic RAG: Claude drives retrieval via a `search_knowledge_base` tool in a capped loop. Ships in 4 independent phases (A → B → C → D); each is verifiable with `bun run build:dev` + manual browser test before the next begins.

**Tech stack:** `@anthropic-ai/sdk` (already installed), Supabase pgvector + Postgres FTS, Voyage AI (embed `voyage-3` + rerank `rerank-2.5`), TanStack Start `createServerFn`, Bun.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/20260606120000_hybrid_search.sql` | Create — FTS column/index, HNSW, `hybrid_search_chunks` RPC |
| `src/lib/api/stream-chat.ts` | Rewrite — agentic loop, tool, caching, status protocol |
| `src/lib/ai-queries.ts` | Update — status-line stripping in stream reader |
| `src/lib/api/doc-functions.ts` | Update — sentence chunking, Haiku contextualiser, `reindexAll` |
| `src/components/ai/AiChatPanel.tsx` | Update (optional) — transient "Searching…" indicator |

---

## Phase A — Hybrid Search RPC

**Goal:** Ship the new `hybrid_search_chunks` RPC alongside the old one (no caller changes yet). Repoint `stream-chat.ts` to prove it end-to-end. Independently valuable: global docs become retrievable, FTS+RRF improves accuracy.

### Task A1: Write and apply the migration

**File:** Create `supabase/migrations/20260606120000_hybrid_search.sql`

```sql
-- 1. Add generated FTS column to chunks (auto-indexes on insert/update)
alter table public.bid_document_chunks
  add column if not exists fts tsvector
  generated always as (to_tsvector('english', chunk_text)) stored;

create index if not exists bid_document_chunks_fts_idx
  on public.bid_document_chunks using gin (fts);

-- 2. Replace ivfflat with HNSW (better recall, no lists tuning)
drop index if exists bid_document_chunks_embedding_idx;

create index bid_document_chunks_embedding_hnsw_idx
  on public.bid_document_chunks using hnsw (embedding vector_cosine_ops);

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
```

- [ ] **Step 1:** Write the file above.
- [ ] **Step 2:** Apply in Supabase SQL Editor. Verify:
  ```sql
  select proname from pg_proc where proname = 'hybrid_search_chunks';
  -- expect: 1 row
  ```
- [ ] **Step 3:** `bun run build:dev` — expects exits 0 (no TypeScript changes yet).

### Task A2: Repoint `stream-chat.ts` to the new RPC

**File:** `src/lib/api/stream-chat.ts`

In `buildSystemPrompt`, replace the `supabaseAdmin.rpc("match_bid_document_chunks", ...)` call with:

```ts
const embedding = await embedText(lastUserMessage);
const { data: chunks } = await supabaseAdmin.rpc("hybrid_search_chunks", {
  query_text: lastUserMessage,
  query_embedding: JSON.stringify(embedding),
  match_bid_id: bidId,
  match_count: 8,
  min_similarity: 0.4,
});
if (chunks && chunks.length > 0) {
  parts.push("## Relevant Document Excerpts");
  for (const chunk of chunks as { doc_name: string; chunk_text: string }[]) {
    parts.push(`[${chunk.doc_name}]`);
    parts.push(chunk.chunk_text);
    parts.push("---");
  }
  parts.push("");
}
```

- [ ] **Step 1:** Make the edit above.
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.
- [ ] **Step 3:** Browser test:
  - Bid session with an indexed doc → ask a doc-specific question → confirm relevant excerpts appear with a `[Doc Name]` header.
  - Global session → confirm no retrieval error (global mode bypasses `buildSystemPrompt` today — no change needed yet; this will be fixed in Phase B).

---

## Phase B — Agentic Tool-Use Loop

**Goal:** Replace `buildSystemPrompt` + single-shot `messages.stream` with a capped agentic loop. Claude gets `search_knowledge_base`, decides when/what to search, max 3 rounds. Global mode gets retrieval. Client strips status lines.

### Task B1: Rewrite `stream-chat.ts`

**File:** `src/lib/api/stream-chat.ts` — full rewrite of the handler.

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  bidId: z.string().uuid().nullable(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      created_at: z.string(),
    })
  ),
  model: z.enum(ALLOWED_MODELS),
});

// ── helpers ────────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Voyage error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

type ChunkRow = { doc_name: string; chunk_text: string };

async function runSearch(query: string, bidId: string | null): Promise<ChunkRow[]> {
  try {
    const embedding = await embedText(query);
    const { data } = await supabaseAdmin.rpc("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 8,
      min_similarity: 0.4,
    });
    return (data ?? []) as ChunkRow[];
  } catch {
    // Voyage down → try FTS-only with zero vector
    try {
      const zero = JSON.stringify(new Array(1024).fill(0));
      const { data } = await supabaseAdmin.rpc("hybrid_search_chunks", {
        query_text: query,
        query_embedding: zero,
        match_bid_id: bidId,
        match_count: 8,
        semantic_weight: 0,
      });
      return (data ?? []) as ChunkRow[];
    } catch {
      return [];
    }
  }
}

function formatChunks(chunks: ChunkRow[]): string {
  if (!chunks.length) return "No relevant passages found for that query.";
  return chunks.map((c) => `[${c.doc_name}]\n${c.chunk_text}`).join("\n---\n");
}

// Status line sentinel — ASCII Unit Separator (0x1F), never appears in prose.
function statusLine(kind: string, detail: string): Uint8Array {
  return new TextEncoder().encode(
    `\x1fSTATUS\x1f${JSON.stringify({ kind, query: detail })}\n`
  );
}

// ── system prompt builder ──────────────────────────────────────────────────────

async function buildSystemBlocks(
  bidId: string | null
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const persona = [
    "You are an expert bid strategy assistant for iMocha's pre-sales team.",
    "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
    "Be concise, strategic, and specific to the context provided.",
    "When you use a document passage, name its source document.",
    "",
  ];

  if (!bidId) {
    return [{ type: "text", text: persona.join("\n"), cache_control: { type: "ephemeral" } }];
  }

  const parts = [...persona];

  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, status, stage, deadline, procurement_portal")
    .eq("id", bidId)
    .single();

  if (bid) {
    parts.push("## Active Bid Context");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase()}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    if (bid.procurement_portal) parts.push(`Portal: ${bid.procurement_portal}`);
    parts.push("");
  }

  const { data: questions } = await supabaseAdmin
    .from("bid_questions")
    .select("text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (questions?.length) {
    parts.push("## Bid Questions");
    for (const q of questions) parts.push(`- [${q.stage}] ${q.text}`);
    parts.push("");
  }

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("title, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (deliverables?.length) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- [${d.stage}] ${d.title}`);
    parts.push("");
  }

  // cache_control on the last block caches tools + system together
  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}

// ── tool definition ────────────────────────────────────────────────────────────

const SEARCH_TOOL: Anthropic.Messages.Tool = {
  name: "search_knowledge_base",
  description:
    "Search the indexed bid documents (RFPs, proposals, legal docs, templates, reference material) for passages relevant to a query. " +
    "Call this whenever answering requires specifics from the documents — requirements, pricing, dates, compliance clauses, scope, prior-proposal language. " +
    "You may call it multiple times to decompose a complex question or follow up after seeing initial results. " +
    "Do NOT call it for general strategy questions answerable from the bid metadata already provided in your context. " +
    "Returns the most relevant passages with their source document names for citation.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "A focused, self-contained search query. Rewrite conversational follow-ups into standalone queries (resolve pronouns and ellipsis from conversation context). Prefer specific terms over the user's verbatim phrasing.",
      },
    },
    required: ["query"],
  },
};

// ── server function ────────────────────────────────────────────────────────────

export const streamChatFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const systemBlocks = await buildSystemBlocks(data.bidId);

    // Messages for the loop — map away created_at
    type AnthropicMsg = Anthropic.Messages.MessageParam;
    const messages: AnthropicMsg[] = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const MAX_ROUNDS = 3;

    const stream = new ReadableStream({
      async start(controller) {
        let rounds = 0;

        try {
          while (true) {
            const isLastRound = rounds >= MAX_ROUNDS;

            const apiStream = anthropic.messages.stream({
              model: data.model,
              max_tokens: 4096,
              thinking: { type: "adaptive" },
              system: systemBlocks,
              tools: isLastRound ? undefined : [SEARCH_TOOL],
              tool_choice: isLastRound ? { type: "none" } : undefined,
              messages,
            });

            // Stream text deltas immediately as they arrive
            for await (const event of apiStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                controller.enqueue(new TextEncoder().encode(event.delta.text));
              }
            }

            const final = await apiStream.finalMessage();

            if (final.stop_reason !== "tool_use" || isLastRound) {
              // Done — text was already streamed
              break;
            }

            // Handle tool calls
            messages.push({ role: "assistant", content: final.content });
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

            for (const block of final.content) {
              if (block.type !== "tool_use" || block.name !== "search_knowledge_base") continue;
              const query = (block.input as { query: string }).query;
              controller.enqueue(statusLine("search", query));
              const chunks = await runSearch(query, data.bidId);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: formatChunks(chunks),
              });
            }

            messages.push({ role: "user", content: toolResults });
            rounds++;
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
```

- [ ] **Step 1:** Write the file above (full replacement of existing `stream-chat.ts`).
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.

### Task B2: Update stream reader in `ai-queries.ts`

**File:** `src/lib/ai-queries.ts` — in `useAiChat.send()`, update the `while (true)` reader loop to strip status sentinels.

Replace the current reader loop body:
```ts
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  assistantContent += value;
  setMessages(...)
}
```

With:
```ts
let lineBuffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  lineBuffer += value;

  // Strip complete \x1fSTATUS\x1f...\n records (may be split across chunks)
  let processed = lineBuffer;
  const stripped = processed.replace(/\x1f[^\x1f]*\x1f[^\n]*\n/g, "");

  // Check for an incomplete leading sentinel at the end of the buffer
  const lastSentinel = processed.lastIndexOf("\x1f");
  if (lastSentinel !== -1) {
    const tail = processed.slice(lastSentinel);
    // Only keep trailing incomplete sentinel in buffer if no closing \n yet
    if (!tail.includes("\n")) {
      lineBuffer = tail;
      processed = processed.slice(0, lastSentinel);
    } else {
      lineBuffer = "";
      processed = stripped;
    }
  } else {
    lineBuffer = "";
    processed = stripped;
  }

  if (processed) {
    assistantContent += processed;
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], content: assistantContent };
      return next;
    });
  }
}
```

- [ ] **Step 1:** Apply the edit above.
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.

### Task B3: Browser verification

- [ ] Ask a doc-specific question in a bid session → confirm "Searching: …" status line does **not** appear in the displayed message; correct answer is cited with `[Doc Name]`.
- [ ] Ask a conversational follow-up ("what about the deadline for that?") → confirm model rewrites into a standalone search and retrieves correctly.
- [ ] Open a **global session** → ask a question whose answer is in a global/template doc → confirm retrieval works (was completely broken before).
- [ ] Ask a pure-strategy question ("what win themes could we use?") → confirm model answers without searching.
- [ ] Multi-turn conversation → inspect server-side logs for `cache_read_input_tokens > 0` on turn 2.
- [ ] **After confirmation:** drop the old RPC in a follow-up migration:
  ```sql
  drop function if exists public.match_bid_document_chunks;
  ```

### Task B4: Optional — transient status indicator in `AiChatPanel.tsx`

Add a `searchingQuery: string | null` state to `useAiChat` in `ai-queries.ts`. Set it when a STATUS line is parsed, clear it when the stream ends. Pass it to `AiChatPanel` and render a small pill above the typing indicator:

```tsx
{searchingQuery && (
  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 px-1">
    <Loader2 className="size-3 animate-spin" />
    Searching: {searchingQuery}…
  </div>
)}
```

- [ ] (Optional) Implement if UX warrants; not required for correctness.

---

## Phase C — Ingest Improvements

**Goal:** Better chunks + Anthropic Contextual Retrieval. Zero chat-TTFT impact (ingest-only). Existing chunks must be re-indexed after this lands.

### Task C1: Sentence-aware chunking + contextualiser in `doc-functions.ts`

**File:** `src/lib/api/doc-functions.ts`

Replace `chunkText` and update `indexDocument`:

```ts
import Anthropic from "@anthropic-ai/sdk";

// Sentence-aware chunker — never splits mid-sentence
function chunkText(text: string, targetSize = 1800, overlap = 180): string[] {
  // Split on paragraph breaks, then sentence terminators
  const paragraphs = text.split(/\n\n+/);
  const sentences: string[] = [];
  for (const para of paragraphs) {
    const parts = para.split(/(?<=[.!?])\s+/);
    sentences.push(...parts.filter((s) => s.trim()));
  }

  const chunks: string[] = [];
  let current = "";
  let overlapBuffer = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > targetSize && current) {
      chunks.push(current.trim());
      // carry overlap from the end of current chunk
      overlapBuffer = current.slice(-overlap);
      current = overlapBuffer + " " + sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Contextual Retrieval: generate a 50-100 token situating blurb per chunk
// using Haiku with the full document cached as a system block.
async function contextualiseChunks(
  chunks: string[],
  fullDocText: string
): Promise<string[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const contextualised: string[] = [];

  for (const chunk of chunks) {
    try {
      const resp = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 150,
        // Cache the full doc as the system block — amortised across all chunks
        system: [
          {
            type: "text",
            text: fullDocText,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              "Here is a chunk from the document:\n\n" +
              chunk +
              "\n\nGive a 1-2 sentence context situating this chunk within the overall document for search retrieval. Answer only with the context.",
          },
        ],
      });
      const context =
        resp.content.find((b) => b.type === "text")?.text?.trim() ?? "";
      contextualised.push(context ? `${context}\n\n${chunk}` : chunk);
    } catch {
      // Contextualisation is best-effort — fall back to raw chunk
      contextualised.push(chunk);
    }
  }

  return contextualised;
}
```

In `indexDocument`, between step 3 (extract text) and step 4 (chunk), add:
```ts
// 4. Chunk (sentence-aware)
const rawChunks = chunkText(text);

// 5. Contextualise via Haiku (best-effort — failure falls back to raw)
const chunks = await contextualiseChunks(rawChunks, text);
```

Remove the old `const chunks = chunkText(text);` line; update step numbers accordingly.

- [ ] **Step 1:** Apply the edits above.
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.

### Task C2: Add `reindexAll` server function

**File:** `src/lib/api/doc-functions.ts` — add after `indexDocument`:

```ts
export const reindexAll = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => {
    const { data: docs, error } = await supabaseAdmin
      .from("bid_documents")
      .select("id");
    if (error) throw error;

    let indexed = 0;
    for (const doc of docs ?? []) {
      try {
        await indexDocument({ data: { documentId: doc.id } });
        indexed++;
      } catch (err) {
        console.error(`reindexAll: failed for ${doc.id}`, err);
      }
    }
    return { indexed, total: docs?.length ?? 0 };
  });
```

- [ ] **Step 1:** Add the function above.
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.

### Task C3: Re-index existing documents

- [ ] Upload a new test doc → inspect a `bid_document_chunks` row → confirm `chunk_text` begins with a context sentence and contains no mid-sentence cuts.
- [ ] From a dev route or Supabase Edge Function invocation, call `reindexAll` against the dev database. Monitor progress in logs. Confirm all docs get refreshed.

---

## Phase D — Reranking

**Goal:** Insert Voyage rerank-2.5 between the fused RPC top-50 and the final 8 passed to the model. Further reduces retrieval failures.

### Task D1: Add rerank call to `runSearch` in `stream-chat.ts`

In `runSearch`, bump `match_count` to 50 and add a rerank step after the RPC call:

```ts
async function rerank(query: string, chunks: ChunkRow[]): Promise<ChunkRow[]> {
  if (!chunks.length) return chunks;
  try {
    const resp = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "rerank-2.5",
        query,
        documents: chunks.map((c) => c.chunk_text),
        top_k: 8,
      }),
    });
    if (!resp.ok) throw new Error(`Rerank error: ${resp.status}`);
    const json = (await resp.json()) as { data: { index: number }[] };
    return json.data.map((d) => chunks[d.index]);
  } catch {
    // Rerank failure → fall back to RRF order, slice top-8
    return chunks.slice(0, 8);
  }
}

// In runSearch, after getting `data` from the RPC:
const candidates = (data ?? []) as ChunkRow[];
return await rerank(query, candidates);
```

Also bump the RPC call's `match_count` from `8` to `50`.

- [ ] **Step 1:** Apply the edits above.
- [ ] **Step 2:** `bun run build:dev` — expects exits 0.
- [ ] **Step 3:** Browser test: ask a question where the best passage is not at the top of RRF order. Confirm reranked answer is better. (Add temporary `console.log` of pre/post order if needed.)

---

## Phase E — Eval Harness (Optional)

**Goal:** Measure recall@k and groundedness to quantify gains and guard regressions.

### Task E1: Create eval script

**File:** `scripts/eval.ts`

```ts
import { createClient } from "@supabase/supabase-js";

// Golden set — hand-curate from real bids
const GOLDEN = [
  { query: "What is the submission deadline?", expectedDocSlug: "rfp-acme-2026" },
  // ... add 20-50 pairs
];

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// recall@k: check if expected doc appears in top-k hybrid results
async function recallAtK(k: number) {
  let hits = 0;
  for (const { query, expectedDocSlug } of GOLDEN) {
    const embResp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3", input: [query] }),
    });
    const { data } = (await embResp.json()) as { data: { embedding: number[] }[] };
    const { data: rows } = await supabase.rpc("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(data[0].embedding),
      match_count: k,
    });
    if ((rows ?? []).some((r: { doc_name: string }) => r.doc_name.includes(expectedDocSlug))) hits++;
  }
  return hits / GOLDEN.length;
}

console.log("recall@5:", await recallAtK(5));
console.log("recall@8:", await recallAtK(8));
```

- [ ] **Step 1:** Write the file above; fill in golden pairs from real bid docs.
- [ ] **Step 2:** `bun run scripts/eval.ts` — prints recall figures. Run before Phase A and after each phase to track gains.

---

## Verification Summary

| Phase | Build check | Browser check | Notes |
|---|---|---|---|
| A | `bun run build:dev` ✓ | Bid session → doc excerpts with `[Name]` header | Apply migration first |
| B | `bun run build:dev` ✓ | Status lines stripped; global retrieval works; follow-up rewrites | Drop old RPC after B confirmed |
| C | `bun run build:dev` ✓ | New chunk rows have context prefix; no mid-sentence cuts | Run `reindexAll` on dev |
| D | `bun run build:dev` ✓ | Better answer for buried-passage query | Check rerank API logs |
| E | `bun run scripts/eval.ts` | — | recall@5/@8 printed |

---

## Rollback

Each phase is one commit. `git revert <commit>` + re-apply any needed down-migration restores the prior state. The old `match_bid_document_chunks` RPC stays alive until Phase B is confirmed, so Phase A is risk-free. Migration down-path (recreate ivfflat, drop fts/HNSW) is trivial to add alongside if needed.
