# User Signup & Admin Approval Flow — Implementation Plan

**Goal:** Complete the broken new-user onboarding: DB trigger notifies admins on signup, Settings > Team shows pending approvals with one-click approve/reject, notifications panel surfaces signup alerts, sidebar shows pending badge for admins.

**Spec:** `docs/superpowers/specs/2026-06-09-user-signup-approval-flow-design.md`

**Tech Stack:** React 19, TanStack Query, TanStack Router, TailwindCSS v4, shadcn/ui, Supabase (Postgres + RLS), Bun

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260609120000_signup_notification.sql` | New |
| `src/lib/api/reject-user.ts` | New server fn |
| `src/lib/settings-queries.ts` | Add `useRejectUser()`, `usePendingMembers()` already exists |
| `src/components/settings/PendingApprovals.tsx` | New component |
| `src/components/settings/TeamTab.tsx` | Modify — add PendingApprovals section |
| `src/lib/notification-queries.ts` | Modify — handle `new_user_signup` type |
| `src/components/app/Sidebar.tsx` | Modify — pending badge on Settings nav |

---

## Task 1: DB Migration — Admin Signup Notification Trigger

**File:** `supabase/migrations/20260609120000_signup_notification.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Notify all admin users when a new profile is created with status='pending'
CREATE OR REPLACE FUNCTION public.notify_admins_new_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, bid_id, type, title, body)
  SELECT ur.user_id,
         NULL,
         'new_user_signup',
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

- [ ] **Step 2: Apply in Supabase SQL Editor** — paste and run, confirm no errors

- [ ] **Step 3: Verify** — sign up a test user, check `notifications` table has rows for admin user_ids with type=`new_user_signup`

- [ ] **Step 4: Commit**
```bash
git add supabase/migrations/20260609120000_signup_notification.sql
git commit -m "feat: trigger notify_admins_new_signup on profiles insert"
```

---

## Task 2: Reject User Server Function

**File:** `src/lib/api/reject-user.ts`

- [ ] **Step 1: Create server fn**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const rejectUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const token = getRequest().headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    // Verify caller is admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = roles?.some((r) => r.role === "admin");
    if (!isAdmin) return new Response("Forbidden", { status: 403 });

    // Delete profile first (FK), then auth user
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
    await supabaseAdmin.auth.admin.deleteUser(data.userId);

    return { ok: true };
  });
```

- [ ] **Step 2: Verify build**
```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```bash
git add src/lib/api/reject-user.ts
git commit -m "feat: rejectUserFn server fn — admin deletes pending user"
```

---

## Task 3: useRejectUser Hook

**File:** `src/lib/settings-queries.ts`

- [ ] **Step 1: Add hook** — append to existing file:

```ts
import { rejectUserFn } from "@/lib/api/reject-user";

export function useRejectUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await rejectUserFn({ data: { userId } });
      if (res instanceof Response && !res.ok) throw new Error("Reject failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-members"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
```

- [ ] **Step 2: Commit**
```bash
git add src/lib/settings-queries.ts
git commit -m "feat: useRejectUser mutation hook"
```

---

## Task 4: PendingApprovals Component

**File:** `src/components/settings/PendingApprovals.tsx`

- [ ] **Step 1: Create component**

Shows a card section only visible to admins. Uses `usePendingMembers()`, `useApproveUser()`, `useRejectUser()`.

Layout per row:
- Avatar initials circle (orange, `bg-accent`) + Name + Email (muted, small)
- Requested role pill (e.g. "Pre-Sales") in purple
- [Approve] button — calls `useApproveUser({ userId, role })`, green/success style
- [Reject] button — calls `useRejectUser(userId)`, destructive/ghost style, shows confirm popover

Empty state: "No pending approvals" in muted text — hide section entirely when count is 0.

Loading state: skeleton rows.

- [ ] **Step 2: Verify build**
```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```bash
git add src/components/settings/PendingApprovals.tsx
git commit -m "feat: PendingApprovals component — approve/reject pending users"
```

---

## Task 5: Wire PendingApprovals into TeamTab

**File:** `src/components/settings/TeamTab.tsx`

- [ ] **Step 1: Add import and render** — at the top of the team tab content, before the active member list:

```tsx
import { PendingApprovals } from "./PendingApprovals";

// Inside TeamTab render, before MemberList:
{isAdmin && <PendingApprovals />}
```

- [ ] **Step 2: Verify build + smoke test**
  - Sign up new user → go to Settings > Team as admin → pending user appears
  - Click Approve → user disappears from pending, appears in active list
  - Sign up another → click Reject → user deleted entirely

- [ ] **Step 3: Commit**
```bash
git add src/components/settings/TeamTab.tsx
git commit -m "feat: TeamTab — PendingApprovals section wired up for admins"
```

---

## Task 6: Notifications Panel — new_user_signup Type

**File:** `src/lib/notification-queries.ts` (and notification render component)

- [ ] **Step 1: Handle new type in notification list render**

In the notifications rendering component, add a case for `type === 'new_user_signup'`:
- Icon: `UserPlus` from lucide
- Title: notification title as-is
- Body: notification body as-is
- CTA link: navigate to `/settings` on click + mark as read

- [ ] **Step 2: Commit**
```bash
git add src/lib/notification-queries.ts
git commit -m "feat: notifications — render new_user_signup type with Settings CTA"
```

---

## Task 7: Sidebar Pending Badge (Admin)

**File:** `src/components/app/Sidebar.tsx`

- [ ] **Step 1: Add pending count query** — in Sidebar, admin-only:

```tsx
const { data: pendingCount = 0 } = useQuery({
  queryKey: ["pending-members-count"],
  enabled: isAdmin,
  queryFn: async () => {
    const { count } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  },
});
```

- [ ] **Step 2: Pass badge to Settings NavLink**

```tsx
{isAdmin && (
  <NavLink
    to="/settings"
    icon={Settings}
    label="Settings"
    active={path.startsWith("/settings")}
    badge={pendingCount > 0 ? pendingCount : undefined}
    badgeVariant="accent"
  />
)}
```

- [ ] **Step 3: Verify build**

- [ ] **Step 4: Commit**
```bash
git add src/components/app/Sidebar.tsx
git commit -m "feat: sidebar pending count badge on Settings nav (admin only)"
```

---

## Task 8: End-to-End Smoke Test

- [ ] Sign up new user with role "Legal" → lands on `/pending`
- [ ] Admin logs in → bell badge incremented → notification shows "New signup: …"
- [ ] Admin opens Settings → badge on Settings nav shows count
- [ ] Settings > Team → Pending Approvals section shows user with "Legal" pill
- [ ] Click Approve → user moves to active list, notification marked read
- [ ] Approved user refreshes → redirected to `/queue` (legal default landing)
- [ ] Sign up another user → Reject → user deleted, cannot log in
- [ ] Pending badge disappears when no pending users remain
