# Reports & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/analytics` placeholder with a full-featured analytics dashboard: 5 KPI cards, 7 charts, and an admin-gated Team Performance table — all filtered by a date range selector.

**Architecture:** All chart data is fetched via Supabase RPC functions (no N+1 from the client). A new `bid_stage_transitions` table + Postgres trigger tracks stage changes; `bids.closed_at` is set when a bid is won or lost. The `/analytics` route reads date range from URL search params; Recharts renders all charts. `useUpdateBid` gets a belt-and-suspenders client-side transition write.

**Tech Stack:** TanStack Router (search params), TanStack Query, Supabase RPC, Recharts (already installed), date-fns v4 (already installed), Tailwind CSS v4, lucide-react.

> **No test runner in this project.** Verification steps use `bun run build:dev` (TypeScript + route correctness) and manual browser inspection. Every task ends with a build check and a commit.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/20260605150000_analytics.sql` | Create |
| `src/lib/analytics-queries.ts` | Create |
| `src/lib/bid-queries.ts` | Modify (add transition write to `useUpdateBid`) |
| `src/components/analytics/DateRangePicker.tsx` | Create |
| `src/components/analytics/KpiStrip.tsx` | Create |
| `src/components/analytics/WinRateTrendChart.tsx` | Create |
| `src/components/analytics/StageDistributionChart.tsx` | Create |
| `src/components/analytics/PipelineValueChart.tsx` | Create |
| `src/components/analytics/CycleTimeChart.tsx` | Create |
| `src/components/analytics/WonLostChart.tsx` | Create |
| `src/components/analytics/MonthlyIntakeChart.tsx` | Create |
| `src/components/analytics/TeamPerformanceTable.tsx` | Create |
| `src/routes/_app/analytics.tsx` | Rewrite |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260605150000_analytics.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ── 1. Add closed_at to bids ────────────────────────────────────────────────
alter table public.bids
  add column if not exists closed_at timestamptz;

-- ── 2. bid_stage_transitions ────────────────────────────────────────────────
create table if not exists public.bid_stage_transitions (
  id              uuid primary key default gen_random_uuid(),
  bid_id          uuid references public.bids(id) on delete cascade not null,
  from_stage      text,
  to_stage        text not null,
  transitioned_by uuid references public.profiles(id),
  created_at      timestamptz default now() not null
);

create index if not exists bst_bid_id_idx    on public.bid_stage_transitions (bid_id);
create index if not exists bst_created_at_idx on public.bid_stage_transitions (created_at);

alter table public.bid_stage_transitions enable row level security;

create policy "org members can read transitions"
  on public.bid_stage_transitions for select
  using (auth.uid() is not null);

create policy "org members can insert transitions"
  on public.bid_stage_transitions for insert
  with check (auth.uid() is not null);

-- ── 3. Trigger: stage changes + closed_at ──────────────────────────────────
create or replace function public.handle_bid_stage_change()
returns trigger language plpgsql security definer as $$
begin
  if (new.stage is distinct from old.stage) then
    insert into public.bid_stage_transitions (bid_id, from_stage, to_stage, transitioned_by)
    values (new.id, old.stage::text, new.stage::text, auth.uid());
  end if;

  if (new.status in ('won', 'lost') and old.status not in ('won', 'lost')) then
    new.closed_at := now();
  end if;

  if (old.status in ('won', 'lost') and new.status not in ('won', 'lost')) then
    new.closed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists bid_stage_change_trigger on public.bids;
create trigger bid_stage_change_trigger
  before update on public.bids
  for each row execute function public.handle_bid_stage_change();

-- ── 4. RPC: analytics_kpi_summary ──────────────────────────────────────────
create or replace function public.analytics_kpi_summary(p_from timestamptz, p_to timestamptz)
returns table (
  active_bids   bigint,
  pipeline_value numeric,
  win_rate       numeric,
  avg_cycle_days numeric,
  closed_count   bigint,
  won_count      bigint,
  lost_count     bigint
) language sql security definer as $$
  select
    count(*)                      filter (where status = 'active')                                            as active_bids,
    coalesce(sum(value)           filter (where status = 'active'), 0)                                        as pipeline_value,
    case
      when count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to) > 0
        then round(
          count(*) filter (where status = 'won'  and closed_at between p_from and p_to)::numeric /
          count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to) * 100, 1)
      else 0
    end                                                                                                        as win_rate,
    round(avg(extract(epoch from (closed_at - created_at)) / 86400)
          filter (where status in ('won','lost') and closed_at between p_from and p_to)::numeric, 1)          as avg_cycle_days,
    count(*) filter (where status in ('won','lost') and closed_at between p_from and p_to)                    as closed_count,
    count(*) filter (where status = 'won'  and closed_at between p_from and p_to)                             as won_count,
    count(*) filter (where status = 'lost' and closed_at between p_from and p_to)                             as lost_count
  from public.bids;
$$;

-- ── 5. RPC: analytics_win_rate_trend ────────────────────────────────────────
create or replace function public.analytics_win_rate_trend(p_from timestamptz, p_to timestamptz)
returns table (
  month        date,
  won_count    bigint,
  closed_count bigint,
  win_rate     numeric
) language sql security definer as $$
  select
    date_trunc('month', closed_at)::date                                                                as month,
    count(*) filter (where status = 'won')                                                              as won_count,
    count(*)                                                                                             as closed_count,
    case when count(*) > 0
      then round(count(*) filter (where status = 'won')::numeric / count(*) * 100, 1)
      else 0
    end                                                                                                  as win_rate
  from public.bids
  where status in ('won','lost')
    and closed_at between p_from and p_to
  group by date_trunc('month', closed_at)
  order by month;
$$;

-- ── 6. RPC: analytics_stage_distribution ────────────────────────────────────
create or replace function public.analytics_stage_distribution()
returns table (
  stage     text,
  bid_count bigint,
  pct       numeric
) language sql security definer as $$
  with totals as (select count(*) as total from public.bids where status = 'active')
  select
    b.stage::text,
    count(*)                                                                           as bid_count,
    case when t.total > 0 then round(count(*)::numeric / t.total * 100, 1) else 0 end as pct
  from public.bids b, totals t
  where b.status = 'active'
  group by b.stage, t.total
  order by bid_count desc;
$$;

-- ── 7. RPC: analytics_pipeline_value_by_stage ───────────────────────────────
create or replace function public.analytics_pipeline_value_by_stage()
returns table (
  stage       text,
  total_value numeric
) language sql security definer as $$
  select stage::text, coalesce(sum(value), 0) as total_value
  from public.bids
  where status = 'active'
  group by stage
  order by total_value desc;
$$;

-- ── 8. RPC: analytics_cycle_time_by_stage ───────────────────────────────────
create or replace function public.analytics_cycle_time_by_stage(p_from timestamptz, p_to timestamptz)
returns table (
  stage    text,
  avg_days numeric
) language sql security definer as $$
  with durations as (
    select
      to_stage,
      extract(epoch from (
        coalesce(
          lead(created_at) over (partition by bid_id order by created_at),
          now()
        ) - created_at
      )) / 86400 as days_in_stage
    from public.bid_stage_transitions
    where created_at between p_from and p_to
  )
  select
    to_stage                        as stage,
    round(avg(days_in_stage)::numeric, 1) as avg_days
  from durations
  group by to_stage
  order by avg_days desc;
$$;

-- ── 9. RPC: analytics_won_lost_by_month ─────────────────────────────────────
create or replace function public.analytics_won_lost_by_month(p_from timestamptz, p_to timestamptz)
returns table (
  month      date,
  won_value  numeric,
  lost_value numeric
) language sql security definer as $$
  select
    date_trunc('month', closed_at)::date                              as month,
    coalesce(sum(value) filter (where status = 'won'),  0)            as won_value,
    coalesce(sum(value) filter (where status = 'lost'), 0)            as lost_value
  from public.bids
  where status in ('won','lost')
    and closed_at between p_from and p_to
  group by date_trunc('month', closed_at)
  order by month;
$$;

-- ── 10. RPC: analytics_monthly_intake ───────────────────────────────────────
create or replace function public.analytics_monthly_intake(p_from timestamptz, p_to timestamptz)
returns table (
  month    date,
  new_bids bigint
) language sql security definer as $$
  select
    date_trunc('month', created_at)::date as month,
    count(*)                              as new_bids
  from public.bids
  where created_at between p_from and p_to
  group by date_trunc('month', created_at)
  order by month;
$$;

-- ── 11. RPC: analytics_team_performance ─────────────────────────────────────
create or replace function public.analytics_team_performance(p_from timestamptz, p_to timestamptz)
returns table (
  user_id        uuid,
  display_name   text,
  avatar_url     text,
  active_bids    bigint,
  closed_count   bigint,
  won_count      bigint,
  win_rate       numeric,
  pipeline_value numeric,
  avg_cycle_days numeric
) language sql security definer as $$
  select
    p.id                                                                                        as user_id,
    p.full_name                                                                                 as display_name,
    p.avatar_url,
    count(*) filter (where b.status = 'active')                                                as active_bids,
    count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) as closed_count,
    count(*) filter (where b.status = 'won'  and b.closed_at between p_from and p_to)          as won_count,
    case
      when count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) > 0
        then round(
          count(*) filter (where b.status = 'won' and b.closed_at between p_from and p_to)::numeric /
          count(*) filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to) * 100, 1)
      else 0
    end                                                                                         as win_rate,
    coalesce(sum(b.value) filter (where b.status = 'active'), 0)                               as pipeline_value,
    round(avg(extract(epoch from (b.closed_at - b.created_at)) / 86400)
          filter (where b.status in ('won','lost') and b.closed_at between p_from and p_to)::numeric, 1)
                                                                                                as avg_cycle_days
  from public.profiles p
  left join public.bids b on b.owner_id = p.id
  group by p.id, p.full_name, p.avatar_url
  having count(b.id) > 0
  order by win_rate desc nulls last;
$$;
```

