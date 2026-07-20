import { useState, useEffect } from "react";
import {
  Check, Circle, AlertTriangle, MessageSquare, Users, FileText, Activity, LayoutList,
  Clock, CheckCircle2, Plus, X, UserPlus, Sparkles, RefreshCw, Download, ChevronDown, ChevronRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import {
  useStageItems, useToggleQuestion, useToggleDeliverable, useBidTeam, useBidActivity,
  useCreateQuestion, useUpdateQuestionResponse, useTeamMembers,
  useGenerateRfiQuestions, useBulkCreateQuestions,
} from "@/lib/bid-queries";
import { supabase } from "@/integrations/supabase/client";
import { initials } from "@/lib/bid-constants";
import { useQueryClient } from "@tanstack/react-query";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AdvanceStageFooter } from "./AdvanceStageFooter";
import type { TabDef } from "./BidHeaderBar";
import { useCurrentUser } from "@/lib/auth";
import type { RfiQuestion, RfiCategory } from "@/lib/api/generate-rfi-questions";
import { RFI_CATEGORIES } from "@/lib/api/generate-rfi-questions";

export type RFITab = "overview" | "team" | "activity_log";

export const RFI_TABS: TabDef[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "team", label: "Team", icon: Users },
  { key: "activity_log", label: "Activity Log", icon: Activity },
];

