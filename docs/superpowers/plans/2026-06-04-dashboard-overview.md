# Dashboard Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/dashboard` with a KPI + needs-attention overview page for Pre-Sales/Bid Managers; move the pipeline split-pane to `/pipeline`.

**Architecture:** Four file changes total — create `pipeline.tsx` (content moved from dashboard), rewrite `dashboard.tsx` (new overview), update `Sidebar.tsx` (add Overview nav entry), update `TopBar.tsx` (add pipeline breadcrumb). All data comes from the existing `useBids()` query; no new Supabase calls.

**Tech Stack:** TanStack Router (file-based routes), React 19, TailwindCSS v4, `@radix-ui/react-collapsible`, existing `bid-queries.ts` / `bid-constants.ts` helpers.

> **Note on testing:** This project has no test runner configured. Each task ends with a manual smoke-check step using `bun dev` instead of automated tests.

---

### Task 1: Create `/pipeline` route

Move the current pipeline split-pane from `dashboard.tsx` to a new `pipeline.tsx` file with the updated route key.

**Files:**
- Create: `src/routes/_app/pipeline.tsx`

- [ ] **Step 1: Create `src/routes/_app/pipeline.tsx`** with the pipeline content, changing only the route key from `/_app/dashboard` to `/_app/pipeline`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BidCard } from "@/components/bids/BidCard";
import { StageNav } from "@/components/bids/StageNav";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { useBids } from "@/lib/bid-queries";
import { Search } from "lucide-react";
import type { StageKey } from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

type Filter = "all" | "mine" | "legal" | "urgent";

