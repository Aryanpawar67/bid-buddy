# BidTrack — CLAUDE.md

Internal bid management workspace for iMocha's pre-sales and revenue teams. Tracks RFPs/RFIs/RFQs through an 8-stage pipeline with role-based access.

### iMocha Product Nomenclature

| Code | Full names (all interchangeable) |
|------|----------------------------------|
| **TA** | Talent Acquisition · Skills Assessment (SA) |
| **TM** | Talent Management · Skills Intelligence (SI) |

Always normalise to `"TA"` or `"TM"` in code and JSON. Proposal templates: `src/assets/TA_Proposal_template.docx` (TA) and `src/assets/TM_Proposal_template.docx` (TM).

---

## Stack

- **Framework:** TanStack Start (SSR) + TanStack Router (file-based routing) v1.167–1.168
- **Runtime:** Bun (use `bun` for all installs and scripts, not npm/yarn)
- **UI:** React 19, TailwindCSS v4, shadcn/ui components (Radix primitives)
- **Backend:** Supabase (Postgres + pgvector + Auth)
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`) + Voyage AI (embeddings + reranking)
- **Build:** Vite 7 with `@tanstack/react-start/plugin/vite`
- **Markdown rendering:** `react-markdown` + `remark-gfm` + `@tailwindcss/typography`
- **No test runner** — verify with `bun run build:dev` and manual browser testing

---

## Commands

```bash
bun start            # start dev server (auto-selects free port 3000–3020)
bun stop             # stop background dev server
bun dev              # dev server (foreground, default port)
bun run build:dev    # build — use this to verify TypeScript/route correctness
bun run build        # production build
bun run lint         # ESLint
bun run format       # Prettier
```

`bun start` / `bun stop` use `scripts/start.sh` and `scripts/stop.sh`. They write PID + port to `.dev-server.pid` / `.dev-server.port` (gitignored).

---

## Environment Variables

```
ANTHROPIC_API_KEY     # Anthropic — agentic loop + Haiku contextualiser
VOYAGE_API_KEY        # Voyage AI — voyage-3 embeddings + rerank-2.5
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

---

## Project Layout

```
src/
  routes/
    __root.tsx              # HTML shell, QueryClientProvider, 404/error boundaries
    _app.tsx                # Auth guard + app shell (Sidebar + TopBar + Outlet)
    _app/
      dashboard.tsx         # Overview page: KPI strip + needs-attention list
      pipeline.tsx          # Bid pipeline split-pane (list + stage workspace)
      queue.tsx             # Personal task queue (questions + deliverables)
      analytics.tsx         # Win rate, stage distribution, monthly intake charts
      bids.$id.tsx          # Bid detail / stage workspace
      bids.$id.gonogo.tsx   # Go/No-Go scoring form
      ai.tsx                # AI Command Center (bid + global sessions)
      docs.tsx              # Knowledge Hub (global templates + bid-scoped docs)
      hubspot.tsx           # HubSpot sync placeholder
      settings.tsx          # Settings: Team (RBAC + member management) + Integrations (HubSpot)
    auth.tsx                # Login/signup page
    pending.tsx               # Pending approval screen (no auth guard)
    index.tsx               # Redirects to /dashboard or /queue based on role
  components/
    app/
      Sidebar.tsx           # Icon-only sidebar (52px). NAV array drives visible items per role.
      TopBar.tsx            # Breadcrumbs + New bid button + IntakeModal trigger
    bids/
      BidCard.tsx           # Compact bid list item used in pipeline sidebar
      StageNav.tsx          # Horizontal stage progress nav
      StageWorkspace.tsx    # Per-stage task/deliverable workspace
      IntakeModal.tsx       # New bid intake form
    ai/
      AiChatPanel.tsx       # Chat UI — streaming messages, model selector, quick actions,
                            #   markdown rendering (react-markdown + remark-gfm)
      AiBidList.tsx         # Bid session list sidebar for the AI route
    ui/                     # shadcn/ui components — do not edit these manually
  lib/
    auth.ts                 # useSession, useCurrentUser, AppRole type, defaultLandingFor
    bid-queries.ts          # All TanStack Query hooks (useBids, useBid, useMyQueue, etc.) + Bid type
    bid-constants.ts        # STAGES, stageLabel, urgencyClass, fmtMoney, initials, PORTALS
    ai-queries.ts           # useAiChat, useAiSessions, useCreateAiSession — streaming + sentinel stripping
    doc-queries.ts          # useDocuments, useUploadDocument, useDeleteDocument, useIndexDocument
    api/
      stream-chat.ts        # Agentic RAG server fn — tool-use loop, hybrid search, status protocol
      doc-functions.ts      # indexDocument, reindexAll — sentence chunking, Haiku contextualiser
      ai-functions.ts       # streamChat, exportMessage, generateProposal client wrappers
      export-message.ts     # exportMessageFn — DOCX export of a single AI message
      generate-proposal.ts  # generateProposalFn — Haiku author + JSZip template assembly + KH upload
  assets/
    TA_Proposal_template.docx   # TA (Talent Acquisition / Skills Assessment) branded master
    TM_Proposal_template.docx   # TM (Talent Management / Skills Intelligence) branded master
  integrations/
    supabase/
      client.ts             # Browser Supabase client
      client.server.ts      # Server-side Supabase client
      types.ts              # Generated Supabase DB types (regenerate after migrations)
      auth-attacher.ts      # TanStack Start middleware: attaches Supabase session to server context
      auth-middleware.ts
scripts/
  start.sh                  # Auto-port dev server launcher
  stop.sh                   # Graceful dev server shutdown
```

