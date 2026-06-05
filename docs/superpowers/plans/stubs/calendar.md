# Calendar — Stub Plan
_Status: PENDING — requires design session before implementation_
_Created: 2026-06-05_
_Current route: `/calendar` (placeholder, to be created in shell redesign)_

## Goal
A calendar view showing all bid-related deadlines, key dates (orals, BAFO, clarification deadlines), and team tasks in a monthly/weekly/agenda view.

## Proposed Features
- Month view with bid deadline markers
- Week view with day-level detail
- Agenda/list view (simplified, mobile-friendly)
- Click event → opens bid or task detail
- Filter by: all / my bids / my tasks / by stage
- Show: bid deadline, orals_date, clarification_deadline (all already on `bids` table)

## Backend Requirements
- **No new tables required for phase 1** — all date data already exists on `bids` (`deadline`, `orals_date`, `clarification_deadline`) and `bid_deliverables` (`due_date`)
- **Optional phase 2:** `bid_events` table for ad-hoc calendar events (e.g. internal review meetings)

## Proposed New Tables (phase 2 only)
```sql
bid_events (
  id uuid pk,
  bid_id uuid fk bids nullable,
  title text,
  event_date timestamptz,
  event_type text,  -- 'meeting' | 'review' | 'submission' | 'custom'
  created_by uuid fk profiles,
  created_at timestamptz
)
```

## Calendar Library Options
- **`react-big-calendar`** — full-featured, complex
- **`@fullcalendar/react`** — most feature-rich, paid for some features
- **Custom grid** — simple month grid built with Tailwind, sufficient for phase 1

## Key Questions Before Building
1. Month / week / agenda — which views are required for v1?
2. iCal export / Google Calendar sync?
3. Ad-hoc event creation (phase 1 or 2)?
4. Team calendar (all bids) vs personal calendar (my bids + tasks)?

## Rough Effort
- Phase 1 (deadline markers, no new tables): ~2–3 days
- Phase 2 (custom events, external sync): ~3–5 days additional

## Dependencies
- None for phase 1 (all data already in `bids` and `bid_deliverables`)
