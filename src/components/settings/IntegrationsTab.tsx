import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useHubSpotStatus,
  useSaveHubSpotToken,
  useSaveStageMap,
  useSyncFromHubSpot,
  useSharePointStatus,
  useSaveSharePointCreds,
} from "@/lib/settings-queries";
import { testHubSpotTokenFn } from "@/lib/api/hubspot-sync";
import { testSharePointFn } from "@/lib/api/sharepoint-sync";
import { STAGES } from "@/lib/bid-constants";

type Mapping = { hubspot: string; bidcompass: string };

export function IntegrationsTab() {
  // ── HubSpot ────────────────────────────────────────────────────────────────
  const { data: status, isLoading } = useHubSpotStatus();
  const saveToken = useSaveHubSpotToken();
  const saveMap = useSaveStageMap();
  const sync = useSyncFromHubSpot();

  const [tokenInput, setTokenInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [mappings, setMappings] = useState<Mapping[] | null>(null);

  const activeMappings: Mapping[] = mappings ?? status?.mappings ?? [];
  const lastSynced = status?.lastSynced;

  // ── SharePoint ─────────────────────────────────────────────────────────────
  const { data: spStatus } = useSharePointStatus();
  const saveCreds = useSaveSharePointCreds();

  const [spTenantId, setSpTenantId] = useState("");
  const [spClientId, setSpClientId] = useState("");
  const [spClientSecret, setSpClientSecret] = useState("");
  const [testingSp, setTestingSp] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[11px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  // ── HubSpot handlers ───────────────────────────────────────────────────────
  const handleSaveToken = () => {
    if (!tokenInput.trim()) return;
    saveToken.mutate(tokenInput.trim(), {
      onSuccess: () => { setTokenInput(""); toast.success("Token saved"); },
      onError: () => toast.error("Failed to save token"),
    });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testHubSpotTokenFn({ data: {} });
      if (result.ok) toast.success("Connection successful");
      else toast.error(result.error ?? "Connection failed");
    } catch {
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSaveMappings = () => {
    saveMap.mutate(activeMappings, {
      onSuccess: () => { setMappings(null); toast.success("Stage mappings saved"); },
      onError: () => toast.error("Failed to save mappings"),
    });
  };

  const handleSync = () => {
    sync.mutate(undefined, {
      onSuccess: (result) => {
        if (result && !result.ok) { toast.error(result.error ?? "Sync failed"); return; }
        const r = result as any;
        toast.success(`Sync complete — Created: ${r.created}, Updated: ${r.updated}, Errors: ${r.errors}`);
      },
      onError: () => toast.error("Sync failed"),
    });
  };

  const updateMapping = (i: number, field: keyof Mapping, value: string) => {
    setMappings(activeMappings.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  };
  const removeMapping = (i: number) => setMappings(activeMappings.filter((_, idx) => idx !== i));
  const addMapping = () => setMappings([...activeMappings, { hubspot: "", bidcompass: "rfp" }]);

  // ── SharePoint handlers ────────────────────────────────────────────────────
  const handleSaveCreds = () => {
    if (!spTenantId.trim() || !spClientId.trim() || !spClientSecret.trim()) return;
    saveCreds.mutate(
      { tenantId: spTenantId.trim(), clientId: spClientId.trim(), clientSecret: spClientSecret.trim() },
      {
        onSuccess: () => { setSpClientSecret(""); toast.success("SharePoint credentials saved"); },
        onError: (err: any) => toast.error(err?.message ?? "Failed to save credentials"),
      }
    );
  };

  const handleTestSp = async () => {
    setTestingSp(true);
    try {
      const result = await testSharePointFn({ data: {} });
      if (result.ok) toast.success("SharePoint connection successful");
      else toast.error("Connection test failed");
    } catch (err: any) {
      toast.error(err?.message ?? "Connection test failed");
    } finally {
      setTestingSp(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-5 max-w-2xl">

      {/* ── HubSpot Connection ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          HubSpot Connection
        </h2>
        <div className="bg-card hairline border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${status?.connected ? "bg-green-500" : "bg-muted-foreground"}`} />
            <span className="text-[12px] font-medium">
              {status?.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={status?.connected ? "••••••••••••  (enter new token to replace)" : "Paste private app token…"}
              className="flex-1 text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleSaveToken}
              disabled={!tokenInput.trim() || saveToken.isPending}
              className="text-[11px] px-3 py-2 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              {saveToken.isPending ? "Saving…" : "Update Token"}
            </button>
          </div>
          {status?.connected && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="self-start text-[11px] px-3 py-1.5 rounded-md hairline border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
          )}
        </div>
      </section>

      {/* ── Stage Mapping ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Stage Mapping
        </h2>
        <div className="bg-card hairline border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b hairline border-border bg-muted/30">
            <span className="flex-1 text-[10px] uppercase tracking-wider text-muted-foreground">HubSpot Stage</span>
            <span className="flex-1 text-[10px] uppercase tracking-wider text-muted-foreground">BidCompass Stage</span>
            <span className="w-6" />
          </div>
          {activeMappings.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-4">No mappings configured</p>
          )}
          {activeMappings.map((m, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 border-b hairline border-border last:border-0">
              <input
                type="text"
                value={m.hubspot}
                onChange={(e) => updateMapping(i, "hubspot", e.target.value)}
                placeholder="e.g. Proposal Sent"
                className="flex-1 text-[11px] px-2 py-1.5 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
              />
              <Select value={m.bidcompass} onValueChange={(v) => updateMapping(i, "bidcompass", v)}>
                <SelectTrigger className="flex-1 h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key} className="text-[11px]">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => removeMapping(i)}
                className="w-6 text-[12px] text-muted-foreground hover:text-destructive transition-colors"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 border-t hairline border-border bg-muted/20">
            <button onClick={addMapping} className="text-[11px] text-primary hover:underline">
              + Add Mapping
            </button>
            <button
              onClick={handleSaveMappings}
              disabled={saveMap.isPending}
              className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saveMap.isPending ? "Saving…" : "Save Mappings"}
            </button>
          </div>
        </div>
      </section>

      {/* ── HubSpot Sync ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Sync
        </h2>
        <div className="bg-card hairline border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-medium">Sync from HubSpot</span>
              <span className="text-[10px] text-muted-foreground">Pull all deals matching stage mappings into BidCompass</span>
            </div>
            <button
              onClick={handleSync}
              disabled={sync.isPending || !status?.connected}
              className="text-[11px] px-4 py-2 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              {sync.isPending ? "Syncing…" : "Sync Now"}
            </button>
          </div>
          {lastSynced?.at && (
            <div className="text-[10px] text-muted-foreground border-t hairline border-border pt-2">
              Last synced: {new Date(lastSynced.at).toLocaleString()} ·{" "}
              Created: {lastSynced.created} · Updated: {lastSynced.updated}
              {lastSynced.errors > 0 && (
                <span className="text-destructive"> · Errors: {lastSynced.errors}</span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="border-t hairline border-border pt-1" />

      {/* ── SharePoint ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-[13px] font-semibold">Microsoft SharePoint</h2>
        <div className="rounded-md bg-muted/40 hairline border border-border px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Prerequisites:</span> Register an app in Azure Entra ID with{" "}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Files.Read.All</code> and{" "}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Sites.Read.All</code> application permissions (admin-consented).
          Only files from the <span className="font-medium text-foreground">same Microsoft 365 tenant</span> are supported.
          Supported file types: PDF, DOCX, XLSX.{" "}
          <span className="text-foreground">Link and sync files from the Knowledge Hub page.</span>
        </div>
      </div>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Connection
        </h3>
        <div className="bg-card hairline border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${spStatus?.connected ? "bg-green-500" : "bg-muted-foreground"}`} />
            <span className="text-[12px] font-medium">
              {spStatus?.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Tenant ID</label>
              <input
                type="text"
                value={spTenantId || spStatus?.tenantId || ""}
                onChange={(e) => setSpTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Client ID</label>
              <input
                type="text"
                value={spClientId || spStatus?.clientId || ""}
                onChange={(e) => setSpClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary font-mono"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Client Secret</label>
            <input
              type="password"
              value={spClientSecret}
              onChange={(e) => setSpClientSecret(e.target.value)}
              placeholder={spStatus?.connected ? "••••••••••••  (enter new secret to replace)" : "Paste client secret value…"}
              className="text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCreds}
              disabled={saveCreds.isPending || (!spTenantId.trim() && !spClientId.trim() && !spClientSecret.trim())}
              className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {saveCreds.isPending ? "Saving…" : "Save Credentials"}
            </button>
            {spStatus?.connected && (
              <button
                onClick={handleTestSp}
                disabled={testingSp}
                className="text-[11px] px-3 py-1.5 rounded-md hairline border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {testingSp ? "Testing…" : "Test Connection"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
