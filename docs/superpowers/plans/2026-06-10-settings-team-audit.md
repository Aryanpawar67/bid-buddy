# Settings → Team Audit: Bug Fixes + Admin CRUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 409 approval bug, restore all broken permission-matrix writes, and give admins full CRUD over team members (create with password, change password, delete) in Settings → Team.

**Architecture:** Three layers of fixes: (1) a new SQL migration that adds the missing table-level GRANTs so Supabase RLS policies can actually execute writes; (2) logic fixes in `settings-queries.ts` and `auth.tsx` that currently conflict with the DB trigger; (3) new server functions + UI components for admin user management, following the pattern already established by `reject-user.ts`.

**Tech Stack:** TanStack Start (SSR), React 19, Supabase (Postgres + Auth admin API), TanStack Query, Zod, shadcn/ui, Tailwind v4, Bun

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `supabase/migrations/20260610100000_fix_settings_grants.sql` | Missing GRANT statements for user_roles, role_permissions, bid_assignments |
| **Create** | `src/lib/api/admin-user.ts` | Server functions: createUserFn, changePasswordFn, deleteUserFn |
| **Create** | `src/components/settings/CreateUserModal.tsx` | Modal: email, name, role, password fields |
| **Create** | `src/components/settings/ChangePasswordModal.tsx` | Modal: new password field |
| **Modify** | `src/lib/settings-queries.ts` | Fix useApproveUser; add useCreateUser, useChangePassword, useDeleteUser |
| **Modify** | `src/components/settings/MemberList.tsx` | Add Delete + Change Password to admin row actions |
| **Modify** | `src/components/settings/TeamTab.tsx` | Add "Add User" button wired to CreateUserModal |
| **Modify** | `src/routes/auth.tsx` | Remove broken user_roles `.update()` call on signup |

---

## Task 1: Migration — Fix Missing Table GRANTs

**Background:** The initial migration only grants `SELECT` on `user_roles` to `authenticated`. The `settings_rbac` migration that added `role_permissions` and `bid_assignments` has no GRANTs at all. In Postgres, RLS policies only control row-level visibility — they cannot override table-level privilege denials. So even though the "Admins can manage roles" RLS policy exists, the `INSERT`/`DELETE` operations silently fail or return 403 because `authenticated` lacks the table privilege.

**Files:**
- Create: `supabase/migrations/20260610100000_fix_settings_grants.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260610100000_fix_settings_grants.sql

-- user_roles: authenticated only had SELECT; admins need INSERT + DELETE
-- (UPDATE not needed — role changes use delete-then-insert pattern)
GRANT INSERT, DELETE ON public.user_roles TO authenticated;

-- role_permissions: no grants existed at all
-- All authenticated users need SELECT (filtered by RLS to own role)
-- Admins need UPDATE for the permission matrix
GRANT SELECT, UPDATE ON public.role_permissions TO authenticated;

-- bid_assignments: no grants existed at all
-- Admins need INSERT + DELETE; all users need SELECT (RLS already filters)
GRANT SELECT, INSERT, DELETE ON public.bid_assignments TO authenticated;
```

- [ ] **Step 2: Apply the migration**

In Supabase dashboard → SQL Editor, paste and run the file contents.

OR if you have the Supabase CLI linked:
```bash
supabase db push
```

- [ ] **Step 3: Verify in Supabase Table Editor**

Open `user_roles` → Policies tab. Confirm no errors appear when testing an admin user operation. No build step needed for SQL-only changes.

---

## Task 2: Fix `useApproveUser` — 409 Conflict on Approval

**Background:** The `handle_new_user` DB trigger (first migration, line 82) auto-inserts `(user_id, 'pre_sales')` into `user_roles` the moment any user signs up. The current `useApproveUser` then tries to `INSERT` again → hits `UNIQUE (user_id, role)` → 409. Fix: delete the trigger-inserted row first, then insert the admin-chosen role (same pattern as the existing `useUpdateMemberRole`).

