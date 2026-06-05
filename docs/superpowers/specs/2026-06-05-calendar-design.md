# Calendar — Design Spec
_Date: 2026-06-05_
_Route: `/calendar` (placeholder exists)_

## Goal

A weekly calendar view showing bid deadlines and ad-hoc events. Users can toggle between a team view (all bids + all events) and a personal view (their bids + their events), and create free-standing events by clicking any time slot.

---

## Library

**`react-big-calendar`** with the date-fns localizer.
- MIT license, ~200KB
- Built-in week view with time slots
- `selectable` prop enables click-to-create
- CSS-based theming via `.rbc-*` class overrides to match design tokens

---

## Data Model

### New table: `bid_events`

```sql
bid_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  event_date  timestamptz NOT NULL,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
)
```

No `bid_id` — events are free-standing, not attached to a bid.

**RLS:**
- All authenticated users can `SELECT` (enables team view)
- Only `created_by = auth.uid()` can `UPDATE` / `DELETE`

### Existing fields used (no schema changes)

- `bids.deadline` — source for deadline markers
- `bids.owner_id` — used to filter personal view
- `bids.status` — only `active` bids shown

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/<ts>_bid_events.sql` | Table + RLS |
| `src/lib/calendar-queries.ts` | 4 hooks |
| `src/routes/_app/calendar.tsx` | Full page rewrite |
| `src/components/app/EventCreateModal.tsx` | Ad-hoc event creation modal |

### `calendar-queries.ts` hooks

- `useCalendarBids()` — filters `useBids()` to `status === "active"`
- `useCalendarEvents(mode: "team" | "personal")` — fetches `bid_events`; in personal mode adds `.eq("created_by", userId)` filter
- `useCreateEvent()` — inserts into `bid_events`, invalidates `["calendar-events"]`
- `useDeleteEvent()` — deletes by id, invalidates `["calendar-events"]`

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│ [← Prev]  [Today]  [Next →]   Week of Jun 2–8       │  ← top bar
│                               [Team] [Personal]      │
├─────────────────────────────────────────────────────┤
│ All-day │  Accenture deadline  │  iMocha RFP        │  ← deadline strip
├─────────┼──────────────────────┬────────────────────┤
│  9 AM   │                      │                    │
│ 10 AM   │   [Ad-hoc event]     │                    │  ← time grid
│ 11 AM   │                      │                    │
│  ...    │                      │                    │
└─────────┴──────────────────────┴────────────────────┘
```

- **Deadline markers** → all-day row at top, styled in primary purple (`#491AEB`), labeled with `bid.client_name`
- **Ad-hoc events** → timed blocks in the grid, styled in accent orange (`#FD5B0E`)
- Week navigation arrows + "Today" button in the top bar
- Team / Personal toggle (pill buttons) in top bar, right side

---

## Interactions

### Click empty time slot
Opens `EventCreateModal`:
- Single text input: event title
- Date/time pre-filled from clicked slot
- Save → `useCreateEvent()` mutation → modal closes
- Cancel → modal closes, no change

### Click deadline marker (all-day event)
Navigates to `/bids/:id` via `useNavigate`.

### Click ad-hoc event (timed block)
Opens a small inline popover with:
- Event title
- Formatted date/time
- Delete button → `useDeleteEvent()` mutation

No drag-to-reschedule in v1.

### Team / Personal toggle
- **Team:** all active bids + all `bid_events`
- **Personal:** bids where `owner_id = currentUser.id` + `bid_events` where `created_by = currentUser.id`

---

## Theming

Import `react-big-calendar/lib/css/react-big-calendar.css` then override `.rbc-*` classes in a scoped block at the top of `calendar.tsx` (or a dedicated CSS block in `styles.css`). Key overrides:

- Font sizes → `text-[11px]` / `text-[12px]`
- Border color → `var(--border)`
- Today column highlight → `var(--primary)` at low opacity
- Event background → per-type (purple for deadlines, orange for ad-hoc)
- Toolbar hidden (we build our own top bar)

---

## iCal / Google Calendar Export

Skipped in v1.

---

## What's Not In V1

- Drag-to-reschedule events
- Edit existing ad-hoc events (delete + re-create instead)
- `orals_date`, `clarification_deadline`, `bid_deliverables.due_date` as calendar items
- `bid_id` on events
- iCal / Google Calendar sync
