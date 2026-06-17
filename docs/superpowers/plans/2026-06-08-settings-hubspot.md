# Settings — HubSpot Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full two-way HubSpot sync — token management (secure, server-only), stage mapping config, inbound deal pull, and outbound stage push on bid update.

**Spec:** `docs/superpowers/specs/2026-06-08-settings-milestone3-design.md`

**Prerequisite:** Plan 3.1 (`2026-06-08-settings-user-rbac.md`) must be fully executed first — the `org_settings` table from Task 1 of that plan is required.

**Tech Stack:** React 19, TanStack Query, TanStack Start server functions, TailwindCSS v4, HubSpot CRM API v3, Supabase `supabaseAdmin`

**Env var needed:** `HUBSPOT_API_BASE` = `https://api.hubapi.com` (or just hardcode it)

---

## File Map

| File | Change |
|---|---|
| `src/lib/api/hubspot-sync.ts` | New — all HubSpot server functions |
| `src/lib/settings-queries.ts` | Extend — add HubSpot-specific hooks |
| `src/components/settings/IntegrationsTab.tsx` | New — HubSpot UI |
| `src/lib/bid-queries.ts` | Modify — trigger outbound push on stage change |

---

## Task 1: HubSpot Server Functions

**Files:**
- Create: `src/lib/api/hubspot-sync.ts`

- [ ] **Step 1: Create the server functions file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HUBSPOT_BASE = "https://api.hubapi.com";

// ── helpers ───────────────────────────────────────────────────────────────────

async function getHubSpotToken(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("org_settings")
    .select("value")
    .eq("key", "hubspot_token")
    .single();
  return (data?.value as { token: string | null })?.token ?? null;
}

async function getStageMap(): Promise<{ hubspot: string; bidcompass: string }[]> {
  const { data } = await supabaseAdmin
    .from("org_settings")
    .select("value")
    .eq("key", "hubspot_stage_map")
    .single();
  return (data?.value as { mappings: { hubspot: string; bidcompass: string }[] })?.mappings ?? [];
}

async function requireAdmin(token: string | undefined) {
  if (!token) throw new Error("Unauthorized");
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) throw new Error("Unauthorized");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (!roles?.some((r) => r.role === "admin")) throw new Error("Admin required");
  return user;
}

// ── testHubSpotToken ──────────────────────────────────────────────────────────

export const testHubSpotTokenFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ _noop: z.string().optional() }))
  .handler(async () => {
    const token = await getHubSpotToken();
    if (!token) return { ok: false, error: "No token configured" };
    const resp = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { ok: false, error: `HubSpot returned ${resp.status}` };
    return { ok: true };
  });

// ── saveHubSpotToken ──────────────────────────────────────────────────────────

export const saveHubSpotTokenFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    await requireAdmin(authHeader?.replace("Bearer ", ""));
    const { error } = await supabaseAdmin
      .from("org_settings")
      .update({ value: { token: data.token }, updated_at: new Date().toISOString() })
      .eq("key", "hubspot_token");
    if (error) throw error;
    return { ok: true };
  });

// ── saveStageMap ──────────────────────────────────────────────────────────────

export const saveStageMapFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    mappings: z.array(z.object({ hubspot: z.string(), bidcompass: z.string() })),
  }))
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    await requireAdmin(authHeader?.replace("Bearer ", ""));
    const { error } = await supabaseAdmin
      .from("org_settings")
      .update({ value: { mappings: data.mappings }, updated_at: new Date().toISOString() })
      .eq("key", "hubspot_stage_map");
    if (error) throw error;
    return { ok: true };
  });

// ── syncFromHubSpot ───────────────────────────────────────────────────────────