- [ ] **Step 2: Apply the migration to your local Supabase**

```bash
cd /Users/aryan/Desktop/Bid\ Compass/bid-buddy
bunx supabase db push
```

Expected: Migration applied without errors. If `supabase db push` fails (remote-only setup), apply via the Supabase dashboard SQL editor — paste the entire migration file contents and run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605150000_analytics.sql
git commit -m "feat: add analytics schema (bid_stage_transitions, closed_at, 8 RPC functions)"
```

---

## Task 2: Analytics Query Layer

**Files:**
- Create: `src/lib/analytics-queries.ts`

- [ ] **Step 1: Create the query file**

```typescript
import { useQuery } from "@tanstack/react-query";
import { subDays, subMonths, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

export type DateRange = { from: Date; to: Date };

export type KpiSummary = {
  active_bids: number;
  pipeline_value: number;
  win_rate: number;
  avg_cycle_days: number | null;
  closed_count: number;
  won_count: number;
  lost_count: number;
};

export type WinRateTrendRow = {
  month: string;       // ISO date string
  won_count: number;
  closed_count: number;
  win_rate: number;
};

export type StageDistributionRow = {
  stage: string;
  bid_count: number;
  pct: number;
};

export type PipelineValueRow = {
  stage: string;
  total_value: number;
};

export type CycleTimeRow = {
  stage: string;
  avg_days: number;
};

export type WonLostRow = {
  month: string;       // ISO date string
  won_value: number;
  lost_value: number;
};

export type MonthlyIntakeRow = {
  month: string;       // ISO date string
  new_bids: number;
};

export type TeamPerformanceRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  active_bids: number;
  closed_count: number;
  won_count: number;
  win_rate: number;
  pipeline_value: number;
  avg_cycle_days: number | null;
};

