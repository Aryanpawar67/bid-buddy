# Settings — User Management & RBAC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the user approval flow, RBAC permission matrix, member list, and bid assignments in the Settings Team tab.

**Spec:** `docs/superpowers/specs/2026-06-08-settings-milestone3-design.md`

**Tech Stack:** React 19, TanStack Query, TanStack Router, TailwindCSS v4, shadcn/ui, Supabase (Postgres + RLS)

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260608180000_settings_rbac.sql` | New — all schema additions |
| `src/routes/pending.tsx` | New — pending approval screen |
| `src/routes/_app.tsx` | Modify — add `profile.status` guard |
| `src/lib/settings-queries.ts` | New — all settings hooks |
| `src/components/settings/PermissionMatrix.tsx` | New |
| `src/components/settings/MemberList.tsx` | New |
| `src/components/settings/BidAssignModal.tsx` | New |
| `src/components/settings/TeamTab.tsx` | New |
| `src/routes/_app/settings.tsx` | Modify — replace placeholder with tabbed layout |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260608180000_settings_rbac.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 1. profiles.status
alter table public.profiles
  add column if not exists status text not null default 'pending'
  check (status in ('pending', 'active', 'suspended'));

-- Backfill all existing profiles to 'active'
update public.profiles set status = 'active' where status = 'pending';

-- 2. role_permissions
create table if not exists public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('pre_sales', 'legal', 'finance')),
  resource_type text not null check (resource_type in ('page', 'feature')),
  resource_key  text not null,
  allowed       boolean not null default true,
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz default now(),
  unique (role, resource_key)
);

alter table public.role_permissions enable row level security;
create policy "admins_all_role_permissions" on public.role_permissions
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );
create policy "users_read_own_role_permissions" on public.role_permissions
  for select using (
    role = (select r.role from public.user_roles r where r.user_id = auth.uid() limit 1)
  );

-- Seed defaults
insert into public.role_permissions (role, resource_type, resource_key, allowed) values
  ('pre_sales','page','page:dashboard',true),
  ('pre_sales','page','page:pipeline',true),
  ('pre_sales','page','page:queue',true),
  ('pre_sales','page','page:analytics',true),
  ('pre_sales','page','page:ai',true),
  ('pre_sales','page','page:docs',true),
  ('pre_sales','page','page:calendar',true),
  ('pre_sales','page','page:notifications',true),
  ('pre_sales','feature','feature:docs:upload',true),
  ('pre_sales','feature','feature:docs:delete',true),
  ('pre_sales','feature','feature:docs:reindex',true),
  ('pre_sales','feature','feature:bids:create',true),
  ('pre_sales','feature','feature:bids:delete',false),
  ('pre_sales','feature','feature:analytics:export',true),
  ('pre_sales','feature','feature:ai:model-select',true),
  ('legal','page','page:dashboard',true),
  ('legal','page','page:pipeline',true),
  ('legal','page','page:queue',true),
  ('legal','page','page:analytics',false),
  ('legal','page','page:ai',false),
  ('legal','page','page:docs',true),
  ('legal','page','page:calendar',true),
  ('legal','page','page:notifications',true),
  ('legal','feature','feature:docs:upload',false),
  ('legal','feature','feature:docs:delete',false),
  ('legal','feature','feature:docs:reindex',false),
  ('legal','feature','feature:bids:create',false),
  ('legal','feature','feature:bids:delete',false),
  ('legal','feature','feature:analytics:export',false),
  ('legal','feature','feature:ai:model-select',false),
  ('finance','page','page:dashboard',true),
  ('finance','page','page:pipeline',true),
  ('finance','page','page:queue',true),
  ('finance','page','page:analytics',true),
  ('finance','page','page:ai',false),
  ('finance','page','page:docs',false),
  ('finance','page','page:calendar',true),
  ('finance','page','page:notifications',true),
  ('finance','feature','feature:docs:upload',false),
  ('finance','feature','feature:docs:delete',false),
  ('finance','feature','feature:docs:reindex',false),
  ('finance','feature','feature:bids:create',false),
  ('finance','feature','feature:bids:delete',false),
  ('finance','feature','feature:analytics:export',true),
  ('finance','feature','feature:ai:model-select',false)
on conflict (role, resource_key) do nothing;

-- 3. bid_assignments
create table if not exists public.bid_assignments (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid not null references public.bids(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz default now(),
  unique (bid_id, user_id)
);

alter table public.bid_assignments enable row level security;
create policy "admins_manage_bid_assignments" on public.bid_assignments
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );
create policy "users_read_bid_assignments" on public.bid_assignments
  for select using (auth.uid() is not null);

-- 4. org_settings
create table if not exists public.org_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);

alter table public.org_settings enable row level security;
create policy "admins_all_org_settings" on public.org_settings
  for all using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

insert into public.org_settings (key, value) values
  ('hubspot_token',       '{"token": null}'),
  ('hubspot_stage_map',   '{"mappings": []}'),
  ('hubspot_last_synced', '{"at": null, "created": 0, "updated": 0, "errors": 0}')
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply migration in Supabase SQL Editor**

Paste the migration file contents into the Supabase SQL Editor and run it. Confirm no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260608180000_settings_rbac.sql
git commit -m "feat: settings RBAC migration — profiles.status, role_permissions, bid_assignments, org_settings"
```

