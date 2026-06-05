# V1 Shell Redesign — Design Spec
_Date: 2026-06-05_
_Reference mockup: `docs/design-mockups/v1-full-redesign.html`_

## Goal

Implement the v1 full-redesign mockup for the existing wired pages (Dashboard, Pursuits, My Queue) and create placeholder routes for new backend-requiring tabs (AI Command Center, Calendar, Notifications). No new Supabase tables are added in this milestone.

---

## 1. Scope

### In scope (implement now)
| File | Change |
|---|---|
| `src/components/app/Sidebar.tsx` | Full rewrite — 220px labeled sidebar with sub-nav, user footer |
| `src/components/app/TopBar.tsx` | Redesign — page title/subtitle, search bar, icon action buttons |
| `src/routes/_app/dashboard.tsx` | Full rewrite — KPI strip, pipeline funnel, pursuits table, right rail, charts |
| `src/routes/_app/ai.tsx` | New placeholder route |
| `src/routes/_app/calendar.tsx` | New placeholder route |
| `src/routes/_app/notifications.tsx` | New placeholder route |
| `src/lib/bid-queries.ts` | Add `useRecentActivity()` hook for right-rail notifications |

### Out of scope (separate plans)
- AI Command Center backend (AI integration, prompt system)
- Knowledge Hub document management
- Full Reports & Analytics charts
- Calendar event/deadline tables
- Notifications table + real-time subscriptions

---

## 2. Sidebar

### Layout
```
┌─────────────────────┐  220px wide, full height, bg #220032
│ [B] Bid Compass     │  Logo block + brand name + "Pursuit Management" sub
│     Pursuit Mgmt    │
├─────────────────────┤
│ ▪ Dashboard         │  active = bg-primary (purple), text white
│ ▾ Pursuits    [48]  │  collapsible; count badge from useBids()
│   1 Deal Qual   [8] │  sub-items: stage number + label + count
│   2 RFI         [7] │  clicking sub-item navigates to /pipeline (visual for now)
│   3 RFP        [14] │
│   ...               │
│ ── Tools ──         │  section separator
│ ▪ My Queue    [5]   │  badge = useMyQueue() open count
│ ▪ AI Cmd Ctr  [New] │  "New" green badge, links to /ai
│ ▪ Knowledge Hub     │  links to /docs
│ ▪ Reports          │  links to /analytics
│ ▪ Calendar         │  links to /calendar
│ ── System ──        │
│ ▪ Settings         │  admin only
│ ▪ Notifications [12]│  links to /notifications; badge from activity log count
├─────────────────────┤
│ [AK] Aryan Pawar    │  user avatar + name + role + "›" chevron
│      Bid Manager    │
└─────────────────────┘
```

### Key decisions
- **Width:** CSS variable `--sidebar-width: 220px` added to `styles.css`; `_app.tsx` layout is unchanged (sidebar is `shrink-0`, main uses `flex-1 min-w-0`)
- **Pursuits collapse:** local `useState` in Sidebar, default open
- **Stage counts:** derived from `useBids()` (already fetched globally via React Query — no extra request)
- **User footer:** `useCurrentUser()` for name, role, initials
- **Badge counts:** My Queue badge from `useMyQueue()` item count; Notifications badge from `useRecentActivity()` count (last 7 days)
- **Active state:** `path.startsWith(n.to)` logic unchanged; sub-items don't get independent active state

---

## 3. TopBar

### Layout
```
[Dashboard]  [Overview of all your pursuits...]   [🔍 Search pursuits...]  ─spacer─  [⏱][👤 12][ℹ][💬 3]  [+ New bid]
```

- **Left:** `page` title (bold, 16px) + `sub` subtitle (11px, muted) — derived from `useCrumbs()` extended map
- **Center:** Search input (max-w-360px, bg-surface, placeholder "Search pursuits, clients, tasks…") — cosmetic only, no search logic wired
- **Right icons:** 4 icon buttons (clock, user-with-badge, info, chat-with-badge) — static badge counts (3 and 12) until notification system is built
- **New bid button:** unchanged, pre_sales only

### Subtitle map (added to `useCrumbs`)
```ts
const subtitleMap: Record<string, string> = {
  dashboard: "Overview of all your pursuits and tasks",
  pipeline: "All active bids across pipeline stages",
  queue: "Your assigned questions and deliverables",
  analytics: "Pipeline metrics and win rate trends",
  docs: "Bid documents and templates",
  ai: "AI-powered pursuit assistant",
  calendar: "Deadlines and key dates",
  notifications: "Activity and alerts",
  settings: "Workspace configuration",
}
```

---

## 4. Dashboard

### Layout (top → bottom)
1. **KPI strip** — 5 cards in a row
2. **Pipeline stage funnel** — 8 columns, one per stage
3. **Two-column body** — pursuits table (flex-1) + right rail (300px)
4. **Charts row** — 2 charts side by side

