import { useState } from "react";
import { DocCard } from "@/components/docs/DocCard";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import { useDocuments, type BidDocument, type DocType } from "@/lib/doc-queries";
import { useCurrentUser } from "@/lib/auth";
import type { Bid } from "@/lib/bid-queries";

type FilterKey = "all" | DocType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",           label: "All" },
  { key: "rfp",           label: "RFP" },
  { key: "proposal",      label: "Proposal" },
  { key: "questionnaire", label: "Questionnaire" },
  { key: "legal",         label: "Legal" },
  { key: "reference",     label: "Reference" },
  { key: "template",      label: "Template" },
];

type Props = {
  bid: Bid;
};

export function BidDocSection({ bid }: Props) {
  const { data: docs = [], isLoading } = useDocuments({ bidId: bid.id });
  const { primaryRole } = useCurrentUser();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const canUpload = primaryRole === "pre_sales" || primaryRole === "admin";

  const filtered = filter === "all" ? docs : docs.filter((d) => d.type === filter);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {filtered.length} doc{filtered.length !== 1 ? "s" : ""}
        </span>
        {canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1 hover:opacity-90"
          >
            + Upload
          </button>
        )}
      </div>

      {/* Doc grid */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-[12px] text-muted-foreground">
            Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
            <div className="text-3xl opacity-20">📁</div>
            <div className="text-[13px]">No documents yet</div>
            {canUpload && (
              <div className="text-[11px]">Upload the client RFP, SOW, or any reference files using the button above</div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                onPreview={setPreviewDoc}
              />
            ))}
          </div>
        )}
      </div>

      <DocPreviewModal
        doc={previewDoc}
        allDocs={docs}
        onClose={() => setPreviewDoc(null)}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        bids={[]}
        prefilledBidId={bid.id}
      />
    </div>
  );
}