**Files:**
- Modify: `src/lib/settings-queries.ts:130-150`

- [ ] **Step 1: Replace the insert-only logic with delete-then-insert**

Find `useApproveUser` (around line 130). Replace the `mutationFn` body:

```ts
// settings-queries.ts — useApproveUser
mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
  const { error: statusErr } = await (supabase as any)
    .from("profiles")
    .update({ status: "active" })
    .eq("id", userId);
  if (statusErr) throw statusErr;

  // Delete the trigger-inserted default role before inserting the chosen one
  await supabase.from("user_roles").delete().eq("user_id", userId);
  const { error: roleErr } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role });
  if (roleErr) throw roleErr;
},
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

Expected: no TypeScript errors related to settings-queries.ts.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-queries.ts
git commit -m "fix: delete trigger-inserted role before inserting chosen role on approval (fixes 409)"
```

---

## Task 3: Fix Auth Signup — Remove Broken `user_roles` Update

**Background:** `auth.tsx` calls `.update({ role })` on `user_roles` after signup. This silently no-ops because: (a) authenticated users' RLS blocks writes to other users' rows, (b) even for own row, only admins have write permission per RLS policy. The signup role dropdown value is never persisted. Since approval is where the admin assigns the real role, the safest fix is to remove the dead code entirely. The signup form can keep the role selector as a UI hint ("Admins can change roles in Settings" footnote already exists).

**Files:**
- Modify: `src/routes/auth.tsx:62-76`

- [ ] **Step 1: Remove the dead user_roles update from signup**

Find the `signup` branch in the `submit` function (around line 63). Replace:

```ts
// BEFORE (broken — update silently no-ops due to RLS)
if (mode === "signup") {
  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: { full_name: name },
    },
  });
  if (error) throw error;
  if (signUpData.user) {
    await supabase.from("user_roles")
      .update({ role } as never)
      .eq("user_id", signUpData.user.id);
  }
}
```

```ts
// AFTER — clean: signup just creates the auth user; profile + pending role are
// handled by the handle_new_user trigger; admin assigns real role on approval
if (mode === "signup") {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: { full_name: name },
    },
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

Expected: clean build, no unused variable warnings.

- [ ] **Step 3: Commit**

```bash
git add src/routes/auth.tsx
git commit -m "fix: remove dead user_roles update on signup (RLS blocked it silently)"
```

---

## Task 4: Server Functions — Admin User Management

**Background:** Creating users and resetting passwords requires `supabaseAdmin` (service-role key), which must only run on the server. Follow the pattern from `src/lib/api/reject-user.ts`: `createServerFn` with Zod validation, admin-role check, then `supabaseAdmin.auth.admin.*`.

**Files:**
- Create: `src/lib/api/admin-user.ts`

- [ ] **Step 1: Create the server functions file**

```ts
// src/lib/api/admin-user.ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(authHeader: string | null) {
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return new Response("Unauthorized", { status: 401 });
  const { data: roles } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", user.id);
  if (!roles?.some((r) => r.role === "admin"))
    return new Response("Forbidden", { status: 403 });
  return null; // null = ok
}

// ── createUserFn ─────────────────────────────────────────────────────────────
export const createUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1),
    role: z.enum(["pre_sales", "legal", "finance", "admin"]),
  }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    // Create auth user (email confirmed immediately — admin-provisioned accounts)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr) throw new Error(createErr.message);

    const userId = created.user.id;

    // handle_new_user trigger fires synchronously: profile (status=pending) +
    // user_roles (pre_sales) are already inserted by the time we get here.
    // Activate immediately and assign the admin-chosen role.
    await supabaseAdmin.from("profiles" as any).update({ status: "active" }).eq("id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles").insert({ user_id: userId, role: data.role });
    if (roleErr) throw new Error(roleErr.message);

    return { ok: true, userId };
  });

