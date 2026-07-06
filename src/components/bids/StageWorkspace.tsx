import { Check, Circle, AlertTriangle, MessageSquare, ArrowRight } from "lucide-react";
import { STAGES, type StageKey, TEAM_LABEL } from "@/lib/bid-constants";
import type { Bid } from "@/lib/bid-queries";
import { useStageItems, useToggleDeliverable, useToggleQuestion, useUpdateBid } from "@/lib/bid-queries";
import { DealQualificationWorkspace, type Tab } from "./DealQualificationWorkspace";
import { RFIWorkspace } from "./RFIWorkspace";
import { RFPWorkspace } from "./RFPWorkspace";
import { BAFOWorkspace } from "./BAFOWorkspace";
import { ContractWorkspace } from "./ContractWorkspace";


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
  if (stage === "bafo") return <BAFOWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
  if (stage === "contract_closure") return <ContractWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;

  const items = useStageItems(bid.id, stage);
  const toggleD = useToggleDeliverable();
  const toggleQ = useToggleQuestion();
  const updateBid = useUpdateBid();

  const deliverables = items.data?.deliverables ?? [];
  const questions = items.data?.questions ?? [];
  const totalItems = deliverables.length + questions.length;
  const doneItems =
    deliverables.filter((d) => d.status === "done").length +
    questions.filter((q) => q.status === "done").length;
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const currentIdx = STAGES.findIndex((s) => s.key === bid.stage);

  async function advance() {
    const next = STAGES[currentIdx + 1];
    if (!next) return;
    if (next.key === "rfi" && bid.gonogo_decision !== "go" && bid.gonogo_decision !== "conditional_go") {
      alert("Complete the Go / No-Go scorecard with a Go or Conditional Go before advancing to RFI.");
      return;
    }
    await updateBid.mutateAsync({ id: bid.id, patch: { stage: next.key } });
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="px-6 py-5 max-w-[1100px]">
        {/* Progress bar — RFI / RFP only */}
        {(stage === "rfi" || stage === "rfp") && (
          <div className="mb-4">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* Checklist: Deliverables */}
        <Card
          title="Checklist"
          subtitle={`${doneItems}/${totalItems} complete`}
        >
          {items.isLoading ? (
            <Empty>Loading…</Empty>
          ) : totalItems === 0 ? (
            <Empty>No items yet for this stage.</Empty>
          ) : (
            <ul className="divide-y hairline divide-border">
              {deliverables.map((d) => (
                <ChecklistRow
                  key={d.id}
                  label={d.label}
                  meta={`${TEAM_LABEL[d.assigned_team] ?? d.assigned_team} · ${d.type}`}
                  status={d.status}
                  onToggle={(next) => toggleD.mutate({ id: d.id, status: next })}
                />
              ))}
              {questions.map((q) => (
                <ChecklistRow
                  key={q.id}
                  label={q.question_text}
                  meta={`Question · ${TEAM_LABEL[q.assigned_team] ?? q.assigned_team}`}
                  status={q.status}
                  onToggle={(next) => toggleQ.mutate({ id: q.id, status: next })}
                  icon={<MessageSquare className="size-3.5 text-muted-foreground" />}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-5">
          {stageIdx === currentIdx && currentIdx < STAGES.length - 1 && (
            <button
              onClick={advance}
              disabled={updateBid.isPending}
              className="h-9 px-3.5 rounded-md bg-accent text-accent-foreground text-[12px] font-medium hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              Advance to {STAGES[currentIdx + 1].short} <ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card hairline border rounded-xl p-3.5 mb-3.5">
      <header className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-medium">{title}</h3>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}


function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-muted-foreground py-3 text-center">{children}</div>;
}

function ChecklistRow({
  label,
  meta,
  status,
  onToggle,
  icon,
}: {
  label: string;
  meta: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  onToggle: (next: "pending" | "done") => void;
  icon?: React.ReactNode;
}) {
  const done = status === "done";
  const blocked = status === "blocked";
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <button
        onClick={() => onToggle(done ? "pending" : "done")}
        className={[
          "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border",
          done
            ? "bg-success-soft border-[#97C459]"
            : blocked
            ? "bg-warning-soft border-[#FB794B]"
            : "border-dashed border-border-strong",
        ].join(" ")}
        aria-label="Toggle status"
      >
        {done && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
        {blocked && <AlertTriangle className="size-3 text-warning-foreground" strokeWidth={2} />}
        {!done && !blocked && <Circle className="size-2 text-muted-foreground/40" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={`text-[12.5px] leading-snug ${
            done ? "text-muted-foreground line-through" : blocked ? "text-warning-foreground" : ""
          }`}
        >
          {label}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
          {icon}
          {meta}
        </div>
      </div>
    </li>
  );
}
