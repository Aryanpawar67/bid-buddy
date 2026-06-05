# Reports & Analytics — Design Spec
_Date: 2026-06-05_
_Reference mockup: `docs/design-mockups/analytics-mockup.html` (Variation A — Grid)_

## Goal

Replace the `/analytics` placeholder with a full-featured analytics dashboard. Users see 5 KPI cards, 6 charts (Win Rate Trend, Stage Distribution, Pipeline Value by Stage, Cycle Time by Stage, Won vs Lost Value, Monthly Intake), and an admin-gated Team Performance table — all filtered by a date range selector pinned to the topbar.

---

## 1. Decisions

| Question | Decision |
|---|---|
| Layout | Variation A — Grid (KPI strip, 2-col chart grid, full-width team table) |
| Date filter | 30d / 90d / 12m chips + custom date range picker (calendar popover) |
| Export in v1? | No |
| Team Performance | Admin-only for individual breakdowns; non-admins see aggregate team totals only |
| Stage transition tracking | Postgres trigger on `bids.stage` writes to `bid_stage_transitions`; `useUpdateBid` also writes a row client-side (belt-and-suspenders) |
| `closed_at` column | `ALTER TABLE bids ADD COLUMN closed_at timestamptz` — set by trigger when `status` changes to `won` or `lost` |
| Chart library | Recharts (already used elsewhere in the ecosystem; treeshakes well with Vite) |
| Query strategy | Supabase RPC functions for all aggregated queries — no N+1 from the client |

---

## 2. Data Model

### 2a. `bids` table — new column

```sql
alter table public.bids
  add column if not exists closed_at timestamptz;
```

`closed_at` is set when `status` changes to `won` or `lost` (via trigger). It is the timestamp used for "closed within date range" filtering.

### 2b. `bid_stage_transitions` — new table

```sql
create table if not exists public.bid_stage_transitions (
  id           uuid primary key default gen_random_uuid(),
  bid_id       uuid references public.bids(id) on delete cascade not null,
  from_stage   text,                   -- null for initial stage assignment
  to_stage     text not null,
  transitioned_by uuid references public.profiles(id),
  created_at   timestamptz default now() not null
);

create index if not exists bst_bid_id_idx on public.bid_stage_transitions (bid_id);
create index if not exists bst_created_at_idx on public.bid_stage_transitions (created_at);

alter table public.bid_stage_transitions enable row level security;

create policy "org members can read transitions"
  on public.bid_stage_transitions for select
  using (auth.uid() is not null);

create policy "org members can insert transitions"
  on public.bid_stage_transitions for insert
  with check (auth.uid() is not null);
```

### 2c. Postgres trigger — auto-write transition + set `closed_at`

```sql
create or replace function public.handle_bid_stage_change()
returns trigger language plpgsql security definer as $$
begin
  -- Record stage transition when stage changes
  if (new.stage is distinct from old.stage) then
    insert into public.bid_stage_transitions (bid_id, from_stage, to_stage, transitioned_by)
    values (new.id, old.stage, new.stage, auth.uid());
  end if;

  -- Set closed_at when status flips to won or lost
  if (new.status in ('won', 'lost') and old.status not in ('won', 'lost')) then
    new.closed_at := now();
  end if;

  -- Clear closed_at if status reverts from won/lost (e.g. re-opened)
  if (old.status in ('won', 'lost') and new.status not in ('won', 'lost')) then
    new.closed_at := null;
  end if;

  return new;
end;
$$;

create trigger bid_stage_change_trigger
  before update on public.bids
  for each row execute function public.handle_bid_stage_change();
```

### 2d. RPC functions

All chart data is fetched through Supabase RPC functions to avoid N+1 queries. Functions accept `p_from timestamptz` and `p_to timestamptz` range params.

**`analytics_kpi_summary(p_from, p_to)`**

Returns one row:
```
active_bids int, pipeline_value numeric,
win_rate numeric, avg_cycle_days numeric,
closed_count int, won_count int, lost_count int
```

**`analytics_win_rate_trend(p_from, p_to)`**

