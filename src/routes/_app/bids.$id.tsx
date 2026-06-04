import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StageNav } from "@/components/bids/StageNav";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { useBid } from "@/lib/bid-queries";
import type { StageKey } from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/bids/$id")({
  component: BidDetail,
});

function BidDetail() {
  const { id } = useParams({ from: "/_app/bids/$id" });
  const { data: bid, isLoading } = useBid(id);
  const [stage, setStage] = useState<StageKey | null>(null);
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
      <div className="w-[260px] shrink-0 bg-surface hairline border-r p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bid</div>
        <div className="text-[14px] font-medium leading-tight">{bid.client_name}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{bid.title}</div>
      </div>
      {stage && (
        <>
          <StageNav current={bid.stage} selected={stage} onSelect={setStage} />
          <StageWorkspace bid={bid} stage={stage} />
        </>
      )}
    </div>
  );
}
