import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StageNav } from "@/components/bids/StageNav";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { BidDocSection } from "@/components/bids/BidDocSection";
import { useBid } from "@/lib/bid-queries";
import type { StageKey } from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/bids/$id")({
  component: BidDetail,
});

type View = "stages" | "documents";

function BidDetail() {
  const { id } = useParams({ from: "/_app/bids/$id" });
  const { data: bid, isLoading } = useBid(id);
  const [stage, setStage] = useState<StageKey | null>(null);
  const [view, setView] = useState<View>("stages");
  const navigate = useNavigate();

  useEffect(() => {
    if (bid && !stage) setStage(bid.stage);
  }, [bid, stage]);

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
      {/* Left sidebar */}
      <div className="w-[260px] shrink-0 bg-surface hairline border-r p-4 flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bid</div>
        <div className="text-[14px] font-medium leading-tight">{bid.client_name}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{bid.title}</div>

        {/* View toggle */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setView("stages")}
            className={[
              "flex-1 text-[10px] py-1.5 rounded-md border hairline transition-colors",
              view === "stages"
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:bg-background",
            ].join(" ")}
          >
            Stages
          </button>
          <button
            onClick={() => setView("documents")}
            className={[
              "flex-1 text-[10px] py-1.5 rounded-md border hairline transition-colors",
              view === "documents"
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:bg-background",
            ].join(" ")}
          >
            Documents
          </button>
        </div>
      </div>

      {/* Main content */}
      {view === "stages" && stage && (
        <>
          <StageNav current={bid.stage} selected={stage} onSelect={setStage} />
          <StageWorkspace bid={bid} stage={stage} />
        </>
      )}
      {view === "documents" && (
        <BidDocSection bid={bid} />
      )}
    </div>
  );
}