---

## Task 2: Pending User Screen + Layout Guard

**Files:**
- Create: `src/routes/pending.tsx`
- Modify: `src/routes/_app.tsx`

- [ ] **Step 1: Create `/pending` route**

```tsx
// src/routes/pending.tsx
import { createFileRoute, useSearch } from "@tanstack/react-router";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});

function PendingPage() {
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm text-center flex flex-col items-center gap-4 px-6">
        <div className="w-12 h-12 rounded-full bg-[#ede9fd] flex items-center justify-center text-2xl">⏳</div>
        <h1 className="text-[16px] font-semibold">Awaiting Approval</h1>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Your account has been created and is pending admin approval. You'll be able to access BidCompass once an admin reviews and activates your account.
        </p>
        <p className="text-[11px] text-muted-foreground">If you believe this is an error, contact your administrator.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add status guard to `_app.tsx` layout**

In `src/routes/_app.tsx`, after the auth check and profile load, add:

```tsx
// After existing auth guard — add profile status check
const { profile, loading } = useCurrentUser();

if (!loading && profile?.status === 'pending') {
  return <Navigate to="/pending" />;
}
if (!loading && profile?.status === 'suspended') {
  return <Navigate to="/pending" />;
}
```

Import `Navigate` from `@tanstack/react-router`.

- [ ] **Step 3: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/pending.tsx src/routes/_app.tsx
git commit -m "feat: pending user approval screen + layout status guard"
```

---

## Task 3: settings-queries.ts

**Files:**
- Create: `src/lib/settings-queries.ts`

- [ ] **Step 1: Create the hooks file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/auth";

export type RolePermission = {
  id: string;
  role: "pre_sales" | "legal" | "finance";
  resource_type: "page" | "feature";
  resource_key: string;
  allowed: boolean;
};

export type TeamMember = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  status: "pending" | "active" | "suspended";
  primaryRole: AppRole;
};

export type BidAssignment = {
  id: string;
  bid_id: string;
  user_id: string;
  assigned_by: string | null;
  assigned_at: string;
};

// ── useRolePermissions ────────────────────────────────────────────────────────
export function useRolePermissions() {
  return useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("*")
        .order("role")
        .order("resource_key");
      if (error) throw error;
      return (data ?? []) as RolePermission[];
    },
  });
}

// ── useUpdateRolePermissions ──────────────────────────────────────────────────
export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: string; allowed: boolean }[]) => {
      for (const u of updates) {
        const { error } = await supabase
          .from("role_permissions")
          .update({ allowed: u.allowed, updated_at: new Date().toISOString() })
          .eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });
}

// ── useTeamMembers ────────────────────────────────────────────────────────────
export function useTeamMembers() {
  return useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, status")
        .in("status", ["active", "suspended"])
        .order("full_name");
      if (error) throw error;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");

      return (profiles ?? []).map((p) => {
        const userRoles = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole);
        const primaryRole: AppRole =
          userRoles.includes("admin") ? "admin"
          : userRoles.includes("pre_sales") ? "pre_sales"
          : userRoles.includes("legal") ? "legal"
          : userRoles.includes("finance") ? "finance"
          : "pre_sales";
        return { ...p, primaryRole } as TeamMember;
      });
    },
  });
}

// ── useUpdateMemberRole ───────────────────────────────────────────────────────
export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });
}

// ── useApproveUser ────────────────────────────────────────────────────────────
export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error: statusErr } = await supabase
        .from("profiles")
        .update({ status: "active" })
        .eq("id", userId);
      if (statusErr) throw statusErr;
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (roleErr) throw roleErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── useSuspendUser ────────────────────────────────────────────────────────────
export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase
        .from("profiles")
        .update({ status: "suspended" })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });
}

// ── useBidAssignments ─────────────────────────────────────────────────────────
export function useBidAssignments(userId?: string) {
  return useQuery({
    queryKey: ["bid-assignments", userId],
    enabled: true,
    queryFn: async () => {
      let q = supabase.from("bid_assignments").select("*, bids(id, client_name, stage)");
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── useAssignBid ──────────────────────────────────────────────────────────────
export function useAssignBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bidId, userId, assignedBy }: { bidId: string; userId: string; assignedBy: string }) => {
      const { error } = await supabase
        .from("bid_assignments")
        .insert({ bid_id: bidId, user_id: userId, assigned_by: assignedBy });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bid-assignments"] }),
  });
}

