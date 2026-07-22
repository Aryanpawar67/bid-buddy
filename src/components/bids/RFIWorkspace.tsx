import { useState, useEffect } from "react";
import {
  Check, Circle, AlertTriangle, MessageSquare, Users, FileText, Activity, LayoutList,
  CheckCircle2, Plus, X, UserPlus, Sparkles, RefreshCw, Download, ChevronDown, ChevronRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import type { Bid } from "@/lib/bid-queries";
import {
  useStageItems, useToggleQuestion, useToggleDeliverable, useBidTeam, useBidActivity,
  useCreateQuestion, useUpdateQuestionResponse, useTeamMembers,
  useGenerateRfiQuestions, useBulkCreateQuestions, useDeleteQuestion, useRegenerateRfiCategory,
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

// ── XLSX download helper (ExcelJS — supports embedded images + full styles) ────

async function downloadQuestionnaire(questions: RfiQuestion[], clientName: string) {
  const ExcelJS = (await import("exceljs")).default;

  const NAVY  = "FF1B3560";
  const BLUE  = "FFD6E8FF";
  const WHITE = "FFFFFFFF";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clarification Questions");

  ws.columns = [
    { key: "num",      width: 5  },
    { key: "cat",      width: 26 },
    { key: "question", width: 65 },
    { key: "response", width: 42 },
  ];

  // ── Fetch + embed the iMocha logo ──────────────────────────────────────────
  try {
    const imgResp = await fetch("/imocha-logo.png");
    const imgBuf  = await imgResp.arrayBuffer();
    const imageId = wb.addImage({ buffer: imgBuf, extension: "png" });

    // Rows 1–3 are the banner (height ~60px total). Place logo in those rows.
    // Columns A–D span ~890px. Logo is 937×201px; scale to fit banner height.
    ws.addImage(imageId, {
      tl: { col: 0.15, row: 0.1 },
      br: { col: 1.6,  row: 2.9 },
      editAs: "oneCell",
    });
  } catch { /* logo fetch failed gracefully — banner still has navy bg */ }

  // Rows 1–3: navy banner background (logo floats above these)
  for (let r = 1; r <= 3; r++) {
    const row = ws.getRow(r);
    row.height = r === 1 ? 28 : 14;
    ["A", "B", "C", "D"].forEach(col => {
      const cell = ws.getCell(`${col}${r}`);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    });
  }
  // Merge A1:D3 for the banner block
  ws.mergeCells("A1:D3");

  // Row 4: column headers
  ws.getRow(4).height = 20;
  const headers = ["#", "Category", "Clarification Required", "Client Response"];
  const cols    = ["A", "B", "C", "D"];
  headers.forEach((h, i) => {
    const cell = ws.getCell(`${cols[i]}4`);
    cell.value = h;
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font  = { bold: true, color: { argb: WHITE }, size: 11, name: "Calibri" };
    cell.alignment = { horizontal: i === 0 ? "center" : "left", vertical: "middle", wrapText: true };
  });

  // Data rows
  questions.forEach((q, i) => {
    const rowNum = i + 5;
    const fill   = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: i % 2 === 0 ? BLUE : WHITE } };
    const row    = ws.getRow(rowNum);
    row.height   = 40;

    const numCell = ws.getCell(`A${rowNum}`);
    numCell.value     = i + 1;
    numCell.fill      = fill;
    numCell.font      = { bold: true, size: 11, name: "Calibri" };
    numCell.alignment = { horizontal: "center", vertical: "top" };

    const catCell = ws.getCell(`B${rowNum}`);
    catCell.value     = q.category;
    catCell.fill      = fill;
    catCell.font      = { size: 10, name: "Calibri" };
    catCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

    const qCell = ws.getCell(`C${rowNum}`);
    qCell.value     = q.question;
    qCell.fill      = fill;
    qCell.font      = { size: 11, name: "Calibri" };
    qCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };

    const rCell = ws.getCell(`D${rowNum}`);
    rCell.value     = "";
    rCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
    rCell.font      = { size: 11, name: "Calibri" };
    rCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  });

  // Freeze pane after header row
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4 }];

  const buf  = await wb.xlsx.writeBuffer();
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
  const toggleQ             = useToggleQuestion();
  const toggleD             = useToggleDeliverable();
  const generateRfi         = useGenerateRfiQuestions();
  const bulkCreate          = useBulkCreateQuestions();
  const deleteQuestion      = useDeleteQuestion();
  const regenerateCategory  = useRegenerateRfiCategory();

  // Review panel draft — persisted in sessionStorage so refresh doesn't lose it
  const SESSION_KEY = `rfi_draft_${bid.id}`;
  const [generated, setGeneratedRaw] = useState<RfiQuestion[] | null>(null);
  const [showAllQs, setShowAllQs]    = useState(false);

  // Download-mode selection (by question id)
  const [downloadMode,     setDownloadMode]     = useState(false);
  const [downloadSelected, setDownloadSelected] = useState<Set<string>>(new Set());

  // Per-category regeneration tracking
  const [regeneratingCat, setRegeneratingCat] = useState<string | null>(null);

  // Restore draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const { questions: qs } = JSON.parse(saved);
        if (Array.isArray(qs)) setGeneratedRaw(qs);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setGenerated(qs: RfiQuestion[] | null) {
    setGeneratedRaw(qs);
  }

  // Sync draft to sessionStorage
  useEffect(() => {
    if (generated) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ questions: generated }));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated]);

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
      onSuccess: ({ questions: qs }) => setGenerated(qs),
    });
  }

  async function handleConfirm() {
    if (!generated) return;
    const rows = generated.map((q, i) => ({
      question_text: `[${q.category}] ${q.question}`,
      status: "pending",
      order_index: questions.length + i,
    }));

    await bulkCreate.mutateAsync({ bidId: bid.id, rows });

    await (supabase as any).from("bid_activity_log").insert({
      bid_id: bid.id,
      user_id: user?.id ?? null,
      action: `AI generated ${generated.length} RFI clarification questions`,
    });

    setGenerated(null);
    toast.success(`${generated.length} questions added to the list`);
  }

  function handleDownloadModeToggle() {
    if (downloadMode) {
      setDownloadMode(false);
      setDownloadSelected(new Set());
    } else {
      setDownloadMode(true);
      setDownloadSelected(new Set(questions.map((q: any) => q.id)));
    }
  }

  async function handleDownloadSelected() {
    const selectedQs = questions
      .filter((q: any) => downloadSelected.has(q.id))
      .map((q: any) => parseDbQuestion(q.question_text));
    await downloadQuestionnaire(selectedQs, bid.client_name);
    setDownloadMode(false);
    setDownloadSelected(new Set());
  }

  function handleRegenerateCategory(category: string) {
    const existingIds = questions
      .filter((q: any) => parseDbQuestion(q.question_text).category === category)
      .map((q: any) => q.id);
    setRegeneratingCat(category);
    regenerateCategory.mutate(
      { bidId: bid.id, category, existingIds },
      {
        onSuccess: () => {
          toast.success(`${category} questions regenerated`);
          setRegeneratingCat(null);
        },
        onError: () => {
          toast.error("Failed to regenerate questions");
          setRegeneratingCat(null);
        },
      }
    );
  }

  function handleDeleteQuestion(id: string) {
    deleteQuestion.mutate(
      { id, bidId: bid.id },
      {
        onSuccess: () => toast.success("Question deleted"),
        onError: () => toast.error("Failed to delete question"),
      }
    );
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
              downloadMode ? (
                <>
                  <span className="text-[11px] text-muted-foreground">
                    <button onClick={() => setDownloadSelected(new Set(questions.map((q: any) => q.id)))} className="text-primary hover:underline">All</button>
                    {" / "}
                    <button onClick={() => setDownloadSelected(new Set())} className="hover:underline">None</button>
                    {" · "}
                    <span className="font-semibold text-foreground">{downloadSelected.size}</span> selected
                  </span>
                  <button
                    onClick={handleDownloadSelected}
                    disabled={downloadSelected.size === 0}
                    className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    <Download className="size-3" />
                    Download {downloadSelected.size > 0 ? `${downloadSelected.size}` : "Selected"}
                  </button>
                  <button
                    onClick={handleDownloadModeToggle}
                    className="h-7 w-7 rounded-md hairline border text-muted-foreground hover:bg-muted inline-flex items-center justify-center transition-colors"
                    title="Cancel selection"
                  >
                    <X className="size-3" />
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDownloadModeToggle}
                  title="Download selected questions as XLSX"
                  className="h-7 px-2.5 rounded-md hairline border bg-card text-[11px] font-medium inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
                >
                  <Download className="size-3" />
                  Download XLSX
                </button>
              )
            )}
            {!generated && !downloadMode && (
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
            onConfirm={handleConfirm}
            onDiscard={() => setGenerated(null)}
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
                    downloadMode={downloadMode}
                    downloadSelected={downloadSelected.has(q.id)}
                    onToggleDownload={() =>
                      setDownloadSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(q.id)) next.delete(q.id); else next.add(q.id);
                        return next;
                      })
                    }
                    onRegenerate={() => handleRegenerateCategory(parseDbQuestion(q.question_text).category)}
                    onDelete={() => handleDeleteQuestion(q.id)}
                    isRegenerating={regeneratingCat === parseDbQuestion(q.question_text).category}
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
            {!downloadMode && (showAllQs || questions.length <= 8) && <AddQuestionInline bidId={bid.id} stage="rfi" />}
            {!downloadMode && <ArchivedSection questions={archived} />}
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
  onConfirm,
  onDiscard,
  isConfirming,
}: {
  questions: RfiQuestion[];
  onConfirm: () => void;
  onDiscard: () => void;
  isConfirming: boolean;
}) {
  const groups = RFI_CATEGORIES
    .map((cat) => ({
      cat,
      items: questions.filter((q) => q.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col">
      <div className="max-h-[440px] overflow-y-auto divide-y hairline divide-border">
        {groups.map(({ cat, items }) => (
          <div key={cat}>
            <div className="px-4 py-1.5 bg-muted/40 sticky top-0 z-10">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {cat} · {items.length}
              </span>
            </div>
            {items.map((q, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20">
                <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 w-4">{i + 1}.</span>
                <span className="text-[12px] leading-relaxed">{q.question}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 bg-muted/20 border-t hairline border-border flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{questions.length}</span> questions generated
          <span className="ml-1.5 text-muted-foreground/60">— use Download XLSX after adding to select which to send</span>
        </span>
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
            disabled={isConfirming}
            className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {isConfirming
              ? <><RefreshCw className="size-3 animate-spin" /> Adding…</>
              : <><Check className="size-3.5" /> Add All to List</>}
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

function QuestionRow({
  num, question, onCycle, downloadMode, downloadSelected, onToggleDownload,
  onRegenerate, onDelete, isRegenerating,
}: {
  num: number;
  question: any;
  onCycle: () => void;
  downloadMode: boolean;
  downloadSelected: boolean;
  onToggleDownload: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  isRegenerating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft]       = useState(question.response_text ?? "");
  const updateResponse          = useUpdateQuestionResponse();

  const done   = question.status === "done";
  const inProg = question.status === "in_progress";

  return (
    <li className="group px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-3">
        {downloadMode && (
          <input
            type="checkbox"
            checked={downloadSelected}
            onChange={onToggleDownload}
            className="mt-1 size-3.5 shrink-0 accent-primary cursor-pointer"
          />
        )}
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
            {/* Action buttons — right-aligned, appear on hover */}
            {!downloadMode && (
              <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Delete question"
                  className="h-5 px-1.5 rounded text-[9px] text-destructive hover:bg-destructive/10 inline-flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="size-2.5" />
                  Delete
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
                  disabled={isRegenerating}
                  title="Regenerate questions for this category"
                  className="h-5 px-1.5 rounded text-[9px] text-primary hover:bg-primary/10 inline-flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={`size-2.5 ${isRegenerating ? "animate-spin" : ""}`} />
                  {isRegenerating ? "Regenerating…" : "Regenerate"}
                </button>
              </div>
            )}
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
