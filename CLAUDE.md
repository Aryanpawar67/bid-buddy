# BidTrack — CLAUDE.md

Internal bid management workspace for iMocha's pre-sales and revenue teams. Tracks RFPs/RFIs/RFQs through an 8-stage pipeline with role-based access.

---

## Stack

- **Framework:** TanStack Start (SSR) + TanStack Router (file-based routing) v1.167–1.168
- **Runtime:** Bun (use `bun` for all installs and scripts, not npm/yarn)
- **UI:** React 19, TailwindCSS v4, shadcn/ui components (Radix primitives)
- **Backend:** Supabase (Postgres + Auth)
- **Build:** Vite 7 with `@tanstack/react-start/plugin/vite`
- **No test runner** — verify with `bun run build:dev` and manual browser testing

## Commands

```bash
bun dev              # dev server
bun run build:dev    # build (use this to verify TypeScript/route correctness)
bun run build        # production build
bun run lint         # ESLint
bun run format       # Prettier
```

## Project Layout

```
src/
  routes/
    __root.tsx          # HTML shell, QueryClientProvider, 404/error boundaries
    _app.tsx            # Auth guard + app shell (Sidebar + TopBar + Outlet)
    _app/
      dashboard.tsx     # Overview page: KPI strip + needs-attention list
      pipeline.tsx      # Bid pipeline split-pane (list + stage workspace)
      queue.tsx         # Personal task queue (questions + deliverables)
      analytics.tsx     # Placeholder — milestone 2
      bids.$id.tsx      # Bid detail / stage workspace
      bids.$id.gonogo.tsx  # Go/No-Go scoring form
      docs.tsx          # Documents placeholder
      hubspot.tsx       # HubSpot sync placeholder
      settings.tsx      # Settings placeholder
    auth.tsx            # Login/signup page
    index.tsx           # Redirects to /dashboard or /queue based on role
  components/
    app/
      Sidebar.tsx       # Icon-only sidebar (52px). NAV array drives visible items per role.
      TopBar.tsx        # Breadcrumbs + New bid button + IntakeModal trigger
    bids/
      BidCard.tsx       # Compact bid list item used in pipeline sidebar
      StageNav.tsx      # Horizontal stage progress nav
      StageWorkspace.tsx # Per-stage task/deliverable workspace
      IntakeModal.tsx   # New bid intake form
    ui/                 # shadcn/ui components — do not edit these manually
  lib/
    auth.ts             # useSession, useCurrentUser, AppRole type, defaultLandingFor
    bid-queries.ts      # All TanStack Query hooks (useBids, useBid, useMyQueue, etc.) + Bid type
    bid-constants.ts    # STAGES, stageLabel, urgencyClass, fmtMoney, initials, PORTALS
  integrations/
    supabase/
      client.ts         # Browser Supabase client
      client.server.ts  # Server-side Supabase client
      types.ts          # Generated Supabase DB types
      auth-attacher.ts  # TanStack Start middleware: attaches Supabase session to server context
      auth-middleware.ts
```

## Routing

TanStack Router uses **file-based routing** — adding a file to `src/routes/` registers the route automatically. The `routeTree.gen.ts` file is auto-generated on `bun dev`; never edit it manually.

Route file naming:
- `_app/foo.tsx` → `/foo` (inside the auth-gated `_app` layout)
- `_app/bids.$id.tsx` → `/bids/:id`
- `__root.tsx` → root shell (no URL)

## Auth & Roles

Four roles: `pre_sales`, `legal`, `finance`, `admin`. Stored in `user_roles` table.

```ts
type AppRole = "pre_sales" | "legal" | "finance" | "admin";
```

Role priority (highest wins): `admin > pre_sales > legal > finance`

Default landing: legal/finance → `/queue`; everyone else → `/dashboard`

`useCurrentUser()` returns `{ user, profile, roles, primaryRole, isAdmin, isPreSales }`.

## Data Layer

All Supabase queries live in `src/lib/bid-queries.ts` as TanStack Query hooks. **Do not query Supabase directly in route/component files.**

Key hooks:
- `useBids()` — all bids ordered by deadline
- `useBid(id)` — single bid
- `useStageItems(bidId, stage)` — questions + deliverables for a bid/stage
- `useMyQueue(userId)` — items assigned to current user
- `useUpdateBid()`, `useToggleDeliverable()`, `useToggleQuestion()` — mutations

The `Bid` type is exported from `bid-queries.ts`.

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

All tokens are CSS variables defined in `src/styles.css`. Use them via Tailwind classes, not raw hex values.

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

## Key Helpers (`bid-constants.ts`)

```ts
stageLabel(key)          // "deal_qualification" → "Deal Qualification"
urgencyClass(deadline)   // returns { label: "3d left", className: "text-warning-foreground font-medium" }
fmtMoney(n)              // 1500000 → "$1.5M"
initials(name)           // "Aryan Pawar" → "AP"
```

## Supabase Tables

Core tables: `bids`, `bid_questions`, `bid_deliverables`, `bid_activity_log`, `profiles`, `user_roles`

Full schema in `src/integrations/supabase/types.ts`.

## What's Placeholder (Milestone 2)

- `/analytics` — charts: pipeline value, win rate, cycle time
- `/docs` — document management
- `/hubspot` — CRM sync
- `/settings` — user/org settings
