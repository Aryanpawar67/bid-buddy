import { useRef, useState } from "react";
import { X, Upload, Trash2, ExternalLink, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useDocuments, useUploadAndIndexDocument, useDeleteDocument, type BidDocument } from "@/lib/doc-queries";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";

const DOC_TYPES = ["rfp", "proposal", "legal", "template", "reference"] as const;

function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function extMeta(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return {
    label: ext === "pdf" ? "PDF" : ext === "docx" ? "DOC" : ext === "xlsx" ? "XLS" : ext.toUpperCase(),
    bg: ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4",
    color: ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a",
  };
}

interface Props {
  bidId: string;
  clientName: string;
  onClose: () => void;
}

export function BidDocsDrawer({ bidId, clientName, onClose }: Props) {
  const { data: docs = [], isLoading } = useDocuments({ bidId });
  const uploadAndIndex = useUploadAndIndexDocument();
  const deleteDoc = useDeleteDocument();
  const { primaryRole } = useCurrentUser();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<typeof DOC_TYPES[number]>("rfp");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const canManage = primaryRole === "pre_sales" || primaryRole === "admin";

  async function handleOpen(doc: BidDocument) {
    setOpeningId(doc.id);
    try {
      const { data, error } = await supabase.storage
        .from("bid-documents")
        .createSignedUrl(doc.storage_path, 120);
      if (error || !data?.signedUrl) throw new Error("Could not get file URL");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to open document");
    } finally {
      setOpeningId(null);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const fileArray = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = "";

    for (const file of fileArray) {
      if (!/\.(pdf|docx|xlsx)$/i.test(file.name)) {
        toast.warning(`${file.name}: only PDF, DOCX, XLSX supported`);
        continue;
      }
      if (file.size > 26_214_400) {
        toast.warning(`${file.name}: must be under 25 MB`);
        continue;
      }
      try {
        await uploadAndIndex.mutateAsync({ file, type: uploadType, bidId, stage: null });
        toast.success(`${file.name} uploaded and indexed`);
      } catch (err: any) {
        const msg = err?.message ?? "Upload failed";
        toast.error(msg.includes("upsert") || msg.includes("already exists")
          ? `${file.name} already exists — delete it first to replace`
          : msg);
      }
    }
  }

  function handleDelete(doc: BidDocument) {
    if (deletingId) return;
    setDeletingId(doc.id);
    deleteDoc.mutate(
      { documentId: doc.id, storagePath: doc.storage_path },
      {
        onSuccess: () => toast.success(`${doc.name} deleted`),
        onError: () => toast.error("Failed to delete document"),
        onSettled: () => setDeletingId(null),
      }
    );
  }

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-card border-l hairline border-border flex flex-col z-30 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] font-semibold">Bid Documents</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">{clientName}</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Upload strip */}
      {canManage && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b hairline border-border shrink-0 bg-muted/20">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <select
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value as typeof DOC_TYPES[number])}
            className="text-[10px] bg-background border hairline border-border rounded px-2 py-1.5 text-foreground capitalize flex-1"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">{t}</option>
            ))}
          </select>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadAndIndex.isPending}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          >
            {uploadAndIndex.isPending
              ? <><Loader2 className="w-3 h-3 animate-spin" />Uploading…</>
              : <><Upload className="w-3 h-3" />Upload</>}
          </button>
        </div>
      )}

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-[11px] text-muted-foreground gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <FileText className="w-8 h-8 opacity-25" />
            <span className="text-[11px]">No documents yet</span>
            {canManage && (
              <span className="text-[10px]">Upload files above to index them for the AI</span>
            )}
          </div>
        ) : (
          <div>
            {docs.map((doc) => {
              const { label, bg, color } = extMeta(doc.name);
              const isDeleting = deletingId === doc.id;
              const isOpening = openingId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 border-b hairline border-border last:border-0 hover:bg-muted/20 transition-colors group"
                >
                  {/* File type badge */}
                  <div
                    className="w-8 h-9 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                    style={{ background: bg, color }}
                  >
                    {label}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium truncate leading-tight">{doc.name}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span className="capitalize">{doc.type}</span>
                      <span>·</span>
                      <span>{fmtBytes(doc.size_bytes)}</span>
                      <span>·</span>
                      <span>{fmtDate(doc.created_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleOpen(doc)}
                      disabled={isOpening || isDeleting}
                      title="Open"
                      className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                    >
                      {isOpening ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                    </button>
                    {canManage && (
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={isDeleting || !!deletingId}
                        title="Delete"
                        className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                      >
                        {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer count */}
      {docs.length > 0 && (
        <div className="px-4 py-2 border-t hairline border-border shrink-0">
          <span className="text-[10px] text-muted-foreground">{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}
