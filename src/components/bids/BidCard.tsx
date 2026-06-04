import { STAGES, type StageKey, stageLabel, urgencyClass, fmtMoney } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";

export function BidCard({
  bid,
  active,
  onClick,
}: {
  bid: Bid;
  active: boolean;
  onClick: () => void;
}) {
  const u = urgencyClass(bid.deadline);
  const stageIdx = STAGES.findIndex((s) => s.key === bid.stage);
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 border-b hairline transition-colors",
        active ? "bg-card border-l-2 border-l-primary -ml-px" : "hover:bg-card/60",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <PriorityDot p={bid.priority} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight truncate">{bid.client_name}</div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{bid.title}</div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="text-[9px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded-sm"
              style={{
                background: `oklch(0.96 ${0.02 + stageIdx * 0.005} ${280 - stageIdx * 12})`,
                color: `oklch(0.35 ${0.15 + stageIdx * 0.005} ${280 - stageIdx * 12})`,
              }}
            >
              {STAGES[stageIdx]?.short ?? bid.stage}
            </span>
            <span className={`text-[10px] ${u.className}`}>{u.label}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{fmtMoney(bid.value)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function PriorityDot({ p }: { p: "high" | "medium" | "low" }) {
  const color = p === "high" ? "bg-destructive" : p === "medium" ? "bg-warning" : "bg-success";
  return <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${color}`} title={p} />;
}

export function StatusBadge({ stage, bidStage }: { stage: StageKey; bidStage: StageKey }) {
  const iS = STAGES.findIndex((s) => s.key === stage);
  const iB = STAGES.findIndex((s) => s.key === bidStage);
  if (iS < iB)
    return <Badge cls="bg-success-soft text-success-foreground border-[#97C459]">Submitted</Badge>;
  if (iS === iB)
    return <Badge cls="bg-primary-soft text-primary border-primary-light">In progress</Badge>;
  return <Badge cls="bg-muted text-muted-foreground border-border">Not started</Badge>;
}

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-sm hairline border ${cls}`}>
      {children}
    </span>
  );
}

export { stageLabel };
