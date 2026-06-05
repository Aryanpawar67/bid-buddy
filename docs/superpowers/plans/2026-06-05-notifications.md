# Notifications — Implementation Plan
_Date: 2026-06-05_
_Spec: [2026-06-05-notifications-design.md](../specs/2026-06-05-notifications-design.md)_
_Route: `/notifications`_

**Goal:** Deliver a per-user notifications system with Postgres triggers for fan-out, Supabase Realtime for live delivery, a master/detail `/notifications` page, and a live unread badge in the Sidebar.

**Architecture:** One new migration (table + triggers), one new query file (`notification-queries.ts`), a thin `DeadlineNotifier` component in `_app.tsx`, a Sidebar badge swap, and a full rewrite of `notifications.tsx`.

> **Note on testing:** No test runner configured. Each task ends with `bun run build:dev` to verify TypeScript correctness, then manual smoke-check in browser.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/<ts>_notifications.sql` | Create — table, RLS, helper function, 4 triggers |
| `src/lib/notification-queries.ts` | Create — 5 hooks: useNotifications, useNotificationCount, useMarkRead, useMarkAllRead, useDeadlineNotifier |
| `src/routes/_app.tsx` | Modify — mount `<DeadlineNotifier />` inside AppLayout |
| `src/components/app/Sidebar.tsx` | Modify — swap activity-based badge → useNotificationCount |
| `src/routes/_app/notifications.tsx` | Rewrite — master/detail split UI |

---

## Task 1 — Database Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_notifications.sql`

- [ ] **Step 1: Create migration file**

File name: use the current timestamp in format `YYYYMMDDHHMMSS_notifications.sql`.

```sql
-- ============ NOTIFICATIONS TABLE ============
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bid_id     uuid REFERENCES public.bids(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON public.notifications(user_id);
CREATE INDEX notifications_unread_idx ON public.notifications(user_id, read) WHERE read = false;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============ HELPER: fan out to all pre_sales + admin ============
CREATE OR REPLACE FUNCTION public.notify_eligible_users(
  _bid_id   uuid,
  _type     text,
  _title    text,
  _body     text,
  _actor_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, bid_id, type, title, body)
  SELECT ur.user_id, _bid_id, _type, _title, _body
  FROM public.user_roles ur
  WHERE ur.role IN ('pre_sales', 'admin')
    AND (_actor_id IS NULL OR ur.user_id <> _actor_id);
END;
$$;

-- ============ TRIGGER 1: stage change ============
CREATE OR REPLACE FUNCTION public._trigger_notify_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  IF NEW.stage = OLD.stage THEN RETURN NEW; END IF;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'stage_change',
    NEW.client_name || ' moved to ' || NEW.stage,
    'Stage changed from ' || OLD.stage,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_stage_change
  AFTER UPDATE OF stage ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_stage_change();

-- ============ TRIGGER 2: bid created ============
CREATE OR REPLACE FUNCTION public._trigger_notify_bid_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'bid_created',
    'New pursuit: ' || NEW.title,
    'Created for ' || NEW.client_name,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_bid_created
  AFTER INSERT ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_bid_created();

-- ============ TRIGGER 3: Go/No-Go decision ============
CREATE OR REPLACE FUNCTION public._trigger_notify_gonogo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
BEGIN
  IF OLD.gonogo_decision IS NOT NULL OR NEW.gonogo_decision IS NULL THEN RETURN NEW; END IF;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.id,
    'gonogo',
    NEW.client_name || ' — Go/No-Go: ' || NEW.gonogo_decision,
    'Decision recorded on ' || NEW.client_name,
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_gonogo
  AFTER UPDATE OF gonogo_decision ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_gonogo();

-- ============ TRIGGER 4a: question done ============
CREATE OR REPLACE FUNCTION public._trigger_notify_question_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor  uuid;
  _client text;
BEGIN
  IF OLD.status = 'done' OR NEW.status <> 'done' THEN RETURN NEW; END IF;
  SELECT client_name INTO _client FROM public.bids WHERE id = NEW.bid_id;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.bid_id,
    'task_done',
    _client || ' — task completed',
    '"' || left(NEW.question_text, 60) || '" marked done',
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_question_done
  AFTER UPDATE OF status ON public.bid_questions
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_question_done();

-- ============ TRIGGER 4b: deliverable done ============
CREATE OR REPLACE FUNCTION public._trigger_notify_deliverable_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor  uuid;
  _client text;
BEGIN
  IF OLD.status = 'done' OR NEW.status <> 'done' THEN RETURN NEW; END IF;
  SELECT client_name INTO _client FROM public.bids WHERE id = NEW.bid_id;
  BEGIN _actor := (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
  EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
  PERFORM public.notify_eligible_users(
    NEW.bid_id,
    'task_done',
    _client || ' — task completed',
    '"' || left(NEW.label, 60) || '" marked done',
    _actor
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER notify_deliverable_done
  AFTER UPDATE OF status ON public.bid_deliverables
  FOR EACH ROW EXECUTE FUNCTION public._trigger_notify_deliverable_done();
```