// ── Date preset helpers ───────────────────────────────────────────────────────

export function presetToRange(preset: "30d" | "90d" | "12m"): DateRange {
  const now = new Date();
  if (preset === "30d") return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
  if (preset === "12m") return { from: startOfDay(subMonths(now, 12)), to: endOfDay(now) };
  return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) }; // 90d default
}

function rangeKey(range: DateRange) {
  return [range.from.toISOString(), range.to.toISOString()];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useKpiSummary(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-kpi", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_kpi_summary", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      const row = (data as KpiSummary[])[0];
      return row ?? null;
    },
  });
}

export function useWinRateTrend(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-win-trend", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_win_rate_trend", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as WinRateTrendRow[]) ?? [];
    },
  });
}

export function useStageDistribution() {
  return useQuery({
    queryKey: ["analytics-stage-dist"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_stage_distribution");
      if (error) throw error;
      return (data as StageDistributionRow[]) ?? [];
    },
  });
}

export function usePipelineValueByStage() {
  return useQuery({
    queryKey: ["analytics-pipeline-value"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_pipeline_value_by_stage");
      if (error) throw error;
      return (data as PipelineValueRow[]) ?? [];
    },
  });
}

export function useCycleTimeByStage(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-cycle-time", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_cycle_time_by_stage", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as CycleTimeRow[]) ?? [];
    },
  });
}

export function useWonLostByMonth(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-won-lost", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_won_lost_by_month", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as WonLostRow[]) ?? [];
    },
  });
}

export function useMonthlyIntake(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-intake", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_monthly_intake", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as MonthlyIntakeRow[]) ?? [];
    },
  });
}

export function useTeamPerformance(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-team", ...rangeKey(range)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("analytics_team_performance", {
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
      });
      if (error) throw error;
      return (data as TeamPerformanceRow[]) ?? [];
    },
  });
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```

Expected: Build passes. No TypeScript errors in `analytics-queries.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics-queries.ts
git commit -m "feat: add analytics query layer with 8 RPC hooks"
```

---

## Task 3: Update `useUpdateBid` for Stage Transition Belt-and-Suspenders

**Files:**
- Modify: `src/lib/bid-queries.ts`

The existing `useUpdateBid` mutates bids but doesn't write stage transitions. We add a client-side write whenever `stage` changes. The Postgres trigger is authoritative; this is a failsafe.

- [ ] **Step 1: Read the current `useUpdateBid` in `src/lib/bid-queries.ts`**

Current `useUpdateBid` (lines ~65-79):
```typescript
export function useUpdateBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Bid> }) => {
      const { error } = await supabase.from("bids").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["bids"] });
      qc.invalidateQueries({ queryKey: ["bid", v.id] });
    },
  });
}
```

- [ ] **Step 2: Replace `useUpdateBid` with the transition-aware version**

Find the exact block above in `src/lib/bid-queries.ts` and replace it:

```typescript
export function useUpdateBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch, currentStage }: { id: string; patch: Partial<Bid>; currentStage?: string }) => {
      const { error } = await supabase.from("bids").update(patch).eq("id", id);
      if (error) throw error;

      if (patch.stage && currentStage && patch.stage !== currentStage) {
        // Belt-and-suspenders: trigger handles this too, but write client-side for resilience
        await supabase.from("bid_stage_transitions").insert({
          bid_id: id,
          from_stage: currentStage,
          to_stage: patch.stage,
        });
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["bids"] });
      qc.invalidateQueries({ queryKey: ["bid", v.id] });
    },
  });
}
```

- [ ] **Step 3: Find all callers of `useUpdateBid` to check if any need `currentStage` added**

```bash
grep -rn "useUpdateBid\|mutate({" src/ --include="*.tsx" --include="*.ts"
```

The `currentStage` param is optional — existing callers that don't pass it will skip the client-side transition write (the trigger handles it). No callers need to change unless they want the belt-and-suspenders behavior.

- [ ] **Step 4: Build check**

```bash
bun run build:dev
```

Expected: Build passes. No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bid-queries.ts
git commit -m "feat: useUpdateBid writes bid_stage_transitions on stage change"
```

