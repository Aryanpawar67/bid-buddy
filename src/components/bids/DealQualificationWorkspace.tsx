import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DocxViewerModal } from "@/components/docs/DocxViewerModal";
import { Lock, CheckCircle2, Users, ClipboardList, BarChart3, Activity, RefreshCw, FileText, Eye, Mail } from "lucide-react";
import { initials, urgencyClass, fmtMoney } from "@/lib/bid-constants";
import type { Bid, AssessmentData, QualificationInsights } from "@/lib/bid-queries";
import { useDocuments, type BidDocument, type DocType } from "@/lib/doc-queries";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import {
  useBidTeam,
  useAssessmentData,
  useSaveAssessment,
  useBidActivity,
  useUpdateBid,
  useGenerateQualificationInsights,
  useGenerateQualResult,
  useGenerateDealBrief,
} from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";

export const DEFAULT_CRITERIA = [
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

export type Tab = "bid_details" | "bid_team" | "bid_assessment" | "qualification_result" | "activity_log";

export const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "bid_details", label: "Bid Details", icon: ClipboardList },
  { key: "bid_team", label: "Bid Team Details", icon: Users },
  { key: "bid_assessment", label: "Bid Assessment", icon: BarChart3 },
  { key: "qualification_result", label: "Qualification Result", icon: CheckCircle2 },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

export function computeScore(assessmentData: AssessmentData | null | undefined): number {
  if (!assessmentData?.scores) return 0;
  return Math.round(
    DEFAULT_CRITERIA.reduce((sum, c) => {
      const s = (assessmentData.scores as Record<string, number>)[c.id] ?? 0;
      return sum + (s / 5) * c.weight * 100;
    }, 0),
  );
}

export function DealQualificationWorkspace({
  bid,
  activeTab,
  onTabChange,
}: {
  bid: Bid;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
}) {
  const updateBid = useUpdateBid();

  return (
    <div className="p-5">
      {/* Tab content */}
      {activeTab === "bid_details" && <BidDetailsTab bid={bid} />}
      {activeTab === "bid_team" && <BidTeamTab bid={bid} />}
      {activeTab === "bid_assessment" && <BidAssessmentTab bid={bid} />}
      {activeTab === "qualification_result" && <QualificationResultTab bid={bid} />}
      {activeTab === "activity_log" && <ActivityLogTab bid={bid} />}
    </div>
  );
}

// ── Bid Details Tab ───────────────────────────────────────────────────────────

const DOC_TYPE_STYLES: Record<DocType, string> = {
  rfp:       "bg-[#fff1f1] text-[#e53e3e]",
  proposal:  "bg-[#fff0e8] text-[#fd5b0e]",
  legal:     "bg-[#edfaf4] text-[#16a34a]",
  template:  "bg-[#ede9fd] text-[#491aeb]",
  reference: "bg-[#f5f4fa] text-muted-foreground",
};