- [ ] **Step 2: Apply migration to Supabase**

```bash
# If using Supabase CLI linked to remote project:
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && supabase db push

# OR paste the SQL directly into the Supabase SQL Editor in the dashboard.
```

After applying: verify in Supabase dashboard that `notifications` table appears with correct columns and RLS policies.

Also enable Realtime on the `notifications` table:
- Supabase dashboard → Database → Replication → select `notifications` table → enable

- [ ] **Step 3: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -10
```

Expected: exits 0 (migration doesn't affect TypeScript).

---

## Task 2 — notification-queries.ts

**Files:**
- Create: `src/lib/notification-queries.ts`

- [ ] **Step 1: Create the file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";
import { useBids } from "@/lib/bid-queries";

export type Notification = {
  id: string;
  user_id: string;
  bid_id: string | null;
  type: "stage_change" | "deadline" | "gonogo" | "bid_created" | "task_done";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  bids: { client_name: string; title: string } | null;
};

// ─── useNotifications ────────────────────────────────────────────────────────
export function useNotifications() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["notification-count"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return useQuery({
    queryKey: ["notifications"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*, bids(client_name, title)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

// ─── useNotificationCount ────────────────────────────────────────────────────
export function useNotificationCount() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { qc.invalidateQueries({ queryKey: ["notification-count"] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return useQuery({
    queryKey: ["notification-count"],
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

// ─── useMarkRead ─────────────────────────────────────────────────────────────
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });
}

// ─── useMarkAllRead ──────────────────────────────────────────────────────────
export function useMarkAllRead() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-count"] });
    },
  });
}

// ─── useDeadlineNotifier ─────────────────────────────────────────────────────
export function useDeadlineNotifier() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();

  useEffect(() => {
    if (!user || bids.length === 0) return;

    async function checkDeadlines() {
      const now = new Date();
      const cutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const urgentBids = bids.filter((b) => {
        if (b.status !== "active") return false;
        const d = new Date(b.deadline);
        return d >= now && d <= cutoff;
      });
      if (urgentBids.length === 0) return;

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("notifications")
        .select("bid_id")
        .eq("user_id", user!.id)
        .eq("type", "deadline")
        .gte("created_at", oneDayAgo);

      const alreadyNotified = new Set((existing ?? []).map((r) => r.bid_id));

      for (const bid of urgentBids) {
        if (alreadyNotified.has(bid.id)) continue;
        const days = Math.ceil((new Date(bid.deadline).getTime() - now.getTime()) / 86400000);
        await supabase.from("notifications").insert({
          user_id: user!.id,
          bid_id: bid.id,
          type: "deadline",
          title: `Deadline in ${days}d — ${bid.client_name}`,
          body: `${bid.title} is due ${new Date(bid.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          read: false,
        });
      }
    }

    checkDeadlines();
  }, [user?.id, bids.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 2: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -10
```

Expected: exits 0. If Supabase types don't include `notifications` yet (types auto-generated from DB schema), the `supabase.from("notifications")` calls will use loose typing — acceptable for now, will resolve after migration is applied and types regenerated.

---

## Task 3 — Wire DeadlineNotifier + Sidebar badge

**Files:**
- Modify: `src/routes/_app.tsx`
- Modify: `src/components/app/Sidebar.tsx`

- [ ] **Step 1: Add DeadlineNotifier to `_app.tsx`**

In `src/routes/_app.tsx`, import `useDeadlineNotifier` and create a thin wrapper component that mounts inside `AppLayout` (after auth is confirmed):

```tsx
import { useDeadlineNotifier } from "@/lib/notification-queries";

function DeadlineNotifier() {
  useDeadlineNotifier();
  return null;
}
```

Add `<DeadlineNotifier />` inside the authenticated return, before `<Sidebar />`:

```tsx
return (
  <div className="h-screen w-screen flex bg-background overflow-hidden">
    <DeadlineNotifier />
    <Sidebar />
    ...
  </div>
);
```

- [ ] **Step 2: Swap Sidebar badge to useNotificationCount**

In `src/components/app/Sidebar.tsx`:

Remove:
```ts
const { data: activity = [] } = useRecentActivity(50);
const notifCount = activity.length;
```

Add:
```ts
import { useNotificationCount } from "@/lib/notification-queries";
const { data: notifCount = 0 } = useNotificationCount();
```

Remove the `useRecentActivity` import from the import line.

- [ ] **Step 3: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -10
```

Expected: exits 0.

---

## Task 4 — Rewrite `/notifications` Page

**Files:**
- Rewrite: `src/routes/_app/notifications.tsx`

- [ ] **Step 1: Replace `src/routes/_app/notifications.tsx` entirely**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  type Notification,
} from "@/lib/notification-queries";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});