Returns one row per calendar month in the range:
```
month date, won_count int, closed_count int, win_rate numeric
```

**`analytics_stage_distribution()`**

Returns one row per active stage:
```
stage text, bid_count int, pct numeric
```
(No date filter — reflects current live state)

**`analytics_pipeline_value_by_stage()`**

Returns one row per active stage:
```
stage text, total_value numeric
```
(No date filter — current state)

**`analytics_cycle_time_by_stage(p_from, p_to)`**

Returns avg days spent in each stage for transitions in range:
```
stage text, avg_days numeric
```

**`analytics_won_lost_by_month(p_from, p_to)`**

Returns one row per month × outcome:
```
month date, won_value numeric, lost_value numeric
```

**`analytics_monthly_intake(p_from, p_to)`**

Returns one row per month:
```
month date, new_bids int
```

**`analytics_team_performance(p_from, p_to)`**

Returns one row per team member (admin-only via RLS/app-layer check):
```
user_id uuid, display_name text, avatar_url text,
active_bids int, closed_count int, won_count int,
win_rate numeric, pipeline_value numeric, avg_cycle_days numeric
```

---

## 3. Page Structure

**Route:** `src/routes/_app/analytics.tsx` (full rewrite of placeholder)

### Layout

```
TopBar: "Reports & Analytics"  |  [30d] [90d] [12m]  [📅 Jun 1 – Jun 5 ▾]
────────────────────────────────────────────────────────────────────────────
KPI STRIP  (5 cards, 1 row)
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│Active    │ │Pipeline  │ │Win Rate  │ │Avg Cycle │ │Closed    │
│Bids  24  │ │Value $18M│ │  37%     │ │  42d     │ │  11      │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘

ROW 1  (2 col)
┌──────────────────────┐  ┌──────────────────────┐
│  Win Rate Trend      │  │  Stage Distribution  │
│  (line chart)        │  │  (donut + legend)    │
└──────────────────────┘  └──────────────────────┘

ROW 2  (2 col)
┌──────────────────────┐  ┌──────────────────────┐
│  Pipeline Value      │  │  Cycle Time by Stage │
│  (vertical bars)     │  │  (horizontal bars)   │
└──────────────────────┘  └──────────────────────┘

ROW 3  (2 col)
┌──────────────────────┐  ┌──────────────────────┐
│  Won vs Lost Value   │  │  Monthly Intake      │
│  (grouped bars)      │  │  (bar chart)         │
└──────────────────────┘  └──────────────────────┘

ROW 4  (full width, admin-gated)
┌───────────────────────────────────────────────────┐
│  Team Performance                    [ADMIN ONLY] │
│  (table: member, active, closed, won, win%, value,│
│   avg cycle)                                      │
└───────────────────────────────────────────────────┘
```

Non-admins: Team Performance section is hidden entirely (not just blurred).

### Date Filter

The topbar contains:
- Three chips: `30d`, `90d`, `12m` (select one active state)
- A calendar icon button showing `Jun 1 – Jun 5` that opens a date-range popover (two calendar months side-by-side)
- Selecting a chip updates the date range; picking custom dates deactivates the chips
- Date range state lives in the route via URL search params (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) for shareability

### KPI Cards

Each card:
```
[icon]  LABEL (9px uppercase)
        VALUE (22px bold)
        delta (10px, green/red/neutral)
```

| Card | Value | Delta source |
|---|---|---|
| Active Bids | count of `status = active` | change vs previous period |
| Pipeline Value | sum of `value` where active | change vs previous period |
| Win Rate | won / (won + lost) in period | vs previous equivalent period |
| Avg Cycle Time | avg days from `created_at` to `closed_at` | vs previous period |
| Closed (Period) | total closed in period | breakdown: "N won · N lost" |

### Charts

#### Win Rate Trend
- Recharts `LineChart` with `Area` fill
- X-axis: months in selected period
- Y-axis: 0–100%
- Single line: win rate per month
- Last point has a tooltip bubble showing current %

