import { ArrowRight } from "lucide-react";
import { STAGES, stageLabel, type StageKey } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";
import { useUpdateBid } from "@/lib/bid-queries";

export function AdvanceStageFooter({ bid, stage }: { bid: Bid; stage: StageKey }) {
  const updateBid = useUpdateBid();
  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const currentIdx = STAGES.findIndex((s) => s.key === bid.stage);
  const next = STAGES[currentIdx + 1];

  if (!next || stageIdx !== currentIdx) return null;

  async function advance() {
    if (next.key === "rfi") {
      if (bid.gonogo_decision !== "go" && bid.gonogo_decision !== "conditional_go") {
        alert("Set a Go or Conditional Go decision in the Qualification Result tab before advancing to RFI.");
        return;
      }
    }
    await updateBid.mutateAsync({ id: bid.id, patch: { stage: next.key }, currentStage: bid.stage });
  }

  return (
    <div className="mt-6 pt-4 border-t hairline border-border flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">
        Stage: <strong className="text-foreground">{stageLabel(stage)}</strong>
      </span>
      <button
        onClick={advance}
        disabled={updateBid.isPending}
        className="h-9 px-4 rounded-md bg-accent text-accent-foreground text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {updateBid.isPending ? "…" : <>Advance to {next.short} <ArrowRight className="size-3.5" /></>}
      </button>
    </div>
  );
}
