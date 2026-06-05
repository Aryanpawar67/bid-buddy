# V1 Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v1 full-redesign mockup — expand sidebar to 220px with labels and stage sub-nav, redesign TopBar with search + action icons, fully rewrite the Dashboard with KPI strip / pipeline funnel / pursuits table / right rail / charts, and wire three new placeholder routes (AI, Calendar, Notifications).

**Architecture:** Eight files change. Four are rewrites (Sidebar, TopBar, Dashboard, bid-queries); three are new placeholder routes (ai, calendar, notifications). All dashboard data derives from the already-cached `useBids()` query plus a new lightweight `useRecentActivity()` hook against the existing `bid_activity_log` table. No schema changes.

**Tech Stack:** TanStack Router file-based routing, React 19, TailwindCSS v4, Radix/shadcn primitives, Recharts (already installed), Lucide React, Supabase JS client, TanStack Query.

> **Note on testing:** No test runner configured. Each task ends with `bun run build:dev` to verify TypeScript + route correctness, then manual smoke-check in browser.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/bid-queries.ts` | Add hook | `useRecentActivity(limit)` — recent bid_activity_log entries |
| `src/routes/_app/ai.tsx` | Create | Placeholder for AI Command Center |
| `src/routes/_app/calendar.tsx` | Create | Placeholder for Calendar |
| `src/routes/_app/notifications.tsx` | Create | Placeholder for Notifications |
| `src/components/app/Sidebar.tsx` | Rewrite | 220px labeled sidebar with sub-nav + user footer |
| `src/components/app/TopBar.tsx` | Rewrite | Title/subtitle + search bar + icon action buttons |
| `src/routes/_app/dashboard.tsx` | Rewrite | KPI strip, pipeline funnel, pursuits table, right rail, charts |

---

### Task 1: Add `useRecentActivity` query + three placeholder routes

**Files:**
- Modify: `src/lib/bid-queries.ts`
- Create: `src/routes/_app/ai.tsx`
- Create: `src/routes/_app/calendar.tsx`
- Create: `src/routes/_app/notifications.tsx`

- [ ] **Step 1: Add `useRecentActivity` to `src/lib/bid-queries.ts`**

Open the file and append after the last export:

```ts
export type ActivityEntry = {
  id: string;
  bid_id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  bids: { client_name: string; title: string } | null;
};

export function useRecentActivity(limit = 4) {
  return useQuery({
    queryKey: ["recent-activity", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bid_activity_log")
        .select("*, bids(client_name, title)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ActivityEntry[];
    },
  });
}
```

- [ ] **Step 2: Create `src/routes/_app/ai.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/ai")({
  component: AiPage,
});

function AiPage() {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">AI Command Center</h1>
        <p className="text-[12px] text-muted-foreground">
          Summarise RFPs, generate win themes, identify risks, and draft
          executive summaries — powered by Claude AI.
        </p>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4">
          Coming soon
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/routes/_app/calendar.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/calendar")({
  component: CalendarPage,
});

