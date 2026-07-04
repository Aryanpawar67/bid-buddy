import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { BidDocSection } from "@/components/bids/BidDocSection";
import { useBid } from "@/lib/bid-queries";
import { type StageKey } from "@/lib/bid-constants";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/_app/bids/$id")({
  component: BidDetail,
});

function BidDetail() {
  const { id } = useParams({ from: "/_app/bids/$id" });
  const { data: bid, isLoading } = useBid(id);
  const [view, setView] = useState<"stages" | "documents">("stages");
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!bid) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-2">
        <div className="text-sm">Bid not found.</div>
        <button onClick={() => navigate({ to: "/dashboard" })} className="text-[12px] text-primary underline">
          Back to pipeline
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Left panel — bid info only, no stage list */}
      <div className="w-[220px] shrink-0 bg-surface hairline border-r flex flex-col">

        {/* Bid info */}
        <div className="px-4 pt-4 pb-3 border-b hairline border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bid</div>
          <div className="text-[14px] font-medium leading-tight">{bid.client_name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{bid.title}</div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Documents toggle at bottom */}
        <div className="p-3 border-t hairline border-border">
          <button
            onClick={() => setView(view === "documents" ? "stages" : "documents")}
            className={[
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-medium transition-colors",
              view === "documents"
                ? "bg-primary text-primary-foreground"
                : "hairline border border-border text-muted-foreground hover:bg-card hover:text-foreground",
            ].join(" ")}
          >
            <FileText className="size-3.5 shrink-0" />
            {view === "documents" ? "← Back to Workspace" : "Documents"}
          </button>
        </div>
      </div>

      {/* Main content */}
      {view === "stages" && <StageWorkspace bid={bid} stage={bid.stage as StageKey} />}
      {view === "documents" && <BidDocSection bid={bid} />}
    </div>
  );
}