### 4a. KPI Strip
Same 5 metrics as current implementation, but updated card design to match mockup:
- Icon circle (colored background) + label (10px uppercase) + value (26px bold) + delta line
- Delta is static "vs last month" placeholder (no historical data)
- Metrics: Total Active Pursuits, Pipeline Value, Win Rate (static 37% placeholder), Pending Reviews (= items with status "pending" in queue), Approvals Awaiting (= bids with `gonogo_decision === null` at late stages)

### 4b. Pipeline Stage Funnel
```
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│  1   │  2   │  3   │  4   │  5   │  6   │  7   │  8   │
│Qual. │ RFI  │ RFP  │Orals │ Due  │BAFO  │Contr.│ Won  │
│  8   │  7   │ 14   │  5   │  6   │  4   │  3   │  1   │
│$8.2M │$6.1M │$14.8M│$5.3M │$4.2M │$2.7M │$1.1M │$0.2M │
│  16% │  12% │  29% │  10% │   8% │   5% │   2% │   0% │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```
- Data from `useBids()` grouped by `b.stage`, summing `b.value`
- Percentage = stage count / total active count
- Clicking a column navigates to `/pipeline` (stage filter: future enhancement)

### 4c. Top Active Pursuits Table
Columns: Opportunity + client | Stage pill | Value | Win Prob | Health | Owner | Next Action

- **Win Prob:** derived from `b.gonogo_score` (0-100 → display as %, null → "—"). Color: ≥70 = success, ≥50 = warning, <50 = danger
- **Health dot:** `"healthy"` if deadline > 7 days; `"risk"` if 3–7 days; `"critical"` if < 3 days or overdue
- **Owner:** `initials(profile.full_name)` of `b.owner_id` — resolved via a `profiles` lookup added to `useBids()` or passed as a map
- **Next Action:** derived from `b.stage` + `b.deadline` (e.g. stage = orals → "CXO Presentation", deadline = tomorrow → "Due Tomorrow")
- Shows top 5 active bids sorted by deadline

> **Owner resolution:** `useBids()` does not join profiles. For now, show `b.owner_id?.slice(0,8)` as a placeholder avatar; the profiles join is a follow-up.

### 4d. Right Rail
Two stacked cards (300px wide):

**Notifications card** — pulled from `useRecentActivity()`:
- Queries `bid_activity_log` — last 4 entries joined with bids
- Icon + action text + relative time ("10 mins ago")
- "View All" → `/notifications`

**My Tasks card** — top 4 from `useMyQueue()` already available:
- Checkbox (visual only) + task label + priority badge + due date
- "View All" → `/queue`

### 4e. Charts Row
Two chart cards side by side:

**Win Rate Trend** — static SVG line chart (identical to mockup HTML). No real historical data yet; labelled "Last 6 months (sample data)". This will be replaced when the analytics backend is built.

**Stage Distribution donut** — real data from `useBids()` grouped by stage. Uses recharts `PieChart` with innerRadius (donut shape). Already have recharts installed.

---

## 5. New Placeholder Routes

Three new route files following the existing `analytics.tsx` / `docs.tsx` pattern:

```tsx
// src/routes/_app/ai.tsx
export const Route = createFileRoute("/_app/ai")({ component: AiPage })
function AiPage() { return <Placeholder title="AI Command Center" blurb="..." /> }

// src/routes/_app/calendar.tsx  
export const Route = createFileRoute("/_app/calendar")({ component: CalendarPage })

// src/routes/_app/notifications.tsx
export const Route = createFileRoute("/_app/notifications")({ component: NotificationsPage })
```

---

## 6. Data / Query Changes

One new query added to `bid-queries.ts`:

```ts
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
      return data;
    },
  });
}
```

---

## 7. Style Changes

Add to `src/styles.css`:
```css
/* Sidebar width token for easy future change */
:root { --sidebar-width: 220px; }
```

The `_app.tsx` layout shell does not change — sidebar width is set by the component itself.

---

## 8. Files Changed Summary

| File | Type |
|---|---|
| `src/components/app/Sidebar.tsx` | Rewrite |
| `src/components/app/TopBar.tsx` | Update |
| `src/routes/_app/dashboard.tsx` | Rewrite |
| `src/routes/_app/ai.tsx` | New |
| `src/routes/_app/calendar.tsx` | New |
| `src/routes/_app/notifications.tsx` | New |
| `src/lib/bid-queries.ts` | Add hook |
| `src/styles.css` | Token addition |

---

## 9. Out of Scope (Tracked in Stub Plans)

See `docs/superpowers/plans/stubs/` for:
- `ai-command-center.md`
- `knowledge-hub.md`
- `reports-analytics.md`
- `calendar.md`
- `notifications.md`