// ── useRemoveBidAssignment ────────────────────────────────────────────────────
export function useRemoveBidAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.from("bid_assignments").delete().eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bid-assignments"] }),
  });
}

// ── useHasFeaturePermission ───────────────────────────────────────────────────
// Client-side permission check — reads from cached role_permissions
export function useHasPermission(resourceKey: string): boolean {
  // Imported inline to avoid circular deps
  const { primaryRole, isAdmin } = (() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useCurrentUser } = require("@/lib/auth");
    return useCurrentUser();
  })();
  const { data: perms = [] } = useRolePermissions();
  if (isAdmin) return true;
  const match = perms.find((p) => p.role === primaryRole && p.resource_key === resourceKey);
  return match?.allowed ?? false;
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-queries.ts
git commit -m "feat: settings-queries — RBAC, team member, bid assignment hooks"
```

---

## Task 4: PermissionMatrix Component

**Files:**
- Create: `src/components/settings/PermissionMatrix.tsx`

- [ ] **Step 1: Create the component**

The component renders a grid: rows are resource keys (grouped by Pages / Features), columns are roles (`pre_sales`, `legal`, `finance`). Each cell is a toggle switch. A "Save Changes" button at the bottom triggers `useUpdateRolePermissions` with all dirty cells.

Props: `{ permissions: RolePermission[] }`

The component tracks local dirty state (`Map<id, boolean>`). "Save Changes" is disabled when no dirty cells exist, shows a spinner while saving.

Use the project's dense UI conventions: `text-[10px]` headers, `text-[11px]` labels, `hairline border-border` borders, `bg-card` background.

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/PermissionMatrix.tsx
git commit -m "feat: PermissionMatrix — role × resource permission grid with dirty-state save"
```

---

## Task 5: BidAssignModal + MemberList Components

**Files:**
- Create: `src/components/settings/BidAssignModal.tsx`
- Create: `src/components/settings/MemberList.tsx`

- [ ] **Step 1: Create BidAssignModal**

A Radix `Dialog` modal with a searchable list of active bids not yet assigned to the target user. Shows bid `client_name` + `stage` badge. Click a bid to assign it (calls `useAssignBid`) and closes.

Props: `{ open: boolean; onClose: () => void; userId: string; assignedBidIds: string[] }`

- [ ] **Step 2: Create MemberList**

A table component:
- Admin view: Avatar + Name | Email | Role dropdown (`useUpdateMemberRole`) | Assigned Bids pills (× to remove, + Add Bid opens BidAssignModal) | Suspend button
- Non-admin view: Avatar + Name | Role | Assigned Bids (read-only pills)

Props: `{ members: TeamMember[]; isAdmin: boolean }`

- [ ] **Step 3: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/BidAssignModal.tsx src/components/settings/MemberList.tsx
git commit -m "feat: BidAssignModal + MemberList — team management with bid assignments"
```

---

## Task 6: TeamTab + Settings Page

**Files:**
- Create: `src/components/settings/TeamTab.tsx`
- Modify: `src/routes/_app/settings.tsx`

- [ ] **Step 1: Create TeamTab**

Composes `PermissionMatrix` (admin only, above member list) and `MemberList`. Loads data via `useTeamMembers()`, `useRolePermissions()`, `useBidAssignments()`.

Props: `{ isAdmin: boolean }`

- [ ] **Step 2: Replace settings.tsx**

Replace the placeholder with a tabbed layout:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { TeamTab } from "@/components/settings/TeamTab";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { isAdmin } = useCurrentUser();
  const [tab, setTab] = useState<"team" | "integrations">("team");

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b hairline border-border bg-card shrink-0">
        {(["team", "integrations"] as const)
          .filter((t) => t === "team" || isAdmin)
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "text-[11px] px-4 py-1.5 rounded-md border hairline transition-colors capitalize",
                tab === t
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {t === "team" ? "Team" : "Integrations"}
            </button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "team" && <TeamTab isAdmin={isAdmin} />}
        {tab === "integrations" && isAdmin && <IntegrationsTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/TeamTab.tsx src/routes/_app/settings.tsx
git commit -m "feat: Settings page — tabbed Team + Integrations layout"
```

---

## Task 7: Smoke Test

- [ ] Start dev server: `bun start`
- [ ] Sign up a new user → confirm landing on `/pending` screen
- [ ] As admin, open Notifications → confirm approval notification appears → approve user with role
- [ ] Confirmed approved user can log in and access the app
- [ ] Open Settings > Team → confirm permission matrix renders for admin, read-only list for non-admin
- [ ] Toggle a permission, save → confirm change persisted (reload and check)
- [ ] Assign a bid to a pre_sales member → confirm pill appears → remove it
- [ ] Suspend a member → confirm they see `/pending` on next login
