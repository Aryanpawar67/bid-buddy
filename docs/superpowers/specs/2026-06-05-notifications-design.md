# Notifications — Design Spec
_Date: 2026-06-05_
_Route: `/notifications` (placeholder already exists)_
_Status: ✅ Approved — ready for implementation planning_

---

## Goal

A full per-user notifications centre showing stage changes, deadline alerts, Go/No-Go decisions, new bids, and completed tasks. Delivered in-app only via Supabase Realtime. Right-rail preview (4 items) already ships on the Dashboard; this spec covers the full `/notifications` page, the DB layer, and the sidebar unread badge.

---

## Decisions Made

| Question | Decision |
|---|---|
| Who gets notified | All users with `pre_sales` or `admin` role |
| Email | In-app only — no email in v1 |
| Events | Stage change, deadline < 3 days, Go/No-Go decision, new bid created, task/deliverable marked done |
| Retention | Forever — no auto-delete |
| Read behaviour | Read = highlight removed; unread = purple-tinted row |
| Preferences | Always-on for everyone — no mute settings in v1 |
| UI layout | Master/Detail split — list panel left, detail pane right |

---

## Data Model

### New table: `notifications`

```sql
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bid_id     uuid REFERENCES public.bids(id) ON DELETE CASCADE,
  type       text NOT NULL,   -- 'stage_change' | 'deadline' | 'gonogo' | 'bid_created' | 'task_done'
  title      text NOT NULL,
  body       text NOT NULL,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX notifications_user_idx ON public.notifications(user_id);
CREATE INDEX notifications_read_idx  ON public.notifications(user_id, read);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Realtime enabled on this table (enabled in Supabase dashboard or via replication)
```

---

## Postgres Triggers

All triggers run `SECURITY DEFINER` as `service_role` so they can fan out to all eligible users regardless of the calling user's RLS context.

### Helper: `notify_eligible_users(bid_id, type, title, body)`

A shared PL/pgSQL function that:
1. Selects all `user_id`s from `user_roles` where `role IN ('pre_sales', 'admin')`
2. Excludes `current_setting('request.jwt.claims', true)::json->>'sub'` (the acting user — no self-notifications)
3. Bulk-inserts one `notifications` row per user

### Trigger 1: `notify_on_stage_change`
- Table: `bids` — `AFTER UPDATE OF stage`
- Condition: `NEW.stage <> OLD.stage`
- Title: `"{NEW.client_name} moved to {stage_label(NEW.stage)}"`
- Body: `"Stage changed from {stage_label(OLD.stage)}"`

### Trigger 2: `notify_on_bid_created`
- Table: `bids` — `AFTER INSERT`
- Title: `"New pursuit: {NEW.title}"`
- Body: `"Created for {NEW.client_name} · {fmtMoney(NEW.value)}"`

### Trigger 3: `notify_on_gonogo`
- Table: `bids` — `AFTER UPDATE OF gonogo_decision`
- Condition: `OLD.gonogo_decision IS NULL AND NEW.gonogo_decision IS NOT NULL`
- Title: `"{NEW.client_name} — Go/No-Go: {NEW.gonogo_decision}"`
- Body: `"Decision recorded at {NEW.gonogo_completed_at}"`

### Trigger 4: `notify_on_task_done`
- Tables: `bid_questions` AND `bid_deliverables` — `AFTER UPDATE OF status`
- Condition: `OLD.status <> 'done' AND NEW.status = 'done'`
- Joins `bids` to get `client_name`
- Title: `"{client_name} — task completed"`
- Body: `""{question_text or label}" marked done"`

---

## Client-Side Hooks

New file: `src/lib/notification-queries.ts`

### `useNotifications()`
- Query: `SELECT *, bids(client_name, title) FROM notifications WHERE user_id = auth.uid() ORDER BY created_at DESC`
- Supabase Realtime channel subscribed to `notifications` filtered by `user_id = auth.uid()` — inserts from triggers arrive live
- On new row: `queryClient.invalidateQueries(["notifications"])` + `queryClient.invalidateQueries(["notification-count"])`

### `useNotificationCount()`
- Query: `SELECT count(*) FROM notifications WHERE user_id = auth.uid() AND read = false`
- Lightweight — used only for sidebar badge
- Also subscribed to Realtime for live badge updates

### `useMarkRead(id: string)`
- Mutation: `UPDATE notifications SET read = true WHERE id = id`
- Called when user clicks a row in the list panel
- Invalidates `["notifications"]` and `["notification-count"]`

### `useMarkAllRead()`
- Mutation: `UPDATE notifications SET read = true WHERE user_id = auth.uid() AND read = false`
- Called by "Mark all read" button in TopBar area of the page
- Invalidates both query keys

### `useDeadlineNotifier()`
- Called once in `_app.tsx` (after session is confirmed)
- Queries active bids with `deadline` between today and today+3 days
- For each bid, checks if a `type = 'deadline'` notification for that `bid_id` already exists in the last 24h
- If not, inserts one via `supabase.from('notifications').insert(...)`
- Runs once per session on mount — no polling

---

## Sidebar Badge

In `Sidebar.tsx`:
- Replace the current `useRecentActivity(50)` + `notifCount = activity.length` with `useNotificationCount()`
- Badge shows real unread count, updates live via Realtime

---

## Notifications Page — `/notifications`

**Layout:** Master/Detail split

```
┌──────────────────────────────────────────────────────┐
│ TopBar: "Notifications"  [Mark all read]  [4 unread] │
├──────────────┬───────────────────────────────────────┤
│ List panel   │ Detail pane                           │
│ (260px)      │                                       │
│              │  Title: Acme Corp moved to RFP        │
│ 🔄 Acme →   │  Meta: Stage change · 2 minutes ago   │
│    RFP  2m  │                                       │
│ ⚠️ GlobalT  │  ┌─────────────────────────────────┐  │
│    Deadl 1h │  │ Acme Corp has advanced from RFI │  │
│ ✅ Condor   │  │ to RFP. Changed by Priya Mehta. │  │
│    GoGo  3h │  │ Value $2.4M · due June 14.      │  │
│ 📄 Zenith   │  └─────────────────────────────────┘  │
│    New   1d │                                       │
│ ☑️ Acme    │  [View Bid →]  [Dismiss]              │
│    Task  2d │                                       │
└──────────────┴───────────────────────────────────────┘
```

**List panel behaviour:**
- Unread rows: purple-tinted background (`bg-primary/5`), bold title
- Read rows: white background, normal weight
- Clicking a row: marks it read, shows detail in right pane
- First unread item auto-selected on page load

**Filter chips (above list):** All · Unread · Stage · Deadlines · Tasks — client-side filter on `type` field, no extra queries

**Detail pane:**
- Shows `title`, `body`, timestamp, type badge
- "View Bid →" link navigates to `/bids/{bid_id}` (hidden if `bid_id` is null)
- "Dismiss" marks row read and clears selection

**Empty state:** Centred illustration + "You're all caught up" when no notifications exist.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/YYYYMMDD_notifications.sql` | New migration: table + RLS + triggers |
| `src/lib/notification-queries.ts` | New: all 5 hooks |
| `src/routes/_app.tsx` | Add `<DeadlineNotifier />` (renders null, calls useDeadlineNotifier) |
| `src/components/app/Sidebar.tsx` | Swap `useRecentActivity` badge → `useNotificationCount` |
| `src/routes/_app/notifications.tsx` | Full rewrite: master/detail UI |

---

## Out of Scope (v1)

- Email notifications
- Per-bid mute / notification preferences
- Push notifications (browser)
- Mention/comment system
- Notification grouping ("3 updates on Acme Corp")
