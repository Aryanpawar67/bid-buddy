## BidTrack v1 — Build Plan

This is a substantial internal app. Before I start, two important notes and a proposed v1 slice.

### Stack note (important)

The PRD specifies **Next.js 14 App Router**. This project is built on **TanStack Start + React 19 + Vite** (Lovable's template). The two aren't interchangeable, but everything in the PRD maps cleanly:

- Next App Router routes → TanStack file-based routes in `src/routes/`
- Route handlers → `createServerFn` + server routes under `src/routes/api/`
- RSC data fetching → loaders + TanStack Query (already wired)
- Supabase, Tailwind, shadcn/ui, Recharts, Zustand, RHF+Zod, dnd-kit, Framer Motion, date-fns, Tabler Icons all work identically

I'll build on TanStack Start. If you specifically need Next.js, this is the moment to say so — switching later is expensive.

### Backend note

I'll enable **Lovable Cloud** (managed Supabase under the hood) for DB, auth, storage, RLS, and realtime. HubSpot and Slack will use stored secrets + server functions. No mention of Supabase to end users in UI copy.

### Proposed v1 scope (first shipped milestone)

To get something usable quickly, I'll cut the build into milestones. **This first milestone delivers a working core**:

1. **Design system & shell** — palette, typography, tokens from §7 wired into `styles.css`; persistent sidebar + top breadcrumb bar; routing skeleton for all routes in §8.
2. **Auth + roles + RLS** — Supabase auth, `users` table with role enum, `_authenticated` gate, role-aware sidebar/route guards. Legal/Finance land on `/queue`.
3. **Data model** — all tables from §5 with RLS policies from §6.3, enums, indexes, GRANTs.
4. **Pipeline dashboard (`/dashboard`)** — bid list panel (search, filter chips, urgency coloring), 8-stage left nav strip with status dots/states, per-stage workspace (header, metric row, details, checklist, actions). Fully interactive against real data.
5. **New Bid intake modal** — all fields from §4.5, RHF+Zod, creates bid at `deal_qualification`, writes initial `bid_stage_history` entry, redirects to new bid.
6. **Go/No-Go scorecard (`/bids/[id]/gonogo`)** — weighted 4-section form, live score, verdict thresholds, persists to bid record, gates RFI progression (treating as a hard block — flagged in Open Q #2).
7. **My Queue (`/queue`)** — aggregated tasks across bids, grouped by bid, inline checkbox toggle (optimistic), 4 summary cards, filter bar, empty state.
8. **Seed data** — a handful of demo bids across stages so the UI isn't empty on first login.

### Deferred to later milestones (after v1 ships and you've used it)

- `/analytics` — 6 Recharts charts (Milestone 2)
- `/docs` — central document library with versioning (Milestone 2)
- `/hubspot` — bidirectional sync, sync log UI, settings mapping (Milestone 3)
- Slack webhooks (Milestone 3)
- Supabase Realtime live updates (Milestone 3)
- `/settings/*` admin pages (Milestone 3)
- Document upload inside intake modal (Milestone 2 — schema will be ready)

### Design direction

I'll execute the §7 design system literally — purple `#491AEB` sidebar on `#220032`, orange `#FD5B0E` CTAs, the exact type scale, 12px card radius, 0.5px borders. Dense, tool-feel, no decorative flourishes. Tabler Icons throughout. No design exploration step — the PRD is prescriptive.

### Open questions I'll default on (call out if you disagree)

- Q2: **Go/No-Go is a hard block** on RFI progression. (Easiest to relax later than to add.)
- Q5: **Backward stage movement allowed without reason** in v1. Audit log captures it.
- Q4: **One global activity log per bid** in v1 (`bid_activity_log` as specced).
- Q1: **Legal/Finance can only act on items where `assigned_team` matches their role** — read-only on others. Matches §6.3 RLS.

---

**Confirm to proceed** with this milestone-1 scope on TanStack Start + Lovable Cloud, or tell me what to adjust (stack, scope cuts/adds, open-question defaults).