---

## Routing

TanStack Router uses **file-based routing** — adding a file to `src/routes/` registers the route automatically. The `routeTree.gen.ts` file is auto-generated on `bun dev`; never edit it manually.

Route file naming:

- `_app/foo.tsx` → `/foo` (inside the auth-gated `_app` layout)
- `_app/bids.$id.tsx` → `/bids/:id`
- `__root.tsx` → root shell (no URL)

---

## Auth & Roles

Four roles: `pre_sales`, `legal`, `finance`, `admin`. Stored in `user_roles` table.

```ts
type AppRole = "pre_sales" | "legal" | "finance" | "admin";
```

Role priority (highest wins): `admin > pre_sales > legal > finance`

Default landing: legal/finance → `/queue`; everyone else → `/dashboard`

`useCurrentUser()` returns `{ user, profile, roles, primaryRole, isAdmin, isPreSales }`.

---

## Data Layer

All Supabase queries live in `src/lib/*-queries.ts` as TanStack Query hooks. **Do not query Supabase directly in route/component files.**

Key hooks:

- `useBids()` — all bids ordered by deadline
- `useBid(id)` — single bid
- `useStageItems(bidId, stage)` — questions + deliverables for a bid/stage
- `useMyQueue(userId)` — items assigned to current user
- `useUpdateBid()`, `useToggleDeliverable()`, `useToggleQuestion()` — mutations
- `useAiChat(sessionId, bidId, model)` — streaming chat state + send fn
- `useAiSessions(bidId)` — list sessions for a bid or globally
- `useRenameSession()` — update `ai_sessions.title`
- `useDeleteSession()` — delete session row
- `useGenerateProposal()` — calls `generateProposalFn`, downloads DOCX, saves to KH
- `useRolePermissions()` — RBAC permission matrix from `role_permissions` table
- `useTeamMembers()` — active/suspended members with their primary role
- `useBidAssignments(userId?)` — bid↔member assignments
- `useApproveUser()`, `useSuspendUser()` — admin user lifecycle mutations
- `useHubSpotStatus()`, `useSyncFromHubSpot()` — HubSpot connection + sync

The `Bid` type is exported from `bid-queries.ts`.

---

## AI Command Center — Agentic RAG (Feature 2.6)

### Architecture

Claude drives retrieval via a `search_knowledge_base` tool in a capped loop (max 3 rounds). No chunks are pre-stuffed into the system prompt — the model decides when and what to search.

```
User message
  → buildSystemBlocks() — bid context + tool + persona (prompt-cached)
  → agentic loop (max 3 rounds)
      ├─ stop_reason === "tool_use"
      │     → emit \x1fSTATUS\x1f sentinel → runSearch() → tool_result → next round
      └─ stop_reason === "end_turn"
            → stream text deltas → done
```

### Key files