function PipelinePage() {
  const { data: bids = [], isLoading } = useBids();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageKey | null>(null);

  const filtered = useMemo(() => {
    return bids.filter((b) => {
      if (q && !`${b.client_name} ${b.title}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "urgent") {
        const days = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
        if (days > 5) return false;
      }
      return true;
    });
  }, [bids, q, filter]);

  const selected = filtered.find((b) => b.id === selectedId) ?? filtered[0];

  useEffect(() => {
    if (selected && selectedId !== selected.id) setSelectedId(selected.id);
    if (selected && !selectedStage) setSelectedStage(selected.stage);
  }, [selected, selectedId, selectedStage]);

  return (
    <div className="h-full flex">
      <aside className="w-[260px] shrink-0 bg-surface hairline border-r flex flex-col">
        <div className="p-3 hairline border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium">Bids</h2>
            <span className="text-[10px] text-muted-foreground">{filtered.length}</span>
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bids…"
              className="w-full h-7 pl-7 pr-2 rounded-md hairline border bg-card text-[12px]"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "mine", "legal", "urgent"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-wider px-2 h-6 rounded-sm capitalize ${
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted-foreground">
              No bids yet. Click <strong>New bid</strong> to start.
            </div>
          ) : (
            filtered.map((b) => (
              <BidCard
                key={b.id}
                bid={b}
                active={selected?.id === b.id}
                onClick={() => {
                  setSelectedId(b.id);
                  setSelectedStage(b.stage);
                  navigate({ to: "/bids/$id", params: { id: b.id } });
                }}
              />
            ))
          )}
        </div>
      </aside>

      {selected && selectedStage ? (
        <>
          <StageNav
            current={selected.stage}
            selected={selectedStage}
            onSelect={(s) => setSelectedStage(s)}
          />
          <StageWorkspace bid={selected} stage={selectedStage} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          Select a bid to begin.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/_app/pipeline.tsx
git commit -m "feat: add /pipeline route (split-pane moved from /dashboard)"
```

---

### Task 2: Rewrite `/dashboard` as overview page

Replace the entire content of `dashboard.tsx` with the new KPI + needs-attention overview.

**Files:**
- Modify: `src/routes/_app/dashboard.tsx`

- [ ] **Step 1: Read `src/routes/_app/dashboard.tsx`** to confirm current content before overwriting.

- [ ] **Step 2: Replace the entire file** with:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBids, type Bid } from "@/lib/bid-queries";
import { fmtMoney, stageLabel, urgencyClass } from "@/lib/bid-constants";
import { ArrowRight, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

type Stats = {
  activeCount: number;
  pipelineValue: number;
  overdue: number;
  expiring: number;
  avgScore: number | null;
};

function computeStats(bids: Bid[]): Stats {
  const now = Date.now();
  const active = bids.filter((b) => b.status === "active");
  const overdue = active.filter((b) => new Date(b.deadline).getTime() < now).length;
  const expiring = active.filter((b) => {
    const days = Math.ceil((new Date(b.deadline).getTime() - now) / 86400000);
    return days >= 0 && days <= 5;
  }).length;
  const pipelineValue = active.reduce((sum, b) => sum + (b.value ?? 0), 0);
  const scored = active.filter((b) => b.gonogo_score !== null);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, b) => s + (b.gonogo_score ?? 0), 0) / scored.length)
      : null;
  return { activeCount: active.length, pipelineValue, overdue, expiring, avgScore };
}

function computeAttention(bids: Bid[]): Bid[] {
  const now = Date.now();
  return bids
    .filter((b) => {
      if (b.status !== "active") return false;
      const days = Math.ceil((new Date(b.deadline).getTime() - now) / 86400000);
      if (days <= 5) return true;
      if (b.priority === "high") return true;
      if (b.gonogo_decision === null && b.stage === "deal_qualification") return true;
      return false;
    })
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
}

function DashboardPage() {
  const { data: bids = [], isLoading } = useBids();
  const [allOpen, setAllOpen] = useState(false);

  const stats = useMemo(() => computeStats(bids), [bids]);
  const attention = useMemo(() => computeAttention(bids), [bids]);
  const allActive = useMemo(
    () => bids.filter((b) => b.status === "active").sort(
      (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
    ),
    [bids],
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Active bids" value={stats.activeCount} />
          <StatCard label="Pipeline value" value={fmtMoney(stats.pipelineValue)} />
          <StatCard label="Expiring soon" value={stats.expiring} />
          <StatCard
            label="Overdue"
            value={stats.overdue}
            accent={stats.overdue > 0}
          />
          <StatCard
            label="Avg Go/No-Go"
            value={stats.avgScore !== null ? `${stats.avgScore}/100` : "—"}
          />
        </div>

        {/* Needs attention */}
        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Needs attention
          </h2>
          {attention.length === 0 ? (
            <div className="bg-success-soft hairline border border-[#97C459] rounded-xl px-5 py-4 text-[13px] text-success-foreground">
              All clear — no urgent bids. Pipeline looks healthy.
            </div>
          ) : (
            <div className="bg-card hairline border rounded-xl overflow-hidden divide-y hairline divide-border">
              {attention.map((b) => (
                <BidRow key={b.id} bid={b} />
              ))}
            </div>
          )}
        </section>

        {/* All active bids */}
        <Collapsible open={allOpen} onOpenChange={setAllOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground w-full text-left">
            <ChevronDown
              className={`size-3.5 transition-transform ${allOpen ? "rotate-0" : "-rotate-90"}`}
            />
            All active bids · {allActive.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 bg-card hairline border rounded-xl overflow-hidden divide-y hairline divide-border">
              {allActive.length === 0 ? (
                <div className="px-4 py-3 text-[12px] text-muted-foreground">
                  No active bids yet.
                </div>
              ) : (
                allActive.map((b) => <BidRow key={b.id} bid={b} />)
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="bg-card hairline border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-[20px] font-medium leading-none mt-1 ${accent ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-accent",
  medium: "bg-warning",
  low: "bg-muted-foreground/30",
};

const GONOGO_STYLE: Record<string, string> = {
  go: "bg-success-soft text-success-foreground",
  no_go: "bg-danger-soft text-danger-foreground",
  conditional_go: "bg-warning-soft text-warning-foreground",
};

const GONOGO_LABEL: Record<string, string> = {
  go: "Go",
  no_go: "No-go",
  conditional_go: "Conditional",
};

function BidRow({ bid: b }: { bid: Bid }) {
  const u = urgencyClass(b.deadline);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight truncate">{b.client_name}</div>
        <div className="text-[11px] text-muted-foreground truncate">{b.title}</div>
      </div>
      <span className="text-[10px] px-2 py-0.5 rounded-sm bg-primary-soft text-primary font-medium shrink-0">
        {stageLabel(b.stage)}
      </span>
      <span
        title={b.priority}
        className={`size-2 rounded-full shrink-0 ${PRIORITY_DOT[b.priority] ?? "bg-muted-foreground/30"}`}
      />
      <span className={`text-[11px] shrink-0 ${u.className}`}>{u.label}</span>
      {b.gonogo_decision && (
        <span
          className={`text-[10px] px-2 py-0.5 rounded-sm font-medium shrink-0 ${GONOGO_STYLE[b.gonogo_decision] ?? ""}`}
        >
          {GONOGO_LABEL[b.gonogo_decision] ?? b.gonogo_decision}
        </span>
      )}
      <Link
        to="/bids/$id"
        params={{ id: b.id }}
        className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline shrink-0"
      >
        Open <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/_app/dashboard.tsx
git commit -m "feat: replace /dashboard with KPI + needs-attention overview"
```

---

### Task 3: Update Sidebar navigation

Add the Overview entry and point Pipeline to `/pipeline`.

**Files:**
- Modify: `src/components/app/Sidebar.tsx`

- [ ] **Step 1: Read `src/components/app/Sidebar.tsx`** to confirm current content.

- [ ] **Step 2: Replace the imports and NAV array** — change the `Trophy` import to also bring in `LayoutDashboard`, and update the NAV entries:

Replace this block:
```tsx
import {
  LayoutDashboard,
  CheckSquare,
  BarChart3,
  FileText,
  RefreshCcw,
  Settings,
  Trophy,
  LogOut,
} from "lucide-react";
```

With (no change needed — `LayoutDashboard` is already imported):
```tsx
import {
  LayoutDashboard,
  CheckSquare,
  BarChart3,
  FileText,
  RefreshCcw,
  Settings,
  Trophy,
  LogOut,
} from "lucide-react";
```

- [ ] **Step 3: Replace the NAV array** (the logo button at the top already links to `/dashboard` — leave it):

Replace:
```tsx
const NAV: { to: string; icon: typeof Trophy; label: string; roles: AppRole[] }[] = [
  { to: "/dashboard", icon: Trophy, label: "Pipeline", roles: ALL },
  { to: "/queue", icon: CheckSquare, label: "My queue", roles: ALL },
  { to: "/analytics", icon: BarChart3, label: "Analytics", roles: ["pre_sales", "admin"] },
  { to: "/docs", icon: FileText, label: "Documents", roles: ALL },
  { to: "/hubspot", icon: RefreshCcw, label: "HubSpot", roles: ["pre_sales", "admin"] },
  { to: "/settings", icon: Settings, label: "Settings", roles: ["admin"] },
];
```

With:
```tsx
const NAV: { to: string; icon: typeof Trophy; label: string; roles: AppRole[] }[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Overview", roles: ALL },
  { to: "/pipeline", icon: Trophy, label: "Pipeline", roles: ["pre_sales", "admin"] },
  { to: "/queue", icon: CheckSquare, label: "My queue", roles: ALL },
  { to: "/analytics", icon: BarChart3, label: "Analytics", roles: ["pre_sales", "admin"] },
  { to: "/docs", icon: FileText, label: "Documents", roles: ALL },
  { to: "/hubspot", icon: RefreshCcw, label: "HubSpot", roles: ["pre_sales", "admin"] },
  { to: "/settings", icon: Settings, label: "Settings", roles: ["admin"] },
];
```

- [ ] **Step 4: Commit**

```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat: add Overview nav entry, point Pipeline to /pipeline"
```

---

### Task 4: Update TopBar breadcrumbs

Add `pipeline` and `overview`/`dashboard` entries to the breadcrumb map so the header label is correct on both routes.

**Files:**
- Modify: `src/components/app/TopBar.tsx`

- [ ] **Step 1: Read `src/components/app/TopBar.tsx`** to confirm current content.

- [ ] **Step 2: Update the `map` object** inside `useCrumbs`:

Replace:
```tsx
const map: Record<string, string> = {
  dashboard: "Pipeline",
  queue: "My queue",
  analytics: "Analytics",
  docs: "Documents",
  hubspot: "HubSpot sync",
  settings: "Settings",
  bids: "Pipeline",
  gonogo: "Go / No-Go",
};
```

With:
```tsx
const map: Record<string, string> = {
  dashboard: "Overview",
  pipeline: "Pipeline",
  queue: "My queue",
  analytics: "Analytics",
  docs: "Documents",
  hubspot: "HubSpot sync",
  settings: "Settings",
  bids: "Pipeline",
  gonogo: "Go / No-Go",
};
```

- [ ] **Step 3: Commit**

```bash
git add src/components/app/TopBar.tsx
git commit -m "feat: update TopBar breadcrumbs for /dashboard and /pipeline"
```

---

### Task 5: Smoke-check in browser

- [ ] **Step 1: Start dev server**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun dev
```

- [ ] **Step 2: Verify `/dashboard`**
  - KPI strip shows 5 cards (Active bids, Pipeline value, Expiring soon, Overdue, Avg Go/No-Go)
  - "Needs attention" section appears — either bid rows or the "All clear" green card
  - "All active bids" collapsible is present and collapsed by default; clicking it expands the list
  - Clicking "Open →" on any bid row navigates to `/bids/:id`

- [ ] **Step 3: Verify `/pipeline`**
  - Split-pane layout (bid list left, workspace right) works as before
  - Sidebar "Pipeline" icon navigates here

- [ ] **Step 4: Verify Sidebar**
  - Two icons visible: Overview (`LayoutDashboard`) and Pipeline (`Trophy`)
  - Both highlight correctly when on their respective routes
  - Legal/finance roles see Overview + Queue but NOT Pipeline (role-gated)

- [ ] **Step 5: Verify TopBar**
  - Header reads "Overview" on `/dashboard`
  - Header reads "Pipeline" on `/pipeline`

- [ ] **Step 6: Commit if any fixes were needed during smoke-check**

```bash
git add -p
git commit -m "fix: smoke-check corrections"
```