function BidDetailsTab({ bid }: { bid: Bid }) {
  const u = urgencyClass(bid.deadline);
  const updateBid = useUpdateBid();
  const { primaryRole } = useCurrentUser();
  const { data: docs = [] } = useDocuments({ bidId: bid.id });
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const canUpload = primaryRole === "pre_sales" || primaryRole === "admin";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    client_name: bid.client_name,
    title: bid.title,
    type: bid.type,
    priority: bid.priority,
    procurement_portal: bid.procurement_portal ?? "",
    value: String(bid.value),
    deadline: bid.deadline.slice(0, 10),
    clarification_deadline: bid.clarification_deadline?.slice(0, 10) ?? "",
    orals_date: bid.orals_date?.slice(0, 10) ?? "",
  });

  function startEdit() {
    setForm({
      client_name: bid.client_name,
      title: bid.title,
      type: bid.type,
      priority: bid.priority,
      procurement_portal: bid.procurement_portal ?? "",
      value: String(bid.value),
      deadline: bid.deadline.slice(0, 10),
      clarification_deadline: bid.clarification_deadline?.slice(0, 10) ?? "",
      orals_date: bid.orals_date?.slice(0, 10) ?? "",
    });
    setEditing(true);
  }

  async function handleSave() {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: {
        client_name: form.client_name,
        title: form.title,
        type: form.type as Bid["type"],
        priority: form.priority as Bid["priority"],
        procurement_portal: form.procurement_portal || null,
        value: Number(form.value) || 0,
        deadline: form.deadline,
        clarification_deadline: form.clarification_deadline || null,
        orals_date: form.orals_date || null,
      },
    });
    setEditing(false);
  }

  function set(key: string, val: string) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  if (editing) {
    return (
      <div className="space-y-3.5">
        <Card title="Opportunity">
          <EditKV label="Client" value={form.client_name} onChange={(v) => set("client_name", v)} />
          <EditKV label="Title" value={form.title} onChange={(v) => set("title", v)} />
          <EditKVSelect
            label="Type"
            value={form.type}
            onChange={(v) => set("type", v)}
            options={[
              { value: "rfp", label: "RFP" },
              { value: "rfi", label: "RFI" },
              { value: "rfq", label: "RFQ" },
              { value: "direct", label: "DIRECT" },
            ]}
          />
          <EditKVSelect
            label="Priority"
            value={form.priority}
            onChange={(v) => set("priority", v)}
            options={[
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <EditKV label="Portal" value={form.procurement_portal} onChange={(v) => set("procurement_portal", v)} placeholder="—" />
          <EditKV label="Deal Value" value={form.value} onChange={(v) => set("value", v)} type="number" />
        </Card>
        <Card title="Timeline">
          <EditKV label="Bid Deadline" value={form.deadline} onChange={(v) => set("deadline", v)} type="date" />
          <EditKV label="Clarification Deadline" value={form.clarification_deadline} onChange={(v) => set("clarification_deadline", v)} type="date" />
          <EditKV label="Orals Date" value={form.orals_date} onChange={(v) => set("orals_date", v)} type="date" />
        </Card>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setEditing(false)}
            className="h-8 px-3 rounded-md hairline border text-[12px] text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateBid.isPending}
            className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {updateBid.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex justify-end">
        <button
          onClick={startEdit}
          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
        >
          Edit
        </button>
      </div>
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

      {/* ── Documents ── */}
      <section className="bg-card hairline border rounded-xl p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h3 className="text-[13px] font-medium">Documents</h3>
            {docs.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {docs.length} file{docs.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          {canUpload && (
            <button
              onClick={() => setUploadOpen(true)}
              className="h-7 px-2.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors"
            >
              + Upload
            </button>
          )}
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <FileText className="size-8 opacity-20 mx-auto mb-2" />
            <div className="text-[12px]">No documents uploaded yet</div>
            {canUpload && (
              <div className="text-[11px] mt-1 opacity-70">Upload the client RFP, SOW, or reference files</div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map((doc) => {
              const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
              const extBg = ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4";
              const extColor = ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a";
              return (
                <button
                  key={doc.id}
                  onClick={() => setPreviewDoc(doc)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/40 transition-colors group text-left"
                >
                  <div
                    className="w-8 h-9 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                    style={{ background: extBg, color: extColor }}
                  >
                    {ext.toUpperCase().slice(0, 3)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{doc.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${DOC_TYPE_STYLES[doc.type]}`}>
                        {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                      </span>
                      {doc.embedding && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ede9fd] text-primary font-semibold">✦ AI</span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Eye className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <DocPreviewModal doc={previewDoc} allDocs={docs} onClose={() => setPreviewDoc(null)} />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} bids={[]} prefilledBidId={bid.id} />
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

  const SCORE_LABELS: Record<number, string> = {
    1: "Low", 2: "Below Avg", 3: "Average", 4: "Above Avg", 5: "High",
  };

  const SCORE_COLORS: Record<number, string> = {
    0: "var(--color-muted-foreground)",
    1: "#b91c1c", 2: "#c2410c", 3: "#854d0e", 4: "#166534", 5: "#15803d",
  };

  const STAR_COLOR: Record<number, string> = {
    0: "#d1d5db", 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#16a34a",
  };

  return (
    <div>
      {/* Legend + save */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted-foreground">Score each parameter on a scale of 1 (Low) to 5 (High)</span>
          <div className="flex items-center gap-2">
            {[1,2,3,4,5].map((n) => (
              <span key={n} className="flex items-center gap-1 text-[10px]" style={{ color: SCORE_COLORS[n] }}>
                <span className="size-3 rounded-full inline-block" style={{ background: STAR_COLOR[n] }} />
                {n} {SCORE_LABELS[n]}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saveAssessment.isPending}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {saveAssessment.isPending ? "Saving…" : "Save Assessment"}
        </button>
      </div>

      <div className="text-[12px] text-muted-foreground mb-2">
        Total: <strong className="text-foreground">{totalWeighted.toFixed(1)}</strong> / 100
      </div>

      {/* Assessment table */}
      <div className="bg-card hairline border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3.5 py-2.5 font-medium w-8">#</th>
                <th className="text-left px-3.5 py-2.5 font-medium">Assessment Parameter</th>
                <th className="text-left px-3.5 py-2.5 font-medium hidden xl:table-cell">What should be assessed?</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-14">Weight</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-44">Score (1–5)</th>
                <th className="text-left px-3.5 py-2.5 font-medium w-40 hidden lg:table-cell">Comments</th>
                <th className="text-center px-3.5 py-2.5 font-medium w-24">Weighted</th>
              </tr>
            </thead>
            <tbody className="divide-y hairline divide-border">
              {DEFAULT_CRITERIA.map((c, i) => {
                const score = scores[c.id] ?? 0;
                const weightedMax = c.weight * 100;
                const weightedEarned = (score / 5) * weightedMax;
                const starColor = STAR_COLOR[score] ?? STAR_COLOR[0];
                const scoreColor = SCORE_COLORS[score] ?? SCORE_COLORS[0];
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3.5 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-3.5 py-3 font-medium leading-snug">{c.parameter}</td>
                    <td className="px-3.5 py-3 text-muted-foreground leading-relaxed text-[11px] hidden xl:table-cell">{c.focus}</td>
                    <td className="px-3.5 py-3 text-center font-medium">{Math.round(c.weight * 100)}%</td>
                    <td className="px-3.5 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setScore(c.id, n)}
                              className="transition-transform hover:scale-110"
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1 }}
                              aria-label={`Score ${n}`}
                            >
                              <svg width="18" height="18" viewBox="0 0 20 20">
                                <path
                                  d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.44.91-5.32L2.27 6.62l5.34-.78z"
                                  fill={score >= n ? starColor : "#e5e7eb"}
                                  stroke={score >= n ? starColor : "#d1d5db"}
                                  strokeWidth="0.5"
                                />
                              </svg>
                            </button>
                          ))}
                        </div>
                        {score > 0 && (
                          <span className="text-[10px] font-medium" style={{ color: scoreColor }}>
                            {score} – {SCORE_LABELS[score]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-3 hidden lg:table-cell">
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
                        <span className="font-medium" style={{ color: scoreColor }}>{weightedEarned.toFixed(1)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <span className="text-muted-foreground text-[10px]">/{weightedMax.toFixed(0)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-medium">
                <td colSpan={4} className="px-3.5 py-2.5 text-[11px] text-right uppercase tracking-wider text-muted-foreground">
                  Total Weighted Score
                </td>
                <td colSpan={3} className="px-3.5 py-2.5 text-center text-[14px] font-semibold">
                  {totalWeighted.toFixed(1)}
                  <span className="text-[11px] text-muted-foreground font-normal"> / 100</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Qualification Result Tab ──────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(score, 100) / 100) * circ;
  const strokeColor =
    score >= 65 ? "var(--color-success-foreground)" : score >= 45 ? "var(--color-warning-foreground)" : "var(--color-danger-foreground)";

  return (
    <svg viewBox="0 0 120 120" className="size-[110px]">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={r} fill="none"
        stroke={strokeColor} strokeWidth="10"
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
      <text x="60" y="56" textAnchor="middle" dominantBaseline="middle"
        className="font-semibold" style={{ fontSize: 22, fill: strokeColor, fontWeight: 600 }}>
        {score}
      </text>
      <text x="60" y="73" textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}>
        out of 100
      </text>
    </svg>
  );
}

function paramStatus(score: number): { label: string; cls: string } {
  if (score === 0) return { label: "—", cls: "text-muted-foreground" };
  if (score >= 4)  return { label: "Go",      cls: "bg-success-soft text-success-foreground" };
  if (score === 3) return { label: "Review",   cls: "bg-warning-soft text-warning-foreground" };
  return               { label: "Caution",  cls: "bg-danger-soft text-danger-foreground" };
}

function QualificationResultTab({ bid }: { bid: Bid }) {
  const { data: assessmentData, isLoading } = useAssessmentData(bid.id);
  const updateBid = useUpdateBid();
  const generateInsights = useGenerateQualificationInsights();
  const generateQualResult = useGenerateQualResult();
  const generateDealBrief = useGenerateDealBrief();
  const { user } = useCurrentUser();

  const { totalScore, decision, avgScore, scoredCount } = useMemo(() => {
    const scores = assessmentData?.scores ?? {};
    let total = 0, scoreSum = 0, count = 0;
    for (const c of DEFAULT_CRITERIA) {
      const s = scores[c.id] ?? 0;
      total += (s / 5) * c.weight * 100;
      if (s > 0) { scoreSum += s; count++; }
    }
    const t = Math.round(total);
    const d: "go" | "conditional_go" | "no_go" =
      t >= 65 ? "go" : t >= 45 ? "conditional_go" : "no_go";
    return { totalScore: t, decision: d, avgScore: count ? (scoreSum / count).toFixed(1) : "—", scoredCount: count };
  }, [assessmentData]);

  const insights: QualificationInsights | undefined = assessmentData?.insights;
  const isLocked = !!bid.gonogo_decision;
  const hasScores = scoredCount > 0;

  const [docxViewer, setDocxViewer] = useState<{ url: string; filename: string } | null>(null);
  const openDocx = useCallback((url: string, filename: string) => setDocxViewer({ url, filename }), []);

  // Auto-generate insights once when scores exist but no cached insights yet.
  // Guards: data must be fully loaded (!isLoading) so we don't fire on the
  // undefined-during-fetch window; and we track per-bid with a ref so tab
  // switching never re-fires even if staleTime hasn't expired yet.
  const autoFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isLoading &&
      hasScores &&
      !insights &&
      !generateInsights.isPending &&
      autoFiredRef.current !== bid.id
    ) {
      autoFiredRef.current = bid.id;
      generateInsights.mutate(bid.id);
    }
  }, [isLoading, hasScores, !!insights, bid.id]);

  const bidStrength =
    totalScore >= 75 ? "Strong" : totalScore >= 55 ? "Moderate" : totalScore >= 35 ? "Weak" : "Insufficient Data";
  const bidStrengthCls =
    totalScore >= 75 ? "text-success-foreground" : totalScore >= 55 ? "text-warning-foreground" : "text-danger-foreground";

  async function lockAs(d: "go" | "conditional_go" | "no_go") {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: {
        gonogo_score: totalScore,
        gonogo_decision: d,
        gonogo_completed_at: new Date().toISOString(),
        gonogo_completed_by: user?.id ?? null,
      } as never,
    });
  }

  async function putOnHold() {
    await updateBid.mutateAsync({ id: bid.id, patch: { status: "on_hold" } });
  }

  if (isLoading) return <Empty>Loading…</Empty>;

  return (
    <>
    <div className="grid grid-cols-[1fr_320px] gap-4">

      {/* ── Left column ── */}
      <div className="space-y-3.5">

        {/* Summary card */}
        <section className="bg-card hairline border rounded-xl p-4">
          <h3 className="text-[13px] font-medium mb-3">Overall Qualification Summary</h3>
          <div className="flex items-center gap-5">
            <ScoreGauge score={totalScore} />
            <div className="grid grid-cols-2 gap-2 flex-1">
              {[
                { label: "Total Parameters", value: "10" },
                { label: "Avg Parameter Score", value: avgScore },
                { label: "Score Achieved", value: `${totalScore}%` },
                { label: "Bid Strength", value: bidStrength, valueCls: bidStrengthCls },
              ].map((m) => (
                <div key={m.label} className="bg-muted/30 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
                  <div className={`text-[16px] font-semibold mt-0.5 ${(m as any).valueCls ?? ""}`}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Score band legend */}
          <div className="flex gap-3 text-[10px] mt-3 pt-3 border-t hairline border-border">
            <span className="text-success-foreground font-medium">≥ 65 → Go</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-warning-foreground font-medium">45–64 → Conditional Go</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-danger-foreground font-medium">&lt; 45 → No Go</span>
          </div>
        </section>

        {/* Breakdown table */}
        <section className="bg-card hairline border rounded-xl overflow-hidden">
          <header className="px-3.5 py-2.5 border-b hairline border-border">
            <h3 className="text-[13px] font-medium">Assessment Summary by Parameter</h3>
          </header>
          {!hasScores ? (
            <div className="text-[12px] text-muted-foreground p-4 text-center">
              Complete the Bid Assessment tab to see a breakdown here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3.5 py-2 font-medium">#</th>
                    <th className="text-left px-3.5 py-2 font-medium">Parameter</th>
                    <th className="text-center px-3.5 py-2 font-medium w-20">Status</th>
                    <th className="text-center px-3.5 py-2 font-medium w-16">Score</th>
                    <th className="text-center px-3.5 py-2 font-medium w-14">Weight</th>
                    <th className="text-left px-3.5 py-2 font-medium w-36">Progress</th>
                    <th className="text-center px-3.5 py-2 font-medium w-24">Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y hairline divide-border">
                  {DEFAULT_CRITERIA.map((c, i) => {
                    const s = assessmentData?.scores[c.id] ?? 0;
                    const contribution = (s / 5) * c.weight * 100;
                    const maxContrib = c.weight * 100;
                    const pct = maxContrib > 0 ? (contribution / maxContrib) * 100 : 0;
                    const st = paramStatus(s);
                    return (
                      <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3.5 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-3.5 py-2.5 font-medium">{c.parameter}</td>
                        <td className="px-3.5 py-2.5 text-center">
                          {s === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                              {st.label}
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-medium">
                          {s > 0 ? `${s}/5` : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-muted-foreground">
                          {Math.round(c.weight * 100)}%
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                s >= 4 ? "bg-success-foreground" : s === 3 ? "bg-warning-foreground" : s > 0 ? "bg-danger-foreground" : ""
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          {s > 0 ? (
                            <span className="font-medium">{contribution.toFixed(1)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          <span className="text-muted-foreground text-[10px]">/{maxContrib.toFixed(0)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={6} className="px-3.5 py-2.5 text-[11px] text-right uppercase tracking-wider text-muted-foreground">
                      Total
                    </td>
                    <td className="px-3.5 py-2.5 text-center text-[14px]">
                      {totalScore}
                      <span className="text-[11px] text-muted-foreground font-normal">/100</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* ── Document generation buttons ── */}
        {(() => {
          const canGenerate = !!insights && hasScores;
          const disabledTitle = !canGenerate ? "AI insights must be generated first" : undefined;
          return (
            <div className="flex gap-2">
              <button
                onClick={() => generateQualResult.mutate(
                  { bidId: bid.id, clientName: bid.client_name, decision: bid.gonogo_decision ?? "no_go", totalScore },
                  { onSuccess: (r) => { if (r?.url) openDocx(r.url, r.filename); } }
                )}
                disabled={generateQualResult.isPending || !canGenerate}
                title={disabledTitle}
                className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:opacity-90 inline-flex items-center justify-center gap-1.5 transition-opacity"
              >
                <Mail className="size-3.5" />
                {generateQualResult.isPending ? "Generating…" : "Notify Bid Team"}
              </button>
              <button
                onClick={() => generateDealBrief.mutate(
                  bid.id,
                  { onSuccess: (r) => { if (r?.url) openDocx(r.url, r.filename); } }
                )}
                disabled={generateDealBrief.isPending || !canGenerate}
                title={disabledTitle}
                className="flex-1 h-9 rounded-md hairline border bg-card text-[12px] font-medium disabled:opacity-40 hover:bg-muted inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Eye className="size-3.5" />
                {generateDealBrief.isPending ? "Generating…" : "Deal Brief"}
              </button>
            </div>
          );
        })()}
      </div>

      {/* ── Right column ── */}
      <div className="space-y-3.5">

        {/* AI Insights */}
        <section className="bg-card hairline border rounded-xl p-3.5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium">AI Analysis</h3>
            {/* Only show regenerate when insights are already cached */}
            {insights && (
              <button
                onClick={() => {
                  autoFiredRef.current = null;
                  generateInsights.mutate(bid.id);
                }}
                disabled={generateInsights.isPending}
                title="Regenerate AI insights"
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 inline-flex items-center justify-center transition-colors"
              >
                <RefreshCw className={`size-3 ${generateInsights.isPending ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>

          {!hasScores && (
            <p className="text-[11px] text-muted-foreground">
              Score all parameters in the Bid Assessment tab first.
            </p>
          )}

          {hasScores && !insights && !generateInsights.isPending && !generateInsights.isError && (
            <p className="text-[11px] text-muted-foreground">Generating AI analysis…</p>
          )}

          {hasScores && !insights && generateInsights.isError && (
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-destructive">Could not generate insights.</p>
              <button
                onClick={() => {
                  autoFiredRef.current = null;
                  generateInsights.mutate(bid.id);
                }}
                className="h-6 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="size-3" /> Retry
              </button>
            </div>
          )}

          {generateInsights.isPending && (
            <div className="space-y-2">
              {[60, 80, 50].map((w, i) => (
                <div key={i} className={`h-3 bg-muted rounded animate-pulse`} style={{ width: `${w}%` }} />
              ))}
            </div>
          )}

          {insights && !generateInsights.isPending && (
            <div className="space-y-3.5">
              {/* Key Strengths */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-success-foreground font-medium mb-1.5">
                  Key Strengths
                </div>
                <ul className="space-y-1.5">
                  {insights.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px]">
                      <span className="text-success-foreground mt-0.5 shrink-0">✓</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Key Risks */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-danger-foreground font-medium mb-1.5">
                  Key Risks / Watchouts
                </div>
                <ul className="space-y-1.5">
                  {insights.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px]">
                      <span className="text-danger-foreground mt-0.5 shrink-0">⚠</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Recommendation */}
              <div className="pt-2 border-t hairline border-border">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                  Recommendation Summary
                </div>
                <p className="text-[11px] leading-relaxed">{insights.recommendation}</p>
              </div>

              {insights.generated_at && (
                <div className="text-[10px] text-muted-foreground pt-1">
                  Generated {new Date(insights.generated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Lock decision */}
        <section className="bg-card hairline border rounded-xl p-3.5">
          <h3 className="text-[13px] font-medium mb-2.5">
            {isLocked ? "Decision Locked" : "Lock Decision"}
          </h3>
          {isLocked ? (
            <div>
              <div className={`inline-flex px-3 py-1.5 rounded-lg hairline border text-[12px] font-semibold mb-2 ${
                bid.gonogo_decision === "go"
                  ? "bg-success-soft text-success-foreground border-[#97C459]"
                  : bid.gonogo_decision === "conditional_go"
                  ? "bg-warning-soft text-warning-foreground border-[#FB794B]"
                  : "bg-danger-soft text-danger-foreground border-[#A32D2D]"
              }`}>
                <Lock className="size-3 mr-1.5" />
                {bid.gonogo_decision === "go" ? "Go" : bid.gonogo_decision === "conditional_go" ? "Conditional Go" : "No Go"}
              </div>
              {bid.gonogo_completed_at && (
                <div className="text-[11px] text-muted-foreground">
                  Locked {new Date(bid.gonogo_completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </div>
              )}
              <div className="mt-2 pt-2 border-t hairline border-border">
                <div className="text-[10px] text-muted-foreground mb-1.5">Override decision</div>
                <DecisionButtons onSelect={lockAs} pending={updateBid.isPending} disabled={!hasScores} />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] text-muted-foreground mb-2.5">
                Required before advancing to RFI. Score: <span className="font-medium text-foreground">{totalScore}/100</span>
              </p>
              <DecisionButtons onSelect={lockAs} pending={updateBid.isPending} disabled={!hasScores} />
              <button
                onClick={putOnHold}
                disabled={updateBid.isPending}
                className="mt-2 w-full h-8 rounded-md hairline border bg-card text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Put on Hold
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
    {docxViewer && (
      <DocxViewerModal
        url={docxViewer.url}
        filename={docxViewer.filename}
        onClose={() => setDocxViewer(null)}
      />
    )}
    </>
  );
}

function DecisionButtons({
  onSelect,
  pending,
  disabled,
}: {
  onSelect: (d: "go" | "conditional_go" | "no_go") => void;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {([
        { key: "go" as const,             label: "Go",             cls: "bg-success-soft text-success-foreground border-[#97C459] hover:brightness-95" },
        { key: "conditional_go" as const, label: "Conditional Go", cls: "bg-warning-soft text-warning-foreground border-[#FB794B] hover:brightness-95" },
        { key: "no_go" as const,          label: "No Go",          cls: "bg-danger-soft text-danger-foreground border-[#A32D2D] hover:brightness-95" },
      ] as const).map((opt) => (
        <button
          key={opt.key}
          onClick={() => onSelect(opt.key)}
          disabled={pending || disabled}
          className={`h-8 rounded-lg hairline border text-[12px] font-medium disabled:opacity-40 transition-all inline-flex items-center justify-center gap-1.5 ${opt.cls}`}
        >
          <Lock className="size-3" /> {opt.label}
        </button>
      ))}
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

function EditKV({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[12px] hairline border-b last:border-b-0 gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-right bg-transparent text-[12px] font-medium text-foreground outline-none focus:ring-0 border-0 p-0 min-w-0 w-40"
      />
    </div>
  );
}

function EditKVSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[12px] hairline border-b last:border-b-0 gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-right bg-transparent text-[12px] font-medium text-foreground outline-none border-0 p-0 cursor-pointer appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
