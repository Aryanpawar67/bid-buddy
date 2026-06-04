import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBid, useUpdateBid } from "@/lib/bid-queries";
import { ArrowLeft } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/_app/bids/$id/gonogo")({
  component: GoNoGo,
});

const SECTIONS = [
  {
    key: "strategic",
    title: "Strategic fit",
    weight: 0.3,
    criteria: ["Alignment with product offerings", "Client strategic importance"],
  },
  {
    key: "capability",
    title: "Capability assessment",
    weight: 0.25,
    criteria: ["Product readiness", "Delivery confidence", "Technical gap severity"],
  },
  {
    key: "commercial",
    title: "Commercial feasibility",
    weight: 0.25,
    criteria: ["Revenue potential", "Margin", "Competitive positioning"],
  },
  {
    key: "risk",
    title: "Risk evaluation",
    weight: 0.2,
    criteria: ["Legal risk", "Compliance complexity", "Timeline realism", "Integration complexity"],
  },
] as const;

function GoNoGo() {
  const { id } = useParams({ from: "/_app/bids/$id/gonogo" });
  const { data: bid } = useBid(id);
  const navigate = useNavigate();
  const update = useUpdateBid();
  const { user } = useCurrentUser();

  const [scores, setScores] = useState<Record<string, number>>({});

  const { total, decision } = useMemo(() => {
    let sum = 0;
    for (const s of SECTIONS) {
      const vals = s.criteria.map((c) => scores[`${s.key}.${c}`] ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length || 0;
      sum += (mean / 5) * 100 * s.weight;
    }
    const t = Math.round(sum);
    const d: "go" | "conditional_go" | "no_go" =
      t >= 65 ? "go" : t >= 45 ? "conditional_go" : "no_go";
    return { total: t, decision: d };
  }, [scores]);

  if (!bid) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  async function save() {
    await update.mutateAsync({
      id: bid!.id,
      patch: {
        gonogo_score: total,
        gonogo_decision: decision,
        gonogo_completed_at: new Date().toISOString(),
        gonogo_completed_by: user?.id ?? null,
      } as never,
    });
    navigate({ to: "/bids/$id", params: { id: bid!.id } });
  }

  const verdictCls =
    decision === "go"
      ? "bg-success-soft text-success-foreground border-[#97C459]"
      : decision === "conditional_go"
      ? "bg-warning-soft text-warning-foreground border-[#FB794B]"
      : "bg-danger-soft text-danger-foreground border-[#A32D2D]";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <button
          onClick={() => navigate({ to: "/bids/$id", params: { id: bid.id } })}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="size-3.5" /> Back to bid
        </button>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-[18px] font-medium">Go / No-Go Scorecard</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {bid.client_name} · {bid.title}
            </p>
          </div>
          <div className={`px-3 py-2 rounded-lg border hairline text-right ${verdictCls}`}>
            <div className="text-[10px] uppercase tracking-wider">Verdict</div>
            <div className="text-[18px] font-medium leading-none mt-1">{total}</div>
            <div className="text-[10px] mt-1 capitalize">{decision.replace("_", " ")}</div>
          </div>
        </div>

        {SECTIONS.map((s) => (
          <section key={s.key} className="bg-card hairline border rounded-xl p-4 mb-3">
            <header className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium">{s.title}</h3>
              <span className="text-[10px] text-muted-foreground">{Math.round(s.weight * 100)}% weight</span>
            </header>
            <ul className="space-y-2">
              {s.criteria.map((c) => {
                const k = `${s.key}.${c}`;
                const val = scores[k] ?? 0;
                return (
                  <li key={c} className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span className="text-[12px]">{c}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setScores((p) => ({ ...p, [k]: n }))}
                          className={`size-7 rounded-md text-[11px] hairline border ${
                            val >= n ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => navigate({ to: "/bids/$id", params: { id: bid.id } })}
            className="h-9 px-3.5 rounded-md hairline border bg-card text-[12px] hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={update.isPending}
            className="h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-50"
          >
            Save decision
          </button>
        </div>
      </div>
    </div>
  );
}