#### Stage Distribution
- Recharts `PieChart` (donut, inner radius 45)
- Colors: per-stage color map (matches `stageLabel` order)
- Legend: stage name + count + % inline to the right of the chart

#### Pipeline Value by Stage
- Recharts `BarChart` (vertical bars)
- X-axis: stages, Y-axis: dollar value
- Bars colored per stage
- Value labels above bars (fmtMoney)

#### Cycle Time by Stage
- Recharts `BarChart` layout="horizontal" (horizontal bars)
- Y-axis: stage names, X-axis: days
- Shows avg days per stage; bar colored per stage

#### Won vs Lost Value
- Recharts `BarChart` grouped (two bars per month)
- Won bar: `#491AEB`, Lost bar: `#EF4444` at 70% opacity
- Legend at top-left

#### Monthly Intake
- Recharts `BarChart`
- Bars in `#ede9fd` for past months, `#491AEB` for recent months (last 3 in period)
- Count label above each bar

#### Team Performance Table
- Columns: Member (avatar + name), Active Bids, Closed (Period), Won, Win Rate (bar + %), Pipeline Value, Avg Cycle
- Win Rate column: mini horizontal bar + % value
- Sorted by win rate descending
- Only visible to `isAdmin` users; others see nothing (no blur, no locked state — simply absent)

---

## 4. Query Layer

New file: `src/lib/analytics-queries.ts`

```ts
// Date range state
export type DateRange = { from: Date; to: Date }

// Hooks
useKpiSummary(range: DateRange)
useWinRateTrend(range: DateRange)
useStageDistribution()
usePipelineValueByStage()
useCycleTimeByStage(range: DateRange)
useWonLostByMonth(range: DateRange)
useMonthlyIntake(range: DateRange)
useTeamPerformance(range: DateRange)   // returns empty if !isAdmin
```

All hooks use `supabase.rpc(fnName, params)` — no direct table queries. Date ranges are serialized as ISO strings for the RPC call.

Cache keys include the date range so React Query re-fetches automatically when the user changes the filter.

---

## 5. `useUpdateBid` — client-side belt-and-suspenders

In `src/lib/bid-queries.ts`, the existing `useUpdateBid` mutation should also write a `bid_stage_transitions` row whenever `stage` changes:

```ts
// Inside useUpdateBid onMutate / mutationFn:
if (updates.stage && updates.stage !== currentBid.stage) {
  await supabase.from('bid_stage_transitions').insert({
    bid_id: id,
    from_stage: currentBid.stage,
    to_stage: updates.stage,
    transitioned_by: currentUserId,
  })
}
```

The Postgres trigger is the authoritative source; the client write is a fallback for cases where the trigger fires but the transition row is missed (e.g., direct DB edits or future import tools).

---

## 6. New Files

| File | Action |
|---|---|
| `supabase/migrations/20260605150000_analytics.sql` | Create |
| `src/lib/analytics-queries.ts` | Create |
| `src/components/analytics/KpiStrip.tsx` | Create |
| `src/components/analytics/WinRateTrendChart.tsx` | Create |
| `src/components/analytics/StageDistributionChart.tsx` | Create |
| `src/components/analytics/PipelineValueChart.tsx` | Create |
| `src/components/analytics/CycleTimeChart.tsx` | Create |
| `src/components/analytics/WonLostChart.tsx` | Create |
| `src/components/analytics/MonthlyIntakeChart.tsx` | Create |
| `src/components/analytics/TeamPerformanceTable.tsx` | Create |
| `src/components/analytics/DateRangePicker.tsx` | Create |
| `src/routes/_app/analytics.tsx` | Rewrite |

**New dependency:** `recharts` — add via `bun add recharts`

---

## 7. Out of Scope (v1)

- Export to CSV/PDF
- Chart drill-down (clicking a bar to filter the pipeline view)
- Org-level aggregation across multiple workspaces
- Bid-owner filter (filter all charts by a specific user)
- Real-time updates (polling/subscriptions)
- Mobile-responsive layout (desktop-first only)