function CalendarPage() {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">Calendar</h1>
        <p className="text-[12px] text-muted-foreground">
          Bid deadlines, orals dates, and clarification windows in one view.
        </p>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4">
          Coming soon
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/routes/_app/notifications.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-medium mb-1">Notifications</h1>
        <p className="text-[12px] text-muted-foreground">
          Deadline alerts, approval requests, and bid activity in one place.
        </p>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4">
          Coming soon
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -20
```

Expected: exits 0 with no TypeScript errors. Three new routes will appear in `routeTree.gen.ts` automatically on next `bun dev` start.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bid-queries.ts src/routes/_app/ai.tsx src/routes/_app/calendar.tsx src/routes/_app/notifications.tsx
git commit -m "feat: add useRecentActivity hook + ai/calendar/notifications placeholder routes"
```

---

### Task 2: Rewrite Sidebar — 220px labeled navigation

**Files:**
- Rewrite: `src/components/app/Sidebar.tsx`

- [ ] **Step 1: Replace `src/components/app/Sidebar.tsx` entirely**

```tsx
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Target,
  CheckSquare,
  Sparkles,
  BookOpen,
  BarChart3,
  Calendar,
  Settings,
  Bell,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useCurrentUser, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { initials, STAGES } from "@/lib/bid-constants";
import { useBids, useMyQueue, useRecentActivity } from "@/lib/bid-queries";

const ALL: AppRole[] = ["pre_sales", "legal", "finance", "admin"];

export function Sidebar() {
  const { primaryRole, profile, user } = useCurrentUser();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [pursuitsOpen, setPursuitsOpen] = useState(true);

  const { data: bids = [] } = useBids();
  const { data: queueData } = useMyQueue(user?.id);
  const { data: activity = [] } = useRecentActivity(50);

  const activeBids = bids.filter((b) => b.status === "active");

  const queueCount = [
    ...(queueData?.questions ?? []),
    ...(queueData?.deliverables ?? []),
  ].filter((i) => i.status !== "done").length;

  const notifCount = activity.length;

  const isAdmin = primaryRole === "admin";
  const isPreSales = primaryRole === "pre_sales";
  const canSeePipeline = isAdmin || isPreSales;
  const canSeeAnalytics = isAdmin || isPreSales;

  return (
    <aside className="w-[220px] min-w-[220px] shrink-0 bg-sidebar flex flex-col overflow-y-auto overflow-x-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-white/[0.08]">
        <Link
          to="/dashboard"
          className="size-8 rounded-[8px] bg-primary flex items-center justify-center text-white text-[14px] font-bold shrink-0"
        >
          B
        </Link>
        <div>
          <div className="text-[13px] font-semibold text-white leading-tight">
            Bid Compass
          </div>
          <div className="text-[10px] text-white/40 mt-px">
            Pursuit Management
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <div className="py-2 flex-1">
        {/* Dashboard */}
        <NavLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" active={path === "/dashboard"} />

        {/* Pursuits + sub-items */}
        {canSeePipeline && (
          <>
            <button
              onClick={() => setPursuitsOpen((o) => !o)}
              className="w-[calc(100%-12px)] mx-1.5 flex items-center gap-[9px] px-[14px] py-[7px] rounded-[6px] text-[12px] text-white/50 hover:bg-white/10 hover:text-white/85 transition-colors"
            >
              <Target className="size-4 shrink-0 opacity-75" strokeWidth={1.5} />
              <span className="flex-1 truncate text-left">Pursuits</span>
              <span className="text-[10px] text-white/35 mr-1">
                {activeBids.length}
              </span>
              <ChevronDown
                className={`size-3.5 text-white/30 transition-transform ${pursuitsOpen ? "" : "-rotate-90"}`}
                strokeWidth={1.5}
              />
            </button>

            {pursuitsOpen && (
              <div className="mb-1">
                {STAGES.map((s, i) => {
                  const count = activeBids.filter(
                    (b) => b.stage === s.key,
                  ).length;
                  return (
                    <Link
                      key={s.key}
                      to="/pipeline"
                      className="flex items-center gap-2 py-[5px] pl-[38px] pr-[14px] mx-1.5 rounded-[4px] text-[11px] text-white/38 hover:bg-white/10 hover:text-white/70 transition-colors"
                    >
                      <span className="size-4 rounded-full bg-white/[0.08] flex items-center justify-center text-[9px] text-white/50 shrink-0 font-medium">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate">{s.label}</span>
                      <span className="text-[10px] text-white/28">{count}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Tools section */}
        <SectionLabel>Tools</SectionLabel>
        <NavLink
          to="/queue"
          icon={CheckSquare}
          label="My Queue"
          active={path.startsWith("/queue")}
          badge={queueCount > 0 ? queueCount : undefined}
          badgeVariant="accent"
        />
        <NavLink
          to="/ai"
          icon={Sparkles}
          label="AI Command Center"
          active={path.startsWith("/ai")}
          badge="New"
          badgeVariant="success"
        />
        <NavLink
          to="/docs"
          icon={BookOpen}
          label="Knowledge Hub"
          active={path.startsWith("/docs")}
        />
        {canSeeAnalytics && (
          <NavLink
            to="/analytics"
            icon={BarChart3}
            label="Reports & Analytics"
            active={path.startsWith("/analytics")}
          />
        )}
        <NavLink
          to="/calendar"
          icon={Calendar}
          label="Calendar"
          active={path.startsWith("/calendar")}
        />

        {/* System section */}
        <SectionLabel>System</SectionLabel>
        {isAdmin && (
          <NavLink
            to="/settings"
            icon={Settings}
            label="Settings"
            active={path.startsWith("/settings")}
          />
        )}
        <NavLink
          to="/notifications"
          icon={Bell}
          label="Notifications"
          active={path.startsWith("/notifications")}
          badge={notifCount > 0 ? notifCount : undefined}
          badgeVariant="accent"
        />
      </div>

      {/* ── Footer / User row ── */}
      <div className="border-t border-white/[0.08] p-2">
        <div className="flex items-center gap-2.5 p-2 rounded-[6px] hover:bg-white/10 cursor-pointer group">
          <div className="size-7 rounded-full bg-accent flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
            {initials(profile?.full_name ?? profile?.email ?? "?")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-white/80 font-medium truncate leading-tight">
              {profile?.full_name ?? profile?.email ?? "User"}
            </div>
            <div className="text-[10px] text-white/35 capitalize">
              {primaryRole?.replace(/_/g, " ") ?? ""}
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            title="Sign out"
            className="size-6 rounded flex items-center justify-center text-white/25 hover:text-white/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <LogOut className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function NavLink({
  to,
  icon: Icon,
  label,
  active,
  badge,
  badgeVariant = "accent",
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  badge?: string | number;
  badgeVariant?: "accent" | "success";
}) {
  return (
    <Link
      to={to}
      className={[
        "flex items-center gap-[9px] px-[14px] py-[7px] rounded-[6px] mx-1.5 text-[12px] transition-colors",
        active
          ? "bg-primary text-white"
          : "text-white/50 hover:bg-white/10 hover:text-white/85",
      ].join(" ")}
    >
      <Icon
        className={`size-4 shrink-0 ${active ? "opacity-100" : "opacity-75"}`}
        strokeWidth={1.5}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && (
        <span
          className={[
            "text-[9px] font-bold px-[5px] py-px rounded-full leading-[1.4] shrink-0",
            badgeVariant === "success"
              ? "bg-success text-white"
              : "bg-accent text-white",
          ].join(" ")}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 mb-1 px-3.5 text-[9px] uppercase tracking-[0.08em] text-white/30">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -20
```

Expected: exits 0, no TypeScript errors. The `useCurrentUser` hook's `user` field is used — confirm it exists in `src/lib/auth.ts` (it returns `{ user, profile, roles, primaryRole, isAdmin, isPreSales }`).

- [ ] **Step 3: Commit**

```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat: expand sidebar to 220px with labels, stage sub-nav, and user footer"
```

---

### Task 3: Rewrite TopBar — title/subtitle + search + icon buttons

**Files:**
- Rewrite: `src/components/app/TopBar.tsx`

- [ ] **Step 1: Replace `src/components/app/TopBar.tsx` entirely**

```tsx
import { useRouterState } from "@tanstack/react-router";
import { Bell, Search, Plus, Clock, User, Info, MessageSquare } from "lucide-react";
import { useState } from "react";
import { IntakeModal } from "@/components/bids/IntakeModal";
import { useCurrentUser } from "@/lib/auth";

type PageMeta = { title: string; subtitle: string };

const PAGE_META: Record<string, PageMeta> = {
  dashboard:     { title: "Dashboard",            subtitle: "Overview of all your pursuits and tasks" },
  pipeline:      { title: "Pursuits",             subtitle: "All active bids across pipeline stages" },
  queue:         { title: "My Queue",             subtitle: "Your assigned questions and deliverables" },
  analytics:     { title: "Reports & Analytics",  subtitle: "Pipeline metrics and win rate trends" },
  docs:          { title: "Knowledge Hub",         subtitle: "Bid documents and templates" },
  ai:            { title: "AI Command Center",     subtitle: "AI-powered pursuit assistance" },
  calendar:      { title: "Calendar",             subtitle: "Deadlines and key dates" },
  notifications: { title: "Notifications",        subtitle: "Activity and alerts" },
  settings:      { title: "Settings",             subtitle: "Workspace configuration" },
  bids:          { title: "Bid Detail",           subtitle: "Stage workspace and deliverables" },
};

function usePageMeta(): PageMeta {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const seg = path.split("/").filter(Boolean)[0] ?? "dashboard";
  return PAGE_META[seg] ?? { title: seg, subtitle: "" };
}

export function TopBar() {
  const { title, subtitle } = usePageMeta();
  const [open, setOpen] = useState(false);
  const { isPreSales } = useCurrentUser();

  return (
    <header className="h-[52px] min-h-[52px] shrink-0 bg-card border-b hairline border-border-strong flex items-center px-5 gap-3">
      {/* Page title */}
      <div className="shrink-0">
        <div className="text-[16px] font-semibold leading-tight">{title}</div>
        {subtitle && (
          <div className="text-[11px] text-muted-foreground leading-tight mt-px">
            {subtitle}
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="ml-5 flex-1 max-w-[360px] h-[34px] bg-background border hairline border-border-strong rounded-[8px] flex items-center px-2.5 gap-1.5 text-muted-foreground text-[12px]">
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span>Search pursuits, clients, tasks…</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Icon action buttons */}
      <div className="flex items-center gap-1.5">
        <IconBtn icon={Clock} title="Recent activity" />
        <IconBtn icon={User} title="Profile" badge={12} />
        <IconBtn icon={Info} title="Help" />
        <IconBtn icon={MessageSquare} title="Messages" badge={3} />
      </div>

      {/* New bid */}
      {isPreSales && (
        <button
          onClick={() => setOpen(true)}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <Plus className="size-3.5" /> New bid
        </button>
      )}

      <IntakeModal open={open} onOpenChange={setOpen} />
    </header>
  );
}

function IconBtn({
  icon: Icon,
  title,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  badge?: number;
}) {
  return (
    <button
      title={title}
      className="size-[34px] rounded-[8px] border hairline border-border-strong bg-card flex items-center justify-center text-muted-foreground hover:bg-background relative"
    >
      <Icon className="size-4" strokeWidth={1.5} />
      {badge !== undefined && (
        <span className="absolute top-[5px] right-[5px] min-w-[14px] h-[14px] bg-accent text-white text-[8px] font-bold rounded-full flex items-center justify-center px-[3px] border border-white">
          {badge}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/TopBar.tsx
git commit -m "feat: redesign TopBar with page title/subtitle, search bar, and icon action buttons"
```

---

### Task 4: Rewrite Dashboard — KPI strip + pipeline funnel

**Files:**
- Rewrite: `src/routes/_app/dashboard.tsx`

This task rewrites the entire `dashboard.tsx`. The file is replaced in one step to keep TypeScript happy across the whole component tree.

- [ ] **Step 1: Replace `src/routes/_app/dashboard.tsx` entirely**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  LayoutGrid,
  DollarSign,
  TrendingUp,
  CalendarCheck,
  AlertCircle,
} from "lucide-react";
import { useBids, useMyQueue, useRecentActivity, type Bid, type ActivityEntry } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import {
  fmtMoney,
  stageLabel,
  urgencyClass,
  STAGES,
  type StageKey,
} from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

