# Bid Compass — Feature Execution Order
_Last updated: 2026-06-05_

This document tracks the order in which all features are designed, planned, and implemented.
Each feature must have a ✅ **Spec** and ✅ **Plan** before execution can begin.

Legend:
- ✅ Ready — spec + full implementation plan exist, can execute now
- 🔶 Stub — goal and backend requirements documented, needs brainstorm → spec → plan session
- ⬜ Not started — nothing exists yet

---

## Phase 0 — Foundation (Done)

| # | Feature | Spec | Plan | Status |
|---|---|---|---|---|
| 0.1 | Dashboard overview + Pipeline split-pane | [spec](specs/2026-06-04-dashboard-overview-design.md) | [plan](plans/2026-06-04-dashboard-overview.md) | ✅ Implemented |

---

## Phase 1 — V1 Shell Redesign (Done)

| # | Feature | Spec | Plan | Status |
|---|---|---|---|---|
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
_Route: `/notifications` (placeholder exists)_

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-05-notifications-design.md) | [plan](plans/2026-06-05-notifications.md) | ✅ Implemented |

**Key decisions:** All pre_sales + admin notified · In-app only · 5 event types (stage change, deadline, Go/No-Go, bid created, task done) · Forever retention · Master/Detail UI · Approach A (Postgres triggers + client-side deadline check)

**Pending:** Apply migration + enable Realtime on `notifications` table in Supabase dashboard.

---

### 2.2 — Calendar
_Route: `/calendar` (placeholder exists)_

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-05-calendar-design.md) | [plan](plans/2026-06-05-calendar.md) | ✅ Implemented |

**Key decisions:** Week view only · `bids.deadline` markers (all-day strip) + ad-hoc free-standing events · Team/Personal toggle · `react-big-calendar` with date-fns localizer · No iCal export · No drag-to-reschedule in v1

**New table:** `bid_events (id, title, event_date, created_by, created_at)` — no `bid_id` (events are free-standing)

**Pending:** Apply `20260605130000_bid_events.sql` migration in Supabase SQL Editor.

---

### 2.3 — Knowledge Hub (Documents)
_Route: `/docs` (placeholder exists)_

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-05-knowledge-hub-design.md) | [plan](plans/2026-06-05-knowledge-hub.md) | ✅ Ready to execute |

**Key decisions:** Both global templates + bid-scoped (bid_id nullable) · PDF/DOCX/XLSX · In-app preview for all (PDF via iframe, DOCX/XLSX via server-generated HTML) · Replace with confirmation dialog · pgvector embeddings (voyage-3, 1024-dim) · @mention copies slug to clipboard · 25 MB limit · Grid view + preview modal

**New tables:** `bid_documents`, `bid_document_chunks` · **Storage:** bucket `bid-documents` (private, signed URLs) · **Env var needed:** `VOYAGE_API_KEY`

**Pending:** Apply `20260605140000_knowledge_hub.sql` migration in Supabase SQL Editor before executing the plan.

---

### 2.4 — Reports & Analytics
_Route: `/analytics` (placeholder exists)_

**Stub:** [`plans/stubs/reports-analytics.md`](plans/stubs/reports-analytics.md)

**To make the plan, answer these in a brainstorm session:**
- [ ] Which charts are required for v1? (Win Rate Trend, Stage Distribution, Won vs Lost, Monthly Intake, Cycle Time, Team Performance — pick priority)
- [ ] Date range filter? (last 30d / 90d / 12m toggle)
- [ ] Export to CSV or PDF in v1?
- [ ] Per-user vs team-wide view?
- [ ] Backfill `closed_at` on existing bids, or start tracking fresh?
- [ ] Stage transition log: trigger from `useUpdateBid` mutation client-side, or Postgres trigger?

**New schema needed:**
```sql
-- Add to bids:
closed_at timestamptz

-- New table:
bid_stage_transitions (id, bid_id, from_stage, to_stage, transitioned_at, transitioned_by)
```

**Blocked by:** Nothing — but richer data if Notifications (2.1) is already writing activity log entries.

---

### 2.5 — AI Command Center
_Route: `/ai` (placeholder exists)_

**Stub:** [`plans/stubs/ai-command-center.md`](plans/stubs/ai-command-center.md)

**To make the plan, answer these in a brainstorm session:**
- [ ] Streaming responses, or single-shot?
- [ ] Per-bid sessions (context = that bid's data) or global assistant?
- [ ] Should AI context include uploaded documents (Knowledge Hub), or just structured bid fields?
- [ ] Persist chat history in DB, or session-only?
- [ ] Quick actions in the widget (Summarise RFP, Generate win themes, Identify risks, Draft exec summary) — which Claude model for each?
- [ ] Rate limiting / cost guardrails per user or org?

**New tables needed:**
```sql
ai_sessions (id, bid_id, user_id, messages jsonb, created_at)
```
**New server function:** TanStack Start server function to proxy Anthropic API calls (keeps API key server-side).
**Env var needed:** `ANTHROPIC_API_KEY`

**Blocked by:** Nothing — Knowledge Hub (2.3) ✅ is ready. Documents will be AI-indexed with voyage-3 embeddings and `@mention` slugs ready for the AI chat to consume.

---

## Recommended Execution Sequence

```
Phase 1:  1.1  Shell Redesign              ← execute now
Phase 2a: 2.1  Notifications               ← no deps, quick win (~4-5 days)
Phase 2b: 2.2  Calendar                    ← no deps, no new tables for v1 (~2-3 days)
Phase 2c: 2.3  Knowledge Hub               ← enables AI context
Phase 2d: 2.4  Reports & Analytics         ← needs schema additions
Phase 2e: 2.5  AI Command Center           ← best after Knowledge Hub
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