---

## Task 4: DateRangePicker Component

**Files:**
- Create: `src/components/analytics/DateRangePicker.tsx`

This is the date filter bar: three preset chips (30d / 90d / 12m) + a custom date range display button. It renders inside the analytics topbar and calls back with a `DateRange`.

- [ ] **Step 1: Create `src/components/analytics/DateRangePicker.tsx`**

```tsx
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { type DateRange, presetToRange } from "@/lib/analytics-queries";

type Preset = "30d" | "90d" | "12m";

interface Props {
  preset: Preset;
  range: DateRange;
  onPresetChange: (p: Preset) => void;
  onRangeChange: (r: DateRange) => void;
}

export function DateRangePicker({ preset, range, onPresetChange }: Props) {
  const PRESETS: { label: string; value: Preset }[] = [
    { label: "30d", value: "30d" },
    { label: "90d", value: "90d" },
    { label: "12m", value: "12m" },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPresetChange(p.value)}
            className={[
              "h-[26px] px-2.5 rounded-full text-[10px] font-medium border transition-colors",
              preset === p.value
                ? "bg-[#491AEB] text-white border-[#491AEB]"
                : "bg-white text-[#6b6785] border-[#ddd] hover:border-[#491AEB] hover:text-[#491AEB]",
            ].join(" ")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button className="h-[26px] px-2.5 rounded-md border border-[#ddd] bg-white text-[10px] font-medium text-[#6b6785] flex items-center gap-1.5 cursor-default select-none">
        <Calendar size={10} className="opacity-50" />
        {format(range.from, "MMM d")} – {format(range.to, "MMM d")}
      </button>
    </div>
  );
}
```

> **Note:** Custom date picking (calendar popover) is Out of Scope for v1 per the spec. The date-range button is display-only — it shows the current range. Only the preset chips are interactive.

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/DateRangePicker.tsx
git commit -m "feat: DateRangePicker component with preset chips"
```

---

## Task 5: KPI Strip

**Files:**
- Create: `src/components/analytics/KpiStrip.tsx`

- [ ] **Step 1: Create `src/components/analytics/KpiStrip.tsx`**

```tsx
import { BarChart2, DollarSign, Trophy, Clock, FileCheck } from "lucide-react";
import type { KpiSummary } from "@/lib/analytics-queries";
import { fmtMoney } from "@/lib/bid-constants";

interface Props {
  data: KpiSummary | null | undefined;
  loading?: boolean;
}

type KpiDef = {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  delta: string;
  deltaUp?: boolean;
  deltaDown?: boolean;
};

function KpiCard({ icon, iconBg, label, value, delta, deltaUp, deltaDown }: KpiDef) {
  return (
    <div className="bg-white hairline border rounded-lg px-3 py-2.5 flex items-center gap-2.5">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
        <div className="text-[22px] font-bold leading-tight">{value}</div>
        <div
          className={[
            "text-[10px] mt-0.5",
            deltaUp ? "text-[#27C084]" : deltaDown ? "text-[#EF4444]" : "text-muted-foreground",
          ].join(" ")}
        >
          {delta}
        </div>
      </div>
    </div>
  );
}

