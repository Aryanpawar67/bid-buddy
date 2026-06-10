# Bid Compass — Feature Execution Order

*Last updated: 2026-06-08*

This document tracks the order in which all features are designed, planned, and implemented.
Each feature must have a ✅ **Spec** and ✅ **Plan** before execution can begin.

Legend:

- ✅ Ready — spec + full implementation plan exist, can execute now
- 🔶 Stub — goal and backend requirements documented, needs brainstorm → spec → plan session
- ⬜ Not started — nothing exists yet

---

## Phase 0 — Foundation (Done)


| #   | Feature                                  | Spec                                                  | Plan                                           | Status        |
| --- | ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- | ------------- |
| 0.1 | Dashboard overview + Pipeline split-pane | [spec](specs/2026-06-04-dashboard-overview-design.md) | [plan](plans/2026-06-04-dashboard-overview.md) | ✅ Implemented |


---

## Phase 1 — V1 Shell Redesign (Done)


| #   | Feature                                                                             | Spec                                                 | Plan                                          | Status        |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ------------- |
| 1.1 | Sidebar (220px labels + sub-nav) + TopBar + Dashboard redesign + placeholder routes | [spec](specs/2026-06-05-v1-shell-redesign-design.md) | [plan](plans/2026-06-05-v1-shell-redesign.md) | ✅ Implemented |


**Execution order within 1.1:**

1. Task 1 — Foundation (`useRecentActivity` hook + 3 placeholder routes)
2. Task 2 — Sidebar rewrite
3. Task 3 — TopBar rewrite
4. Task 4 — Dashboard rewrite
5. Task 5 — Smoke-check

---

## Phase 2 — Feature Tabs

---

### 2.1 — Notifications

*Route: `/notifications` (placeholder exists)*


| Spec                                             | Plan                                      | Status        |
| ------------------------------------------------ | ----------------------------------------- | ------------- |
| [spec](specs/2026-06-05-notifications-design.md) | [plan](plans/2026-06-05-notifications.md) | ✅ Implemented |


**Key decisions:** All pre_sales + admin notified · In-app only · 5 event types (stage change, deadline, Go/No-Go, bid created, task done) · Forever retention · Master/Detail UI · Approach A (Postgres triggers + client-side deadline check)

**Pending:** Apply migration + enable Realtime on `notifications` table in Supabase dashboard.

---

### 2.2 — Calendar

*Route: `/calendar` (placeholder exists)*


| Spec                                        | Plan                                 | Status        |
| ------------------------------------------- | ------------------------------------ | ------------- |
| [spec](specs/2026-06-05-calendar-design.md) | [plan](plans/2026-06-05-calendar.md) | ✅ Implemented |


**Key decisions:** Week view only · `bids.deadline` markers (all-day strip) + ad-hoc free-standing events · Team/Personal toggle · `react-big-calendar` with date-fns localizer · No iCal export · No drag-to-reschedule in v1

**New table:** `bid_events (id, title, event_date, created_by, created_at)` — no `bid_id` (events are free-standing)

**Pending:** Apply `20260605130000_bid_events.sql` migration in Supabase SQL Editor.

---

### 2.3 — Knowledge Hub (Documents)

*Route: `/docs` (placeholder exists)*


| Spec                                             | Plan                                      | Status        |
| ------------------------------------------------ | ----------------------------------------- | ------------- |
| [spec](specs/2026-06-05-knowledge-hub-design.md) | [plan](plans/2026-06-05-knowledge-hub.md) | ✅ Implemented |


**Key decisions:** Both global templates + bid-scoped (bid_id nullable) · PDF/DOCX/XLSX · In-app preview for all (PDF via iframe, DOCX/XLSX via server-generated HTML) · Replace with confirmation dialog · pgvector embeddings (voyage-3, 1024-dim) · @mention copies slug to clipboard · 25 MB limit · Grid view + preview modal

**New tables:** `bid_documents`, `bid_document_chunks` · **Storage:** bucket `bid-documents` (private, signed URLs) · **Env var needed:** `VOYAGE_API_KEY`

**Pending:** Apply `20260605140000_knowledge_hub.sql` migration in Supabase SQL Editor + add `VOYAGE_API_KEY` to `.env.local`.

---

### 2.4 — Reports & Analytics

*Route: `/analytics` (placeholder exists)*


| Spec | Plan | Status        |
| ---- | ---- | ------------- |
| —    | —    | ✅ Implemented |


**Key decisions:** Win Rate Trend + Stage Distribution + Won vs Lost + Monthly Intake charts · Last 30d/90d/12m toggle · No export in v1 · Team-wide view · `closed_at` added to bids · `bid_stage_transitions` table via Postgres trigger

