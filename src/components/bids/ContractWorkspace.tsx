import { useState } from "react";
import {
  Check, Circle, AlertTriangle, CheckCircle2,
  Users, Activity, LayoutList, FileText, Milestone, Sparkles, ArrowRight,
  Clock, ShieldCheck, XCircle, UserCircle2, CalendarDays,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import {
  useStageItems, useToggleDeliverable, useToggleQuestion, useBidTeam,
  useBidActivity, useUpdateBid,
  useContractApprovals, useEnsureApprovals, useActionApproval,
  type ContractApproval,
} from "@/lib/bid-queries";
import { useDocuments } from "@/lib/doc-queries";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/auth";
import { initials, fmtMoney } from "@/lib/bid-constants";
import { AdvanceStageFooter } from "./AdvanceStageFooter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TabDef } from "./BidHeaderBar";

export const CONTRACT_TABS: TabDef[] = [
  { key: "overview",   label: "Overview",   icon: LayoutList },
  { key: "milestones", label: "Milestones", icon: Milestone },
  { key: "documents",  label: "Documents",  icon: FileText },
  { key: "approvals",  label: "Approvals",  icon: ShieldCheck },
  { key: "team",       label: "Team",       icon: Users },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

function daysLeft(deadline: string) {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function avatarColor(name: string): string {
  const colors = ["#491AEB","#0891b2","#16a34a","#d97706","#dc2626","#7c3aed","#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

const APPROVAL_STAGE_LABELS: Record<ContractApproval["stage"], string> = {
  legal:      "Legal Review",
  commercial: "Commercial Review",
  finance:    "Finance Review",
  executive:  "Executive Approval",
};

// Which user roles can action which approval stage
const STAGE_ROLE_GATE: Record<ContractApproval["stage"], string[]> = {
  legal:      ["legal", "admin"],
  commercial: ["pre_sales", "admin"],
  finance:    ["finance", "admin"],
  executive:  ["admin"],
};

const DOC_CATEGORY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "#d97706", bg: "#fef9c3" },
  redline:    { label: "Redline",    color: "#dc2626", bg: "#fee2e2" },
  final:      { label: "Final",      color: "#16a34a", bg: "#dcfce7" },
  reference:  { label: "Reference",  color: "#6366f1", bg: "#ede9fe" },
  supporting: { label: "Supporting", color: "#0891b2", bg: "#e0f2fe" },
};

const EXT_COLORS: Record<string, { bg: string; color: string }> = {
  pdf:  { bg: "#fff1f1", color: "#e53e3e" },
  docx: { bg: "#ebf5ff", color: "#2563eb" },
  xlsx: { bg: "#edfaf4", color: "#16a34a" },
  default: { bg: "var(--color-muted)", color: "var(--color-muted-foreground)" },
};

export function ContractWorkspace({ bid, activeTab, onTabChange: _onTabChange }: { bid: Bid; activeTab: string; onTabChange: (t: string) => void }) {
  const items     = useStageItems(bid.id, "contract_closure");
  const { data: team = [] }       = useBidTeam(bid.id);
  const { data: activity = [] }   = useBidActivity(bid.id);
  const { data: docs = [] }       = useDocuments({ bidId: bid.id });
  const { data: approvals = [] }  = useContractApprovals(bid.id);
  const ensureApprovals           = useEnsureApprovals();
  const [closeout, setCloseout]   = useState<"won" | "lost" | null>(null);
  const toggleD   = useToggleDeliverable();
  const toggleQ   = useToggleQuestion();
  const { primaryRole, user } = useCurrentUser();

  const deliverables = items.data?.deliverables ?? [];
  const questions    = items.data?.questions    ?? [];

  const total      = deliverables.length;
  const completed  = deliverables.filter(d => d.status === "done").length;
  const inProg     = deliverables.filter(d => d.status === "in_progress").length;
  const notStarted = deliverables.filter(d => d.status === "pending").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const dl = daysLeft(bid.deadline);
  const health = pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
  const healthColor = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  const healthBg    = pct >= 70 ? "#dcfce7"  : pct >= 40 ? "#fef9c3"  : "#fee2e2";

  // Ensure approval rows exist when first viewing this stage
  function handleEnsureApprovals() {
    if (approvals.length === 0 || approvals.every(a => a.id === "")) {
      ensureApprovals.mutate(bid.id);
    }
  }

  // ── Milestones tab ──────────────────────────────────────────────────────────
  if (activeTab === "milestones") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Contract Milestones</h3>
            <span className="text-[11px] text-muted-foreground">{completed}/{total} complete</span>
          </div>
          {deliverables.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No milestones added yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {deliverables.map((d, i) => (
                <MilestoneRow key={d.id} num={i + 1} deliverable={d}
                  onToggle={() => toggleD.mutate({ id: d.id, status: d.status === "done" ? "pending" : "done" })} />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── Documents tab ───────────────────────────────────────────────────────────
  if (activeTab === "documents") {
    return <DocumentsTab docs={docs} />;
  }

  // ── Approvals tab ───────────────────────────────────────────────────────────
  if (activeTab === "approvals") {
    return (
      <ApprovalsTab
        bid={bid}
        approvals={approvals}
        questions={questions}
        primaryRole={primaryRole}
        userId={user?.id ?? ""}
        onToggleQ={(q) => toggleQ.mutate({ id: q.id, status: q.status === "done" ? "pending" : "done" })}
        onEnsure={handleEnsureApprovals}
      />
    );
  }

  // ── Team tab ────────────────────────────────────────────────────────────────
  if (activeTab === "team") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Contract Team</h3>
          </div>
          {team.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No team members assigned.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {team.map(m => (
                <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="size-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: avatarColor(m.full_name) }}>
                    {initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-tight">{m.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">{m.email}</div>
                  </div>
                  <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary capitalize">
                    {m.role.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── Activity Log tab ────────────────────────────────────────────────────────
  if (activeTab === "activity_log") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Audit Trail</h3>
          </div>
          {activity.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {activity.map((e: any) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <div className="size-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  <div>
                    <div className="text-[12px]">{e.action}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{e.profiles?.full_name ?? "System"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── Overview ────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-5 max-w-[1100px]">
      {/* Top stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">

        {/* Progress donut */}
        <div className="bg-card hairline border rounded-xl p-4 flex flex-col items-center justify-center gap-2">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-muted)" strokeWidth="7" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#93c5fd" strokeWidth="7"
              strokeDasharray={`${((inProg) / (total || 1)) * 213.6} 213.6`}
              strokeDashoffset={`${-((completed) / (total || 1)) * 213.6}`}
              strokeLinecap="butt" transform="rotate(-90 40 40)" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#491AEB" strokeWidth="7"
              strokeDasharray={`${(pct / 100) * 213.6} 213.6`}
              strokeLinecap="round" transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dasharray .5s ease" }} />
            <text x="40" y="40" textAnchor="middle" fontSize="15" fontWeight="800" fill="currentColor">{pct}%</text>
            <text x="40" y="53" textAnchor="middle" fontSize="8" fill="var(--color-muted-foreground)">Complete</text>
          </svg>
          <div className="flex flex-col gap-1 w-full">
            <LegendRow color="#491AEB" label="Completed" value={`${completed}`} />
            <LegendRow color="#93c5fd" label="In Progress" value={`${inProg}`} />
            <LegendRow color="var(--color-muted-foreground)" label="Not Started" value={`${notStarted}`} />
          </div>
          <div className="text-[10px] font-medium" style={{ color: dl <= 5 ? "#c2410c" : "var(--color-muted-foreground)" }}>
            {dl < 0 ? `${Math.abs(dl)}d overdue` : `${dl}d to signature`}
          </div>
        </div>

        {/* Contract Details */}
        <div className="col-span-2 bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Contract Details</div>
          <div className="grid grid-cols-2 gap-y-2.5">
            <KV label="Contract Type" value={bid.type.toUpperCase()} />
            <KV label="Contract Value" value={fmtMoney(bid.value)} />
            <KV label="Target Signature" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
            <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
            <KV label="Milestones Done" value={`${completed} / ${total}`} />
            <KV label="Portal" value={bid.procurement_portal ?? "—"} />
          </div>
        </div>

        {/* Approvals mini + close-out */}
        <div className="bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Approvals</div>
          <div className="flex flex-col gap-2">
            {approvals.length === 0
              ? APPROVAL_STAGE_LABELS && Object.entries(APPROVAL_STAGE_LABELS).map(([, label], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Circle className="size-3.5 text-muted-foreground/30 shrink-0" />
                    <span className="text-[11px] flex-1">{label}</span>
                    <span className="text-[9px] font-semibold text-muted-foreground">Pending</span>
                  </div>
                ))
              : approvals.map((a) => (
                  <div key={a.stage} className="flex items-center gap-2">
                    {a.status === "approved"
                      ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
                      : a.status === "rejected"
                        ? <XCircle className="size-3.5 text-destructive shrink-0" />
                        : <Circle className="size-3.5 text-muted-foreground/30 shrink-0" />}
                    <span className="text-[11px] flex-1">{APPROVAL_STAGE_LABELS[a.stage]}</span>
                    <span className={[
                      "text-[9px] font-semibold",
                      a.status === "approved" ? "text-success-foreground"
                        : a.status === "rejected" ? "text-destructive"
                        : "text-muted-foreground"
                    ].join(" ")}>
                      {a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Pending"}
                    </span>
                  </div>
                ))
            }
          </div>
          {(bid.status === "active" || bid.status === "submitted") && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t hairline border-border">
              <button onClick={() => setCloseout("won")}
                className="h-7 px-3 rounded-md bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700">
                Mark as Won
              </button>
              <button onClick={() => setCloseout("lost")}
                className="h-7 px-3 rounded-md hairline border border-destructive text-destructive text-[11px] font-semibold hover:bg-destructive/10">
                Mark as Lost
              </button>
            </div>
          )}
          {closeout && <CloseoutModal bid={bid} outcome={closeout} onClose={() => setCloseout(null)} />}
        </div>
      </div>

      {/* Main 3-col layout */}
      <div className="grid grid-cols-3 gap-4">

        {/* Left: Milestones + Docs */}
        <div className="flex flex-col gap-4">
          <div className="bg-card hairline border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
              <h3 className="text-[12px] font-semibold">Contract Milestones</h3>
              <span className="text-[10px] text-muted-foreground">{completed}/{total}</span>
            </div>
            {deliverables.length === 0 ? (
              <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">No milestones yet.</div>
            ) : (
              <ul className="divide-y hairline divide-border">
                {deliverables.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-muted/20 transition-colors">
                    <button onClick={() => toggleD.mutate({ id: d.id, status: d.status === "done" ? "pending" : "done" })}
                      className={["size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
                        d.status === "done" ? "bg-success-soft border-[#97C459]" : d.status === "in_progress" ? "border-[#3b82f6] bg-blue-50" : "border-dashed border-border-strong"].join(" ")}>
                      {d.status === "done" && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
                      {d.status === "in_progress" && <div className="size-2 rounded-full bg-blue-400" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[11px] leading-snug ${d.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {d.label}
                      </span>
                      {(d as any).due_date && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <CalendarDays className="size-2.5 text-muted-foreground shrink-0" />
                          <span className="text-[9px] text-muted-foreground">
                            {new Date((d as any).due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {docs.length > 0 && (
            <div className="bg-card hairline border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
                <h3 className="text-[12px] font-semibold">Contract Documents</h3>
                <Link to="/docs" className="text-[10px] text-primary font-medium hover:underline">View all</Link>
              </div>
              <ul className="divide-y hairline divide-border">
                {docs.slice(0, 4).map((doc: any) => {
                  const ext = doc.name?.split(".").pop()?.toLowerCase() ?? "default";
                  const style = EXT_COLORS[ext] ?? EXT_COLORS.default;
                  const cat = DOC_CATEGORY_LABELS[doc.doc_category ?? "reference"] ?? DOC_CATEGORY_LABELS.reference;
                  return (
                    <li key={doc.id} className={[
                      "flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-muted/20 transition-colors",
                      doc.doc_category === "final" ? "bg-green-50/40 dark:bg-green-950/20" : ""
                    ].join(" ")}>
                      <div className="w-6 h-7 rounded flex items-center justify-center text-[8px] font-black shrink-0"
                        style={{ background: style.bg, color: style.color }}>
                        {ext.toUpperCase().slice(0, 3)}
                      </div>
                      <span className="text-[11px] truncate flex-1">{doc.name}</span>
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: cat.bg, color: cat.color }}>
                        {cat.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Middle: Legal AI Engine */}
        <div className="flex flex-col gap-4">
          <div className="bg-card hairline border rounded-xl overflow-hidden h-full"
            style={{ background: "linear-gradient(160deg, rgba(73,26,235,.05) 0%, rgba(73,26,235,.02) 100%)" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b hairline border-border">
              <Sparkles className="size-4 text-primary shrink-0" />
              <h3 className="text-[12px] font-semibold">Legal AI Engine</h3>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary ml-auto">Beta</span>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Use the RFx Responder to analyse contract clauses, review obligations, flag risks, and draft redline responses.
              </p>
              <Link to="/ai" search={{ bidId: bid.id }}
                className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2">
                <Sparkles className="size-3.5" />
                Open Legal AI Assistant
                <ArrowRight className="size-3" />
              </Link>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-1">Suggested questions</div>
              <div className="flex flex-col gap-2">
                {[
                  "What are the high risk clauses?",
                  "Show payment terms",
                  "Summarise indemnification clause",
                  "Are there any missing clauses?",
                ].map(q => (
                  <Link key={q} to="/ai" search={{ bidId: bid.id }}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-background hairline border border-border hover:bg-muted/50 transition-colors text-[11px] font-medium">
                    {q}
                    <ArrowRight className="size-3 ml-auto text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Contract Health + Key Risks */}
        <div className="flex flex-col gap-4">
          <div className="bg-card hairline border rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Contract Health</div>
            <span className="inline-block text-[11px] font-bold px-2.5 py-1 rounded-full mb-3"
              style={{ background: healthBg, color: healthColor }}>{health}</span>
            <div className="flex flex-col gap-2">
              <HealthCheck label="No critical issues" ok={completed > 0} />
              <HealthCheck label="All key clauses reviewed" ok={pct >= 50} />
              <HealthCheck label="Milestones on track" ok={pct >= 40} />
              <HealthCheck label="Deadline not overdue" ok={dl >= 0} />
            </div>
          </div>

          <div className="bg-card hairline border rounded-xl p-4 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">Key Risks</div>
            {questions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No open risk items.</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {questions.slice(0, 5).map((q, i) => {
                  const level = i === 0 ? "High" : i <= 1 ? "High" : i <= 3 ? "Medium" : "Low";
                  const lc = level === "High" ? "#dc2626" : level === "Medium" ? "#d97706" : "#16a34a";
                  return (
                    <li key={q.id} className="flex items-start gap-2">
                      <div className="size-1.5 rounded-full mt-1.5 shrink-0" style={{ background: lc }} />
                      <span className="text-[11px] flex-1 leading-snug line-clamp-2">{q.question_text}</span>
                      <span className="text-[9px] font-semibold shrink-0" style={{ color: lc }}>{level}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <AdvanceStageFooter bid={bid} stage="contract_closure" />
    </div>
  );
}

// ── ApprovalsTab ──────────────────────────────────────────────────────────────

function ApprovalsTab({
  bid, approvals, questions, primaryRole, userId, onToggleQ, onEnsure,
}: {
  bid: Bid;
  approvals: ContractApproval[];
  questions: any[];
  primaryRole: string;
  userId: string;
  onToggleQ: (q: any) => void;
  onEnsure: () => void;
}) {
  const actionApproval = useActionApproval();
  const [actionTarget, setActionTarget] = useState<{ stage: ContractApproval["stage"]; outcome: "approved" | "rejected" } | null>(null);
  const [noteText, setNoteText] = useState("");

  function canAction(stage: ContractApproval["stage"]) {
    const allowed = STAGE_ROLE_GATE[stage] ?? [];
    return allowed.includes(primaryRole);
  }

  async function submitAction() {
    if (!actionTarget) return;
    await actionApproval.mutateAsync({
      bidId: bid.id,
      stage: actionTarget.stage,
      status: actionTarget.outcome,
      userId,
      notes: noteText.trim() || undefined,
    });
    setActionTarget(null);
    setNoteText("");
  }

  const displayApprovals = approvals.length > 0
    ? approvals
    : (["legal", "commercial", "finance", "executive"] as ContractApproval["stage"][]).map(stage => ({
        id: "", bid_id: bid.id, stage, status: "pending" as const,
        approved_by: null, approved_at: null, notes: null, approver_name: null,
      }));

  return (
    <div className="px-6 py-5 max-w-[700px]">
      <div className="bg-card hairline border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
          <h3 className="text-[13px] font-semibold">Approval Workflow</h3>
          {approvals.every(a => a.id === "") && (
            <button onClick={onEnsure}
              className="h-6 px-2.5 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20">
              Initialise
            </button>
          )}
        </div>

        <ul className="divide-y hairline divide-border">
          {displayApprovals.map((a) => {
            const canAct = canAction(a.stage);
            const isPending = a.status === "pending";
            return (
              <li key={a.stage} className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  {a.status === "approved"
                    ? <CheckCircle2 className="size-4 text-success-foreground shrink-0" />
                    : a.status === "rejected"
                      ? <XCircle className="size-4 text-destructive shrink-0" />
                      : <Circle className="size-4 text-muted-foreground/40 shrink-0" />}

                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium">{APPROVAL_STAGE_LABELS[a.stage]}</div>
                    {a.status !== "pending" && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {a.approver_name && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <UserCircle2 className="size-3" />
                            {a.approver_name}
                          </span>
                        )}
                        {a.approved_at && (
                          <span className="text-[10px] text-muted-foreground">
                            · {new Date(a.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                    )}
                    {a.notes && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 italic line-clamp-2">"{a.notes}"</div>
                    )}
                  </div>

                  <span className={[
                    "text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                    a.status === "approved" ? "bg-success-soft text-success-foreground"
                      : a.status === "rejected" ? "bg-red-100 text-red-700"
                      : "bg-muted text-muted-foreground"
                  ].join(" ")}>
                    {a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Pending"}
                  </span>
                </div>

                {canAct && isPending && a.id !== "" && (
                  <div className="flex gap-2 mt-2.5 ml-7">
                    <button
                      onClick={() => { setActionTarget({ stage: a.stage, outcome: "approved" }); setNoteText(""); }}
                      className="h-6 px-2.5 rounded text-[10px] font-semibold bg-green-600 text-white hover:bg-green-700">
                      Approve
                    </button>
                    <button
                      onClick={() => { setActionTarget({ stage: a.stage, outcome: "rejected" }); setNoteText(""); }}
                      className="h-6 px-2.5 rounded text-[10px] font-semibold border hairline border-destructive text-destructive hover:bg-destructive/10">
                      Reject
                    </button>
                  </div>
                )}
                {canAct && !isPending && a.id !== "" && (
                  <div className="mt-2 ml-7">
                    <button
                      onClick={() => { setActionTarget({ stage: a.stage, outcome: isPending ? "approved" : "pending" as any }); setNoteText(""); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                      Revise decision
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {questions.length > 0 && (
          <div className="border-t hairline border-border">
            <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Open Items
            </div>
            <ul className="divide-y hairline divide-border">
              {questions.map((q) => (
                <li key={q.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                  <button onClick={() => onToggleQ(q)}
                    className={["size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border",
                      q.status === "done" ? "bg-success-soft border-[#97C459]" : "border-dashed border-border-strong"].join(" ")}>
                    {q.status === "done" && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
                  </button>
                  <div className="flex-1 min-w-0 text-[12px]">{q.question_text}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Approve / Reject confirmation inline dialog */}
      {actionTarget && (
        <Dialog open onOpenChange={() => { setActionTarget(null); setNoteText(""); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-[14px]">
                {actionTarget.outcome === "approved" ? "Approve" : "Reject"} — {APPROVAL_STAGE_LABELS[actionTarget.stage]}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-[12px]">
              <label className="block">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {actionTarget.outcome === "rejected" ? "Reason (required)" : "Note (optional)"}
                </div>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={actionTarget.outcome === "rejected" ? "Explain what needs to change…" : "Add a note…"}
                  className="w-full h-20 px-2 py-1.5 rounded-md hairline border bg-card text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setActionTarget(null); setNoteText(""); }}
                className="h-8 px-3 rounded-md hairline border text-[12px]">Cancel</button>
              <button
                onClick={submitAction}
                disabled={actionApproval.isPending || (actionTarget.outcome === "rejected" && !noteText.trim())}
                className={[
                  "h-8 px-3 rounded-md text-[12px] font-semibold disabled:opacity-50",
                  actionTarget.outcome === "approved"
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-destructive text-destructive-foreground hover:opacity-90"
                ].join(" ")}>
                {actionApproval.isPending ? "…" : actionTarget.outcome === "approved" ? "Confirm Approval" : "Confirm Rejection"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── DocumentsTab ──────────────────────────────────────────────────────────────

function DocumentsTab({ docs }: { docs: any[] }) {
  const FILTERS = ["all", "draft", "redline", "final", "reference", "supporting"] as const;
  const [filter, setFilter] = useState<typeof FILTERS[number]>("all");

  const filtered = filter === "all" ? docs : docs.filter(d => (d.doc_category ?? "reference") === filter);

  return (
    <div className="px-6 py-5 max-w-[800px]">
      {/* Filter pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {FILTERS.map(f => {
          const meta = f === "all" ? null : DOC_CATEGORY_LABELS[f];
          const active = filter === f;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={[
                "h-6 px-2.5 rounded-full text-[10px] font-semibold capitalize transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              ].join(" ")}
              style={active && meta ? { background: meta.bg, color: meta.color } : {}}>
              {f === "all" ? `All (${docs.length})` : meta?.label}
            </button>
          );
        })}
      </div>

      <div className="bg-card hairline border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
          <h3 className="text-[13px] font-semibold">Contract Documents</h3>
          <Link to="/docs" className="text-[11px] text-primary font-medium hover:underline">View all →</Link>
        </div>
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-muted-foreground">
            {docs.length === 0
              ? <>No documents uploaded. <Link to="/docs" className="text-primary underline">Go to Knowledge Hub →</Link></>
              : `No ${filter} documents.`}
          </div>
        ) : (
          <ul className="divide-y hairline divide-border">
            {filtered.map((doc: any) => {
              const ext = doc.name?.split(".").pop()?.toLowerCase() ?? "default";
              const style = EXT_COLORS[ext] ?? EXT_COLORS.default;
              const cat = DOC_CATEGORY_LABELS[doc.doc_category ?? "reference"] ?? DOC_CATEGORY_LABELS.reference;
              return (
                <li key={doc.id} className={[
                  "flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors",
                  doc.doc_category === "final" ? "bg-green-50/40 dark:bg-green-950/20" : ""
                ].join(" ")}>
                  <div className="w-8 h-10 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                    style={{ background: style.bg, color: style.color }}>
                    {ext.toUpperCase().slice(0, 4)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{doc.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 capitalize">{doc.type}</div>
                  </div>
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: cat.bg, color: cat.color }}>
                    {cat.label}
                  </span>
                  {doc.embedding && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold shrink-0">AI Indexed</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── CloseoutModal ─────────────────────────────────────────────────────────────

function CloseoutModal({ bid, outcome, onClose }: { bid: Bid; outcome: "won" | "lost"; onClose: () => void }) {
  const updateBid = useUpdateBid();
  const { user } = useCurrentUser();
  const [finalValue, setFinalValue] = useState(String(bid.value));
  const [reasonLost, setReasonLost] = useState("");

  async function confirm() {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: { status: outcome, value: parseFloat(finalValue) || bid.value },
    });
    await (supabase as any).from("bid_activity_log").insert({
      bid_id: bid.id,
      user_id: user?.id ?? null,
      action: outcome === "won" ? "bid_won" : "bid_lost",
      metadata: { reason_lost: reasonLost || null, final_value: parseFloat(finalValue) },
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {outcome === "won" ? "Mark as Won" : "Mark as Lost"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[12px]">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Final contract value (USD)
            </div>
            <input type="number" value={finalValue} onChange={(e) => setFinalValue(e.target.value)}
              className="w-full h-8 px-2 rounded-md hairline border bg-card text-[12px] focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          {outcome === "lost" && (
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Reason lost (optional)
              </div>
              <textarea value={reasonLost} onChange={(e) => setReasonLost(e.target.value)}
                placeholder="e.g. Lost to competitor on pricing…"
                className="w-full h-16 px-2 py-1.5 rounded-md hairline border bg-card text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-8 px-3 rounded-md hairline border text-[12px]">Cancel</button>
          <button
            onClick={confirm}
            disabled={updateBid.isPending}
            className={`h-8 px-3 rounded-md text-[12px] font-semibold disabled:opacity-50 ${
              outcome === "won"
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-destructive text-destructive-foreground hover:opacity-90"
            }`}>
            {updateBid.isPending ? "…" : outcome === "won" ? "Confirm Won ✓" : "Confirm Lost ✗"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── MilestoneRow ──────────────────────────────────────────────────────────────

function MilestoneRow({ num, deliverable, onToggle }: {
  num: number;
  deliverable: any;
  onToggle: () => void;
}) {
  const done = deliverable.status === "done";
  const inP  = deliverable.status === "in_progress";
  return (
    <li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
      <button onClick={onToggle}
        className={["size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
          done ? "bg-success-soft border-[#97C459]" : inP ? "border-[#3b82f6] bg-blue-50" : "border-dashed border-border-strong"].join(" ")}>
        {done && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
        {inP  && <div className="size-2 rounded-full bg-blue-400" />}
      </button>
      <span className="text-[10px] text-muted-foreground w-5 shrink-0 mt-0.5">{num}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-[12px] ${done ? "line-through text-muted-foreground" : ""}`}>
          {deliverable.label}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {deliverable.due_date && (
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <CalendarDays className="size-2.5 shrink-0" />
              Due {new Date(deliverable.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          {deliverable.assigned_to && (
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <UserCircle2 className="size-2.5 shrink-0" />
              Assigned
            </span>
          )}
        </div>
      </div>
      <span className={["text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5",
        done ? "bg-success-soft text-success-foreground" : inP ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"].join(" ")}>
        {done ? "Done" : inP ? "In Progress" : "Pending"}
      </span>
    </li>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function KV({ label, value, urgent }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-[12px] font-semibold ${urgent ? "text-[oklch(0.5_0.22_25)]" : ""}`}>{value}</span>
    </div>
  );
}

function HealthCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      {ok ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
          : <AlertTriangle className="size-3.5 text-warning-foreground shrink-0" />}
      <span className={ok ? "text-foreground" : "text-warning-foreground"}>{label}</span>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
