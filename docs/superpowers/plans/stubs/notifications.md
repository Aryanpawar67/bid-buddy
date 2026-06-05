# Notifications — Stub Plan
_Status: PENDING — requires design session before implementation_
_Created: 2026-06-05_
_Current route: `/notifications` (placeholder, to be created in shell redesign)_
_Note: `bid_activity_log` already exists and will power the right-rail preview in the shell redesign._

## Goal
A full notifications center showing activity alerts, deadline reminders, approval requests, and system events. Right-rail preview (4 items) ships in the shell redesign; this plan covers the full `/notifications` page and real-time delivery.

## Proposed Features
- Full notification list with infinite scroll or pagination
- Filter by: all / unread / mentions / approvals / deadlines
- Mark as read / mark all read
- Real-time delivery (Supabase Realtime subscription)
- Badge count in sidebar reflects unread count
- Notification types: stage change, deadline approaching, BAFO approval needed, document uploaded, comment/mention

## Current State
`bid_activity_log` table already exists:
```
id, bid_id, user_id, action (text), metadata (jsonb), created_at
```
This powers the shell redesign right rail (4 most recent entries).

## What's Missing for Full Notifications
1. **`notifications` table** — per-user notification records with `read` status (activity log is org-wide, not user-targeted)
2. **Notification triggers** — Supabase Database Webhooks or Postgres triggers to create notification rows when key events happen (stage change, deadline < 3 days, etc.)
3. **Realtime subscription** — Supabase channel subscription to `notifications` table filtered by `user_id`
4. **Unread badge count** — `useNotificationCount()` hook for sidebar badge

## Proposed New Tables
```sql
notifications (
  id uuid pk,
  user_id uuid fk profiles,
  bid_id uuid fk bids nullable,
  type text,  -- 'deadline' | 'stage_change' | 'approval_needed' | 'activity' | 'mention'
  title text,
  body text,
  read boolean default false,
  created_at timestamptz
)
```

## Key Questions Before Building
1. Who decides which users get notified for which events? (e.g., only the bid owner, or all pre_sales?)
2. Email notifications in addition to in-app?
3. Notification preferences / mute settings per bid or globally?
4. How long to retain read notifications?

## Rough Effort
~4–5 days: new table + triggers, realtime hook, full notifications page, unread badge wiring.

## Dependencies
- Supabase Realtime enabled (already default on hosted Supabase)
- Notification trigger logic (Supabase Database Webhooks or Postgres `AFTER INSERT` triggers on `bids` stage changes)