export const syncFromHubSpotFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ _noop: z.string().optional() }))
  .handler(async () => {
    const authHeader = getRequest().headers.get("authorization");
    await requireAdmin(authHeader?.replace("Bearer ", ""));

    const token = await getHubSpotToken();
    if (!token) return { ok: false, error: "No HubSpot token configured" };

    const mappings = await getStageMap();
    const hsToBC = Object.fromEntries(mappings.map((m) => [m.hubspot.toLowerCase(), m.bidcompass]));

    let after: string | undefined;
    let created = 0, updated = 0, errors = 0;

    do {
      const url = new URL(`${HUBSPOT_BASE}/crm/v3/objects/deals`);
      url.searchParams.set("properties", "dealname,dealstage,amount,closedate");
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after", after);

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return { ok: false, error: `HubSpot API error: ${resp.status}` };

      const json = await resp.json() as {
        results: { id: string; properties: Record<string, string> }[];
        paging?: { next?: { after: string } };
      };

      for (const deal of json.results) {
        const { dealname, dealstage, amount, closedate } = deal.properties;
        const bcStage = hsToBC[dealstage?.toLowerCase() ?? ""];
        if (!bcStage) continue;

        try {
          const { data: existing } = await supabaseAdmin
            .from("bids")
            .select("id")
            .eq("hubspot_deal_id", deal.id)
            .maybeSingle();

          if (existing) {
            await supabaseAdmin
              .from("bids")
              .update({ stage: bcStage as any, value: amount ? Math.round(parseFloat(amount)) : undefined, deadline: closedate ?? undefined })
              .eq("id", existing.id);
            updated++;
          } else {
            await supabaseAdmin.from("bids").insert({
              client_name: dealname ?? "HubSpot Deal",
              title: dealname ?? "Imported from HubSpot",
              hubspot_deal_id: deal.id,
              stage: bcStage as any,
              type: "rfp",
              status: "active",
              priority: "medium",
              value: amount ? Math.round(parseFloat(amount)) : 0,
              deadline: closedate ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            });
            created++;
          }
        } catch {
          errors++;
        }
      }

      after = json.paging?.next?.after;
    } while (after);

    await supabaseAdmin
      .from("org_settings")
      .update({ value: { at: new Date().toISOString(), created, updated, errors } })
      .eq("key", "hubspot_last_synced");

    return { ok: true, created, updated, errors };
  });

// ── pushBidStageToHubSpot ─────────────────────────────────────────────────────

export const pushBidStageToHubSpotFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bidId: z.string().uuid(), newStage: z.string() }))
  .handler(async ({ data }) => {
    const token = await getHubSpotToken();
    if (!token) return { ok: false };

    const { data: bid } = await supabaseAdmin
      .from("bids")
      .select("hubspot_deal_id")
      .eq("id", data.bidId)
      .maybeSingle();

    if (!bid?.hubspot_deal_id) return { ok: false };

    const mappings = await getStageMap();
    const bcToHS = Object.fromEntries(mappings.map((m) => [m.bidcompass, m.hubspot]));
    const hsStage = bcToHS[data.newStage];
    if (!hsStage) return { ok: false };

    const resp = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/${bid.hubspot_deal_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { dealstage: hsStage } }),
    });

    return { ok: resp.ok };
  });
```

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/hubspot-sync.ts
git commit -m "feat: hubspot-sync server functions — token, stage map, inbound pull, outbound push"
```

---

## Task 2: HubSpot Hooks in settings-queries.ts

- [ ] **Step 1: Add HubSpot hooks to `src/lib/settings-queries.ts`**