// ─── Colour palette (matches design tokens) ──────────────────────────────────
const C = {
  primary:  "#491AEB",
  accent:   "#FD5B0E",
  success:  "#27C084",
  warning:  "#F59E0B",
  danger:   "#EF4444",
  muted:    "#A09DB8",
  light:    "#826FFF",
};

// Stage colours for donut chart — one per stage, in order
const STAGE_COLORS = [
  "#491AEB", "#7c5af0", "#FD5B0E", "#F59E0B",
  "#27C084", "#EF4444", "#0891b2", "#A09DB8",
];

// ─── Derived stats ────────────────────────────────────────────────────────────
type KpiStats = {
  activeCount: number;
  pipelineValue: number;
  pendingReviews: number;
  approvalsAwaiting: number;
};

function computeKpi(bids: Bid[]): KpiStats {
  const active = bids.filter((b) => b.status === "active");
  const pendingReviews = active.filter((b) => {
    const days = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
    return days <= 7 && days >= 0;
  }).length;
  const approvalsAwaiting = active.filter(
    (b) => b.gonogo_decision === null && b.stage !== "deal_qualification",
  ).length;
  return {
    activeCount: active.length,
    pipelineValue: active.reduce((s, b) => s + (b.value ?? 0), 0),
    pendingReviews,
    approvalsAwaiting,
  };
}

