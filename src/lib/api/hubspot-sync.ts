import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HUBSPOT_BASE = "https://api.hubapi.com";

// ── helpers ───────────────────────────────────────────────────────────────────

async function getHubSpotToken(): Promise<string | null> {
  const { data } = await (supabaseAdmin as any)
    .from("org_settings")
    .select("value")
    .eq("key", "hubspot_token")
    .single();
  return (data?.value as { token: string | null })?.token ?? null;
}

async function getStageMap(): Promise<{ hubspot: string; bidcompass: string }[]> {
  const { data } = await (supabaseAdmin as any)
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
  if (!roles?.some((r) => (r.role as string) === "admin")) throw new Error("Admin required");
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
    const { error } = await (supabaseAdmin as any)
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
    const { error } = await (supabaseAdmin as any)
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
              .update({
                stage: bcStage as any,
                value: amount ? Math.round(parseFloat(amount)) : undefined,
                deadline: closedate ?? undefined,
              })
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

    await (supabaseAdmin as any)
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