| File                                | Responsibility                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/api/stream-chat.ts`        | Agentic loop, `SEARCH_TOOL`, `runSearch`, `rerank`, `buildSystemBlocks`, status + export sentinels         |
| `src/lib/ai-queries.ts`             | Stream reader — strips `\x1fSTATUS\x1f` and `\x1eEXPORT\x1e` sentinels; rename/delete/generate hooks      |
| `src/lib/api/doc-functions.ts`      | `indexDocument` (sentence chunking + Haiku contextualiser), `reindexAll`, `embedBatch` (429 retry backoff) |
| `src/lib/api/export-message.ts`     | `exportMessageFn` — formats a single assistant message as DOCX via `docx` package                         |
| `src/lib/api/generate-proposal.ts`  | `generateProposalFn` — Haiku authors intake JSON → JSZip clones TA/TM template → uploads to KH            |
| `src/components/ai/AiChatPanel.tsx` | Chat UI — quick actions, export chips, Generate Proposal chip (RFI/RFP only)                               |
| `src/components/ai/AiBidList.tsx`   | Session list — rename (inline input) + delete (confirm popover) per session row                            |


### Retrieval pipeline

```
query → hybrid_search_chunks RPC (FTS + vector, RRF fusion, top-50)
      → rerank-2.5 (Voyage, top-8)
      → tool_result back to model
```

### Hybrid search RPC (`hybrid_search_chunks`)

Replaces `match_bid_document_chunks`. Accepts:

- `query_text` — for FTS arm (`websearch_to_tsquery` + `ts_rank_cd` on generated `fts tsvector` column + GIN index)
- `query_embedding vector(1024)` — for vector arm (pgvector cosine, `min_similarity` floor)
- `match_bid_id uuid` — `NULL` = global/template docs only; set = bid docs + global templates
- `match_count`, `rrf_k`, `full_text_weight`, `semantic_weight`, `min_similarity`

Returns `(chunk_id, document_id, doc_name, bid_id, chunk_index, chunk_text, similarity, rrf_score)`.

### Sentinel protocol

Two sentinel channels share the stream — both use ASCII control characters that never appear in prose:

| Sentinel | Char | Format | Purpose |
|----------|------|--------|---------|
| STATUS | `\x1f` (Unit Sep) | `\x1fSTATUS\x1f{"kind":"search","query":"..."}\n` | Search-round progress indicator |
| EXPORT | `\x1e` (Record Sep) | `\x1eEXPORT\x1e{"format":"docx","filename":"name.docx"}\n` | Signals exportable content; client shows Download chip |

The client strips both sentinel types before rendering. `exportMeta` is captured and stored on the `Message` object so the Download chip persists after reload.

### Prompt caching

`system` is a block array with `cache_control: {type:"ephemeral"}` on the last block. Caches tool schema + stable system prefix across turns.

### Ingest (doc-functions.ts)

1. **Sentence-aware chunking** — paragraph → sentence split, greedy-pack to ~1800 chars, ~180-char overlap
2. **Contextual Retrieval** — Haiku generates a 1-2 sentence situating blurb per chunk (full doc cached as system block), prepended to `chunk_text` before embedding
3. `**reindexAll`** — re-indexes all `bid_documents` (idempotent, deletes stale chunks first)
4. **429 retry** — `embedBatch` retries up to 4× with exponential backoff (20s base) on Voyage rate-limit errors

### Models (allowlist)

```ts
"claude-opus-4-8"          // highest quality, adaptive thinking
"claude-sonnet-4-6"        // default
"claude-haiku-4-5-20251001" // fast / ingest contextualiser
```

---

## Design System

Dense, tool-feel UI. Key conventions:

- **0.5px borders** via `hairline` utility class (`border-width: 0.5px`)
- **Primary:** purple `#491AEB` (`oklch(0.43 0.27 280)`)
- **Accent/CTA:** orange `#FD5B0E` (`oklch(0.66 0.22 38)`)
- **Sidebar bg:** dark `#220032`
- **Font sizes:** `text-[10px]` micro, `text-[11px]` meta, `text-[12px]` small, `text-[13px]` body
- **Card radius:** `rounded-lg` (8px) for cards, `rounded-xl` (12px) for panels
- Card pattern: `bg-card hairline border rounded-lg p-3`
- Section heading pattern: `text-[11px] uppercase tracking-wider text-muted-foreground`
- **AI chat responses** use `prose prose-sm` from `@tailwindcss/typography` (registered via `@plugin` in `styles.css`)

All tokens are CSS variables defined in `src/styles.css`. Use them via Tailwind classes, not raw hex values.

---

## Bid Pipeline Stages (in order)