type FilterType = "all" | "unread" | "stage_change" | "deadline" | "task_done" | "gonogo" | "bid_created";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all",          label: "All" },
  { key: "unread",       label: "Unread" },
  { key: "stage_change", label: "Stage" },
  { key: "deadline",     label: "Deadlines" },
  { key: "task_done",    label: "Tasks" },
  { key: "gonogo",       label: "Go/No-Go" },
  { key: "bid_created",  label: "New Bids" },
];

const TYPE_ICON: Record<string, string> = {
  stage_change: "🔄",
  deadline:     "⚠️",
  gonogo:       "✅",
  bid_created:  "📄",
  task_done:    "☑️",
};

const TYPE_BG: Record<string, string> = {
  stage_change: "#ede9fd",
  deadline:     "#fff1f1",
  gonogo:       "#edfaf4",
  bid_created:  "#fff0e8",
  task_done:    "#f0eeff",
};

function relativeTime(dateStr: string): string {
  const diff = new Date().getTime() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationsPage() {
  const { data: notifications = [], isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const [filter, setFilter] = useState<FilterType>("all");
  const [selected, setSelected] = useState<Notification | null>(null);

  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    return n.type === filter;
  });

  // Auto-select first unread on load
  useEffect(() => {
    if (!selected && filtered.length > 0) {
      const first = filtered.find((n) => !n.read) ?? filtered[0];
      setSelected(first);
    }
  }, [filtered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(n: Notification) {
    setSelected(n);
    if (!n.read) markRead.mutate(n.id);
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="h-full flex flex-col">
      {/* Page actions bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border-strong text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            className="text-[11px] text-primary font-medium hover:underline"
          >
            Mark all read
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {unreadCount} unread
        </span>
      </div>

      {/* Master/Detail */}
      <div className="flex flex-1 min-h-0">

        {/* List panel */}
        <div className="w-[280px] shrink-0 border-r hairline border-border flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">No notifications</div>
          ) : (
            <div className="flex-1 overflow-y-auto py-1.5">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleSelect(n)}
                  className={[
                    "w-full flex gap-2.5 items-start px-3 py-2.5 text-left transition-colors border-b hairline border-border last:border-b-0",
                    selected?.id === n.id
                      ? "bg-primary/5"
                      : n.read
                        ? "bg-card hover:bg-background"
                        : "bg-primary/[0.04] hover:bg-primary/[0.07]",
                  ].join(" ")}
                >
                  <div
                    className="size-7 rounded-[7px] flex items-center justify-center text-[12px] shrink-0 mt-px"
                    style={{ background: TYPE_BG[n.type] ?? "#f5f4fa" }}
                  >
                    {TYPE_ICON[n.type] ?? "🔔"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11px] leading-[1.35] truncate ${n.read ? "" : "font-semibold"}`}>
                      {n.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {relativeTime(n.created_at)}
                    </div>
                  </div>
                  {!n.read && (
                    <div className="size-1.5 rounded-full bg-primary shrink-0 mt-[5px]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="px-6 py-4 border-b hairline border-border">
                <div className="flex items-start gap-3">
                  <div
                    className="size-9 rounded-[9px] flex items-center justify-center text-[16px] shrink-0"
                    style={{ background: TYPE_BG[selected.type] ?? "#f5f4fa" }}
                  >
                    {TYPE_ICON[selected.type] ?? "🔔"}
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold leading-tight">{selected.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {selected.type.replace(/_/g, " ")} · {relativeTime(selected.created_at)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 px-6 py-5 overflow-y-auto">
                <div className="bg-background border hairline border-border-strong rounded-xl p-4 text-[13px] text-foreground leading-relaxed max-w-[560px]">
                  {selected.body}
                </div>
                {selected.bids && (
                  <div className="mt-4 text-[12px] text-muted-foreground">
                    Bid: <span className="font-medium text-foreground">{selected.bids.title}</span>
                    {" · "}{selected.bids.client_name}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t hairline border-border flex items-center gap-3">
                {selected.bid_id && (
                  <Link
                    to="/bids/$id"
                    params={{ id: selected.bid_id }}
                    className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
                  >
                    View Bid →
                  </Link>
                )}
                {!selected.read && (
                  <button
                    onClick={() => markRead.mutate(selected.id)}
                    className="h-8 px-4 rounded-md border hairline border-border-strong text-[12px] text-muted-foreground hover:bg-background"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
              <Bell className="size-10 opacity-20" strokeWidth={1} />
              <div className="text-[13px]">Select a notification to read it</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -10
```

Expected: exits 0. If `Link to="/bids/$id"` causes a type error (route not typed), replace with `<a href={"/bids/" + selected.bid_id}>`.

- [ ] **Step 3: Commit all changes**

```bash
git add \
  supabase/migrations/ \
  src/lib/notification-queries.ts \
  src/routes/_app.tsx \
  src/components/app/Sidebar.tsx \
  src/routes/_app/notifications.tsx
git commit -m "feat: add notifications system — DB triggers, realtime hooks, master/detail UI"
```

---

## Task 5 — Smoke-check in Browser

- [ ] **Step 1:** Start dev server: `bun dev`
- [ ] **Step 2:** Go to `/notifications` — page renders with master/detail layout, filter chips visible
- [ ] **Step 3:** In Supabase dashboard SQL editor, manually insert a test notification:
  ```sql
  INSERT INTO notifications (user_id, bid_id, type, title, body)
  VALUES ('<your-user-id>', null, 'bid_created', 'Test notification', 'This is a test body.');
  ```
- [ ] **Step 4:** Confirm the notification appears in the list live (Realtime), clicking it marks it read (highlight removed), sidebar badge count decrements
- [ ] **Step 5:** Change a bid's stage in the pipeline — confirm a notification fan-out row appears for your user
- [ ] **Step 6:** Check deadline notifier — if any active bid has a deadline within 3 days, a `deadline` notification should auto-insert on app load
- [ ] **Step 7:** "Mark all read" button clears all highlights and resets badge to 0
