import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Download, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { BidDocument, DocType } from "@/lib/doc-queries";
import { getDocPreview } from "@/lib/api/doc-functions";
import { useReplaceDocument, useDeleteDocument } from "@/lib/doc-queries";

const TYPE_STYLES: Record<DocType, string> = {
  rfp:       "bg-[#fff1f1] text-[#e53e3e]",
  proposal:  "bg-[#fff0e8] text-[#fd5b0e]",
  legal:     "bg-[#edfaf4] text-[#16a34a]",
  template:  "bg-[#ede9fd] text-[#491aeb]",
  reference: "bg-[#f5f4fa] text-muted-foreground",
};

type ReplaceState =
  | { step: "idle" }
  | { step: "confirm"; file: File }
  | { step: "replacing" };

type Props = {
  doc: BidDocument | null;
  allDocs: BidDocument[];
  onClose: () => void;
};

export function DocPreviewModal({ doc, allDocs, onClose }: Props) {
  const [preview, setPreview] = useState<{ type: "url" | "html"; value: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [replaceState, setReplaceState] = useState<ReplaceState>({ step: "idle" });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const replace = useReplaceDocument();
  const del = useDeleteDocument();

  useEffect(() => {
    if (!doc) { setPreview(null); return; }
    setPreviewLoading(true);
    getDocPreview({ data: { documentId: doc.id } })
      .then(setPreview)
      .catch(() => toast.error("Failed to load preview"))
      .finally(() => setPreviewLoading(false));
  }, [doc?.id]);

  if (!doc) return null;

  function handleCopyMention() {
    const slug = doc!.name.replace(/\.[^.]+$/, "");
    navigator.clipboard.writeText(`@${slug}`);
    toast.success("Copied — paste in AI chat to use this document");
  }

  function handleDownload() {
    if (!preview) return;
    if (preview.type === "url") {
      window.open(preview.value, "_blank");
    } else {
      toast.info("Download not available for converted previews — use Replace to update the file.");
    }
  }

  function handleReplaceSelect() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.xlsx";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setReplaceState({ step: "confirm", file });
    };
    input.click();
  }

  function handleReplaceConfirm() {
    if (replaceState.step !== "confirm") return;
    const { file } = replaceState;
    setReplaceState({ step: "replacing" });
    replace.mutate(
      { documentId: doc!.id, file, storagePath: doc!.storage_path },
      {
        onSuccess: () => {
          toast.success("Document replaced and re-indexing…");
          setReplaceState({ step: "idle" });
          onClose();
        },
        onError: () => {
          toast.error("Replace failed");
          setReplaceState({ step: "idle" });
        },
      }
    );
  }

  function handleDelete() {
    del.mutate(
      { documentId: doc!.id, storagePath: doc!.storage_path },
      {
        onSuccess: () => {
          toast.success("Document deleted");
          setDeleteConfirm(false);
          onClose();
        },
        onError: () => toast.error("Delete failed"),
      }
    );
  }

  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";

  return (
    <Dialog.Root open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed inset-4 md:inset-[5%] z-50 bg-card rounded-xl border hairline border-border shadow-2xl flex flex-col overflow-hidden focus:outline-none">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b hairline border-border shrink-0">
            <div
              className="w-8 h-10 rounded flex items-center justify-center text-[10px] font-black shrink-0"
              style={{
                background: ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4",
                color: ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a",
              }}
            >
              {ext.toUpperCase().slice(0, 3)}
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold truncate">{doc.name}</Dialog.Title>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TYPE_STYLES[doc.type]}`}>
                  {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">
                  {doc.bid_id ? "Bid document" : "Global template"}
                </span>
                {doc.embedding && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ede9fd] text-primary font-semibold">
                    ✦ AI-indexed
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-center shrink-0">
              <button
                onClick={handleCopyMention}
                className="text-[10px] px-2.5 py-1.5 rounded bg-[#ede9fd] text-primary font-semibold hover:bg-[#ddd5fd] transition-colors"
              >
                @ Mention
              </button>
              <button
                onClick={handleDownload}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors"
                title="Download"
              >
                <Download className="size-3.5" />
              </button>
              <button
                onClick={handleReplaceSelect}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors"
                title="Replace"
              >
                <RefreshCw className="size-3.5" />
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-red-500 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
              <Dialog.Close asChild>
                <button className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors">
                  <X className="size-3.5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Preview body */}
          <div className="flex-1 min-h-0 bg-[#f5f4fa]">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                Loading preview…
              </div>
            ) : preview ? (
              preview.type === "url" ? (
                <iframe
                  src={preview.value}
                  className="w-full h-full border-0"
                  title={doc.name}
                />
              ) : (
                <iframe
                  srcDoc={`<style>body{font-family:sans-serif;font-size:13px;padding:20px;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e8e6f0;padding:4px 8px;font-size:11px}</style>${preview.value}`}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0 bg-white"
                  title={doc.name}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                Preview unavailable
              </div>
            )}
          </div>

          {/* Replace confirmation overlay */}
          {(replaceState.step === "confirm" || replaceState.step === "replacing") && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
              <div className="bg-card rounded-xl border hairline border-border shadow-xl w-80 overflow-hidden">
                <div className="px-4 py-3 border-b hairline border-border">
                  <div className="text-[13px] font-semibold">Replace existing document?</div>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-lg bg-[#fff0e8] flex items-center justify-center text-lg shrink-0">⚠️</div>
                    <p className="text-[12px] text-foreground/70 leading-relaxed">
                      Replacing <strong className="text-foreground">{doc.name}</strong> will overwrite the file and re-index its AI embeddings.
                    </p>
                  </div>
                  {replaceState.step === "confirm" && (
                    <div className="bg-background rounded-lg p-2.5 text-[10px] text-muted-foreground flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0">File</span>
                        <span className="line-through">{doc.name}</span>
                        <span className="text-primary font-semibold">→</span>
                        <span className="font-medium text-foreground">{replaceState.file.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0">AI index</span>
                        <span className="line-through">Old embeddings</span>
                        <span className="text-primary font-semibold">→</span>
                        <span className="font-medium text-foreground">Re-indexed</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 px-4 py-3 border-t hairline border-border">
                  <button
                    onClick={handleReplaceConfirm}
                    disabled={replaceState.step === "replacing"}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md bg-[#fd5b0e] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {replaceState.step === "replacing" ? "Replacing…" : "Replace & Re-index"}
                  </button>
                  <button
                    onClick={() => setReplaceState({ step: "idle" })}
                    disabled={replaceState.step === "replacing"}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50 transition-colors"
                  >
                    Keep existing
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete confirmation overlay */}
          {deleteConfirm && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
              <div className="bg-card rounded-xl border hairline border-border shadow-xl w-72 overflow-hidden">
                <div className="px-4 py-3 border-b hairline border-border">
                  <div className="text-[13px] font-semibold">Delete document?</div>
                </div>
                <div className="p-4">
                  <p className="text-[12px] text-foreground/70 leading-relaxed">
                    <strong className="text-foreground">{doc.name}</strong> and all its AI embeddings will be permanently deleted.
                  </p>
                </div>
                <div className="flex gap-2 px-4 py-3 border-t hairline border-border">
                  <button
                    onClick={handleDelete}
                    disabled={del.isPending}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {del.isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