// ─── Funnel data ──────────────────────────────────────────────────────────────
type FunnelStage = {
  key: string;
  label: string;
  num: number;
  count: number;
  value: number;
  pct: number;
};

function computeFunnel(bids: Bid[]): FunnelStage[] {
  const active = bids.filter((b) => b.status === "active");
  const total = active.length || 1;
  return STAGES.map((s, i) => {
    const here = active.filter((b) => b.stage === s.key);
    return {
      key: s.key,
      label: s.short,
      num: i + 1,
      count: here.length,
      value: here.reduce((sum, b) => sum + (b.value ?? 0), 0),
      pct: Math.round((here.length / total) * 100),
    };
  });
}

// ─── Health helper ────────────────────────────────────────────────────────────
function healthOf(deadline: string): { label: string; color: string } {
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  if (days < 3)  return { label: "Critical", color: C.danger };
  if (days <= 7) return { label: "At Risk",  color: C.warning };
  return          { label: "Healthy",  color: C.success };
}

// ─── Next action from stage ───────────────────────────────────────────────────
const NEXT_ACTION: Record<StageKey, string> = {
  deal_qualification: "Go/No-Go Review",
  rfi:                "RFI Response",
  rfp:                "RFP Review",
  orals:              "CXO Presentation",
  due_diligence:      "Due Diligence",
  bafo:               "BAFO Submission",
  contract_closure:   "Legal Review",
  post_closure:       "Contract Signed",
};

