# AI Command Center — Design Spec
_Feature: 2.5 · Route: `/ai` · Date: 2026-06-05_

---

## Overview

A dedicated AI copilot page where pre-sales and admin users can have streaming conversations with Claude, scoped to a specific bid pursuit or across all bids (global mode). Quick-action chips surface the four most common tasks without requiring users to know how to prompt.

---

## Layout & UX

Split-pane page at `/ai`:

**Left column (240px) — Pursuit list**
- Mode toggle at top: **Bid | Global**
- In Bid mode: scrollable list of active bids (name, stage, deadline). Selecting a bid loads that pursuit as context and restores the most recent session for it.
- In Global mode: bid list is dimmed / non-interactive; chat has no bid context injected.
- New session button per bid (creates a fresh `ai_sessions` row).

**Right column — Chat area**
- Context strip (below topbar): shows active bid name + stage (or "Global"), model selector dropdown, usage counter badge.
- Quick-action chips: **Summarise RFP · Win themes · Identify risks · Draft exec summary**. Clicking a chip sends a pre-defined prompt scoped to the active bid.
- Streaming message thread: assistant messages render token-by-token. A subtle typing indicator (animated dots) shows while the stream is in flight.
- Text input + send button. Send disabled while streaming.

---

## Mode Behaviour

| | Bid mode | Global mode |
|---|---|---|
| System prompt | Bid fields + relevant doc chunks + instructions | Instructions only |
| Session stored with | `bid_id` set | `bid_id = null` |
| Bid list | Selectable | Dimmed |
| Quick actions | Bid-scoped | Hidden |

---

## Context Assembly (Bid mode)

The server function builds this context bundle before calling the Anthropic API:

1. **Structured fields (always):** bid name, stage, value, deadline, portal, all questions and deliverables (text only, not completion status).
2. **Document chunks (when available):** pgvector similarity search on `bid_document_chunks` using a Voyage AI embedding of the user's current message. Top 8 chunks retrieved. Skipped if the bid has no indexed documents.

The assembled context is injected as the `system` parameter. User/assistant message history is passed as the `messages` array.

---

## Streaming Architecture

### Server function — `src/lib/api/ai-functions.ts`

```
streamChat(input: { sessionId: string, bidId: string | null, messages: Message[], model: string })
  → ReadableStream<string>
```

Steps:
1. Validate input with Zod.
2. If `bidId` is set: fetch bid record + questions/deliverables from Supabase; run pgvector similarity search for doc chunks using the last user message as query (Voyage embed → `match_bid_document_chunks` RPC).
3. Build system prompt string.
4. Call `anthropic.messages.stream({ model, system, messages })`.
5. Pipe text delta events into a `ReadableStream` returned to the client.
6. API key accessed via `process.env.ANTHROPIC_API_KEY` — never exposed to the client.

### Client hook — `src/lib/ai-queries.ts` → `useAiChat`

Manages: `messages: Message[]`, `isStreaming: boolean`, `inputValue: string`.

On send:
1. Append user message to local state.
2. Call `streamChat` server function.
3. Read stream chunks; append deltas to the in-progress assistant message bubble.
4. On stream end: call `useUpdateAiSession` mutation to persist the completed exchange to `ai_sessions.messages`.

---

## Data Layer

### New table: `ai_sessions`

```sql
create table ai_sessions (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid references bids(id) on delete cascade,  -- null = global
  user_id      uuid references profiles(id) on delete cascade not null,
  model        text not null,
  messages     jsonb not null default '[]',
  created_at   timestamptz not null default now()
);

alter table ai_sessions enable row level security;
create policy "Users manage own sessions"
  on ai_sessions for all
  using (user_id = auth.uid());
```

Message shape inside `messages` jsonb array:
```json
{ "role": "user" | "assistant", "content": "...", "created_at": "ISO8601" }
```

### New query file: `src/lib/ai-queries.ts`

| Hook | Purpose |
|---|---|
| `useAiSessions(bidId?)` | List sessions for a bid (or all global sessions) |
| `useAiSession(sessionId)` | Single session — used to restore history on bid select |
| `useCreateAiSession()` | Create a new session row |
| `useUpdateAiSession()` | Append completed message pair to `messages` jsonb |
| `useAiRequestCount(userId)` | Count `ai_sessions` rows created today by user (for usage counter) |

### pgvector RPC: `match_bid_document_chunks`

```sql
create or replace function match_bid_document_chunks(
  query_embedding vector(1024),
  match_bid_id uuid,
  match_count int default 8
)
returns table (chunk_text text, similarity float)
language sql stable as $$
  select chunk_text, 1 - (embedding <=> query_embedding) as similarity
  from bid_document_chunks
  where document_id in (
    select id from bid_documents where bid_id = match_bid_id
  )
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

---

## Model Selector

Dropdown in the chat context strip listing all current Anthropic models:
- `claude-opus-4-8`
- `claude-sonnet-4-6` (default)
- `claude-haiku-4-5`

Selection persisted in `localStorage` under key `bid-compass:ai-model`. No DB storage needed.

---

## Usage Counter

Non-blocking badge in the context strip: `"N requests today"`. Derived from `useAiRequestCount` — counts `ai_sessions` rows where `user_id = current user` and `created_at >= today 00:00 UTC`. No hard block; purely informational.

---

## New Files

| File | Purpose |
|---|---|
| `src/lib/api/ai-functions.ts` | `streamChat` server function |
| `src/lib/ai-queries.ts` | All TanStack Query hooks for `ai_sessions` |
| `src/routes/_app/ai.tsx` | Full page implementation (replaces placeholder) |
| `src/components/ai/AiChatPanel.tsx` | Chat area (messages + input) |
| `src/components/ai/AiBidList.tsx` | Left-column bid list + mode toggle |
| `supabase/migrations/20260605160000_ai_sessions.sql` | Table + RLS + pgvector RPC |

---

## Modified Files

| File | Change |
|---|---|
| `src/lib/bid-queries.ts` | Export `useBids` for use in `AiBidList` (already exported — no change needed) |
| `.env.local` | Add `ANTHROPIC_API_KEY` |
| `package.json` | Add `@anthropic-ai/sdk` |

---

## Environment Variables

| Var | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `.env.local` (server-only) | Anthropic API access — never sent to client |
| `VOYAGE_API_KEY` | Already set | Embedding for doc chunk retrieval (existing) |

---

## Security

- `ANTHROPIC_API_KEY` accessed only inside `createServerFn` handler — never in client bundles.
- `ai_sessions` RLS policy: users can only read/write their own sessions.
- Input validated with Zod before any API call.
- Model string validated against an allowlist (no arbitrary model injection).

---

## Out of Scope (v1)

- Conversation branching or message editing
- File uploads directly in the chat
- Per-org usage dashboards
- Hard rate limits / billing integration
- iCal / export of AI outputs
