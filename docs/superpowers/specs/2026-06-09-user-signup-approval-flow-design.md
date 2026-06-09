# User Signup & Admin Approval Flow — Design Spec

**Goal:** Complete the end-to-end new user onboarding flow: role selection on signup, admin notification on new signup, pending approvals UI in Settings > Team, and one-click approval/rejection.

---

## Current State (Broken)

| Step | Status | Issue |
|------|--------|-------|
| User signs up at `/auth` | ✅ | Works |
| DB trigger creates profile (status=`pending`) + user_roles (role=`pre_sales`) | ✅ | Works |
| User lands on `/pending` screen | ✅ | Works |
| Admin gets notified of new signup | ❌ | No trigger inserts notification row |
| Admin sees pending users in Settings | ❌ | Team tab filters out `pending` status |
| Admin approves user | ❌ | `useApproveUser()` exists but no UI calls it |

---

## What Was Added (Phase 0 — Done)

- **Role dropdown on signup form** (`pre_sales`, `legal`, `finance`) — user selects intended role
- After `supabase.auth.signUp()`, client immediately updates `user_roles.role` to the selected value
- Admin accounts created directly (not via signup)

---

## Phase 1: Admin Notification on Signup

### Supabase Migration: `20260609120000_signup_notification.sql`

Add a trigger on `profiles` INSERT that notifies all admin users:

```sql
CREATE OR REPLACE FUNCTION public.notify_admins_new_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only fire when a brand-new pending profile is created
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, bid_id, type, title, body)
  SELECT ur.user_id, NULL, 'new_user_signup',
    'New signup: ' || COALESCE(NEW.full_name, NEW.email),
    COALESCE(NEW.full_name, NEW.email) || ' (' || NEW.email || ') is requesting access.'
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_notify_admins
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_signup();
```

### Notifications table
- `bid_id` must be nullable (already is per `20260605120000_notifications.sql`)
- New type value: `'new_user_signup'` — no schema change needed (type is `text`)

---

## Phase 2: Pending Approvals in Settings > Team

### Settings > Team Tab — new "Pending Approvals" section

Above the active member list, show a card:

```
┌─────────────────────────────────────────────────────┐
│ Pending Approvals  (2)                              │
├──────────────────────────┬──────────────┬───────────┤
│ Name / Email             │ Requested    │ Actions   │
├──────────────────────────┼──────────────┼───────────┤
│ Jane Doe                 │ Pre-Sales    │ [Approve] │
│ jane@acme.io             │              │ [Reject]  │
│ Ravi Kumar               │ Legal        │ [Approve] │
│ ravi@corp.com            │              │ [Reject]  │
└──────────────────────────┴──────────────┴───────────┘
```

- Role shown is the one stored in `user_roles` (set by signup form)
- "Approve" calls `useApproveUser({ userId, role })` — sets `profiles.status = 'active'`
- "Reject" calls `useRejectUser(userId)` — deletes the auth user + profile row (via service role server fn)

### Hook: `usePendingMembers()`
Already exists in `settings-queries.ts` — never called. Wire it up in `TeamTab`.

### Hook: `useApproveUser()`
Already exists in `settings-queries.ts` — never called. Wire it up in approval button.

### New hook: `useRejectUser()`
Calls a new server function `rejectUserFn` (needs service role to delete from `auth.users`).

---

## Phase 3: Notifications Panel — Signup Notification Card

In `/notifications`, render `new_user_signup` type notifications with:
- Icon: user-plus
- Body: "Name (email) is requesting access"
- CTA: "Review in Settings →" link to `/settings`
- Mark as read on click

---

## Phase 4: Real-time Badge for Pending Count (Admin only)

In `Sidebar.tsx`, add a badge on the Settings nav item showing pending user count (admin only):

```tsx
{isAdmin && pendingCount > 0 && (
  <span className="badge-accent">{pendingCount}</span>
)}
```

Query: `useQuery` on `profiles` filtered by `status = 'pending'`, count only.

---

## Data Flow Summary

```
User fills signup form (name, email, password, role)
  → supabase.auth.signUp() → auth.users row created
  → on_auth_user_created trigger → profiles (status=pending) + user_roles (role=pre_sales)
  → client updates user_roles.role to selected role
  → on_profile_created_notify_admins trigger → notifications rows for all admins
  → User sees /pending screen

Admin logs in
  → Bell icon shows unread count (new_user_signup notification)
  → Notifications panel shows signup card with "Review in Settings" CTA
  → Settings > Team > Pending Approvals shows pending user + requested role
  → Admin clicks Approve → profiles.status = 'active'
  → User refreshes → _app.tsx guard passes → redirected to /dashboard
```

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `supabase/migrations/20260609120000_signup_notification.sql` | New — notify_admins_new_signup trigger |
| `src/routes/auth.tsx` | Done — role dropdown + update user_roles after signup |
| `src/lib/settings-queries.ts` | Add `useRejectUser()` hook |
| `src/lib/api/reject-user.ts` | New server fn — delete auth user via service role |
| `src/components/settings/PendingApprovals.tsx` | New — pending user card list |
| `src/components/settings/TeamTab.tsx` | Modify — add PendingApprovals above MemberList |
| `src/lib/notification-queries.ts` | Modify — render new_user_signup type in notifications list |
| `src/components/app/Sidebar.tsx` | Modify — pending badge on Settings nav item (admin only) |