```ts
// ── useHubSpotStatus ──────────────────────────────────────────────────────────
export function useHubSpotStatus() {
  return useQuery({
    queryKey: ["hubspot-status"],
    queryFn: async () => {
      const { data } = await supabase
        .from("org_settings")
        .select("value")
        .eq("key", "hubspot_token")
        .maybeSingle();
      const connected = !!((data?.value as any)?.token);
      const { data: syncData } = await supabase
        .from("org_settings")
        .select("value")
        .eq("key", "hubspot_last_synced")
        .maybeSingle();
      const { data: mapData } = await supabase
        .from("org_settings")
        .select("value")
        .eq("key", "hubspot_stage_map")
        .maybeSingle();
      return {
        connected,
        lastSynced: (syncData?.value as any) ?? { at: null, created: 0, updated: 0, errors: 0 },
        mappings: ((mapData?.value as any)?.mappings ?? []) as { hubspot: string; bidcompass: string }[],
      };
    },
  });
}

// ── useSaveHubSpotToken ───────────────────────────────────────────────────────
export function useSaveHubSpotToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => {
      const { saveHubSpotTokenFn } = require("@/lib/api/hubspot-sync");
      return saveHubSpotTokenFn({ data: { token } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hubspot-status"] }),
  });
}

// ── useSaveStageMap ───────────────────────────────────────────────────────────
export function useSaveStageMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappings: { hubspot: string; bidcompass: string }[]) => {
      const { saveStageMapFn } = require("@/lib/api/hubspot-sync");
      return saveStageMapFn({ data: { mappings } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hubspot-status"] }),
  });
}

// ── useSyncFromHubSpot ────────────────────────────────────────────────────────
export function useSyncFromHubSpot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const { syncFromHubSpotFn } = require("@/lib/api/hubspot-sync");
      return syncFromHubSpotFn({ data: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hubspot-status"] });
      qc.invalidateQueries({ queryKey: ["bids"] });
    },
  });
}
```

- [ ] **Step 2: Verify build, commit**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
git add src/lib/settings-queries.ts
git commit -m "feat: HubSpot hooks — status, save token, save mapping, sync trigger"
```

---

## Task 3: IntegrationsTab Component

**Files:**
- Create: `src/components/settings/IntegrationsTab.tsx`

- [ ] **Step 1: Create the component**

Three sections inside a scrollable panel:

1. **Connection card** — status dot, masked token input, "Update Token" + "Test Connection" buttons. Token input shows placeholder `••••••••••••` if connected.

2. **Stage mapping table** — rows of (HubSpot stage text input + BidCompass stage dropdown). "+ Add Mapping" button. "Save Mappings" button. The 8 BidCompass stages are: `deal_qualification`, `rfi`, `rfp`, `orals`, `due_diligence`, `bafo`, `contract_closure`, `post_closure`.

3. **Sync controls** — "Sync from HubSpot" button with loading spinner. Last synced timestamp + "Created: N | Updated: N | Errors: N" summary. Show error toast if sync fails.

Use `useHubSpotStatus`, `useSaveHubSpotToken`, `useSaveStageMap`, `useSyncFromHubSpot` hooks from `settings-queries.ts`. Use `testHubSpotTokenFn` directly for the test button.

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/IntegrationsTab.tsx
git commit -m "feat: IntegrationsTab — HubSpot token, stage mapping, sync controls"
```

---

## Task 4: Outbound Push on Bid Stage Change

**Files:**
- Modify: `src/lib/bid-queries.ts`

- [ ] **Step 1: Add outbound push to `useUpdateBid` mutation**

After the Supabase `update` succeeds in the `useUpdateBid` mutation, if the update includes a `stage` change, fire the outbound push (fire-and-forget):

```ts
// Inside useUpdateBid mutationFn, after successful supabase update:
if (input.updates.stage && input.bidId) {
  import("@/lib/api/hubspot-sync").then(({ pushBidStageToHubSpotFn }) => {
    pushBidStageToHubSpotFn({
      data: { bidId: input.bidId, newStage: input.updates.stage! }
    }).catch(console.error);
  });
}
```

This is fire-and-forget — HubSpot push failure does not block the BidCompass stage update.

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/bid-queries.ts
git commit -m "feat: fire outbound HubSpot stage push on bid stage update"
```

---

## Task 5: Smoke Test

- [ ] Add a real HubSpot private app token in Settings > Integrations
- [ ] Click "Test Connection" → confirm success toast
- [ ] Add one stage mapping (e.g. "Proposal Sent" → `rfp`)
- [ ] Click "Sync from HubSpot" → confirm bids are created/updated
- [ ] Change a synced bid's stage in BidCompass → confirm HubSpot deal stage updates (check HubSpot portal)
- [ ] Remove token → confirm status shows "Not connected"
