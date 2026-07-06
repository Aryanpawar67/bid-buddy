import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBids } from "@/lib/bid-queries";
import type { StageKey } from "@/lib/bid-constants";
import { PursuitRoster } from "@/components/bids/PursuitRoster";
import { BidHeaderBar } from "@/components/bids/BidHeaderBar";
import { BidWorkspaceRail } from "@/components/bids/BidWorkspaceRail";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import type { Tab } from "@/components/bids/DealQualificationWorkspace";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

type Filter = "all" | "mine" | "legal" | "urgent";

function PipelinePage() {
  const { data: bids = [], isLoading } = useBids();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewStage, setViewStage] = useState<StageKey | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("bid_details");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rosterCollapsed, setRosterCollapsed] = useState(false);

  const filtered = useMemo(() => {
    return bids.filter((b) => {
      if (q && !`${b.client_name} ${b.title}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "urgent") {
        const days = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
        if (days > 3) return false;
      }
      return true;
    });
  }, [bids, q, filter]);

  const selected = filtered.find((b) => b.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="h-full flex overflow-hidden">
      <PursuitRoster
        bids={isLoading ? [] : filtered}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          setSelectedId(id);
          setViewStage(null);
          setActiveTab("bid_details");
          setRosterCollapsed(true);
        }}
        collapsed={rosterCollapsed}
        onToggleCollapse={() => setRosterCollapsed((c) => !c)}
        q={q}
        onQ={setQ}
        filter={filter}
        onFilter={setFilter}
      />

      {selected ? (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <BidHeaderBar
            bid={selected}
            viewStage={viewStage ?? selected.stage}
            onViewStage={setViewStage}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 overflow-y-auto">
              <StageWorkspace
                bid={selected}
                stage={viewStage ?? selected.stage}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </div>
            <BidWorkspaceRail
              bid={selected}
              isDealQual={
                (viewStage ?? selected.stage) === "deal_qualification" &&
                activeTab === "qualification_result"
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          {isLoading ? "Loading…" : "No bids yet. Click New bid to start."}
        </div>
      )}
    </div>
  );
}
