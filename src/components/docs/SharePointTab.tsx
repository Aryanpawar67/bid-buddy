import { useState } from "react";
import { Loader2, RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  useSharePointStatus,
  useSharePointSources,
  useSyncSharePoint,
} from "@/lib/settings-queries";

function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtSynced(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  onManage: () => void;
};

export function SharePointTab({ onManage }: Props) {
  const { data: spStatus } = useSharePointStatus();
  const { data: sources = [], isLoading } = useSharePointSources();
  const syncSp = useSyncSharePoint();
  const [syncingId, setSyncingId] = useState<string | "all" | null>(null);

  const isConnected = spStatus?.connected ?? false;

  function handleSync(documentId: string) {
    setSyncingId(documentId);
    syncSp.mutate(documentId, {
      onSuccess: (r) => toast.success(`Synced — ${r.refreshed} refreshed`),
      onError: (err: any) => toast.error(err?.message ?? "Sync failed"),
      onSettled: () => setSyncingId(null),
    });
  }

  function handleSyncAll() {
    setSyncingId("all");
    syncSp.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(`Sync complete — ${r.refreshed} refreshed, ${r.errors} errors`),
      onError: (err: any) => toast.error(err?.message ?? "Sync failed"),
      onSettled: () => setSyncingId(null),
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Status + action bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b hairline border-border bg-card shrink-0">
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isConnected ? "bg-green-500" : "bg-muted-foreground/50"
          }`}
        />
        <div className="flex flex-col gap-0.5">
          <div className="text-[12px] font-medium">
            {isConnected ? "SharePoint Connected" : "SharePoint not configured"}
          </div>
          {!isConnected && (
            <div className="text-[10px] text-muted-foreground">
              Configure credentials in Settings › Integrations
            </div>
          )}
        </div>
        <div className="flex-1" />
        {sources.length > 0 && (
          <button
            onClick={handleSyncAll}
            disabled={syncingId !== null}
            className="h-7 px-2.5 rounded hairline border border-border text-[11px] text-foreground hover:bg-muted flex items-center gap-1.5 disabled:opacity-40 transition-colors"
          >
            {syncingId === "all" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Sync All
          </button>
        )}
        <button
          onClick={onManage}
          disabled={!isConnected}
          className="h-7 px-3 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 transition-opacity"
        >
          <Plus className="w-3 h-3" />
          Add Source
        </button>
      </div>

      {/* Sources list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[12px] text-muted-foreground">
            Loading…
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-20">
            <div className="text-3xl opacity-20">🔗</div>
            <div className="text-[13px]">No SharePoint sources linked</div>
            <div className="text-[11px] text-center max-w-[240px] leading-relaxed">
              {isConnected
                ? "Paste a SharePoint share link to index a file or folder into the Knowledge Hub."
                : "Configure SharePoint credentials in Settings › Integrations first."}
            </div>
            {isConnected && (
              <button
                onClick={onManage}
                className="text-[11px] px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium hover:opacity-90"
              >
                + Add Source
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-5 py-2 border-b hairline border-border shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {sources.length} source{sources.length !== 1 ? "s" : ""}
              </span>
              <div className="flex-1" />
              <span className="text-[10px] text-muted-foreground">
                Read-only — synced from SharePoint
              </span>
            </div>
            {(sources as any[]).map((src) => (
              <div
                key={src.id}
                className="flex items-center gap-3 px-5 py-3 border-b hairline border-border hover:bg-muted/20 transition-colors"
              >
                <div className="text-[13px] shrink-0">📄</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate">{src.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    <span className="capitalize">{src.type}</span>
                    {" · "}
                    {fmtBytes(src.size_bytes)}
                    {" · synced "}
                    {fmtSynced(src.last_synced_at)}
                  </div>
                </div>
                <button
                  onClick={() => handleSync(src.id)}
                  disabled={syncingId !== null}
                  className="h-7 px-2.5 rounded hairline border border-border text-[11px] text-foreground hover:bg-muted flex items-center gap-1.5 disabled:opacity-40 shrink-0 transition-colors"
                >
                  {syncingId === src.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Sync
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
