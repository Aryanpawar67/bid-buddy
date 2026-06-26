import { useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useSharePointStatus,
  useSharePointSources,
  useAddSharePointSource,
  useRemoveSharePointSource,
  useSyncSharePoint,
} from "@/lib/settings-queries";

const SP_TYPES = [
  { value: "reference", label: "Reference" },
  { value: "template", label: "Template" },
  { value: "rfp", label: "RFP" },
  { value: "proposal", label: "Proposal" },
  { value: "legal", label: "Legal" },
] as const;

function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtSynced(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SharePointModal({ open, onClose }: Props) {
  const { data: spStatus } = useSharePointStatus();
  const { data: sources = [] } = useSharePointSources();
  const addSource = useAddSharePointSource();
  const removeSource = useRemoveSharePointSource();
  const syncSp = useSyncSharePoint();

  const [url, setUrl] = useState("");
  const [type, setType] = useState("reference");
  const [syncingId, setSyncingId] = useState<string | "all" | null>(null);

  const isConnected = spStatus?.connected ?? false;

  const handleAdd = () => {
    if (!url.trim()) return;
    addSource.mutate(
      { shareUrl: url.trim(), type },
      {
        onSuccess: (r) => {
          setUrl("");
          const result = r as any;
          if (result.filesIndexed != null) {
            toast.success(`Indexed ${result.filesIndexed} file${result.filesIndexed !== 1 ? "s" : ""} · ${result.chunksIndexed ?? 0} chunks`);
          } else {
            toast.success(`Indexed ${result.chunksIndexed ?? 0} chunks`);
          }
        },
        onError: (err: any) => toast.error(err?.message ?? "Failed to add source"),
      }
    );
  };

  const handleSync = (documentId: string) => {
    setSyncingId(documentId);
    syncSp.mutate(documentId, {
      onSuccess: (r) => toast.success(`Synced — ${r.refreshed} refreshed, ${r.errors} errors`),
      onError: (err: any) => toast.error(err?.message ?? "Sync failed"),
      onSettled: () => setSyncingId(null),
    });
  };

  const handleSyncAll = () => {
    setSyncingId("all");
    syncSp.mutate(undefined, {
      onSuccess: (r) => toast.success(`Sync complete — ${r.refreshed} refreshed, ${r.errors} errors`),
      onError: (err: any) => toast.error(err?.message ?? "Sync failed"),
      onSettled: () => setSyncingId(null),
    });
  };

  const handleRemove = (documentId: string) => {
    removeSource.mutate(documentId, {
      onSuccess: () => toast.success("Source removed"),
      onError: () => toast.error("Failed to remove source"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4 border-b hairline border-border">
          <DialogTitle className="text-[14px] font-semibold flex items-center gap-2">
            <img src="/sharepoint-icon.png" alt="" className="w-4 h-4" onError={(e) => (e.currentTarget.style.display = "none")} />
            SharePoint Knowledge Sources
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-5 max-h-[70vh] overflow-y-auto">

          {/* ── Add source ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
              Paste a SharePoint share link to index a file or folder into the Knowledge Hub. Folders index all supported files (PDF, DOCX, XLSX) inside.
              {!isConnected && (
                <span className="text-amber-500 ml-1">SharePoint credentials not configured — go to Settings › Integrations.</span>
              )}
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="https://yourorg.sharepoint.com/:f:/s/… or /:w:/s/…"
                disabled={!isConnected || addSource.isPending}
                className="flex-1 text-[11px] px-3 py-2 rounded-md hairline border border-border bg-background outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <Select value={type} onValueChange={setType} disabled={!isConnected || addSource.isPending}>
                <SelectTrigger className="w-28 h-9 text-[11px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-[11px]">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={handleAdd}
                disabled={!url.trim() || !isConnected || addSource.isPending}
                className="text-[11px] px-3 py-2 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0 flex items-center gap-1.5"
              >
                {addSource.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Indexing…</> : "Add & Index"}
              </button>
            </div>
          </div>

          {/* ── Sources list ───────────────────────────────────────────────── */}
          {sources.length > 0 && (
            <div className="flex flex-col gap-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Linked sources ({sources.length})
                </span>
                <button
                  onClick={handleSyncAll}
                  disabled={syncingId !== null}
                  className="text-[11px] px-2.5 py-1 rounded hairline border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {syncingId === "all"
                    ? <><Loader2 className="w-3 h-3 animate-spin" />Syncing…</>
                    : <><RefreshCw className="w-3 h-3" />Sync All</>}
                </button>
              </div>

              <div className="rounded-lg hairline border border-border overflow-hidden">
                {sources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center gap-3 px-3 py-2.5 border-b hairline border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="text-[12px] font-medium truncate">{src.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {src.type} · {fmtBytes(src.size_bytes)} · synced {fmtSynced(src.last_synced_at)}
                      </span>
                    </div>

                    <button
                      onClick={() => handleSync(src.id)}
                      disabled={syncingId !== null}
                      title="Sync now"
                      className="text-[11px] px-2 py-1 rounded hairline border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40 flex items-center gap-1 shrink-0"
                    >
                      {syncingId === src.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RefreshCw className="w-3 h-3" />}
                      <span>Sync</span>
                    </button>

                    <button
                      onClick={() => handleRemove(src.id)}
                      disabled={removeSource.isPending}
                      title="Remove source"
                      className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sources.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-2">No SharePoint sources linked yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