export function KpiStrip({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-5 gap-2.5 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white hairline border rounded-lg h-[72px] animate-pulse" />
        ))}
      </div>
    );
  }

  const cards: KpiDef[] = [
    {
      icon: <BarChart2 size={16} className="text-[#491AEB]" />,
      iconBg: "#ede9fd",
      label: "Active Bids",
      value: String(data.active_bids),
      delta: "current open pipeline",
    },
    {
      icon: <DollarSign size={16} className="text-[#FD5B0E]" />,
      iconBg: "#fff0e8",
      label: "Pipeline Value",
      value: fmtMoney(data.pipeline_value),
      delta: "active bids total",
    },
    {
      icon: <Trophy size={16} className="text-[#27C084]" />,
      iconBg: "#edfaf4",
      label: "Win Rate",
      value: `${data.win_rate}%`,
      delta: "of closed in period",
      deltaUp: data.win_rate >= 40,
      deltaDown: data.win_rate < 25,
    },
    {
      icon: <Clock size={16} className="text-[#EF4444]" />,
      iconBg: "#fff1f1",
      label: "Avg Cycle Time",
      value: data.avg_cycle_days != null ? `${data.avg_cycle_days}d` : "—",
      delta: "avg days to close",
    },
    {
      icon: <FileCheck size={16} className="text-[#F59E0B]" />,
      iconBg: "#fffbeb",
      label: "Closed (Period)",
      value: String(data.closed_count),
      delta: `${data.won_count} won · ${data.lost_count} lost`,
      deltaUp: data.won_count > data.lost_count,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-2.5 p-3">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/KpiStrip.tsx
git commit -m "feat: KpiStrip with 5 metric cards"
```

---

## Task 6: Win Rate Trend + Stage Distribution Charts

**Files:**
- Create: `src/components/analytics/WinRateTrendChart.tsx`
- Create: `src/components/analytics/StageDistributionChart.tsx`

These two charts appear side-by-side in Row 1 of the grid.

- [ ] **Step 1: Create `src/components/analytics/WinRateTrendChart.tsx`**

```tsx
import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";
import type { WinRateTrendRow } from "@/lib/analytics-queries";

interface Props {
  data: WinRateTrendRow[];
}

export function WinRateTrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    month: format(new Date(d.month), "MMM"),
    win_rate: Number(d.win_rate),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No closed bids in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="winGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#491AEB" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#491AEB" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
          domain={[0, 100]}
          width={32}
        />
        <Tooltip
          formatter={(v: number) => [`${v}%`, "Win Rate"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Area
          type="monotone"
          dataKey="win_rate"
          stroke="#491AEB"
          strokeWidth={2}
          fill="url(#winGradient)"
          dot={{ r: 3, fill: "#491AEB", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#491AEB" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Create `src/components/analytics/StageDistributionChart.tsx`**

```tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { StageDistributionRow } from "@/lib/analytics-queries";
import { stageLabel } from "@/lib/bid-constants";

const STAGE_COLORS: Record<string, string> = {
  deal_qualification: "#491AEB",
  rfi:               "#7c5af0",
  rfp:               "#FD5B0E",
  orals:             "#F59E0B",
  due_diligence:     "#27C084",
  bafo:              "#0891b2",
  contract_closure:  "#A09DB8",
  post_closure:      "#6b6785",
};

interface Props {
  data: StageDistributionRow[];
}

export function StageDistributionChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[140px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie
            data={data}
            dataKey="bid_count"
            cx="50%"
            cy="50%"
            innerRadius={38}
            outerRadius={58}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell
                key={entry.stage}
                fill={STAGE_COLORS[entry.stage] ?? "#a09db8"}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, _n, props) => [v, stageLabel(props.payload.stage)]}
            contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 flex flex-col gap-1.5 text-[10px]">
        {data.map((d) => (
          <div key={d.stage} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-[2px] flex-shrink-0"
              style={{ background: STAGE_COLORS[d.stage] ?? "#a09db8" }}
            />
            <span className="flex-1 text-[#6b6785]">{stageLabel(d.stage)}</span>
            <span className="font-semibold">{d.bid_count}</span>
            <span className="text-muted-foreground ml-0.5">{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/WinRateTrendChart.tsx src/components/analytics/StageDistributionChart.tsx
git commit -m "feat: WinRateTrendChart and StageDistributionChart"
```

---

## Task 7: Pipeline Value + Cycle Time Charts

**Files:**
- Create: `src/components/analytics/PipelineValueChart.tsx`
- Create: `src/components/analytics/CycleTimeChart.tsx`

These appear side-by-side in Row 2.

- [ ] **Step 1: Create `src/components/analytics/PipelineValueChart.tsx`**

```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ResponsiveContainer, LabelList
} from "recharts";
import type { PipelineValueRow } from "@/lib/analytics-queries";
import { stageLabel, fmtMoney } from "@/lib/bid-constants";

const STAGE_COLORS: Record<string, string> = {
  deal_qualification: "#491AEB",
  rfi:               "#7c5af0",
  rfp:               "#FD5B0E",
  orals:             "#F59E0B",
  due_diligence:     "#27C084",
  bafo:              "#0891b2",
  contract_closure:  "#A09DB8",
  post_closure:      "#6b6785",
};

interface Props {
  data: PipelineValueRow[];
}

export function PipelineValueChart({ data }: Props) {
  const formatted = data.map((d) => ({
    stage: d.stage,
    label: stageLabel(d.stage).replace(" & ", " & ").split(" ")[0], // short label
    total_value: Number(d.total_value),
    displayValue: fmtMoney(Number(d.total_value)),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => fmtMoney(v)}
          width={38}
        />
        <Tooltip
          formatter={(v: number, _n, props) => [fmtMoney(v), stageLabel(props.payload.stage)]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="total_value" radius={[3, 3, 0, 0]}>
          {formatted.map((entry) => (
            <Cell
              key={entry.stage}
              fill={STAGE_COLORS[entry.stage] ?? "#a09db8"}
            />
          ))}
          <LabelList
            dataKey="displayValue"
            position="top"
            style={{ fontSize: 8, fontWeight: 700 }}
            formatter={(v: string) => v}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Create `src/components/analytics/CycleTimeChart.tsx`**

```tsx
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, LabelList
} from "recharts";
import type { CycleTimeRow } from "@/lib/analytics-queries";
import { stageLabel } from "@/lib/bid-constants";

const STAGE_COLORS: Record<string, string> = {
  deal_qualification: "#491AEB",
  rfi:               "#7c5af0",
  rfp:               "#FD5B0E",
  orals:             "#F59E0B",
  due_diligence:     "#27C084",
  bafo:              "#0891b2",
  contract_closure:  "#A09DB8",
  post_closure:      "#6b6785",
};

interface Props {
  data: CycleTimeRow[];
}

export function CycleTimeChart({ data }: Props) {
  const formatted = data.map((d) => ({
    stage: d.stage,
    label: stageLabel(d.stage),
    avg_days: Number(d.avg_days),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No stage transitions in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        layout="vertical"
        data={formatted}
        margin={{ top: 0, right: 50, left: 0, bottom: 0 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}d`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 9, fill: "#6b6785" }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          formatter={(v: number) => [`${v} days`, "Avg time in stage"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="avg_days" radius={[0, 3, 3, 0]} maxBarSize={12}>
          {formatted.map((entry) => (
            <Cell
              key={entry.stage}
              fill={STAGE_COLORS[entry.stage] ?? "#a09db8"}
            />
          ))}
          <LabelList
            dataKey="avg_days"
            position="right"
            style={{ fontSize: 9, fontWeight: 700 }}
            formatter={(v: number) => `${v}d`}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/PipelineValueChart.tsx src/components/analytics/CycleTimeChart.tsx
git commit -m "feat: PipelineValueChart and CycleTimeChart"
```

---

## Task 8: Won vs Lost + Monthly Intake Charts

**Files:**
- Create: `src/components/analytics/WonLostChart.tsx`
- Create: `src/components/analytics/MonthlyIntakeChart.tsx`

These appear side-by-side in Row 3.

- [ ] **Step 1: Create `src/components/analytics/WonLostChart.tsx`**

```tsx
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from "recharts";
import type { WonLostRow } from "@/lib/analytics-queries";
import { fmtMoney } from "@/lib/bid-constants";

interface Props {
  data: WonLostRow[];
}

export function WonLostChart({ data }: Props) {
  const formatted = data.map((d) => ({
    month: format(new Date(d.month), "MMM"),
    Won: Number(d.won_value),
    Lost: Number(d.lost_value),
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No closed bids in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => fmtMoney(v)}
          width={38}
        />
        <Tooltip
          formatter={(v: number, name) => [fmtMoney(v), name]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
          iconSize={8}
          iconType="rect"
        />
        <Bar dataKey="Won" fill="#491AEB" radius={[2, 2, 0, 0]} maxBarSize={20} />
        <Bar dataKey="Lost" fill="#EF4444" fillOpacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Create `src/components/analytics/MonthlyIntakeChart.tsx`**

```tsx
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, LabelList, ResponsiveContainer
} from "recharts";
import type { MonthlyIntakeRow } from "@/lib/analytics-queries";

interface Props {
  data: MonthlyIntakeRow[];
}

export function MonthlyIntakeChart({ data }: Props) {
  // Most recent 3 months get primary colour; older months get light purple
  const total = data.length;
  const formatted = data.map((d, i) => ({
    month: format(new Date(d.month), "MMM"),
    new_bids: Number(d.new_bids),
    recent: i >= total - 3,
  }));

  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No bids created in this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e6f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 10, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a09db8" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={24}
        />
        <Tooltip
          formatter={(v: number) => [v, "New Bids"]}
          contentStyle={{ fontSize: 11, borderRadius: 6, border: "0.5px solid #e2dff0" }}
        />
        <Bar dataKey="new_bids" radius={[3, 3, 0, 0]} maxBarSize={40}>
          {formatted.map((entry, i) => (
            <Cell key={i} fill={entry.recent ? "#491AEB" : "#ede9fd"} />
          ))}
          <LabelList
            dataKey="new_bids"
            position="top"
            style={{ fontSize: 9, fontWeight: 600 }}
            formatter={(v: number) => v}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/WonLostChart.tsx src/components/analytics/MonthlyIntakeChart.tsx
git commit -m "feat: WonLostChart and MonthlyIntakeChart"
```

---

## Task 9: Team Performance Table

**Files:**
- Create: `src/components/analytics/TeamPerformanceTable.tsx`

Admin-gated. Only rendered when `isAdmin` is true. Non-admins see nothing.

- [ ] **Step 1: Create `src/components/analytics/TeamPerformanceTable.tsx`**

```tsx
import type { TeamPerformanceRow } from "@/lib/analytics-queries";
import { fmtMoney, initials } from "@/lib/bid-constants";

interface Props {
  data: TeamPerformanceRow[];
  loading?: boolean;
}

function WinRateBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[80px] h-[5px] rounded-full bg-[#f0eef8]">
        <div
          className="h-[5px] rounded-full bg-[#491AEB]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] font-semibold text-[#491AEB]">{pct}%</span>
    </div>
  );
}

export function TeamPerformanceTable({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 border-b border-[#f0eef8] bg-white" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="py-6 text-center text-[11px] text-muted-foreground">
        No team data for this period
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {["Member", "Active Bids", "Closed", "Won", "Win Rate", "Pipeline Value", "Avg Cycle"].map((h) => (
              <th
                key={h}
                className="px-2.5 py-1.5 text-left text-[9px] uppercase tracking-[0.06em] text-muted-foreground border-b border-[#f0eef8] font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.user_id} className="border-b border-[#f0eef8] last:border-b-0 hover:bg-[#faf9fd]">
              <td className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-[22px] h-[22px] rounded-full bg-[#491AEB] text-white text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                    {initials(row.display_name ?? "")}
                  </div>
                  <span className="font-medium">{row.display_name}</span>
                </div>
              </td>
              <td className="px-2.5 py-2">{row.active_bids}</td>
              <td className="px-2.5 py-2">{row.closed_count}</td>
              <td className="px-2.5 py-2 font-semibold text-[#27C084]">{row.won_count}</td>
              <td className="px-2.5 py-2">
                <WinRateBar pct={Number(row.win_rate)} />
              </td>
              <td className="px-2.5 py-2 font-semibold">{fmtMoney(Number(row.pipeline_value))}</td>
              <td className="px-2.5 py-2 text-muted-foreground">
                {row.avg_cycle_days != null ? `${row.avg_cycle_days}d` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```

Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/TeamPerformanceTable.tsx
git commit -m "feat: TeamPerformanceTable with win rate bars"
```

---

## Task 10: Analytics Route — Page Assembly

**Files:**
- Rewrite: `src/routes/_app/analytics.tsx`

This wires everything together: URL search params for date range, all query hooks, all chart components, the KPI strip, and the admin-gated team table.

- [ ] **Step 1: Rewrite `src/routes/_app/analytics.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { parseISO } from "date-fns";
import { useCurrentUser } from "@/lib/auth";
import {
  presetToRange,
  useKpiSummary,
  useWinRateTrend,
  useStageDistribution,
  usePipelineValueByStage,
  useCycleTimeByStage,
  useWonLostByMonth,
  useMonthlyIntake,
  useTeamPerformance,
  type DateRange,
} from "@/lib/analytics-queries";
import { DateRangePicker } from "@/components/analytics/DateRangePicker";
import { KpiStrip } from "@/components/analytics/KpiStrip";
import { WinRateTrendChart } from "@/components/analytics/WinRateTrendChart";
import { StageDistributionChart } from "@/components/analytics/StageDistributionChart";
import { PipelineValueChart } from "@/components/analytics/PipelineValueChart";
import { CycleTimeChart } from "@/components/analytics/CycleTimeChart";
import { WonLostChart } from "@/components/analytics/WonLostChart";
import { MonthlyIntakeChart } from "@/components/analytics/MonthlyIntakeChart";
import { TeamPerformanceTable } from "@/components/analytics/TeamPerformanceTable";

// ── Route search params ───────────────────────────────────────────────────────

type AnalyticsSearch = {
  preset: "30d" | "90d" | "12m";
  from?: string;
  to?: string;
};

export const Route = createFileRoute("/_app/analytics")({
  validateSearch: (search: Record<string, unknown>): AnalyticsSearch => ({
    preset: (["30d", "90d", "12m"].includes(search.preset as string)
      ? (search.preset as "30d" | "90d" | "12m")
      : "90d"),
    from: typeof search.from === "string" ? search.from : undefined,
    to:   typeof search.to   === "string" ? search.to   : undefined,
  }),
  component: AnalyticsPage,
});

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="bg-white hairline border rounded-lg overflow-hidden">
      <div className="flex flex-col px-3 pt-2.5 pb-2 border-b border-[#f0eef8]">
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">{sub}</span>
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function AnalyticsPage() {
  const { preset, from, to } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { isAdmin } = useCurrentUser();

  const range: DateRange = useMemo(() => {
    if (from && to) return { from: parseISO(from), to: parseISO(to) };
    return presetToRange(preset);
  }, [preset, from, to]);

  function handlePresetChange(p: "30d" | "90d" | "12m") {
    navigate({ search: { preset: p } });
  }

  const kpi          = useKpiSummary(range);
  const winTrend     = useWinRateTrend(range);
  const stageDist    = useStageDistribution();
  const pipelineVal  = usePipelineValueByStage();
  const cycleTime    = useCycleTimeByStage(range);
  const wonLost      = useWonLostByMonth(range);
  const intake       = useMonthlyIntake(range);
  const teamPerf     = useTeamPerformance(range);

  return (
    <div className="flex flex-col h-full overflow-auto bg-[#f8f7fc]">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 h-11 bg-white hairline border-b flex-shrink-0">
        <span className="text-[13px] font-semibold flex-1">Reports & Analytics</span>
        <DateRangePicker
          preset={preset}
          range={range}
          onPresetChange={handlePresetChange}
          onRangeChange={() => {}} // custom picker is out of scope v1
        />
      </div>

      <div className="flex-1 p-3 space-y-2.5">
        {/* KPI Strip */}
        <KpiStrip data={kpi.data} loading={kpi.isLoading} />

        {/* Row 1: Win Rate + Stage Distribution */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Win Rate Trend" sub="Monthly win % over period">
            <WinRateTrendChart data={winTrend.data ?? []} />
          </ChartCard>
          <ChartCard title="Stage Distribution" sub="Active bids by pipeline stage">
            <StageDistributionChart data={stageDist.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 2: Pipeline Value + Cycle Time */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Pipeline Value by Stage" sub="Total value of active bids per stage">
            <PipelineValueChart data={pipelineVal.data ?? []} />
          </ChartCard>
          <ChartCard title="Cycle Time by Stage" sub="Avg. days a bid spends in each stage">
            <CycleTimeChart data={cycleTime.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 3: Won vs Lost + Monthly Intake */}
        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard title="Won vs Lost Value" sub="Monthly closed deal value">
            <WonLostChart data={wonLost.data ?? []} />
          </ChartCard>
          <ChartCard title="Monthly Intake" sub="New bids created per month">
            <MonthlyIntakeChart data={intake.data ?? []} />
          </ChartCard>
        </div>

        {/* Row 4: Team Performance (admin only) */}
        {isAdmin && (
          <div className="bg-white hairline border rounded-lg overflow-hidden">
            <div className="flex items-start justify-between px-3 pt-2.5 pb-2 border-b border-[#f0eef8]">
              <div>
                <span className="text-[12px] font-semibold">Team Performance</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Win rate and pipeline value by team member
                </p>
              </div>
              <span className="h-5 px-2 rounded bg-[#ede9fd] text-[#491AEB] text-[9px] font-bold flex items-center tracking-wider uppercase">
                Admin Only
              </span>
            </div>
            <TeamPerformanceTable
              data={teamPerf.data ?? []}
              loading={teamPerf.isLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```

Expected: Build passes. No TypeScript errors. Route tree auto-generates.

- [ ] **Step 3: Start the dev server and verify in browser**

```bash
bun dev
```

Navigate to `http://localhost:3000/analytics` (or wherever your dev server runs — check the terminal output for the port).

Verify:
- Page loads without crashing
- Topbar shows "Reports & Analytics" with preset chips and date display
- KPI strip renders 5 cards (values may be 0/— if no data seeded)
- All 6 chart cards render (may show "No data" empty states — that's correct)
- Switching preset chips (30d → 12m → 90d) updates the URL `?preset=...` param
- Admin badge and Team Performance table are visible when logged in as admin; absent for non-admin

- [ ] **Step 4: Commit**

```bash
git add src/routes/_app/analytics.tsx
git commit -m "feat: Reports & Analytics page — KPI strip, 6 charts, team table, date filter"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Covered? |
|---|---|
| 5 KPI cards | ✓ Task 5 — KpiStrip |
| Win Rate Trend (line/area chart) | ✓ Task 6 |
| Stage Distribution (donut) | ✓ Task 6 |
| Pipeline Value by Stage (bar) | ✓ Task 7 |
| Cycle Time by Stage (horizontal bar) | ✓ Task 7 |
| Won vs Lost Value (grouped bar) | ✓ Task 8 |
| Monthly Intake (bar) | ✓ Task 8 |
| Team Performance table (admin-gated) | ✓ Task 9 |
| Date filter: 30d/90d/12m preset chips | ✓ Task 4, Task 10 |
| Date range in URL search params | ✓ Task 10 (`validateSearch`) |
| `bids.closed_at` column | ✓ Task 1 migration |
| `bid_stage_transitions` table + trigger | ✓ Task 1 migration |
| RPC functions for all charts (no N+1) | ✓ Task 1 migration (8 RPCs) |
| `useUpdateBid` belt-and-suspenders writes | ✓ Task 3 |
| Non-admins: Team table completely hidden | ✓ Task 10 — `{isAdmin && ...}` |
| No export in v1 | ✓ Not implemented |
| `recharts` — already installed | ✓ No install step needed |

### Placeholder Scan

No TBD, TODO, or "similar to Task N" references found. All code blocks are complete.

### Type Consistency

- `DateRange` defined in `analytics-queries.ts` (Task 2), imported by `DateRangePicker` (Task 4) and `analytics.tsx` (Task 10) ✓
- `KpiSummary`, `WinRateTrendRow`, `StageDistributionRow`, `PipelineValueRow`, `CycleTimeRow`, `WonLostRow`, `MonthlyIntakeRow`, `TeamPerformanceRow` — all defined in Task 2, imported by corresponding chart components in Tasks 5–9 and route in Task 10 ✓
- `presetToRange` defined in Task 2, used in Task 10 ✓
- `STAGE_COLORS` defined independently in each chart component (Tasks 6, 7) — intentionally not shared to keep components self-contained ✓
