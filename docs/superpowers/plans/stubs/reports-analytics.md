# Reports & Analytics — Stub Plan
_Status: PENDING — requires design session before implementation_
_Created: 2026-06-05_
_Current route: `/analytics` (placeholder)_

## Goal
Full analytics dashboard showing pipeline health, win rates, cycle times, team performance, and revenue trends over time.

## Proposed Charts (from existing dashboard + mockup)
1. **Win Rate Trend** — monthly win % over rolling 6 months (requires `closed_at` timestamp on bids)
2. **Stage Distribution** — donut of active bids by stage (already partially done on dashboard)
3. **Pipeline Value by Stage** — stacked bar
4. **Cycle Time by Stage** — avg days per stage (requires stage transition log)
5. **Won vs Lost Value** — monthly grouped bar (exists in current dashboard analytics section)
6. **Monthly Intake** — new bids per month (exists in current dashboard analytics section)
7. **Team Performance** — win rate / value by owner (requires profiles join)

## Backend Requirements
- **`closed_at` column on `bids`** — needed for win rate trend (currently using `updated_at` as proxy, unreliable)
- **Stage transition log** — new table to track when a bid moves between stages (for cycle time)
- **Supabase RPC or views** — for aggregated queries (avoid N+1 on the client)

## Proposed New Tables / Columns
```sql
-- Add to bids table:
closed_at timestamptz nullable

-- New table:
bid_stage_transitions (
  id uuid pk,
  bid_id uuid fk bids,
  from_stage text,
  to_stage text,
  transitioned_at timestamptz,
  transitioned_by uuid fk profiles
)
```

## Key Questions Before Building
1. Historical data: do we backfill `closed_at` / stage transitions or start fresh?
2. Date range filter on analytics page (last 30d / 90d / 12m)?
3. Export to CSV/PDF?
4. Per-user vs team-wide analytics?

## Rough Effort
~4–5 days: new schema columns, RPC functions, chart components (recharts already installed).

## Dependencies
- `closed_at` migration on `bids`
- Stage transition log (triggered via `useUpdateBid` mutation)