**Pending:** Apply `supabase/migrations/20260605150000_analytics.sql` in Supabase SQL Editor.

---

### 2.5 — AI Command Center

*Route: `/ai`*


| Spec                                                                                                                                                                                                            | Plan                                                                                                                                                                                       | Status        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| [spec(](specs/2026-06-05-ai-command-center-design.md)/Users/aryan/Desktop/Bid Compass/bid-buddy/docs/superpowers/specs/[2026-06-05-ai-command-center-design.md)](http://2026-06-05-ai-command-center-design.md) | [plan(](plans/2026-06-05-ai-command-center.md)/Users/aryan/Desktop/Bid Compass/bid-buddy/docs/superpowers/plans/[2026-06-05-ai-command-center.md)](http://2026-06-05-ai-command-center.md) | ✅ Implemented |


**Key decisions:** Streaming via `createServerFn` returning `Response` (TanStack Start `x-tss-raw` passthrough) · Bid + Global modes · pgvector doc chunk retrieval via Voyage AI (top 8 chunks) · `claude-sonnet-4-6` default · Model persisted in `localStorage` under `bid-compass:ai-model` · Quick-action chips (Summarise RFP, Win themes, Identify risks, Draft exec summary) · Informational usage counter (sessions created today), no hard rate limit in v1

**New table:** `ai_sessions (id, bid_id, user_id, model, messages jsonb, created_at)` with RLS · **New RPC:** `match_bid_document_chunks` (pgvector, 1024-dim) · **Env vars:** `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY` (already set from 2.3)

**Pending:** Apply `supabase/migrations/20260605160000_ai_sessions.sql` in Supabase SQL Editor. Applied already now.

---

### 2.6 — Agentic RAG

*Route: `/ai` (upgrade to 2.5)*


| Spec                                                          | Plan                                       | Status      |
| ------------------------------------------------------------- | ------------------------------------------ | ----------- |
| [spec](specs/2026-06-06-agentic-rag-design.md) | [plan](plans/2026-06-06-agentic-rag.md) | ✅ Ready |


**Key decisions:** Single-agent tool-use loop (max 3 rounds) · `search_knowledge_base` tool with prescriptive description · Hybrid search RPC (`hybrid_search_chunks`: pgvector HNSW + Postgres FTS + RRF fusion) · Global/template docs now retrievable in both modes · Voyage `rerank-2.5` post-fusion · Anthropic Contextual Retrieval at ingest (Haiku + prompt caching, ~$1/1M doc tokens) · Sentence-aware chunking · `\x1f`-sentinel status line protocol (stripped client-side) · Prompt caching on stable system prefix · Adaptive thinking on all models

**Phases:** A (hybrid RPC + HNSW migration) → B (agentic loop + client stripping) → C (chunking + contextual retrieval + reindex) → D (reranking) → E (optional eval harness)

**Migration:** `supabase/migrations/20260606120000_hybrid_search.sql` · No new env vars (uses existing `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`)

**Pending:** Execute phases A–D in order; run `reindexAll` after Phase C; drop `match_bid_document_chunks` RPC after Phase B browser-verified.

---

### 2.7 — Generate Proposal Redesign

*Route: `/ai` — enhancement to 2.5 AI Command Center*

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-09-generate-proposal-redesign.md) | [plan](plans/2026-06-09-generate-proposal-redesign.md) | ✅ Implemented |

**Key decisions:** Persistent footer chip (RFI/RFP stage + pre_sales/admin only) replaces the empty-session-only quick-action chip · 2-phase modal: Phase 1 = Sonnet-authored content preview (exec summary ×3, scope intro, deliverables) with per-section Regen; Phase 2 = auto-filled info strip + cover fields (prepared_for, spoc_name, spoc_email) · `previewProposalFn` (Sonnet, `max_tokens: 2500`) serialises chat history as `<chat_history>` block → returns `ProposalPreview` JSON · `generateProposalFn` extended with optional `intake` param — skips Haiku authoring when pre-authored intake is provided (backward compatible) · `IntakeSchema` (Zod) exported for type safety across server/client boundary

**New files:** `src/components/ai/ProposalModal.tsx` · **Modified:** `generate-proposal.ts`, `ai-functions.ts`, `ai-queries.ts`, `AiChatPanel.tsx`

---

## Phase 3 — Settings & Integrations

### 3.1 — Settings: User Management & RBAC

*Route: `/settings` (placeholder exists) + new `/pending` route*

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-08-settings-milestone3-design.md) | [plan](plans/2026-06-08-settings-user-rbac.md) | ✅ Implemented |