// ── changePasswordFn ──────────────────────────────────────────────────────────
export const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    userId: z.string().uuid(),
    newPassword: z.string().min(8),
  }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── deleteUserFn ──────────────────────────────────────────────────────────────
export const deleteUserFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const guard = await assertAdmin(getRequest().headers.get("authorization"));
    if (guard) return guard;

    // Delete profile first (CASCADE removes user_roles, bid_assignments rows)
    await supabaseAdmin.from("profiles" as any).delete().eq("id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

Expected: no errors. If `supabaseAdmin.from("profiles")` shows a type error on the `update`, wrap with `as any` (same as the existing client code pattern).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/admin-user.ts
git commit -m "feat: add createUserFn, changePasswordFn, deleteUserFn server functions"
```

---

## Task 5: Add Mutations to `settings-queries.ts`

**Files:**
- Modify: `src/lib/settings-queries.ts` (add after `useRejectUser` at end of file)

- [ ] **Step 1: Add the three new imports and mutations**

Add to the imports at the top of `settings-queries.ts`:

```ts
import {
  createUserFn,
  changePasswordFn,
  deleteUserFn,
} from "@/lib/api/admin-user";
```

Then append these three hooks at the bottom of the file (after `useRejectUser`):

```ts
// ── useCreateUser ─────────────────────────────────────────────────────────────
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      email: string;
      password: string;
      fullName: string;
      role: AppRole;
    }) => createUserFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}

// ── useChangePassword ─────────────────────────────────────────────────────────
export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: { userId: string; newPassword: string }) =>
      changePasswordFn({ data: payload }),
  });
}

