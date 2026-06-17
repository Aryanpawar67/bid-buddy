# Milestone 3: Settings — User Management, RBAC & HubSpot Integration

**Goal:** Replace the empty `/settings` placeholder with a functional admin control centre: team management with a per-role permission matrix, a user approval flow for new sign-ups, bid-to-member assignments, and full two-way HubSpot sync. The `/hubspot` placeholder route is retired into the Settings > Integrations tab.

---

## Architecture Overview

| Layer | What changes |
|---|---|
| DB | 4 additions: `profiles.status` column, `role_permissions` table, `bid_assignments` table, `org_settings` table |
| Routes | `/settings` filled in (tabbed); new `/pending` route (outside `_app` auth guard) |
| Server fns | New `src/lib/api/hubspot-sync.ts` — token test, inbound pull, outbound push |
| Client hooks | New `src/lib/settings-queries.ts` — all settings/RBAC/assignment/HubSpot hooks |
| Components | `src/components/settings/` — TeamTab, PermissionMatrix, MemberList, BidAssignModal, IntegrationsTab |

Admin always has full access — the permission matrix only controls `pre_sales`, `legal`, and `finance`.

---

## DB Schema

### 1. `profiles.status`

New column on the existing `profiles` table:

```sql
alter table profiles add column status text not null default 'pending'
  check (status in ('pending', 'active', 'suspended'));
```

All existing profiles should be backfilled to `'active'` in the migration.

### 2. `role_permissions`

```sql
create table role_permissions (
  id          uuid primary key default gen_random_uuid(),
  role        text not null check (role in ('pre_sales', 'legal', 'finance')),
  resource_type text not null check (resource_type in ('page', 'feature')),
  resource_key  text not null,   -- e.g. 'page:ai', 'feature:docs:upload'
  allowed     boolean not null default true,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz default now(),
  unique (role, resource_key)
);
```

RLS: admins can read/write all rows; non-admins can read only their own role's rows.

**Default seed (applied in migration):**

| resource_key | pre_sales | legal | finance |
|---|---|---|---|
| page:dashboard | ✅ | ✅ | ✅ |
| page:pipeline | ✅ | ✅ | ✅ |
| page:queue | ✅ | ✅ | ✅ |
| page:analytics | ✅ | ❌ | ✅ |
| page:ai | ✅ | ❌ | ❌ |
| page:docs | ✅ | ✅ | ❌ |
| page:calendar | ✅ | ✅ | ✅ |
| page:notifications | ✅ | ✅ | ✅ |
| feature:docs:upload | ✅ | ❌ | ❌ |
| feature:docs:delete | ✅ | ❌ | ❌ |
| feature:docs:reindex | ✅ | ❌ | ❌ |
| feature:bids:create | ✅ | ❌ | ❌ |
| feature:bids:delete | ❌ | ❌ | ❌ |
| feature:analytics:export | ✅ | ❌ | ✅ |
| feature:ai:model-select | ✅ | ❌ | ❌ |

### 3. `bid_assignments`

```sql
create table bid_assignments (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid not null references bids(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  assigned_by uuid references profiles(id),
  assigned_at timestamptz default now(),
  unique (bid_id, user_id)
);
```

RLS: admins can insert/delete; all authenticated users can select.

### 4. `org_settings`

```sql
create table org_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now()
);
```

RLS: only `admin` role can select or modify. Token is read exclusively via server functions using `supabaseAdmin` — never exposed to the client.

**Initial rows (seeded in migration):**
- `hubspot_token` → `{ "token": null }` (null = not connected)
- `hubspot_stage_map` → `{ "mappings": [] }`
- `hubspot_last_synced` → `{ "at": null, "created": 0, "updated": 0, "errors": 0 }`

---

## User Approval Flow

1. User signs up at `/auth` → Supabase creates the auth user.
2. A Postgres trigger on `auth.users` insert creates a `profiles` row with `status: 'pending'`.
3. The `_app.tsx` layout (auth guard) checks `profile.status` after loading the profile:
   - `pending` → redirect to `/pending`
   - `active` → normal app access (gated further by `role_permissions`)
   - `suspended` → redirect to `/pending` with a "suspended" message variant
4. `/pending` route: full-screen message — "Your account is pending admin approval." No nav, no sidebar.
5. A Postgres trigger on `profiles` insert fires a notification to all users with `admin` role (type: `user_approval_requested`, title: `"New signup: {full_name or email}"`, link: `/settings`).
6. Admin sees the approval notification in the Notifications panel + badge on the Sidebar icon.
7. Admin clicks the notification → goes to Settings > Team tab → approves user, assigns role → `profiles.status` set to `'active'`, `user_roles` row inserted.

**`useApproveUser` mutation:** updates `profiles.status` to `'active'` + inserts into `user_roles`. **`useSuspendUser` mutation:** sets `profiles.status` to `'suspended'` + deletes their `user_roles` row.

---

## Settings Page Layout

`/settings` — a two-tab layout. Tab labels: **Team** | **Integrations**.

- **Team** tab: visible to all authenticated users; content differs by role (admin vs non-admin).
- **Integrations** tab: rendered only for admins; non-admins don't see the tab at all.

Default active tab: Team.

---

## Team Tab

### Admin view

Two stacked sections:

**Section A — Permission Matrix**

A dense grid: rows = resources (pages then features), columns = roles (`pre_sales`, `legal`, `finance`). Each cell is a toggle. Admin column is omitted (always full access).

