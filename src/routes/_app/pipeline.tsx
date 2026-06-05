import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BidCard } from "@/components/bids/BidCard";
import { StageNav } from "@/components/bids/StageNav";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { useBids } from "@/lib/bid-queries";
import { Search } from "lucide-react";
import type { StageKey } from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/pipeline")({
  component: PipelinePage,
});

type Filter = "all" | "mine" | "legal" | "urgent";

function PipelinePage() {
  const { data: bids = [], isLoading } = useBids();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageKey | null>(null);

  const filtered = useMemo(() => {
    return bids.filter((b) => {
      if (q && !`${b.client_name} ${b.title}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "urgent") {
        const days = Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000);
        if (days > 5) return false;
      }
      return true;
    });
  }, [bids, q, filter]);

  const selected = filtered.find((b) => b.id === selectedId) ?? filtered[0];

  useEffect(() => {
    if (selected && selectedId !== selected.id) setSelectedId(selected.id);
    if (selected && !selectedStage) setSelectedStage(selected.stage);
  }, [selected, selectedId, selectedStage]);

  return (
    <div className="h-full flex">
      <aside className="w-[260px] shrink-0 bg-surface hairline border-r flex flex-col">
        <div className="p-3 hairline border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium">Bids</h2>
            <span className="text-[10px] text-muted-foreground">{filtered.length}</span>
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bids…"
              className="w-full h-7 pl-7 pr-2 rounded-md hairline border bg-card text-[12px]"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "mine", "legal", "urgent"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-wider px-2 h-6 rounded-sm capitalize ${
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-[12px] text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted-foreground">
              No bids yet. Click <strong>New bid</strong> to start.
            </div>
          ) : (
            filtered.map((b) => (
              <BidCard
                key={b.id}
                bid={b}
                active={selected?.id === b.id}
                onClick={() => {
                  setSelectedId(b.id);
                  setSelectedStage(b.stage);
                  navigate({ to: "/bids/$id", params: { id: b.id } });
                }}
              />
            ))
          )}
        </div>
      </aside>

      {selected && selectedStage ? (
        <>
          <StageNav
            current={selected.stage}
            selected={selectedStage}
            onSelect={(s) => setSelectedStage(s)}
          />
          <StageWorkspace bid={selected} stage={selectedStage} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          Select a bid to begin.
        </div>
      )}
    </div>
  );
}