// ── useDeleteUser ─────────────────────────────────────────────────────────────
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => deleteUserFn({ data: { userId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-queries.ts
git commit -m "feat: add useCreateUser, useChangePassword, useDeleteUser mutations"
```

---

## Task 6: `CreateUserModal` Component

**Files:**
- Create: `src/components/settings/CreateUserModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/settings/CreateUserModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateUser } from "@/lib/settings-queries";
import type { AppRole } from "@/lib/auth";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "pre_sales", label: "Pre-Sales" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
  { value: "admin", label: "Admin" },
];

type Props = { open: boolean; onClose: () => void };

export function CreateUserModal({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("pre_sales");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateUser();

  function reset() {
    setEmail(""); setFullName(""); setPassword(""); setRole("pre_sales"); setErr(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({ email, password, fullName, role });
      reset();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create user");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">Create Team Member</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <Field label="Full name">
            <input
              required
              placeholder="Jane Smith"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Email address">
            <input
              type="email"
              required
              placeholder="jane@imocha.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Password (min 8 chars)">
            <input
              type="password"
              required
              minLength={8}
              placeholder="········"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          {err && (
            <div className="text-[11px] text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="h-7 px-3 rounded-md border border-border text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="h-7 px-3 rounded-md bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/CreateUserModal.tsx
git commit -m "feat: CreateUserModal — admin can provision accounts with role + password"
```

---

## Task 7: `ChangePasswordModal` Component

**Files:**
- Create: `src/components/settings/ChangePasswordModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/settings/ChangePasswordModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useChangePassword } from "@/lib/settings-queries";

type Props = { open: boolean; onClose: () => void; userId: string; userName: string };

export function ChangePasswordModal({ open, onClose, userId, userName }: Props) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const change = useChangePassword();

  function reset() { setPassword(""); setErr(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await change.mutateAsync({ userId, newPassword: password });
      reset();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update password");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            Change Password — {userName}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              New password (min 8 chars)
            </div>
            <input
              type="password"
              required
              minLength={8}
              placeholder="········"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {err && (
            <div className="text-[11px] text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="h-7 px-3 rounded-md border border-border text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={change.isPending}
              className="h-7 px-3 rounded-md bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {change.isPending ? "Saving…" : "Set Password"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ChangePasswordModal.tsx
git commit -m "feat: ChangePasswordModal — admin can reset any member's password"
```

---

## Task 8: Update `MemberList` — Delete + Change Password Actions

**Background:** Add two new admin-only actions per row: "Change Password" (opens ChangePasswordModal) and "Delete" (confirm then call useDeleteUser). Keep the existing "Suspend" button. Delete is destructive so requires a confirm dialog.

**Files:**
- Modify: `src/components/settings/MemberList.tsx`

- [ ] **Step 1: Update MemberRow to add new imports, state, and actions**

Replace the entire file content:

```tsx
// src/components/settings/MemberList.tsx
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useBidAssignments,
  useUpdateMemberRole,
  useRemoveBidAssignment,
  useSuspendUser,
  useDeleteUser,
} from "@/lib/settings-queries";
import type { TeamMember } from "@/lib/settings-queries";
import type { AppRole } from "@/lib/auth";
import { BidAssignModal } from "./BidAssignModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { initials } from "@/lib/bid-constants";

type Props = { members: TeamMember[]; isAdmin: boolean };

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "pre_sales", label: "Pre-Sales" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
];

function MemberRow({ member, isAdmin }: { member: TeamMember; isAdmin: boolean }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const updateRole = useUpdateMemberRole();
  const removeAssignment = useRemoveBidAssignment();
  const suspend = useSuspendUser();
  const deleteUser = useDeleteUser();
  const { data: assignments = [] } = useBidAssignments(member.id);

  const assignedBidIds = assignments.map((a) => a.bid_id);

  function handleDelete() {
    if (
      window.confirm(
        `Permanently delete ${member.full_name ?? member.email}? This cannot be undone.`
      )
    ) {
      deleteUser.mutate(member.id);
    }
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 border-b hairline border-border last:border-0">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5">
        {member.avatar_url ? (
          <img src={member.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
        ) : (
          initials(member.full_name ?? member.email)
        )}
      </div>

      {/* Name + Email */}
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate">{member.full_name ?? "—"}</div>
        <div className="text-[10px] text-muted-foreground truncate">{member.email}</div>

        {/* Assigned bids pills */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {assignments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 text-[10px] bg-muted px-2 py-0.5 rounded-full hairline border border-border"
            >
              {a.bids?.client_name ?? "Bid"}
              {isAdmin && (
                <button
                  onClick={() => removeAssignment.mutate(a.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                  aria-label="Remove assignment"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {isAdmin && (
            <button
              onClick={() => setAssignOpen(true)}
              className="inline-flex items-center text-[10px] text-primary hover:underline"
            >
              + Add Bid
            </button>
          )}
        </div>
      </div>

      {/* Role */}
      <div className="shrink-0 w-28">
        {isAdmin ? (
          <Select
            value={member.primaryRole}
            onValueChange={(val) =>
              updateRole.mutate({ userId: member.id, newRole: val as AppRole })
            }
          >
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[11px] text-muted-foreground capitalize">
            {member.primaryRole.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Status badge + admin actions */}
      <div className="shrink-0 flex items-center gap-2 pt-0.5">
        {member.status === "suspended" && (
          <span className="text-[9px] uppercase tracking-wider text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
            Suspended
          </span>
        )}
        {isAdmin && (
          <div className="flex items-center gap-1.5">
            {member.status !== "suspended" && (
              <button
                onClick={() => suspend.mutate(member.id)}
                disabled={suspend.isPending}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
              >
                Suspend
              </button>
            )}
            <button
              onClick={() => setPwOpen(true)}
              className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
            >
              Pwd
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteUser.isPending}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <BidAssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        userId={member.id}
        assignedBidIds={assignedBidIds}
      />

      <ChangePasswordModal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        userId={member.id}
        userName={member.full_name ?? member.email}
      />
    </div>
  );
}

export function MemberList({ members, isAdmin }: Props) {
  if (!members.length) {
    return (
      <div className="bg-card hairline border border-border rounded-lg px-4 py-8 text-center text-[11px] text-muted-foreground">
        No active members yet.
      </div>
    );
  }

  return (
    <div className="bg-card hairline border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b hairline border-border bg-muted/30">
        <div className="w-7 shrink-0" />
        <div className="flex-1 text-[10px] uppercase tracking-wider text-muted-foreground">Member</div>
        <div className="w-28 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Role</div>
        <div className="w-32 shrink-0" />
      </div>
      {members.map((m) => (
        <MemberRow key={m.id} member={m} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/MemberList.tsx
git commit -m "feat: add Delete and Change Password actions to admin MemberList rows"
```

---

## Task 9: Update `TeamTab` — Add "Add User" Button + Wire `CreateUserModal`

**Files:**
- Modify: `src/components/settings/TeamTab.tsx`

- [ ] **Step 1: Update TeamTab to include the modal**

Replace the entire file:

```tsx
// src/components/settings/TeamTab.tsx
import { useState } from "react";
import { useTeamMembers, useRolePermissions, useBidAssignments } from "@/lib/settings-queries";
import { PermissionMatrix } from "./PermissionMatrix";
import { MemberList } from "./MemberList";
import { PendingApprovals } from "./PendingApprovals";
import { CreateUserModal } from "./CreateUserModal";

type Props = { isAdmin: boolean };

export function TeamTab({ isAdmin }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: members = [], isLoading: membersLoading } = useTeamMembers();
  const { data: permissions = [], isLoading: permsLoading } = useRolePermissions();
  useBidAssignments(); // warm cache

  if (membersLoading || (isAdmin && permsLoading)) {
    return (
      <div className="flex items-center justify-center py-16 text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      {isAdmin && <PendingApprovals />}
      {isAdmin && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Permission Matrix
          </h2>
          <PermissionMatrix permissions={permissions} />
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Team Members
          </h2>
          {isAdmin && (
            <button
              onClick={() => setCreateOpen(true)}
              className="h-6 px-2.5 rounded-md bg-primary text-white text-[10px] font-medium hover:opacity-90 transition-opacity"
            >
              + Add User
            </button>
          )}
        </div>
        <MemberList members={members} isAdmin={isAdmin} />
      </section>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: Build to verify TypeScript**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev
```

Expected: clean build across all modified files.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/TeamTab.tsx
git commit -m "feat: add '+ Add User' button in TeamTab header wired to CreateUserModal"
```

---

## Task 10: End-to-End Manual Verification

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun start
```

Check `.dev-server.port` for the assigned port (usually 3000).

- [ ] **Step 2: Verify approval flow (409 fix)**

1. Sign up a new account at `/auth` → Request access
2. Log in as admin → Settings → Team
3. Click "Approve" on the pending user
4. **Expected:** No 409 error in console; user appears in Team Members list

- [ ] **Step 3: Verify permission matrix saves**

1. As admin → Settings → Team → Permission Matrix
2. Toggle any switch → Click "Save Changes"
3. **Expected:** No errors; toggle state persists after page refresh

- [ ] **Step 4: Verify bid assignment**

1. As admin → Settings → Team → click "+ Add Bid" on a member
2. Select a bid and save
3. **Expected:** Bid pill appears under the member; no errors

- [ ] **Step 5: Verify Create User**

1. As admin → Settings → Team → "+ Add User"
2. Fill in name, email, role, password → "Create User"
3. **Expected:** Modal closes; new member appears in Team Members list immediately; new user can log in with the provided credentials

- [ ] **Step 6: Verify Change Password**

1. As admin → click "Pwd" on any active member
2. Enter new password → "Set Password"
3. **Expected:** Modal closes; that user can now log in with the new password

- [ ] **Step 7: Verify Delete User**

1. As admin → click "Delete" on a non-admin member → confirm dialog
2. **Expected:** Member disappears from list; they can no longer log in

- [ ] **Step 8: Final commit (if any hotfixes were applied during testing)**

```bash
git add -p
git commit -m "fix: post-verification hotfixes for settings team audit"
```