1. `deal_qualification` — Deal Qualification
2. `rfi` — RFI
3. `rfp` — RFP
4. `orals` — Orals
5. `due_diligence` — Due Diligence
6. `bafo` — BAFO
7. `contract_closure` — Contract & Closure
8. `post_closure` — Post Closure

Use `stageLabel(key)` from `bid-constants.ts` to get display names.

---

## Key Helpers (`bid-constants.ts`)

```ts
stageLabel(key)          // "deal_qualification" → "Deal Qualification"
urgencyClass(deadline)   // returns { label: "3d left", className: "text-warning-foreground font-medium" }
fmtMoney(n)              // 1500000 → "$1.5M"
initials(name)           // "Aryan Pawar" → "AP"
```

---

## Supabase Tables


| Table                 | Purpose                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `bids`                | Core bid records                                                                                   |
| `bid_questions`       | Questions per bid/stage — column: `question_text` (not `text`), `stage`                            |
| `bid_deliverables`    | Deliverables per bid/stage — column: `label` (not `title`), `stage`                                |
| `bid_activity_log`    | Audit trail                                                                                        |
| `bid_documents`       | Uploaded files (PDF/DOCX/XLSX) — `bid_id` nullable for global templates; `source` = `'uploaded'` \| `'generated'` |
| `bid_document_chunks` | Embedding chunks — `chunk_text`, `embedding vector(1024)`, `fts tsvector` (generated, GIN indexed) |
| `ai_sessions`         | Chat sessions — `bid_id` nullable, `messages jsonb`, `model`, `title` (optional display name)      |
| `profiles`            | User profiles                                                                                      |
| `user_roles`          | Role assignments                                                                                   |
| `role_permissions`    | Per-role page + feature access flags — admin always bypasses |
| `bid_assignments`     | Many-to-many bid↔team member assignments |
| `org_settings`        | Key-value org config — HubSpot token (admin-only RLS, server-read only), stage map, sync log |


Full schema in `src/integrations/supabase/types.ts`. **Note:** `bid_documents`, `bid_document_chunks`, and `ai_sessions` are not yet in the generated types file — use `as any` casts for RPC calls and these tables until types are regenerated.

### Applied Migrations


| File                               | What it does                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `20260605140000_knowledge_hub.sql` | `bid_documents`, `bid_document_chunks`, `match_bid_document_chunks` RPC, storage bucket |
| `20260605160000_ai_sessions.sql`   | `ai_sessions` table + RLS                                                               |
| `20260606120000_hybrid_search.sql` | `fts` column + GIN index on chunks, `hybrid_search_chunks` RPC                          |
| `20260608180000_settings_rbac.sql` | `profiles.status`, `role_permissions`, `bid_assignments`, `org_settings` tables + RLS + seeds |
| `20260608200000_rfx_proposal.sql`  | `ai_sessions.title` (session rename), `bid_documents.source` (`uploaded`\|`generated`)         |


### Deferred

- **HNSW index** — requires `maintenance_work_mem ≥ 64 MB` (Supabase free tier caps at 32 MB). See `docs/superpowers/notes/agentic-rag-verification.md` for manual apply instructions.
- **Drop `match_bid_document_chunks`** — after Phase B browser-verified: `drop function if exists public.match_bid_document_chunks;`

---

## What's Placeholder (Milestone 2)

- `/hubspot` — CRM sync (to be retired into Settings > Integrations tab in Milestone 3)
- `/settings` — user/org settings (Milestone 3 in progress)

---

## Settings & RBAC

### User Approval Flow

New users sign up at `/auth` → profile created with `status: 'pending'` → redirected to `/pending` screen. Admin approves via Notifications panel → `profiles.status` set to `'active'` + `user_roles` row inserted.

### Permission Model

`role_permissions` table drives page-level and feature-level access for `pre_sales`, `legal`, `finance`. Admin always bypasses. Client checks via `useHasPermission(resourceKey)` hook. Server functions check via `supabaseAdmin` query.

Resource key format:
- Pages: `page:dashboard`, `page:ai`, `page:docs`, etc.
- Features: `feature:docs:upload`, `feature:bids:create`, `feature:ai:model-select`, etc.

### HubSpot Sync

Token stored in `org_settings` (key: `hubspot_token`), admin-only RLS, read exclusively by server functions in `src/lib/api/hubspot-sync.ts`. Never exposed to the client.

Inbound sync: manual via Settings > Integrations > "Sync from HubSpot".
Outbound push: automatic on bid stage change via `useUpdateBid` mutation (fire-and-forget).

