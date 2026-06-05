import { useState } from "react";
import { DocCard } from "./DocCard";
import type { BidDocument, DocType } from "@/lib/doc-queries";
import type { Bid } from "@/lib/bid-queries";

type FilterKey = "all" | DocType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "template",  label: "Templates" },
  { key: "rfp",       label: "RFP" },
  { key: "proposal",  label: "Proposal" },
  { key: "legal",     label: "Legal" },
  { key: "reference", label: "Reference" },
];

type Props = {
  docs: BidDocument[];
  bids: Bid[];
  isLoading: boolean;
  onPreview: (doc: BidDocument) => void;
};

export function DocGrid({ docs, bids, isLoading, onPreview }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [bidFilter, setBidFilter] = useState<string>("");

  const bidMap = Object.fromEntries(bids.map((b) => [b.id, b.client_name]));

  const filtered = docs.filter((d) => {
    if (filter !== "all" && d.type !== filter) return false;
    if (bidFilter === "__global") return d.bid_id === null;
    if (bidFilter && d.bid_id !== bidFilter) return false;
    return true;
  });

  const globalDocs = filtered.filter((d) => d.bid_id === null);
  const bidDocs    = filtered.filter((d) => d.bid_id !== null);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border-strong text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <select
          value={bidFilter}
          onChange={(e) => setBidFilter(e.target.value)}
          className="text-[10px] bg-background border hairline border-border rounded-md px-2 py-1 text-foreground"
        >
          <option value="">By Bid: All</option>
          <option value="__global">Global only</option>
          {bids.map((b) => (
            <option key={b.id} value={b.id}>{b.client_name}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">{filtered.length} doc{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Grid content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
            <div className="text-3xl opacity-20">📁</div>
            <div className="text-[13px]">No documents yet</div>
            <div className="text-[11px]">Upload your first document using the button above</div>
          </div>
        ) : (
          <>
            {globalDocs.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Global Templates
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {globalDocs.map((doc) => (
                    <DocCard key={doc.id} doc={doc} onPreview={onPreview} />
                  ))}
                </div>
              </section>
            )}

            {bidDocs.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Bid Documents
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {bidDocs.map((doc) => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      bidName={doc.bid_id ? bidMap[doc.bid_id] : undefined}
                      onPreview={onPreview}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
