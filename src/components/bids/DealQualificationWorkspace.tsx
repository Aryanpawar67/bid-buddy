import { useState, useMemo, useRef, useCallback } from "react";
import { DocxViewerModal } from "@/components/docs/DocxViewerModal";
import { Lock, Users, ClipboardList, BarChart3, Activity, RefreshCw, FileText, Eye, Mail, UserPlus, X } from "lucide-react";
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
  useGenerateQualAssessment,
  useGenerateQualResult,
  useGenerateDealBrief,
  useTeamMembers,
} from "@/lib/bid-queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export type Tab = "bid_details" | "bid_team" | "assessment_result" | "activity_log";

export const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "bid_details", label: "Bid Details", icon: ClipboardList },
  { key: "bid_team", label: "Bid Team Details", icon: Users },
  { key: "assessment_result", label: "Assessment & Result", icon: BarChart3 },
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
      {activeTab === "assessment_result" && <AssessmentResultTab bid={bid} />}
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
    product_type: bid.product_type ?? "",
    contact_name: bid.contact_name ?? "",
    contact_email: bid.contact_email ?? "",
    contact_phone: bid.contact_phone ?? "",
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
      product_type: bid.product_type ?? "",
      contact_name: bid.contact_name ?? "",
      contact_email: bid.contact_email ?? "",
      contact_phone: bid.contact_phone ?? "",
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
        product_type: (form.product_type as "TA" | "TM") || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
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
          <EditKVSelect
            label="Product"
            value={form.product_type}
            onChange={(v) => set("product_type", v)}
            options={[
              { value: "", label: "— not set —" },
              { value: "TA", label: "TA — Talent Acquisition" },
              { value: "TM", label: "TM — Talent Management" },
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
        <Card title="Procurement Contact">
          <EditKV label="Contact Name" value={form.contact_name} onChange={(v) => set("contact_name", v)} placeholder="e.g. Jane Smith" />
          <EditKV label="Contact Email" value={form.contact_email} onChange={(v) => set("contact_email", v)} placeholder="e.g. jane@acme.com" />
          <EditKV label="Contact Phone" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} placeholder="optional" />
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
        {bid.product_type && <KV label="Product" value={bid.product_type === "TA" ? "TA — Talent Acquisition" : "TM — Talent Management"} />}
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
      {(bid.contact_name || bid.contact_email || bid.contact_phone) && (
        <Card title="Procurement Contact">
          {bid.contact_name && <KV label="Name" value={bid.contact_name} />}
          {bid.contact_email && <KV label="Email" value={bid.contact_email} />}
          {bid.contact_phone && <KV label="Phone" value={bid.contact_phone} />}
        </Card>
      )}
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
  const qc = useQueryClient();

  async function removeMember(assignmentId: string) {
    await (supabase as any).from("bid_assignments").delete().eq("id", assignmentId);
    qc.invalidateQueries({ queryKey: ["bid-team", bid.id] });
  }

  return (
    <section className="bg-card hairline border rounded-xl p-3.5 mb-3.5">
      <header className="flex items-center justify-between mb-2.5">
        <div>
          <h3 className="text-[13px] font-medium">Assigned Team Members</h3>
          <span className="text-[11px] text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</span>
        </div>
        <DQAssignMemberPopover bidId={bid.id} assignedUserIds={members.map((m) => m.user_id)} />
      </header>
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
              <th className="w-8"></th>
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
                <td className="py-2.5">
                  <button onClick={() => removeMember(m.assignment_id)}
                    className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DQAssignMemberPopover({ bidId, assignedUserIds }: { bidId: string; assignedUserIds: string[] }) {
  const { data: members = [] } = useTeamMembers();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unassigned = members.filter((m) => !assignedUserIds.includes(m.user_id));

  async function assign(userId: string) {
    await (supabase as any).from("bid_assignments").insert({ bid_id: bidId, user_id: userId });
    qc.invalidateQueries({ queryKey: ["bid-team", bidId] });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="h-7 px-3 rounded-md hairline border text-[11px] font-medium hover:bg-muted inline-flex items-center gap-1.5">
          <UserPlus className="size-3.5" /> Assign member
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {unassigned.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">All members already assigned.</div>
        ) : (
          <ul>
            {unassigned.map((m) => (
              <li key={m.user_id}>
                <button onClick={() => assign(m.user_id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 rounded-md text-left">
                  <div className="size-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                    {initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate">{m.full_name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{m.primary_role.replace(/_/g, " ")}</div>
                  </div>
                  <UserPlus className="size-3 text-muted-foreground ml-auto shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Assessment & Result Tab (merged) ─────────────────────────────────────────

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

function AssessmentResultTab({ bid }: { bid: Bid }) {
  const { data: assessmentData, isLoading } = useAssessmentData(bid.id);
  const { data: docs = [] } = useDocuments({ bidId: bid.id });
  const generateAssessment = useGenerateQualAssessment();
  const saveAssessment = useSaveAssessment();
  const generateQualResult = useGenerateQualResult();
  const generateDealBrief = useGenerateDealBrief();
  const updateBid = useUpdateBid();
  const { user } = useCurrentUser();
  const [docxViewer, setDocxViewer] = useState<{ url: string; filename: string } | null>(null);
  const openDocx = useCallback((url: string, filename: string) => setDocxViewer({ url, filename }), []);

  // Local editable scores — seeded from DB, reset when bid changes
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [touchedIds, setTouchedIds] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const prevBidId = useRef<string | null>(null);

  if ((!initialised || prevBidId.current !== bid.id) && assessmentData && !isLoading) {
    prevBidId.current = bid.id;
    setScores(assessmentData.scores ?? {});
    setComments(assessmentData.comments ?? {});
    setTouchedIds(new Set());
    setDirty(false);
    setInitialised(true);
  }

  const indexedDocs = docs.filter((d) => d.embedding !== null);
  const indexedDocCount = indexedDocs.length;
  const hasIndexedDocs = indexedDocCount > 0;
  const indexedDocNames = indexedDocs.map((d) => d.name).join(", ");
  const isAiScored = !!assessmentData?.ai_scored;
  const rationales: Record<string, string> = assessmentData?.rationales ?? {};
  const insights: QualificationInsights | undefined = assessmentData?.insights;
  const isLocked = !!bid.gonogo_decision;

  const { totalScore, scoredCount, avgScore } = useMemo(() => {
    let total = 0, scoreSum = 0, count = 0;
    for (const c of DEFAULT_CRITERIA) {
      const s = scores[c.id] ?? 0;
      total += (s / 5) * c.weight * 100;
      if (s > 0) { scoreSum += s; count++; }
    }
    return { totalScore: Math.round(total), scoredCount: count, avgScore: count ? (scoreSum / count).toFixed(1) : "—" };
  }, [scores]);

  const hasScores = scoredCount > 0;
  const displayScore = hasScores ? totalScore : (bid.gonogo_score ?? 0);

  const bidStrength = displayScore >= 75 ? "Strong" : displayScore >= 55 ? "Moderate" : displayScore >= 35 ? "Weak" : "Insufficient Data";
  const bidStrengthCls = displayScore >= 75 ? "text-success-foreground" : displayScore >= 55 ? "text-warning-foreground" : displayScore > 0 ? "text-danger-foreground" : "text-muted-foreground";

  const STAR_COLOR: Record<number, string> = {
    0: "#d1d5db", 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#22c55e", 5: "#16a34a",
  };

  function handleSetScore(id: string, val: number) {
    setScores((p) => ({ ...p, [id]: val }));
    setTouchedIds((p) => new Set([...p, id]));
    setDirty(true);
  }

  function handleSetComment(id: string, val: string) {
    setComments((p) => ({ ...p, [id]: val }));
    setDirty(true);
  }

  async function handleSave() {
    const merged: AssessmentData = { ...(assessmentData ?? { scores: {}, comments: {} }), scores, comments };
    await saveAssessment.mutateAsync({ bidId: bid.id, data: merged });
    setDirty(false);
  }

  async function lockAs(d: "go" | "conditional_go" | "no_go") {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: {
        gonogo_score: displayScore,
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

  const canGenerate = hasScores && !!insights;

  return (
    <>
    <div className="space-y-3.5">

      {/* ── Action header ── */}
      <div className="flex items-center gap-3 px-3.5 py-3 bg-muted/30 hairline border border-border rounded-xl">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold">AI Assessment & Result</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {generateAssessment.isPending
              ? `Searching ${indexedDocNames} + iMocha knowledge base…`
              : !hasIndexedDocs
              ? "Upload customer requirement documents in Bid Details to enable AI assessment."
              : isAiScored && assessmentData?.ai_scored_at
              ? `Last run ${new Date(assessmentData.ai_scored_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${indexedDocNames} · iMocha KB`
              : `Ready: ${indexedDocNames} · iMocha KB`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saveAssessment.isPending}
              className="h-8 px-3 rounded-md hairline border text-[11px] text-primary font-medium hover:bg-primary/10 disabled:opacity-40 transition-colors"
            >
              {saveAssessment.isPending ? "Saving…" : "Save Changes"}
            </button>
          )}
          <button
            onClick={() => generateAssessment.mutate(bid.id)}
            disabled={generateAssessment.isPending || !hasIndexedDocs}
            className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {generateAssessment.isPending ? (
              <><RefreshCw className="size-3 animate-spin" /> Assessing…</>
            ) : isAiScored ? (
              <><RefreshCw className="size-3" /> Re-run AI</>
            ) : (
              <>✦ Run AI Assessment</>
            )}
          </button>
        </div>
      </div>

      {/* ── Generating banner ── */}
      {generateAssessment.isPending && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-primary/8 hairline border border-primary/20 rounded-xl text-[11px] text-primary">
          <RefreshCw className="size-3 animate-spin shrink-0" />
          Reading {indexedDocNames} + iMocha knowledge base · scoring all 10 parameters…
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasScores && !generateAssessment.isPending && (
        <div className="flex flex-col items-center text-center gap-3 py-12">
          <div className="size-10 rounded-full bg-muted/50 flex items-center justify-center">
            <BarChart3 className="size-5 text-muted-foreground opacity-40" />
          </div>
          <div>
            <div className="text-[13px] font-medium">No assessment yet</div>
            <div className="text-[11px] text-muted-foreground mt-1 max-w-sm leading-relaxed">
              {hasIndexedDocs
                ? "Click Run AI Assessment to auto-score all 10 qualification parameters from customer documents and the iMocha knowledge base."
                : "Upload the customer's requirement documents in Bid Details, then run the AI assessment. Scores can be edited before locking the Go/No-Go decision."}
            </div>
          </div>
        </div>
      )}

      {/* ── Score summary ── */}
      {hasScores && (
        <section className="bg-card hairline border rounded-xl p-4">
          <h3 className="text-[13px] font-medium mb-3">Qualification Summary</h3>
          <div className="flex items-center gap-5">
            <ScoreGauge score={displayScore} />
            <div className="grid grid-cols-2 gap-2 flex-1">
              {([
                { label: "Avg Parameter Score", value: avgScore },
                { label: "Score Achieved", value: `${displayScore}%` },
                { label: "Bid Strength", value: bidStrength, valueCls: bidStrengthCls },
                { label: "Scored Parameters", value: `${scoredCount} / 10` },
              ] as const).map((m) => (
                <div key={m.label} className="bg-muted/30 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
                  <div className={`text-[16px] font-semibold mt-0.5 ${"valueCls" in m ? (m as any).valueCls : ""}`}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 text-[10px] mt-3 pt-3 border-t hairline border-border">
            <span className="text-success-foreground font-medium">≥ 65 → Go</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-warning-foreground font-medium">45–64 → Conditional Go</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-danger-foreground font-medium">&lt; 45 → No Go</span>
          </div>
        </section>
      )}

      {/* ── Parameter table (editable) ── */}
      {hasScores && (
        <section className="bg-card hairline border rounded-xl overflow-hidden">
          <header className="px-3.5 py-2.5 border-b hairline border-border flex items-center justify-between">
            <h3 className="text-[13px] font-medium">Parameter Scores</h3>
            {isAiScored && (
              <span className="text-[10px] text-muted-foreground">
                ✦ AI-drafted · {touchedIds.size > 0 ? `${touchedIds.size} score${touchedIds.size !== 1 ? "s" : ""} edited` : "click stars to edit"}
              </span>
            )}
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3.5 py-2 font-medium w-8">#</th>
                  <th className="text-left px-3.5 py-2 font-medium">Parameter</th>
                  <th className="text-center px-3.5 py-2 font-medium w-14">Weight</th>
                  <th className="text-left px-3.5 py-2 font-medium w-52">Score</th>
                  <th className="text-left px-3.5 py-2 font-medium hidden lg:table-cell">
                    {isAiScored ? "AI Rationale" : "Notes"}
                  </th>
                  <th className="text-center px-3.5 py-2 font-medium w-24">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y hairline divide-border">
                {DEFAULT_CRITERIA.map((c, i) => {
                  const score = scores[c.id] ?? 0;
                  const starColor = STAR_COLOR[score] ?? STAR_COLOR[0];
                  const contribution = (score / 5) * c.weight * 100;
                  const maxContrib = c.weight * 100;
                  const isEdited = touchedIds.has(c.id);
                  const scoreColor = score >= 4 ? "var(--color-success-foreground)" : score === 3 ? "var(--color-warning-foreground)" : score > 0 ? "var(--color-danger-foreground)" : undefined;
                  return (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3.5 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-3.5 py-3">
                        <div className="font-medium leading-snug">{c.parameter}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed hidden xl:block">{c.focus}</div>
                      </td>
                      <td className="px-3.5 py-3 text-center text-muted-foreground">{Math.round(c.weight * 100)}%</td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => handleSetScore(c.id, n)}
                                className="transition-transform hover:scale-110"
                                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1 }}
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
                          {isAiScored && score > 0 && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${isEdited ? "bg-[#fff0e8] text-orange-600 dark:bg-orange-500/15 dark:text-orange-400" : "bg-[#ede9fd] text-primary dark:bg-primary/15"}`}>
                              {isEdited ? "✎ Edited" : "✦ AI"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 hidden lg:table-cell">
                        {isAiScored && rationales[c.id] ? (
                          <span className="text-[11px] text-muted-foreground leading-relaxed">{rationales[c.id]}</span>
                        ) : (
                          <input
                            type="text"
                            value={comments[c.id] ?? ""}
                            onChange={(e) => handleSetComment(c.id, e.target.value)}
                            placeholder="Add note…"
                            className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground border-0 outline-none focus:ring-0 p-0"
                          />
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-center">
                        {score > 0 ? (
                          <span className="font-medium" style={{ color: scoreColor }}>{contribution.toFixed(1)}</span>
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
                <tr className="bg-muted/40 font-semibold">
                  <td colSpan={5} className="px-3.5 py-2.5 text-[11px] text-right uppercase tracking-wider text-muted-foreground">
                    Total Weighted Score
                  </td>
                  <td className="px-3.5 py-2.5 text-center text-[14px] font-semibold">
                    {totalScore}
                    <span className="text-[11px] text-muted-foreground font-normal"> / 100</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* ── AI Analysis ── */}
      {insights && (
        <section className="bg-card hairline border rounded-xl p-3.5">
          <h3 className="text-[13px] font-medium mb-3">AI Analysis</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-success-foreground font-medium mb-1.5">Key Strengths</div>
              <ul className="space-y-1.5">
                {insights.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-success-foreground mt-0.5 shrink-0">✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-danger-foreground font-medium mb-1.5">Key Risks / Watchouts</div>
              <ul className="space-y-1.5">
                {insights.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-danger-foreground mt-0.5 shrink-0">⚠</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-2 pt-3 border-t hairline border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Recommendation</div>
              <p className="text-[11px] leading-relaxed">{insights.recommendation}</p>
            </div>
          </div>
          {insights.generated_at && (
            <div className="text-[10px] text-muted-foreground mt-3">
              Generated {new Date(insights.generated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              {isAiScored ? " · Grounded in customer documents" : ""}
            </div>
          )}
        </section>
      )}

      {/* ── Document generation ── */}
      {canGenerate && (
        <div className="flex gap-2">
          <button
            onClick={() => generateQualResult.mutate(
              { bidId: bid.id, clientName: bid.client_name, decision: bid.gonogo_decision ?? "no_go", totalScore },
              { onSuccess: (r) => { if (r?.url) openDocx(r.url, r.filename); } },
            )}
            disabled={generateQualResult.isPending}
            className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:opacity-90 inline-flex items-center justify-center gap-1.5 transition-opacity"
          >
            <Mail className="size-3.5" />
            {generateQualResult.isPending ? "Generating…" : "Notify Bid Team"}
          </button>
          <button
            onClick={() => generateDealBrief.mutate(bid.id, { onSuccess: (r) => { if (r?.url) openDocx(r.url, r.filename); } })}
            disabled={generateDealBrief.isPending}
            className="flex-1 h-9 rounded-md hairline border bg-card text-[12px] font-medium disabled:opacity-40 hover:bg-muted inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Eye className="size-3.5" />
            {generateDealBrief.isPending ? "Generating…" : "Deal Brief"}
          </button>
        </div>
      )}

      {/* ── Lock Decision ── */}
      {hasScores && (
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
      )}

    </div>
    {docxViewer && (
      <DocxViewerModal url={docxViewer.url} filename={docxViewer.filename} onClose={() => setDocxViewer(null)} />
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
