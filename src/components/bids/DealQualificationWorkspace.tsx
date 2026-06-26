import { useState, useMemo } from "react";
import { Lock, CheckCircle2, Users, ClipboardList, BarChart3, Activity, ArrowRight } from "lucide-react";
import { STAGES, stageLabel, fmtMoney, urgencyClass, initials } from "@/lib/bid-constants";
import type { Bid, AssessmentData } from "@/lib/bid-queries";
import {
  useBidTeam,
  useAssessmentData,
  useSaveAssessment,
  useBidActivity,
  useUpdateBid,
} from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import { StatusBadge } from "./BidCard";

// TODO: load from org_settings to allow admin customisation
const DEFAULT_CRITERIA = [
  {
    id: "strategic_fit",
    parameter: "Strategic Opportunity Fit",
    focus: "Does this opportunity align with iMocha's core offerings (Skills Intelligence, Assessments, Internal Mobility, Workforce Planning, Talent Intelligence, Hiring)?",
    weight: 0.15,
  },
  {
    id: "business_problem",
    parameter: "Business Problem Clarity",
    focus: "Is the client's business challenge clearly defined with measurable outcomes? Can iMocha solve it through its Skills Intelligence platform?",
    weight: 0.10,
  },
  {
    id: "use_case",
    parameter: "Use Case Alignment",
    focus: "Are the requested use cases directly supported by iMocha capabilities without major customization?",
    weight: 0.10,
  },
  {
    id: "stakeholder",
    parameter: "Customer Stakeholder & Decision Readiness",
    focus: "Executive sponsor identified? Decision makers engaged? Procurement only or business-led opportunity?",
    weight: 0.10,
  },
  {
    id: "commercial",
    parameter: "Commercial Attractiveness",
    focus: "Deal size, expansion potential, ARR opportunity, strategic logo value, long-term revenue potential.",
    weight: 0.10,
  },
  {
    id: "competitive",
    parameter: "Competitive Position",
    focus: "Does iMocha have clear differentiators against competitors? Are incumbents, competitor strengths, and customer evaluation criteria understood?",
    weight: 0.10,
  },
  {
    id: "implementation",
    parameter: "Implementation Feasibility",
    focus: "Can iMocha realistically deliver the solution within the expected timeline, considering resources, integrations, dependencies, and implementation complexity?",
    weight: 0.10,
  },
  {
    id: "technical",
    parameter: "Technical & Security Fit",
    focus: "API readiness, SSO, HRMS/LMS integration, security/compliance requirements, hosting feasibility.",
    weight: 0.10,
  },
  {
    id: "proposal_risk",
    parameter: "Proposal Risk Assessment",
    focus: "Scope ambiguity, unrealistic timelines, missing information, customization risk, contractual risks.",
    weight: 0.10,
  },
  {
    id: "value_realization",
    parameter: "Value Realization & Expansion Potential",
    focus: "Can this opportunity generate measurable business outcomes and open doors for future use cases, business units, geographies, or long-term partnerships?",
    weight: 0.05,
  },
] as const;

type Tab = "bid_details" | "bid_team" | "bid_assessment" | "qualification_result" | "activity_log";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "bid_details", label: "Bid Details", icon: ClipboardList },
  { key: "bid_team", label: "Bid Team Details", icon: Users },
  { key: "bid_assessment", label: "Bid Assessment", icon: BarChart3 },
  { key: "qualification_result", label: "Qualification Result", icon: CheckCircle2 },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