// ─── Relative time ────────────────────────────────────────────────────────────
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Format activity action text ─────────────────────────────────────────────
function fmtAction(entry: ActivityEntry): string {
  const client = entry.bids?.client_name ?? "A bid";
  const a = entry.action;
  if (a === "created") return `${client} — new bid created`;
  if (a === "stage_changed") return `${client} — stage updated`;
  if (a === "gonogo_scored") return `${client} — Go/No-Go scored`;
  if (a === "submitted") return `${client} — submitted`;
  if (a === "won") return `${client} — marked won 🎉`;
  if (a === "lost") return `${client} — marked lost`;
  return `${client} — ${a.replace(/_/g, " ")}`;
}

// ─── Notification icon + colour ───────────────────────────────────────────────
function notifStyle(action: string): { emoji: string; bg: string } {
  if (action === "created") return { emoji: "📄", bg: "#ede9fd" };
  if (action === "won") return { emoji: "✅", bg: "#edfaf4" };
  if (action === "lost") return { emoji: "⚠️", bg: "#fff1f1" };
  return { emoji: "🔔", bg: "#fff0e8" };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function DashboardPage() {
  const { data: bids = [], isLoading } = useBids();
  const { user } = useCurrentUser();
  const { data: activity = [] } = useRecentActivity(4);
  const { data: queueData } = useMyQueue(user?.id);

  const kpi    = useMemo(() => computeKpi(bids), [bids]);
  const funnel = useMemo(() => computeFunnel(bids), [bids]);

  const topBids = useMemo(
    () =>
      bids
        .filter((b) => b.status === "active")
        .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
        .slice(0, 5),
    [bids],
  );

  const myTasks = useMemo(() => {
    const items = [
      ...(queueData?.questions ?? []).map((q) => ({
        id: q.id,
        label: q.question_text,
        priority: "medium" as const,
        due_date: q.due_date,
        status: q.status,
      })),
      ...(queueData?.deliverables ?? []).map((d) => ({
        id: d.id,
        label: d.label,
        priority: "medium" as const,
        due_date: d.due_date,
        status: d.status,
      })),
    ]
      .filter((i) => i.status !== "done")
      .slice(0, 4);
    return items;
  }, [queueData]);

  const donutData = useMemo(
    () =>
      funnel
        .filter((f) => f.count > 0)
        .map((f) => ({ name: f.label, value: f.count, color: STAGE_COLORS[f.num - 1] ?? STAGE_COLORS[0] })),
    [funnel],
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-5 py-5 flex flex-col gap-[18px]">

        {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-5 gap-3">
          <KpiCard
            icon={LayoutGrid}
            iconBg="#ede9fd"
            iconColor={C.primary}
            label="Total Active Pursuits"
            value={kpi.activeCount}
            delta="↑ vs last month"
            deltaUp
          />
          <KpiCard
            icon={DollarSign}
            iconBg="#fff0e8"
            iconColor={C.accent}
            label="Pipeline Value"
            value={fmtMoney(kpi.pipelineValue)}
            delta="↑ vs last month"
            deltaUp
          />
          <KpiCard
            icon={TrendingUp}
            iconBg="#edfaf4"
            iconColor={C.success}
            label="Win Rate"
            value="—"
            delta="no closed deals yet"
            deltaUp={false}
          />
          <KpiCard
            icon={CalendarCheck}
            iconBg="#fffbeb"
            iconColor={C.warning}
            label="Pending Reviews"
            value={kpi.pendingReviews}
            delta="due within 7 days"
            deltaUp={false}
          />
          <KpiCard
            icon={AlertCircle}
            iconBg="#fff1f1"
            iconColor={C.danger}
            label="Approvals Awaiting"
            value={kpi.approvalsAwaiting}
            delta="go/no-go pending"
            deltaUp={false}
          />
        </div>

        {/* ── Pipeline Funnel ─────────────────────────────────────────────────── */}
        <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
          <div className="text-[13px] font-semibold mb-3 flex items-center gap-1.5">
            Pursuit Pipeline
            <span className="text-[11px] text-muted-foreground font-normal cursor-default" title="Active bids by stage">
              ⓘ
            </span>
          </div>
          <div className="grid grid-cols-8 rounded-[8px] border hairline border-border-strong overflow-hidden">
            {funnel.map((f) => (
              <Link
                key={f.key}
                to="/pipeline"
                className="border-r hairline border-border-strong last:border-r-0 p-2.5 text-center hover:bg-background transition-colors cursor-pointer"
              >
                <div className="text-[9px] text-muted-foreground mb-0.5">{f.num}</div>
                <div className="text-[10px] font-semibold text-muted-foreground mb-1.5 truncate">{f.label}</div>
                <div className="text-[20px] font-bold text-foreground leading-none mb-1.5">{f.count}</div>
                <div className="text-[11px] font-semibold text-primary mb-px">{fmtMoney(f.value)}</div>
                <div className="text-[10px] text-muted-foreground">{f.pct}%</div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Two-column body ─────────────────────────────────────────────────── */}
        <div className="flex gap-3.5 items-start">

          {/* Pursuits table */}
          <div className="flex-1 min-w-0 bg-card hairline border border-border-strong rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
              <span className="text-[13px] font-semibold">Top Active Pursuits</span>
              <Link to="/pipeline" className="text-[11px] text-primary hover:underline flex items-center gap-1">
                View All Pursuits →
              </Link>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Opportunity", "Stage", "Value", "Win Prob.", "Health", "Owner", "Next Action"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.06em] text-muted-foreground border-b hairline border-border font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topBids.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-[12px] text-muted-foreground text-center">
                      No active bids yet.
                    </td>
                  </tr>
                ) : (
                  topBids.map((b) => <PursuitRow key={b.id} bid={b} />)
                )}
              </tbody>
            </table>
          </div>

          {/* Right rail */}
          <div className="w-[300px] shrink-0 flex flex-col gap-3">

            {/* Notifications */}
            <div className="bg-card hairline border border-border-strong rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Notifications
                </span>
                <Link to="/notifications" className="text-[10px] text-primary font-medium hover:underline">
                  View All
                </Link>
              </div>
              {activity.length === 0 ? (
                <div className="px-3.5 py-4 text-[11px] text-muted-foreground">No recent activity.</div>
              ) : (
                activity.map((entry) => {
                  const s = notifStyle(entry.action);
                  return (
                    <div key={entry.id} className="flex gap-2.5 px-3.5 py-2.5 border-b hairline border-border last:border-b-0 items-start">
                      <div
                        className="size-7 rounded-[8px] flex items-center justify-center text-[13px] shrink-0 mt-px"
                        style={{ background: s.bg }}
                      >
                        {s.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-foreground leading-[1.4]">
                          {fmtAction(entry)}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {relativeTime(entry.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* My Tasks */}
            <div className="bg-card hairline border border-border-strong rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-3 border-b hairline border-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  My Tasks
                </span>
                <Link to="/queue" className="text-[10px] text-primary font-medium hover:underline">
                  View All
                </Link>
              </div>
              {myTasks.length === 0 ? (
                <div className="px-3.5 py-4 text-[11px] text-muted-foreground">All caught up!</div>
              ) : (
                myTasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 px-3.5 py-2 border-b hairline border-border last:border-b-0">
                    <div className="size-3.5 rounded-[3px] border-[1.5px] border-border-strong shrink-0 mt-[2px]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground leading-[1.4] truncate">
                        {t.label}
                      </div>
                      {t.due_date && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Due {new Date(t.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

        {/* ── Charts row ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3.5">

          {/* Win Rate Trend — static SVG placeholder */}
          <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[13px] font-semibold">Win Rate Trend</div>
                <div className="text-[10px] text-muted-foreground">
                  Sample data — real trend available after first closed deals
                </div>
              </div>
              <Link to="/analytics" className="text-[11px] text-primary hover:underline shrink-0">
                View Report →
              </Link>
            </div>
            <WinRateChart />
          </div>

          {/* Stage Distribution — real data donut */}
          <div className="bg-card hairline border border-border-strong rounded-xl p-3.5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-[13px] font-semibold">Stage Distribution</div>
                <div className="text-[10px] text-muted-foreground">
                  Active pursuits by pipeline stage
                </div>
              </div>
              <Link to="/analytics" className="text-[11px] text-primary hover:underline shrink-0">
                View Report →
              </Link>
            </div>
            <StageDonut data={donutData} total={bids.filter((b) => b.status === "active").length} />
          </div>

        </div>

        {/* Bottom padding */}
        <div className="h-16" />

      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  delta,
  deltaUp,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  delta: string;
  deltaUp: boolean;
}) {
  return (
    <div className="bg-card hairline border border-border-strong rounded-xl p-3.5 flex items-start gap-3">
      <div
        className="size-10 rounded-full flex items-center justify-center shrink-0"
        style={{ background: iconBg }}
      >
        <Icon className="size-5" style={{ color: iconColor }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground mb-0.5">
          {label}
        </div>
        <div className="text-[26px] font-bold leading-none text-foreground">
          {value}
        </div>
        <div
          className={`text-[10px] mt-1 flex items-center gap-1 ${
            deltaUp ? "text-success" : "text-muted-foreground"
          }`}
        >
          {delta}
        </div>
      </div>
    </div>
  );
}

// ─── Pursuit Table Row ────────────────────────────────────────────────────────
function PursuitRow({ bid: b }: { bid: Bid }) {
  const u = urgencyClass(b.deadline);
  const health = healthOf(b.deadline);
  const winProb = b.gonogo_score !== null ? `${b.gonogo_score}%` : "—";
  const winProbColor =
    b.gonogo_score === null
      ? "text-muted-foreground"
      : b.gonogo_score >= 70
        ? "text-success font-semibold"
        : b.gonogo_score >= 50
          ? "text-warning font-semibold"
          : "text-danger font-semibold";

  return (
    <tr className="border-b hairline border-border last:border-b-0 hover:bg-background">
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[12px] font-medium">{b.title}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{b.client_name}</div>
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <StagePill stage={b.stage} />
      </td>
      <td className="px-3 py-2.5 align-middle text-[12px] font-semibold whitespace-nowrap">
        {fmtMoney(b.value ?? 0)}
      </td>
      <td className={`px-3 py-2.5 align-middle text-[12px] whitespace-nowrap ${winProbColor}`}>
        {winProb}
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full shrink-0"
            style={{ background: health.color }}
          />
          <span className="text-[11px]" style={{ color: health.color }}>
            {health.label}
          </span>
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div
          className="size-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
          style={{ background: C.muted }}
          title={b.owner_id ? "Assigned" : "Unassigned"}
        >
          —
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[11px] text-muted-foreground max-w-[110px] leading-[1.3]">
          {NEXT_ACTION[b.stage as StageKey] ?? "—"}
        </div>
        <div className={`text-[10px] mt-0.5 ${u.className}`}>{u.label}</div>
      </td>
    </tr>
  );
}

// ─── Stage Pill ───────────────────────────────────────────────────────────────
const STAGE_PILL_STYLE: Partial<Record<StageKey, string>> = {
  deal_qualification: "bg-primary-soft text-primary",
  rfi:               "bg-primary-soft text-primary",
  rfp:               "bg-primary-soft text-primary",
  orals:             "bg-[rgba(73,26,235,0.08)] text-primary-light",
  due_diligence:     "bg-accent-soft text-accent",
  bafo:              "bg-accent-soft text-accent",
  contract_closure:  "bg-success-soft text-success",
  post_closure:      "bg-success-soft text-success",
};

function StagePill({ stage }: { stage: string }) {
  const style = STAGE_PILL_STYLE[stage as StageKey] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-semibold whitespace-nowrap ${style}`}
    >
      {stageLabel(stage)}
    </span>
  );
}

// ─── Win Rate static SVG chart ────────────────────────────────────────────────
function WinRateChart() {
  return (
    <div className="h-[160px] relative overflow-hidden">
      <svg viewBox="0 0 460 160" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <line x1="0" y1="120" x2="460" y2="120" stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="90"  x2="460" y2="90"  stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="60"  x2="460" y2="60"  stroke="#eee" strokeWidth="0.5" />
        <line x1="0" y1="30"  x2="460" y2="30"  stroke="#eee" strokeWidth="0.5" />
        <text x="0" y="124" fill="#a09db8" fontSize="9">0</text>
        <text x="0" y="94"  fill="#a09db8" fontSize="9">20</text>
        <text x="0" y="64"  fill="#a09db8" fontSize="9">40</text>
        <text x="0" y="34"  fill="#a09db8" fontSize="9">60</text>
        <text x="32"  y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Dec</text>
        <text x="112" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Jan</text>
        <text x="192" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Feb</text>
        <text x="272" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Mar</text>
        <text x="352" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">Apr</text>
        <text x="428" y="148" fill="#a09db8" fontSize="9" textAnchor="middle">May</text>
        <defs>
          <linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#491AEB" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#491AEB" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path
          d="M32,96 L112,84 L192,102 L272,78 L352,66 L428,52 L428,120 L32,120 Z"
          fill="url(#winGrad)"
        />
        <polyline
          points="32,96 112,84 192,102 272,78 352,66 428,52"
          fill="none"
          stroke="#491AEB"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="32"  cy="96"  r="3.5" fill="#491AEB" />
        <circle cx="112" cy="84"  r="3.5" fill="#491AEB" />
        <circle cx="192" cy="102" r="3.5" fill="#491AEB" />
        <circle cx="272" cy="78"  r="3.5" fill="#491AEB" />
        <circle cx="352" cy="66"  r="3.5" fill="#491AEB" />
        <circle cx="428" cy="52"  r="5"   fill="#491AEB" />
        <rect x="390" y="34" width="38" height="16" rx="4" fill="#491AEB" />
        <text x="409" y="45" fill="white" fontSize="9.5" fontWeight="700" textAnchor="middle">37%</text>
      </svg>
    </div>
  );
}

// ─── Stage Distribution donut ─────────────────────────────────────────────────
type DonutSlice = { name: string; value: number; color: string };

function StageDonut({ data, total }: { data: DonutSlice[]; total: number }) {
  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground">
        No active bids
      </div>
    );
  }
  return (
    <div className="flex items-center gap-5 h-[160px]">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={46}
            outerRadius={68}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
            formatter={(v: number) => [v, "bids"]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-1.5 text-[11px] flex-1 min-w-0">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <div className="size-2 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-muted-foreground truncate flex-1">{d.name}</span>
            <span className="font-semibold text-foreground shrink-0">{d.value}</span>
            <span className="text-muted-foreground text-[10px] shrink-0">
              ({Math.round((d.value / (total || 1)) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -30
```

Expected: exits 0. If you see a `Cell` import error — the recharts import must include `Cell`:
```ts
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
```
If `StageKey` import error, ensure `bid-constants.ts` exports `type StageKey` (it does — line 12).

- [ ] **Step 3: Commit**

```bash
git add src/routes/_app/dashboard.tsx
git commit -m "feat: rewrite dashboard with KPI strip, pipeline funnel, pursuits table, right rail, and charts"
```

---

### Task 5: Smoke-check in browser

- [ ] **Step 1: Start dev server**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun dev
```

- [ ] **Step 2: Check Sidebar**
  - Width is ~220px with labels visible
  - "Dashboard" item highlights purple when on `/dashboard`
  - "Pursuits" toggle collapses/expands the 8 stage sub-items
  - Stage sub-items show live counts from bids data
  - "My Queue" badge shows open item count (or is absent when 0)
  - "AI Command Center" shows green "New" badge
  - User name + role visible in footer
  - Hovering footer row reveals logout button

- [ ] **Step 3: Check TopBar**
  - Shows "Dashboard" title + subtitle on `/dashboard`
  - Shows "Pursuits" title on `/pipeline`, "My Queue" on `/queue`
  - Search bar renders in center (cosmetic only)
  - 4 icon buttons visible right of search; two have orange badges
  - "New bid" button present for pre_sales role

- [ ] **Step 4: Check Dashboard**
  - 5 KPI cards render with icons and values from live data
  - Pipeline funnel shows 8 stage columns with counts and values
  - Top Active Pursuits table shows up to 5 rows
  - Right rail: Notifications pulls from bid_activity_log (empty if log is empty)
  - Right rail: My Tasks pulls from current user's queue
  - Win Rate Trend shows the static SVG line chart
  - Stage Distribution donut shows real data with colours

- [ ] **Step 5: Check new routes**
  - `/ai` → "AI Command Center / Coming soon" placeholder
  - `/calendar` → "Calendar / Coming soon" placeholder
  - `/notifications` → "Notifications / Coming soon" placeholder

- [ ] **Step 6: Commit if any fixes were applied**

```bash
git add -p
git commit -m "fix: smoke-check corrections to shell redesign"
```