function daysLeft(deadline: string) {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function avatarColor(name: string): string {
  const colors = ["#491AEB", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#db2777"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

// ── Parse DB question text back to category/question ─────────────────────────
// DB stores as "[Category] Question text" — reverse that for XLSX re-download
function parseDbQuestion(text: string): RfiQuestion {
  const match = text.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
  if (match && RFI_CATEGORIES.includes(match[1] as RfiCategory)) {
    return { category: match[1] as RfiCategory, question: match[2].trim() };
  }
  return { category: "Scope & Delivery", question: text.trim() };
}

// ── XLSX download helper ──────────────────────────────────────────────────────

async function downloadQuestionnaire(questions: RfiQuestion[], clientName: string) {
  // xlsx-js-style is a drop-in replacement for SheetJS that actually applies cell styles
  const XLSX = await import("xlsx-js-style");

  const NAVY  = "1B3560";
  const WHITE = "FFFFFF";
  const BLUE  = "D6E8FF";

  type CellStyle = Record<string, unknown>;

  function mkCell(v: string | number, s: CellStyle): any {
    return { v, t: typeof v === "number" ? "n" : "s", s };
  }

  const navyFill  = { patternType: "solid", fgColor: { rgb: NAVY } };
  const blueFill  = { patternType: "solid", fgColor: { rgb: BLUE } };
  const whiteFill = { patternType: "solid", fgColor: { rgb: WHITE } };
  const navyFont  = (sz: number, bold = false) => ({ bold, color: { rgb: WHITE }, sz, name: "Calibri" });
  const bodyFont  = (sz = 11, bold = false) => ({ bold, sz });
  const left      = { horizontal: "left",   vertical: "top",    wrapText: true };
  const center    = { horizontal: "center", vertical: "center" };

  const ws: any = {};

  // Rows 1-3: iMocha banner (merged A1:D3)
  ws["A1"] = mkCell("  iMocha", { fill: navyFill, font: navyFont(20, true), alignment: center });
  for (const ref of ["B1","C1","D1","A2","B2","C2","D2","A3","B3","C3","D3"]) {
    ws[ref] = mkCell("", { fill: navyFill });
  }

  // Row 4: column headers
  const hBase = { fill: navyFill, font: navyFont(11, true) };
  ws["A4"] = mkCell("#",                      { ...hBase, alignment: center });
  ws["B4"] = mkCell("Category",               { ...hBase, alignment: left });
  ws["C4"] = mkCell("Clarification Required", { ...hBase, alignment: left });
  ws["D4"] = mkCell("Client Response",        { ...hBase, alignment: left });

  // Data rows (row 5 onward)
  questions.forEach((q, i) => {
    const row  = i + 5;
    const fill = i % 2 === 0 ? blueFill : whiteFill;
    ws[`A${row}`] = mkCell(i + 1,      { fill, font: bodyFont(11, true), alignment: center });
    ws[`B${row}`] = mkCell(q.category, { fill, font: bodyFont(10),       alignment: left });
    ws[`C${row}`] = mkCell(q.question, { fill, font: bodyFont(11),       alignment: left });
    ws[`D${row}`] = mkCell("",         { fill: whiteFill, font: bodyFont(11), alignment: left });
  });

  const lastRow = questions.length + 4;
  ws["!ref"]    = `A1:D${lastRow}`;
  ws["!cols"]   = [{ wch: 5 }, { wch: 26 }, { wch: 65 }, { wch: 42 }];
  ws["!rows"]   = [{ hpt: 26 }, { hpt: 10 }, { hpt: 10 }, { hpt: 20 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 2, c: 3 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clarification Questions");
  const buf  = XLSX.write(wb, { type: "array", bookType: "xlsx", cellStyles: true });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${clientName.replace(/[^a-zA-Z0-9]/g, "_")}_RFI_Clarification_Questions.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── RFIWorkspace ──────────────────────────────────────────────────────────────

export function RFIWorkspace({ bid, activeTab, onTabChange }: {
  bid: Bid;
  activeTab: string;
  onTabChange: (t: string) => void;
}) {
  const { user } = useCurrentUser();
  const items     = useStageItems(bid.id, "rfi");
  const { data: team = [] }     = useBidTeam(bid.id);
  const { data: activity = [] } = useBidActivity(bid.id);
  const { data: docs = [] }     = useDocuments({ bidId: bid.id });
  const [docPanelOpen, setDocPanelOpen] = useState(false);

  const allQuestions  = items.data?.questions ?? [];
  const deliverables  = items.data?.deliverables ?? [];
  const toggleQ       = useToggleQuestion();
  const toggleD       = useToggleDeliverable();
  const generateRfi   = useGenerateRfiQuestions();
  const bulkCreate    = useBulkCreateQuestions();

  // Review panel state — persisted in sessionStorage so refresh doesn't lose it
  const SESSION_KEY = `rfi_draft_${bid.id}`;
  const [generated, setGeneratedRaw] = useState<RfiQuestion[] | null>(null);
  const [selected,  setSelected]     = useState<Set<number>>(new Set());
  const [showAllQs, setShowAllQs]    = useState(false);

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const { questions: qs, selectedIndices } = JSON.parse(saved);
        setGeneratedRaw(qs);
        setSelected(new Set(selectedIndices as number[]));
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setGenerated(qs: RfiQuestion[] | null) {
    setGeneratedRaw(qs);
  }

  // Sync review state to sessionStorage whenever it changes
  useEffect(() => {
    if (generated) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        questions: generated,
        selectedIndices: Array.from(selected),
      }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, selected]);

  const hasIndexedDocs = docs.some((d: any) => d.embedding !== null);

  // Separate active (pending/in_progress/done) from archived (blocked)
  const questions = allQuestions.filter((q: any) => q.status !== "blocked");
  const archived  = allQuestions.filter((q: any) => q.status === "blocked");

  const total      = questions.length;
  const answered   = questions.filter((q: any) => q.status === "done").length;
  const inProgress = questions.filter((q: any) => q.status === "in_progress").length;
  const pending    = questions.filter((q: any) => q.status === "pending").length;
  const pct        = total ? Math.round((answered / total) * 100) : 0;

  const dl       = daysLeft(bid.deadline);
  const clarDays = (bid as any).clarification_deadline
    ? Math.ceil((new Date((bid as any).clarification_deadline).getTime() - Date.now()) / 86400000)
    : null;

  const health      = total === 0 ? "Not Started" : pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
  const healthColor = total === 0 ? "var(--color-muted-foreground)" : pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
  const healthBg    = total === 0 ? "var(--color-muted)" : pct >= 70 ? "#dcfce7" : pct >= 40 ? "#fef9c3" : "#fee2e2";

  function handleGenerate() {
    generateRfi.mutate({ bidId: bid.id }, {
      onSuccess: ({ questions: qs }) => {
        setGenerated(qs);
        setSelected(new Set(qs.map((_, i) => i))); // all pre-selected
      },
    });
  }

  async function handleConfirm() {
    if (!generated) return;
    const selectedQs = generated.filter((_, i) => selected.has(i));
    const archivedQs = generated.filter((_, i) => !selected.has(i));

    const rows = [
      ...selectedQs.map((q, i) => ({
        question_text: `[${q.category}] ${q.question}`,
        status: "pending",
        order_index: questions.length + i,
      })),
      ...archivedQs.map((q, i) => ({
        question_text: q.question,
        status: "blocked",
        order_index: questions.length + selectedQs.length + i,
      })),
    ];

    await bulkCreate.mutateAsync({ bidId: bid.id, rows });

    await (supabase as any).from("bid_activity_log").insert({
      bid_id: bid.id,
      user_id: user?.id ?? null,
      action: `AI generated ${selectedQs.length} RFI clarification questions (${archivedQs.length} archived)`,
    });

    await downloadQuestionnaire(selectedQs, bid.client_name);
    setGenerated(null);
    setSelected(new Set());
  }

  if (activeTab === "team") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Team Members</h3>
            <AssignMemberPopover bidId={bid.id} assignedUserIds={team.map((m) => m.user_id)} />
          </div>
          {team.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No team members assigned yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {team.map((m) => (
                <TeamMemberRow key={m.user_id} member={m} bidId={bid.id} />
              ))}
            </ul>
          )}
        </div>
        <AdvanceStageFooter bid={bid} stage="rfi" />
      </div>
    );
  }

  if (activeTab === "activity_log") {
    return (
      <div className="px-6 py-5 max-w-[700px]">
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Activity Log</h3>
          </div>
          {activity.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">No activity recorded yet.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {activity.map((e: any) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <div className="size-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  <div>
                    <div className="text-[12px]">{e.action}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {e.profiles?.full_name ?? "System"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <AdvanceStageFooter bid={bid} stage="rfi" />
      </div>
    );
  }

  // ── Overview tab ────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 flex gap-4 items-start">
    <div className="flex-1 min-w-0 max-w-[1100px]">
      {clarDays !== null && clarDays <= 3 && (
        <div className="mb-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border hairline border-amber-400 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            Clarification deadline {clarDays <= 0 ? "is overdue" : `in ${clarDays}d`} — questions due to{" "}
            <strong>{(bid as any).contact_name ?? "the client"}</strong> by{" "}
            {new Date((bid as any).clarification_deadline!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="col-span-1 bg-card hairline border rounded-xl p-4 flex flex-col items-center justify-center gap-2">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-muted)" strokeWidth="7" />
            <circle
              cx="40" cy="40" r="34" fill="none"
              stroke="var(--color-primary)" strokeWidth="7"
              strokeDasharray={`${(pct / 100) * 213.6} 213.6`}
              strokeLinecap="round"
              transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dasharray .5s ease" }}
            />
            <text x="40" y="44" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor">{pct}%</text>
          </svg>
          <div className="text-[10px] text-muted-foreground text-center leading-snug">
            <span className="text-foreground font-semibold">{answered}</span> of {total} answered
          </div>
        </div>

        <div className="col-span-2 bg-card hairline border rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">RFI Details</div>
          <div className="grid grid-cols-2 gap-y-2">
            <KV label="Due Date" value={bid.deadline ? new Date(bid.deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"} />
            <KV label="Time Remaining" value={dl < 0 ? `${Math.abs(dl)}d over` : `${dl}d left`} urgent={dl <= 5} />
            <KV label="Total Questions" value={String(total)} />
            <KV label="Answered" value={String(answered)} />
            <KV label="In Progress" value={String(inProgress)} />
            <KV label="Pending" value={String(pending)} />
            {(bid as any).clarification_deadline && (
              <>
                <KV
                  label="Clarif. Deadline"
                  value={new Date((bid as any).clarification_deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                />
                <KV
                  label="Clarif. Time Left"
                  value={clarDays! <= 0 ? `${Math.abs(clarDays!)}d over` : `${clarDays}d left`}
                  urgent={clarDays! <= 5}
                />
              </>
            )}
          </div>
        </div>

        <div className="col-span-1 bg-card hairline border rounded-xl p-4 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">RFI Health</div>
          <span
            className="self-start text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: healthBg, color: healthColor }}
          >
            {health}
          </span>
          <div className="flex flex-col gap-1.5 mt-auto">
            <HealthCheck label={total === 0 ? "Add your first question to begin" : "Questions assigned"} ok={total > 0} />
            <HealthCheck label="Responses on schedule" ok={total > 0 && pct >= 40} />
            <HealthCheck label="Deadline not overdue" ok={dl >= 0} />
          </div>
        </div>
      </div>

      {team.length > 0 && (
        <div className="bg-card hairline border rounded-xl p-4 mb-4 flex items-center gap-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Team</div>
          <div className="flex items-center gap-2 flex-wrap">
            {team.slice(0, 6).map((m) => (
              <div
                key={m.user_id}
                title={`${m.full_name} · ${m.role.replace(/_/g, " ")}`}
                className="size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 cursor-default"
                style={{ background: avatarColor(m.full_name) }}
              >
                {initials(m.full_name)}
              </div>
            ))}
            {team.length > 6 && (
              <div className="size-7 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                +{team.length - 6}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/ai"
              search={{ bidId: bid.id }}
              className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
            >
              <MessageSquare className="size-3.5" />
              Open RFx Responder
            </Link>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-3 px-1">
        <LegendDot color="#491AEB" label={`Answered (${answered})`} />
        <LegendDot color="#f59e0b" label={`In Progress (${inProgress})`} />
        <LegendDot color="var(--color-border-strong)" label={`Pending (${pending})`} />
      </div>

      <div className="bg-card hairline border rounded-xl overflow-hidden mb-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
          <h3 className="text-[13px] font-semibold">Questions</h3>
          <div className="flex items-center gap-2">
            {!generated && (
              <span className="text-[11px] text-muted-foreground">{answered}/{total} answered</span>
            )}
            {!generated && questions.length > 0 && (
              <button
                onClick={() => downloadQuestionnaire(questions.map((q: any) => parseDbQuestion(q.question_text)), bid.client_name)}
                title="Download current questions as XLSX to send to client"
                className="h-7 px-2.5 rounded-md hairline border bg-card text-[11px] font-medium inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
              >
                <Download className="size-3" />
                Download XLSX
              </button>
            )}
            {!generated && (
              <button
                onClick={handleGenerate}
                disabled={generateRfi.isPending || !hasIndexedDocs}
                title={!hasIndexedDocs ? "Upload and index documents in Bid Details to enable AI generation" : "Generate clarification questions with AI"}
                className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {generateRfi.isPending
                  ? <><RefreshCw className="size-3 animate-spin" /> Generating…</>
                  : <><Sparkles className="size-3" /> Generate</>}
              </button>
            )}
            <button
              onClick={() => setDocPanelOpen((o) => !o)}
              title="Toggle documents panel"
              className={`p-1 rounded hover:bg-muted ${docPanelOpen ? "text-primary" : "text-muted-foreground"}`}
            >
              <FileText className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Generating banner */}
        {generateRfi.isPending && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 text-primary text-[11px] border-b hairline border-primary/20">
            <RefreshCw className="size-3 animate-spin shrink-0" />
            Analyzing customer documents + iMocha KB · generating clarification questions…
          </div>
        )}

        {/* Review panel OR normal list */}
        {generated ? (
          <ReviewPanel
            questions={generated}
            selected={selected}
            onToggle={(i) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              })
            }
            onSelectAll={() => setSelected(new Set(generated.map((_, i) => i)))}
            onDeselectAll={() => setSelected(new Set())}
            onConfirm={handleConfirm}
            onDiscard={() => { setGenerated(null); setSelected(new Set()); }}
            isConfirming={bulkCreate.isPending}
          />
        ) : (
          <>
            {questions.length === 0 ? (
              <div className="py-8 text-center">
                <div className="text-[12px] text-muted-foreground mb-1">No questions added yet.</div>
                {hasIndexedDocs && (
                  <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                    Click Generate to auto-populate clarification questions from your documents.
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y hairline divide-border">
                {(showAllQs ? questions : questions.slice(0, 8)).map((q: any, i: number) => (
                  <QuestionRow
                    key={q.id}
                    num={i + 1}
                    question={q}
                    onCycle={() => {
                      const next = q.status === "pending" ? "in_progress" : q.status === "in_progress" ? "done" : "pending";
                      toggleQ.mutate({ id: q.id, status: next });
                    }}
                  />
                ))}
              </ul>
            )}
            {questions.length > 8 && (
              <button
                onClick={() => setShowAllQs((o) => !o)}
                className="w-full px-4 py-2.5 border-t hairline border-border text-[11px] text-primary font-medium hover:bg-muted/40 text-left"
              >
                {showAllQs ? `▲ Show less` : `▼ Show all ${questions.length} questions`}
              </button>
            )}
            {(showAllQs || questions.length <= 8) && <AddQuestionInline bidId={bid.id} stage="rfi" />}
            <ArchivedSection questions={archived} />
          </>
        )}
      </div>

      {deliverables.length > 0 && (
        <div className="bg-card hairline border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">Deliverables</h3>
            <span className="text-[11px] text-muted-foreground">
              {deliverables.filter((d) => d.status === "done").length}/{deliverables.length} done
            </span>
          </div>
          <ul className="divide-y hairline divide-border">
            {deliverables.map((d) => {
              const done = d.status === "done";
              return (
                <li key={d.id} className="flex items-start gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleD.mutate({ id: d.id, status: done ? "pending" : "done" })}
                    className={[
                      "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border",
                      done ? "bg-success-soft border-[#97C459]" : "border-dashed border-border-strong",
                    ].join(" ")}
                  >
                    {done ? <Check className="size-3 text-success-foreground" strokeWidth={2.5} /> : <Circle className="size-2 text-muted-foreground/40" />}
                  </button>
                  <div>
                    <div className={`text-[12.5px] ${done ? "line-through text-muted-foreground" : ""}`}>{d.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{d.type}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AdvanceStageFooter bid={bid} stage="rfi" />
    </div>
    {docPanelOpen && <DocQuickPanel bidId={bid.id} onClose={() => setDocPanelOpen(false)} />}
    </div>
  );
}

// ── ReviewPanel ───────────────────────────────────────────────────────────────

function ReviewPanel({
  questions,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onConfirm,
  onDiscard,
  isConfirming,
}: {
  questions: RfiQuestion[];
  selected: Set<number>;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  isConfirming: boolean;
}) {
  const selectedCount = selected.size;
  const total         = questions.length;

  // Group by category, preserving declaration order
  const groups = RFI_CATEGORIES
    .map((cat) => ({
      cat,
      items: questions
        .map((q, idx) => ({ ...q, idx }))
        .filter((q) => q.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col">
      {/* Category + checkbox list */}
      <div className="max-h-[440px] overflow-y-auto divide-y hairline divide-border">
        {groups.map(({ cat, items }) => (
          <div key={cat}>
            <div className="px-4 py-1.5 bg-muted/40 sticky top-0 z-10">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {cat}
              </span>
            </div>
            {items.map(({ question, idx }) => {
              const isSelected = selected.has(idx);
              return (
                <label
                  key={idx}
                  className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? "hover:bg-muted/20" : "hover:bg-muted/10 opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(idx)}
                    className="mt-0.5 size-3.5 shrink-0 accent-primary cursor-pointer"
                  />
                  <span className="text-[12px] leading-relaxed select-none">{question}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-muted/20 border-t hairline border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{selectedCount}</span> of {total} selected
          </span>
          <span className="text-muted-foreground/40">·</span>
          <button onClick={onSelectAll} className="text-[11px] text-primary hover:underline">All</button>
          <button onClick={onDeselectAll} className="text-[11px] text-muted-foreground hover:underline">None</button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscard}
            disabled={isConfirming}
            className="h-8 px-3 rounded-md hairline border text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onConfirm}
            disabled={isConfirming || selectedCount === 0}
            className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {isConfirming
              ? <><RefreshCw className="size-3 animate-spin" /> Adding…</>
              : <><Download className="size-3.5" /> Add to List & Download</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ArchivedSection ───────────────────────────────────────────────────────────

function ArchivedSection({ questions }: { questions: any[] }) {
  const [open, setOpen] = useState(false);
  if (questions.length === 0) return null;

  return (
    <div className="border-t hairline border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
      >
        {open
          ? <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
        <span className="text-[11px] text-muted-foreground">
          Archived AI Suggestions — {questions.length}
        </span>
      </button>
      {open && (
        <ul className="pb-2 divide-y hairline divide-border/50">
          {questions.map((q: any, i: number) => (
            <li key={q.id} className="flex items-start gap-2.5 px-4 py-2 opacity-55">
              <span className="text-[10px] text-muted-foreground w-4 shrink-0 mt-0.5">{i + 1}</span>
              <span className="text-[11px] text-muted-foreground leading-relaxed">{q.question_text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── QuestionRow ───────────────────────────────────────────────────────────────

function QuestionRow({ num, question, onCycle }: {
  num: number;
  question: any;
  onCycle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft]       = useState(question.response_text ?? "");
  const updateResponse          = useUpdateQuestionResponse();

  const done   = question.status === "done";
  const inProg = question.status === "in_progress";

  return (
    <li className="px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-3">
        <span className="text-[10px] text-muted-foreground w-5 shrink-0 mt-0.5">{num}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onCycle(); }}
          className={[
            "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
            done ? "bg-success-soft border-[#97C459]" : inProg ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-dashed border-border-strong",
          ].join(" ")}
        >
          {done   && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
          {inProg && <div className="size-2 rounded-full bg-amber-400" />}
          {!done && !inProg && <Circle className="size-2 text-muted-foreground/40" />}
        </button>
        <div className="flex-1 min-w-0">
          <button onClick={() => setExpanded((o) => !o)} className="text-left w-full">
            <div className={`text-[12.5px] leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>
              {question.question_text}
            </div>
          </button>
          <div className="flex items-center gap-2 mt-1">
            <span className={[
              "text-[9px] font-semibold px-1.5 py-0.5 rounded",
              done ? "bg-success-soft text-success-foreground" : inProg ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
            ].join(" ")}>
              {done ? "Answered" : inProg ? "In Progress" : "Pending"}
            </span>
            {question.assigned_team && (
              <span className="text-[10px] text-muted-foreground">{question.assigned_team.replace(/_/g, " ")}</span>
            )}
            {question.response_text && <FileText className="size-3 text-muted-foreground" />}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-8">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Your response</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Draft your response here… (auto-saves on blur)"
            className="w-full text-[12px] bg-muted/30 hairline border rounded-md p-2 resize-none min-h-[5rem] focus:outline-none focus:ring-1 focus:ring-ring"
            onBlur={() => {
              if (draft !== (question.response_text ?? "")) {
                const nextStatus = question.status === "pending" && draft.trim() ? "in_progress" : undefined;
                updateResponse.mutate({ id: question.id, responseText: draft, status: nextStatus });
              }
            }}
          />
          <button onClick={() => setExpanded(false)} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground">
            ▲ Collapse
          </button>
        </div>
      )}
    </li>
  );
}

// ── AddQuestionInline ─────────────────────────────────────────────────────────

function AddQuestionInline({ bidId, stage }: { bidId: string; stage: "rfi" | "rfp" | "bafo" | "contract_closure" | "deal_qualification" | "orals" | "due_diligence" | "post_closure" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [team, setTeam] = useState<"pre_sales" | "legal" | "finance">("pre_sales");
  const create          = useCreateQuestion();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 text-[11px] text-primary font-medium hover:bg-muted/30 transition-colors flex items-center gap-1.5 justify-center border-t hairline border-border"
      >
        <Plus className="size-3.5" /> Add question
      </button>
    );
  }

  return (
    <div className="px-4 py-3 border-t hairline border-border bg-muted/20">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter question text…"
        className="w-full text-[12px] bg-card hairline border rounded-md p-2 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2 mt-2">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value as "pre_sales" | "legal" | "finance")}
          className="h-7 px-2 text-[11px] bg-card hairline border rounded-md"
        >
          <option value="pre_sales">Pre-Sales</option>
          <option value="legal">Legal</option>
          <option value="finance">Finance</option>
        </select>
        <button
          onClick={async () => {
            if (!text.trim()) return;
            await create.mutateAsync({ bidId, stage, questionText: text.trim(), assignedTeam: team });
            setText("");
            setOpen(false);
          }}
          disabled={!text.trim() || create.isPending}
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50"
        >
          {create.isPending ? "…" : "Add"}
        </button>
        <button onClick={() => { setText(""); setOpen(false); }} className="h-7 px-3 rounded-md hairline border text-[11px]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── DocQuickPanel ─────────────────────────────────────────────────────────────

function DocQuickPanel({ bidId, onClose }: { bidId: string; onClose: () => void }) {
  const { data: docs = [] } = useDocuments({ bidId });
  const [preview, setPreview] = useState<BidDocument | null>(null);

  return (
    <>
      <div className="w-60 shrink-0 bg-card hairline border rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b hairline border-border">
          <span className="text-[11px] font-semibold">Documents ({docs.length})</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {docs.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-muted-foreground">No documents.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setPreview(d)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 text-left"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[11px] truncate">{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {preview && <DocPreviewModal doc={preview} allDocs={docs} onClose={() => setPreview(null)} />}
    </>
  );
}

// ── AssignMemberPopover ───────────────────────────────────────────────────────

function AssignMemberPopover({ bidId, assignedUserIds }: { bidId: string; assignedUserIds: string[] }) {
  const { data: members = [] } = useTeamMembers();
  const qc   = useQueryClient();
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
          <div className="py-4 text-center text-[11px] text-muted-foreground">All team members already assigned.</div>
        ) : (
          <ul>
            {unassigned.map((m) => (
              <li key={m.user_id}>
                <button
                  onClick={() => assign(m.user_id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 rounded-md text-left"
                >
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

// ── TeamMemberRow ─────────────────────────────────────────────────────────────

function TeamMemberRow({ member, bidId }: { member: any; bidId: string }) {
  const qc = useQueryClient();

  async function remove() {
    await (supabase as any).from("bid_assignments").delete().eq("id", member.assignment_id);
    qc.invalidateQueries({ queryKey: ["bid-team", bidId] });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div
        className="size-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ background: avatarColor(member.full_name) }}
      >
        {initials(member.full_name)}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-tight">{member.full_name}</div>
        <div className="text-[11px] text-muted-foreground">{member.email}</div>
      </div>
      <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary capitalize">
        {member.role.replace(/_/g, " ")}
      </span>
      <button onClick={remove} className="text-muted-foreground hover:text-destructive transition-colors ml-1">
        <X className="size-3.5" />
      </button>
    </li>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

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
      {ok
        ? <CheckCircle2 className="size-3.5 text-success-foreground shrink-0" />
        : <AlertTriangle className="size-3.5 text-warning-foreground shrink-0" />}
      <span className={ok ? "text-foreground" : "text-warning-foreground"}>{label}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <div className="size-2 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </div>
  );
}