export function DealQualificationWorkspace({ bid }: { bid: Bid }) {
  const [activeTab, setActiveTab] = useState<Tab>("bid_details");
  const updateBid = useUpdateBid();
  const currentIdx = STAGES.findIndex((s) => s.key === bid.stage);

  async function advance() {
    const next = STAGES[currentIdx + 1];
    if (!next) return;
    if (next.key === "rfi" && bid.gonogo_decision !== "go" && bid.gonogo_decision !== "conditional_go") {
      alert("Lock a Go or Conditional Go decision in the Qualification Result tab before advancing to RFI.");
      return;
    }
    await updateBid.mutateAsync({ id: bid.id, patch: { stage: next.key }, currentStage: bid.stage });
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="px-6 py-5 max-w-[1200px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-[18px] font-medium">{stageLabel("deal_qualification")}</h1>
              <StatusBadge stage="deal_qualification" bidStage={bid.stage} />
            </div>
            <p className="text-[12px] text-muted-foreground">
              Assess strategic fit, capability, commercial feasibility and risk.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Deal value</div>
            <div className="text-[18px] font-medium">{fmtMoney(bid.value)}</div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-muted/40 p-1 rounded-lg w-fit">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                ].join(" ")}
              >
                <Icon className="size-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === "bid_details" && <BidDetailsTab bid={bid} />}
        {activeTab === "bid_team" && <BidTeamTab bid={bid} />}
        {activeTab === "bid_assessment" && <BidAssessmentTab bid={bid} />}
        {activeTab === "qualification_result" && <QualificationResultTab bid={bid} />}
        {activeTab === "activity_log" && <ActivityLogTab bid={bid} />}

        {/* Advance button — always visible */}
        {currentIdx < STAGES.length - 1 && bid.stage === "deal_qualification" && (
          <div className="flex justify-end mt-5">
            <button
              onClick={advance}
              disabled={updateBid.isPending}
              className="h-9 px-3.5 rounded-md bg-accent text-accent-foreground text-[12px] font-medium hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              Advance to {STAGES[currentIdx + 1].short} <ArrowRight className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bid Details Tab ───────────────────────────────────────────────────────────

function BidDetailsTab({ bid }: { bid: Bid }) {
  const u = urgencyClass(bid.deadline);
  return (
    <div className="space-y-3.5">
      <Card title="Opportunity">
        <KV label="Client" value={bid.client_name} />
        <KV label="Title" value={bid.title} />
        <KV label="Type" value={bid.type.toUpperCase()} />
        <KV label="Priority" value={bid.priority} />
        <KV label="Portal" value={bid.procurement_portal ?? "—"} />
        <KV label="Deal Value" value={fmtMoney(bid.value)} />
      </Card>
      <Card title="Timeline">
        <KV label="Bid Deadline" value={new Date(bid.deadline).toLocaleDateString()} foot={u.label} footClass={u.className} />
        {bid.clarification_deadline && (
          <KV label="Clarification Deadline" value={new Date(bid.clarification_deadline).toLocaleDateString()} />
        )}
        {bid.orals_date && (
          <KV label="Orals Date" value={new Date(bid.orals_date).toLocaleDateString()} />
        )}
      </Card>
      {bid.gonogo_decision && (
        <Card title="Qualification Decision">
          <KV
            label="Score"
            value={bid.gonogo_score !== null ? `${Math.round(bid.gonogo_score)} / 100` : "—"}
          />
          <KV
            label="Decision"
            value={bid.gonogo_decision.replace(/_/g, " ")}
            valueClass={
              bid.gonogo_decision === "go"
                ? "text-success-foreground font-semibold capitalize"
                : bid.gonogo_decision === "conditional_go"
                ? "text-warning-foreground font-semibold capitalize"
                : "text-danger-foreground font-semibold capitalize"
            }
          />
          {bid.gonogo_completed_at && (
            <KV label="Locked on" value={new Date(bid.gonogo_completed_at).toLocaleDateString()} />
          )}
        </Card>
      )}
    </div>
  );
}

// ── Bid Team Tab ──────────────────────────────────────────────────────────────

function BidTeamTab({ bid }: { bid: Bid }) {
  const { data: members = [], isLoading } = useBidTeam(bid.id);

  return (
    <Card title="Assigned Team Members" subtitle={`${members.length} member${members.length !== 1 ? "s" : ""}`}>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : members.length === 0 ? (
        <Empty>No team members assigned to this bid yet.</Empty>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 font-medium">Member</th>
              <th className="text-left py-2 font-medium">Role</th>
              <th className="text-left py-2 font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y hairline divide-border">
            {members.map((m) => (
              <tr key={m.assignment_id}>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-full bg-primary/10 text-primary text-[10px] font-medium flex items-center justify-center shrink-0">
                      {initials(m.full_name)}
                    </div>
                    <span className="font-medium">{m.full_name}</span>
                  </div>
                </td>
                <td className="py-2.5 capitalize text-muted-foreground">{m.role.replace(/_/g, " ")}</td>
                <td className="py-2.5 text-muted-foreground">{m.email || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Bid Assessment Tab ────────────────────────────────────────────────────────

function BidAssessmentTab({ bid }: { bid: Bid }) {
  const { data: saved, isLoading } = useAssessmentData(bid.id);
  const saveAssessment = useSaveAssessment();

  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [initialised, setInitialised] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Seed local state from saved data once loaded
  if (!initialised && saved && !isLoading) {
    setScores(saved.scores ?? {});
    setComments(saved.comments ?? {});
    setInitialised(true);
  }

  function setScore(id: string, val: number) {
    setScores((p) => ({ ...p, [id]: val }));
    setDirty(true);
  }

  function setComment(id: string, val: string) {
    setComments((p) => ({ ...p, [id]: val }));
    setDirty(true);
  }

  async function handleSave() {
    await saveAssessment.mutateAsync({ bidId: bid.id, data: { scores, comments } });
    setDirty(false);
  }

  const totalWeighted = useMemo(() => {
    return DEFAULT_CRITERIA.reduce((sum, c) => {
      const s = scores[c.id] ?? 0;
      return sum + (s / 5) * c.weight * 100;
    }, 0);
  }, [scores]);

  if (isLoading) {
    return <Empty>Loading assessment…</Empty>;
  }

  return (
    <div>
      <div className="bg-card hairline border rounded-xl overflow-hidden mb-3.5">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3.5 py-2.5 font-medium w-8">#</th>
                <th className="text-left px-3.5 py-2.5 font-medium w-48">Assessment Parameter</th>
                <th className="text-left px-3.5 py-2.5 font-medium">What should be assessed?</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-16">Weight</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-36">Score (1–5)</th>
                <th className="text-left px-3.5 py-2.5 font-medium w-44">Comments</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-28">Weighted Score</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline divide-border">
              {DEFAULT_CRITERIA.map((c, i) => {
                const score = scores[c.id] ?? 0;
                const weightedMax = c.weight * 100;
                const weightedEarned = (score / 5) * weightedMax;
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3.5 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-3.5 py-3 font-medium leading-snug">{c.parameter}</td>
                    <td className="px-3.5 py-3 text-muted-foreground leading-relaxed text-[11px]">{c.focus}</td>
                    <td className="px-3.5 py-3 text-center font-medium">{Math.round(c.weight * 100)}%</td>
                    <td className="px-3.5 py-3">
                      <div className="flex gap-1 justify-center">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setScore(c.id, n)}
                            className={[
                              "size-7 rounded-md text-[11px] hairline border transition-colors",
                              score >= n
                                ? "bg-primary text-white border-primary"
                                : "bg-card hover:bg-muted border-border",
                            ].join(" ")}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3.5 py-3">
                      <input
                        type="text"
                        value={comments[c.id] ?? ""}
                        onChange={(e) => setComment(c.id, e.target.value)}
                        placeholder="Add note…"
                        className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground border-0 outline-none focus:ring-0 p-0"
                      />
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      {score > 0 ? (
                        <span className="font-medium">{weightedEarned.toFixed(1)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <span className="text-muted-foreground"> / {weightedMax.toFixed(0)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-medium">
                <td colSpan={6} className="px-3.5 py-2.5 text-[11px] text-right uppercase tracking-wider text-muted-foreground">
                  Total Weighted Score
                </td>
                <td className="px-3.5 py-2.5 text-center text-[14px] font-semibold">
                  {totalWeighted.toFixed(1)}
                  <span className="text-[11px] text-muted-foreground font-normal"> / 100</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!dirty || saveAssessment.isPending}
          className="h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {saveAssessment.isPending ? "Saving…" : "Save Assessment"}
        </button>
      </div>
    </div>
  );
}

// ── Qualification Result Tab ──────────────────────────────────────────────────

function QualificationResultTab({ bid }: { bid: Bid }) {
  const { data: assessmentData, isLoading } = useAssessmentData(bid.id);
  const updateBid = useUpdateBid();
  const { user } = useCurrentUser();

  const { totalScore, decision } = useMemo(() => {
    const scores = assessmentData?.scores ?? {};
    const total = DEFAULT_CRITERIA.reduce((sum, c) => {
      const s = scores[c.id] ?? 0;
      return sum + (s / 5) * c.weight * 100;
    }, 0);
    const t = Math.round(total);
    const d: "go" | "conditional_go" | "no_go" =
      t >= 65 ? "go" : t >= 45 ? "conditional_go" : "no_go";
    return { totalScore: t, decision: d };
  }, [assessmentData]);

  const isLocked = !!bid.gonogo_decision;

  async function lockDecision() {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: {
        gonogo_score: totalScore,
        gonogo_decision: decision,
        gonogo_completed_at: new Date().toISOString(),
        gonogo_completed_by: user?.id ?? null,
      } as never,
    });
  }

  const verdictCls =
    decision === "go"
      ? "bg-success-soft text-success-foreground border-[#97C459]"
      : decision === "conditional_go"
      ? "bg-warning-soft text-warning-foreground border-[#FB794B]"
      : "bg-danger-soft text-danger-foreground border-[#A32D2D]";

  const scoreCls =
    totalScore >= 65
      ? "text-success-foreground"
      : totalScore >= 45
      ? "text-warning-foreground"
      : "text-danger-foreground";

  if (isLoading) return <Empty>Loading…</Empty>;

  const hasScores = Object.keys(assessmentData?.scores ?? {}).length > 0;

  return (
    <div className="space-y-3.5">
      {/* Score hero */}
      <Card title="Overall Score">
        <div className="flex items-center gap-6 py-2">
          <div className="text-center">
            <div className={`text-[52px] font-semibold leading-none ${scoreCls}`}>{totalScore}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">out of 100</div>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${
                  totalScore >= 65 ? "bg-success-foreground" : totalScore >= 45 ? "bg-warning-foreground" : "bg-danger-foreground"
                }`}
                style={{ width: `${Math.min(totalScore, 100)}%` }}
              />
            </div>
            <div className="flex gap-2 text-[10px]">
              <span className="text-success-foreground font-medium">≥ 65 Go</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-warning-foreground font-medium">45–64 Conditional Go</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-danger-foreground font-medium">&lt; 45 No Go</span>
            </div>
            <div className={`mt-3 inline-flex px-3 py-1.5 rounded-lg hairline border text-[12px] font-semibold ${verdictCls}`}>
              {decision === "go" ? "Go" : decision === "conditional_go" ? "Conditional Go" : "No Go"}
            </div>
          </div>
        </div>
      </Card>

      {/* Criterion breakdown */}
      {hasScores && (
        <Card title="Score Breakdown">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-2 font-medium">Parameter</th>
                <th className="text-center py-2 font-medium w-16">Weight</th>
                <th className="text-center py-2 font-medium w-16">Score</th>
                <th className="text-center py-2 font-medium w-28">Contribution</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline divide-border">
              {DEFAULT_CRITERIA.map((c) => {
                const s = assessmentData?.scores[c.id] ?? 0;
                const contribution = (s / 5) * c.weight * 100;
                return (
                  <tr key={c.id}>
                    <td className="py-2">{c.parameter}</td>
                    <td className="py-2 text-center text-muted-foreground">{Math.round(c.weight * 100)}%</td>
                    <td className="py-2 text-center">
                      {s > 0 ? (
                        <span className="font-medium">{s} / 5</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-center font-medium">
                      {s > 0 ? `${contribution.toFixed(1)}` : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {!hasScores && (
        <div className="text-[12px] text-muted-foreground bg-muted/30 rounded-xl p-4 text-center hairline border">
          Complete the Bid Assessment tab to see a score breakdown here.
        </div>
      )}

      {/* Lock decision */}
      <div className="bg-card hairline border rounded-xl p-3.5">
        {isLocked ? (
          <div className="flex items-center gap-3">
            <div className={`px-3 py-2 rounded-lg hairline border text-[12px] font-semibold ${verdictCls}`}>
              {bid.gonogo_decision === "go" ? "Go" : bid.gonogo_decision === "conditional_go" ? "Conditional Go" : "No Go"}
            </div>
            <div>
              <div className="text-[12px] font-medium flex items-center gap-1.5">
                <Lock className="size-3.5" /> Decision locked
              </div>
              {bid.gonogo_completed_at && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(bid.gonogo_completed_at).toLocaleDateString(undefined, {
                    year: "numeric", month: "short", day: "numeric",
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium">Lock Go/No-Go Decision</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Saves the current score and recommendation. Required before advancing to RFI.
              </div>
            </div>
            <button
              onClick={lockDecision}
              disabled={updateBid.isPending || !hasScores}
              className="h-9 px-3.5 rounded-md bg-accent text-accent-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Lock className="size-3.5" />
              {updateBid.isPending ? "Saving…" : "Lock Decision"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Activity Log Tab ──────────────────────────────────────────────────────────

function ActivityLogTab({ bid }: { bid: Bid }) {
  const { data: events = [], isLoading } = useBidActivity(bid.id);

  return (
    <Card title="Activity Log" subtitle={`${events.length} event${events.length !== 1 ? "s" : ""}`}>
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : events.length === 0 ? (
        <Empty>No activity recorded yet.</Empty>
      ) : (
        <ul className="divide-y hairline divide-border">
          {events.map((e) => {
            const actor = (e as any).profiles?.full_name ?? "System";
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <div className="size-6 rounded-full bg-primary/10 text-primary text-[9px] font-medium flex items-center justify-center shrink-0 mt-0.5">
                  {initials(actor)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] leading-snug">{e.action}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {actor} · {new Date(e.created_at).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

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

function KV({
  label,
  value,
  foot,
  footClass,
  valueClass,
}: {
  label: string;
  value: string;
  foot?: string;
  footClass?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start justify-between py-1.5 text-[12px] hairline border-b last:border-b-0 gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="text-right">
        <span className={valueClass ?? "font-medium capitalize"}>{value}</span>
        {foot && <div className={`text-[10px] mt-0.5 ${footClass ?? "text-muted-foreground"}`}>{foot}</div>}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-muted-foreground py-4 text-center">{children}</div>;
}
