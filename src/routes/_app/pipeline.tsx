import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBids } from "@/lib/bid-queries";
import type { StageKey } from "@/lib/bid-constants";
import { PursuitRoster } from "@/components/bids/PursuitRoster";
import { BidHeaderBar, type TabDef } from "@/components/bids/BidHeaderBar";
import { BidWorkspaceRail } from "@/components/bids/BidWorkspaceRail";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { TABS as DQ_TABS } from "@/components/bids/DealQualificationWorkspace";
import { RFI_TABS } from "@/components/bids/RFIWorkspace";
import { RFP_TABS } from "@/components/bids/RFPWorkspace";
import { LayoutList } from "lucide-react";

export const Route = createFileRoute("/_app/pipeline")({
  validateSearch: (search: Record<string, unknown>) => ({
    bidId: typeof search.bidId === "string" ? search.bidId : undefined,
    stage: typeof search.stage === "string" ? (search.stage as StageKey) : undefined,
  }),
  component: PipelinePage,
});

type Filter = "all" | "mine" | "legal" | "urgent";

function getTabsForStage(stage: StageKey): TabDef[] {
  if (stage === "deal_qualification") return DQ_TABS as TabDef[];
  if (stage === "rfi") return RFI_TABS;
  if (stage === "rfp") return RFP_TABS;
  return [{ key: "overview", label: "Overview", icon: LayoutList }];
}

function defaultTabForStage(stage: StageKey): string {
  if (stage === "deal_qualification") return "bid_details";
  return "overview";
}

function PipelinePage() {
  const { data: bids = [], isLoading } = useBids();
  const { bidId: urlBidId, stage: urlStage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [activeTab, setActiveTab] = useState<string>("bid_details");
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

  const selected = filtered.find((b) => b.id === urlBidId) ?? filtered[0] ?? null;
  const effectiveStage = (urlStage ?? selected?.stage ?? "deal_qualification") as StageKey;
  const tabs = getTabsForStage(effectiveStage);

  function handleBidDeleted(bidId: string) {
    if (urlBidId === bidId) {
      const remaining = filtered.filter((b) => b.id !== bidId);
      const next = remaining[0];
      if (next) {
        navigate({ search: { bidId: next.id, stage: next.stage as StageKey } });
      } else {
        navigate({ search: {} });
      }
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      <PursuitRoster
        bids={isLoading ? [] : filtered}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          const bid = bids.find((b) => b.id === id);
          navigate({ search: { bidId: id, stage: bid?.stage as StageKey } });
          setActiveTab(bid ? defaultTabForStage(bid.stage as StageKey) : "overview");
          setRosterCollapsed(true);
        }}
        onDelete={handleBidDeleted}
        collapsed={rosterCollapsed}
        onToggleCollapse={() => {
          if (!rosterCollapsed) navigate({ to: "/dashboard" });
          else setRosterCollapsed(false);
        }}
        q={q}
        onQ={setQ}
        filter={filter}
        onFilter={setFilter}
      />

      {selected ? (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <BidHeaderBar
            bid={selected}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 overflow-y-auto">
              <StageWorkspace
                bid={selected}
                stage={effectiveStage}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </div>
            <BidWorkspaceRail
              bid={selected}
              isDealQual={
                effectiveStage === "deal_qualification" &&
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
