import { useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Upload } from "lucide-react";
import { toast } from "sonner";
import { useUploadDocument, useDocuments, type DocType } from "@/lib/doc-queries";
import type { Bid } from "@/lib/bid-queries";

type FileStatus = "pending" | "uploading" | "indexing" | "done" | "error";

type FileEntry = {
  file: File;
  status: FileStatus;
  error?: string;
};

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "template",  label: "Template" },
  { value: "rfp",       label: "RFP" },
  { value: "proposal",  label: "Proposal" },
  { value: "legal",     label: "Legal" },
  { value: "reference", label: "Reference" },
];

const STAGE_OPTIONS = [
  { value: "",                label: "Any stage" },
  { value: "deal_qualification", label: "Deal Qualification" },
  { value: "rfi",             label: "RFI" },
  { value: "rfp",             label: "RFP" },
  { value: "orals",           label: "Orals" },
  { value: "due_diligence",   label: "Due Diligence" },
  { value: "bafo",            label: "BAFO" },
  { value: "contract_closure", label: "Contract & Closure" },
  { value: "post_closure",    label: "Post Closure" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  bids: Bid[];
  prefilledBidId?: string;
  lockToGlobal?: boolean;
};

export function UploadModal({ open, onClose, bids, prefilledBidId, lockToGlobal }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [docType, setDocType] = useState<DocType>(prefilledBidId ? "rfp" : "template");
  const [bidId, setBidId] = useState<string>(prefilledBidId ?? "");
  const [stage, setStage] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useUploadDocument();
  const { data: existingDocs = [] } = useDocuments();

  const isUploading = files.some((f) => f.status === "uploading" || f.status === "indexing");
  const allDone = files.length > 0 && files.every((f) => f.status === "done" || f.status === "error");

  function addFiles(incoming: File[]) {
    const valid = incoming.filter(
      (f) => f.size <= 26_214_400 && /\.(pdf|docx|xlsx)$/i.test(f.name)
    );
    if (valid.length < incoming.length) {
      toast.warning("Some files were skipped (must be PDF/DOCX/XLSX, max 25 MB)");
    }
    setFiles((prev) => [
      ...prev,
      ...valid.map((file) => ({ file, status: "pending" as FileStatus })),
    ]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function handleSubmit() {
    const collisions = files
      .filter((f) => existingDocs.some((d) => d.name === f.file.name))
      .map((f) => f.file.name);
    if (collisions.length > 0) {
      toast.warning(
        `${collisions.join(", ")} already exist. Use the Replace button in the document card to update them.`
      );
      return;
    }

    for (const entry of files) {
      if (entry.status !== "pending") continue;

      setFiles((prev) =>
        prev.map((f) => (f.file === entry.file ? { ...f, status: "uploading" } : f))
      );

      try {
        await upload.mutateAsync({
          file: entry.file,
          type: docType,
          bidId: bidId || null,
          stage: stage || null,
        });
        setFiles((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "indexing" } : f))
        );
        setFiles((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "done" } : f))
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === entry.file
              ? { ...f, status: "error", error: (err as Error).message }
              : f
          )
        );
      }
    }
  }

  function handleClose() {
    setFiles([]);
    setDocType("template");
    setBidId(prefilledBidId ?? "");
    setStage("");
    onClose();
  }

  const STATUS_LABEL: Record<FileStatus, string> = {
    pending:   "Ready",
    uploading: "Uploading…",
    indexing:  "Indexing…",
    done:      "Done",
    error:     "Failed",
  };

  const STATUS_COLOR: Record<FileStatus, string> = {
    pending:   "text-muted-foreground",
    uploading: "text-primary",
    indexing:  "text-primary",
    done:      "text-green-600",
    error:     "text-red-500",
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 z-50 bg-card rounded-xl border hairline border-border shadow-2xl w-[640px] max-h-[80vh] overflow-hidden flex flex-col focus:outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border shrink-0">
            <Dialog.Title className="text-[14px] font-semibold">Upload Documents</Dialog.Title>
            <Dialog.Close asChild>
              <button className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background">
                <X className="size-3.5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: dropzone + file list */}
            <div className="flex-1 flex flex-col gap-3 p-4 min-w-0 overflow-y-auto">
              {/* Dropzone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={[
                  "border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-background",
                ].join(" ")}
              >
                <Upload className="size-6 text-muted-foreground" />
                <div className="text-[13px] font-semibold text-primary">Drop files or click to browse</div>
                <div className="text-[11px] text-muted-foreground">PDF, DOCX, XLSX · max 25 MB</div>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.docx,.xlsx"
                  onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                />
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {files.map((entry, i) => {
                    const ext = entry.file.name.split(".").pop()?.toLowerCase() ?? "";
                    const extLabel = ext === "pdf" ? "PDF" : ext === "docx" ? "DOC" : "XLS";
                    const extBg = ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4";
                    const extColor = ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a";
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 bg-background rounded-lg px-3 py-2 border hairline border-border"
                      >
                        <div
                          className="w-7 h-8 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                          style={{ background: extBg, color: extColor }}
                        >
                          {extLabel}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium truncate">{entry.file.name}</div>
                          <div className="h-1 bg-border rounded-full mt-1.5 overflow-hidden">
                            <div
                              className={[
                                "h-full rounded-full transition-all duration-500",
                                entry.status === "done" ? "bg-green-500 w-full" :
                                entry.status === "indexing" ? "bg-primary w-4/5" :
                                entry.status === "uploading" ? "bg-primary w-2/5" :
                                entry.status === "error" ? "bg-red-500 w-full" :
                                "bg-border w-0",
                              ].join(" ")}
                            />
                          </div>
                        </div>
                        <span className={`text-[10px] font-semibold shrink-0 ${STATUS_COLOR[entry.status]}`}>
                          {STATUS_LABEL[entry.status]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: metadata form */}
            <div className="w-52 shrink-0 border-l hairline border-border flex flex-col gap-4 p-4">
              {!prefilledBidId && !lockToGlobal && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Document Type
                </div>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType)}
                  className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              )}

              {!prefilledBidId && !lockToGlobal && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Link to Bid
                  </div>
                  <select
                    value={bidId}
                    onChange={(e) => setBidId(e.target.value)}
                    className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                  >
                    <option value="">— Global Template —</option>
                    {bids.map((b) => (
                      <option key={b.id} value={b.id}>{b.client_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {!prefilledBidId && !lockToGlobal && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Stage (optional)
                </div>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              )}

              <div className="mt-auto flex flex-col gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={files.length === 0 || isUploading || allDone}
                  className="w-full text-[11px] font-semibold py-2 rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isUploading ? "Uploading…" : "Upload & Index"}
                </button>
                {allDone && (
                  <button
                    onClick={handleClose}
                    className="w-full text-[11px] font-semibold py-2 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