**Key decisions:** Self-signup with admin approval gate · `profiles.status` (pending/active/suspended) · Approval notifications to admins via existing notification system · `role_permissions` table — per-role page + feature toggles (admin always bypasses) · `bid_assignments` table — many-to-many bid↔member · Permission matrix in Team tab (admin only) + read-only member list for non-admins · Tab layout on `/settings` (Team | Integrations)

**New tables:** `role_permissions`, `bid_assignments`, `org_settings` · **New column:** `profiles.status` · **New route:** `/pending`

**Pending:** Apply `20260608180000_settings_rbac.sql` in Supabase SQL Editor (note: RLS policies use `'admin'::public.app_role` cast — fixed from original plan).

---

### 3.2 — Settings: HubSpot Integration

*Route: `/settings` > Integrations tab (retires `/hubspot` placeholder)*

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-08-settings-milestone3-design.md) | [plan](plans/2026-06-08-settings-hubspot.md) | ✅ Implemented |

**Key decisions:** HubSpot private app token — stored in `org_settings` (admin RLS), read server-side only via `supabaseAdmin`, never sent to browser · Stage mapping stored in `org_settings.hubspot_stage_map` · Inbound: manual "Sync from HubSpot" button (no scheduled cron in v1) · Outbound: fire-and-forget push on `useUpdateBid` stage change · `/hubspot` placeholder route retired

**New server fns:** `testHubSpotTokenFn`, `syncFromHubSpotFn`, `pushBidStageToHubSpotFn`, `saveHubSpotTokenFn`, `saveStageMapFn` (all in `src/lib/api/hubspot-sync.ts`) · HubSpot base URL hardcoded · Static imports used in hooks (not `require()`)

**Prerequisite:** 3.1 ✅ complete — `org_settings` table exists.

---

### 3.3 — SharePoint → Knowledge Base Sync

*Route: `/settings` > Integrations tab (new SharePoint section)*

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-10-sharepoint-kb-sync-design.md) | [plan](/Users/aryan/.claude/plans/what-is-the-feasibility-swirling-knuth.md) | ✅ Ready — parked for later |

**Goal:** Admin pastes a SharePoint share link to a KB file. When that file changes in SharePoint, Bid Compass auto-detects the change (eTag + content hash polling via Microsoft Graph) and re-runs the ingestion pipeline, eliminating manual delete + reupload. Synced docs go in at `bid_id = NULL` so they surface globally in every RFI/RFP AI session.

**Key decisions:** Microsoft Graph app-only auth (client credentials) — requires one-time Entra app registration (`Sites.Read.All` + `Files.Read.All`, same-tenant only) · Credentials in `org_settings` (admin RLS, server-only — mirrors HubSpot token pattern) · Reuses `indexDocument` from `doc-functions.ts` unchanged · Change detection: eTag (cheap skip) + `quickXorHash` (content-authoritative, avoids re-embed on rename/move) · Download via `@microsoft.graph.downloadUrl` (no auth header needed) · v1 = manual Sync Now / Sync All; v2 = secret-gated cron route for true auto-refresh · File types: pdf/docx/xlsx only (constrained by existing `extractText`)

**New files:** `src/lib/api/sharepoint-sync.ts`, `supabase/migrations/20260610130000_sharepoint_sync.sql` · **Modified:** `src/lib/settings-queries.ts` (hooks), `src/components/settings/IntegrationsTab.tsx` (UI section), `src/lib/doc-queries.ts` + `src/integrations/supabase/types.ts` (Document type) · **Phase 2:** `src/routes/api/sharepoint-cron.ts`

**Prerequisite:** 3.2 ✅ complete — `org_settings` table exists.

---

## Recommended Execution Sequence

```
Phase 1:  1.1  Shell Redesign              ← execute now
Phase 2a: 2.1  Notifications               ← no deps, quick win (~4-5 days)
Phase 2b: 2.2  Calendar                    ← no deps, no new tables for v1 (~2-3 days)
Phase 2c: 2.3  Knowledge Hub               ← enables AI context
Phase 2d: 2.4  Reports & Analytics         ← needs schema additions
Phase 2e: 2.5  AI Command Center           ← best after Knowledge Hub
Phase 3a: 3.1  Settings: User Management & RBAC   ← execute after Phase 2
Phase 3b: 3.2  Settings: HubSpot Integration       ← requires 3.1 (org_settings)
Phase 3c: 3.3  SharePoint → KB Sync               ← requires 3.2; parked for later (spec + plan ready)
```

---

## How to Start a New Plan

For each 🔶 item above:

1. Start a new session and share this file + the relevant stub
2. Run `/brainstorm` (or invoke `superpowers:brainstorming` skill)
3. Answer the questions listed in the stub's "To make the plan" section
4. Spec gets written to `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`
5. Plan gets written to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
6. Update this file: change 🔶 to ✅ and add links

