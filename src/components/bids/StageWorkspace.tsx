import { stageLabel, type StageKey } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";
import { DealQualificationWorkspace, type Tab } from "./DealQualificationWorkspace";
import { RFIWorkspace } from "./RFIWorkspace";
import { RFPWorkspace } from "./RFPWorkspace";

export function StageWorkspace({
  bid,
  stage,
  activeTab,
  onTabChange,
}: {
  bid: Bid;
  stage: StageKey;
  activeTab: string;
  onTabChange: (t: string) => void;
}) {
  if (stage === "deal_qualification") {
    return <DealQualificationWorkspace bid={bid} activeTab={activeTab as Tab} onTabChange={onTabChange} />;
  }
  if (stage === "rfi") return <RFIWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
  if (stage === "rfp") return <RFPWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
  return <ComingSoonWorkspace stage={stage} />;
}

function ComingSoonWorkspace({ stage }: { stage: string }) {
  const label = stageLabel(stage);
  return (
    <div className="flex-1 flex items-center justify-center p-16">
      <div className="text-center max-w-xs">
        <div className="text-[40px] mb-4 opacity-60">🚧</div>
        <div className="text-[15px] font-bold mb-2">{label}</div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          This stage is under construction and will be available soon.
        </p>
      </div>
    </div>
  );
}