Row groups:
- **Pages** (8 rows): Dashboard, Pipeline, Queue, Analytics, AI Command Center, Knowledge Hub, Calendar, Notifications
- **Features** (7 rows): Upload Docs, Delete Docs, Reindex Docs, Create Bid, Delete Bid, Export Analytics, Select AI Model

At the bottom of the matrix: a **Save Changes** button (batch-updates all dirty cells). Changes take effect on the user's next page load (permission checks run client-side via `useRolePermissions()` hook + server-side in server functions).

**Section B — Member List**

A table below the matrix. Columns: Avatar + Name | Email | Role | Assigned Bids | Actions.

- **Role column**: dropdown to change role (writes to `user_roles` + invalidates `["roles", userId]`). Changing to a new role replaces the existing role (single primary role per user).
- **Assigned Bids column**: pill list of bid `client_name` values. Each pill has an `×` to remove the assignment. An **+ Add Bid** button opens `BidAssignModal` — a searchable list of active bids (not already assigned to this user).
- **Actions column**: Suspend button (admin cannot suspend themselves).

Pending users do not appear in this list — they are handled via the Notifications panel only.

### Non-admin view

Read-only table: Avatar + Name | Role | Assigned Bids. No controls, no permission matrix. Shows all active team members.

---

## Integrations Tab (admin only)

### HubSpot section

**Connection card:**
- Status indicator: green "Connected" or grey "Not connected" based on whether `hubspot_token.token` is non-null.
- Masked token input field (shows `••••••••` if set, empty if not). "Update Token" button — submits via server function, never sends token to client side.
- "Test Connection" button — calls `testHubSpotToken` server fn, returns success/error toast.

**Stage mapping table:**
- Two columns: HubSpot Stage Name (free-text input) | BidCompass Stage (dropdown: 8 stages).
- "+ Add mapping" button appends a new row.
- × button on each row removes it.
- "Save Mappings" button — writes to `org_settings.hubspot_stage_map`.
- Mappings are bidirectional (used for both inbound pull and outbound push).

**Sync controls:**
- "Sync from HubSpot" button — calls `syncFromHubSpot` server fn.
- Last synced timestamp + last sync summary: "Created: N | Updated: N | Errors: N".
- Mini sync log: last 5 sync events shown as a compact list.

---

## HubSpot Two-Way Sync Architecture

### Token security

The HubSpot private app token is stored in `org_settings` under key `hubspot_token`. It is read only by server functions via `supabaseAdmin`. The client never receives the token value — only a boolean "is connected" flag.

### Inbound: HubSpot → BidCompass

Triggered by the "Sync from HubSpot" button. Server function `syncFromHubSpot`:

1. Read token + stage mappings from `org_settings` (via `supabaseAdmin`).
2. Call HubSpot `GET /crm/v3/objects/deals?properties=dealname,dealstage,amount,closedate,hubspot_owner_id&limit=100` (paginate with `after` cursor).
3. For each deal: look up `dealstage` in the mappings → get BidCompass stage.
4. Upsert into `bids` matching on `hubspot_deal_id`:
   - **New deal** → insert bid with `status: 'active'`, `type: 'rfp'`, mapped stage, `client_name` from deal name, `value` from amount, `deadline` from closedate.
   - **Existing bid** → update `stage`, `value`, `deadline` only (don't overwrite user-edited fields like `title`, `priority`).
5. Write result counts to `org_settings.hubspot_last_synced`.

### Outbound: BidCompass → HubSpot

Triggered when `useUpdateBid` mutation changes the `stage` field. After the Supabase update succeeds, call `pushBidStageToHubSpot` server fn:

1. Read token + mappings from `org_settings`.
2. Look up reverse mapping: BidCompass stage → HubSpot stage name.
3. If bid has `hubspot_deal_id` set and a reverse mapping exists → call HubSpot `PATCH /crm/v3/objects/deals/{dealId}` with `{ properties: { dealstage: mappedHubSpotStage } }`.
4. Failures are logged to console but do not block the BidCompass stage update (fire-and-forget with error toast).

---

## New Files

| File | Purpose |
|---|---|
| `src/routes/_app/settings.tsx` | Replace placeholder — tabbed Settings page |
| `src/routes/pending.tsx` | Pending approval screen (outside `_app` layout) |
| `src/components/settings/TeamTab.tsx` | Admin vs non-admin team tab |
| `src/components/settings/PermissionMatrix.tsx` | Role × resource permission grid |
| `src/components/settings/MemberList.tsx` | Member list with role dropdown + bid assignments |
| `src/components/settings/BidAssignModal.tsx` | Searchable bid picker modal |
| `src/components/settings/IntegrationsTab.tsx` | HubSpot connection, mapping, sync controls |
| `src/lib/settings-queries.ts` | All TanStack Query hooks for settings data |
| `src/lib/api/hubspot-sync.ts` | Server functions: testHubSpotToken, syncFromHubSpot, pushBidStageToHubSpot, saveHubSpotToken, saveStageMap |
| `supabase/migrations/20260608180000_settings_rbac.sql` | All schema additions + RLS + seeds |

---

## Migration: `20260608180000_settings_rbac.sql`

Applies in order:
1. Add `profiles.status` column, backfill existing rows to `'active'`
2. Create `role_permissions` table + RLS policies + seed defaults
3. Create `bid_assignments` table + RLS policies
4. Create `org_settings` table + RLS policies + seed initial rows
5. Postgres trigger: on `profiles` insert with `status = 'pending'` → insert notification rows for all admins
