import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, X, ChevronDown, Pencil, Sparkles, RotateCcw, Plus } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { answerQuestionnaireFn } from "@/lib/api/answer-questionnaire";
import { detectColumnsFn } from "@/lib/api/detect-questionnaire-columns";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type Confidence = "high" | "medium" | "low";

type AnswerRow = {
  row: number;
  text: string;
  answer: string;
  confidence: Confidence;
  sources: string[];
};

type ParsedRow = { row: number; text: string };

type ColInfo = {
  letter: string;
  header: string;
  samples: string[];
  avgLen: number;
  fillRate: number; // 0–1
};

type SheetAnalysis = {
  cols: ColInfo[];
  totalDataRows: number;
  detectedHeaderRows: number;
  suggested: { questionCol: string; answerCol: string; statusCol: string; headerRows: number };
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "Supported",
  medium: "Partial",
  low: "Review Required",
};

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  high: "#16a34a",
  medium: "#d97706",
  low: "#dc2626",
};

// ── Column letter helpers ─────────────────────────────────────────────────────

function colNumToLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colLetterToNum(letter: string): number {
  letter = letter.toUpperCase().trim();
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n;
}

// ── XLSX structure analysis ───────────────────────────────────────────────────

// Multilingual role keywords — EN + common Asian/European RFP languages
const Q_KEYWORDS = /question|requirement|specification|description|criterion|item|parameter|ask|query|field|statement|topic|yêu cầu|câu hỏi|требование|anforderung|exigence|requisito|要求|요구사항/i;
const A_KEYWORDS = /answer|response|vendor|reply|comment|your response|proposal|provided by|fill|input|đối tác|ghi chú của đối|partner note|supplier|nhà cung|phản hồi nhà|ответ поставщика|lieferant|fournisseur|proveedor|回答|공급업체/i;
const S_KEYWORDS = /status|coverage|confidence|rating|score|evaluation|result|assessment|verdict|phản hồi đáp|tuân thủ|соответствие|bewertung|évaluation|evaluación|状态|상태/i;

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  // Merged title rows (common in Asian company spreadsheets) return the same
  // value for every column via ExcelJS. The real header row is the first row
  // where at least 2 adjacent cells have distinct non-empty values.
  const scanCols = Math.min(ws.columnCount || 10, 10);
  for (let r = 1; r <= 6; r++) {
    const row = ws.getRow(r);
    const seen = new Set<string>();
    let nonEmpty = 0;
    for (let c = 1; c <= scanCols; c++) {
      const val = String(row.getCell(c).value ?? "").trim();
      if (val) { seen.add(val); nonEmpty++; }
    }
    // Diverse values in multiple columns → this is the real header row
    if (nonEmpty >= 2 && seen.size >= 2) return r;
  }
  return 1;
}

function analyzeWorksheet(ws: ExcelJS.Worksheet): SheetAnalysis {
  const lastCol = ws.columnCount || 10;
  const lastRow = ws.rowCount || 1;
  const SAMPLE_ROWS = 10;

  // Detect the actual header row — skips merged title rows
  const headerRowNum = findHeaderRow(ws);
  const DATA_START = headerRowNum + 1;

  const cols: ColInfo[] = [];

  for (let c = 1; c <= Math.min(lastCol, 26); c++) {
    const letter = colNumToLetter(c);
    const headerCell = ws.getRow(headerRowNum).getCell(c);
    const header = String(headerCell.value ?? "").trim();

    const samples: string[] = [];
    let totalLen = 0;
    let filled = 0;
    const dataRows = Math.min(lastRow - 1, SAMPLE_ROWS);

    for (let r = DATA_START; r <= DATA_START + dataRows - 1; r++) {
      const cell = ws.getRow(r).getCell(c);
      const text = String(cell.value ?? "").trim();
      if (text) {
        filled++;
        totalLen += text.length;
        if (samples.length < 3) samples.push(text.slice(0, 120));
      }
    }

    cols.push({
      letter,
      header,
      samples,
      avgLen: filled > 0 ? Math.round(totalLen / filled) : 0,
      fillRate: dataRows > 0 ? filled / dataRows : 0,
    });
  }

  // Drop trailing all-empty columns
  while (cols.length > 1 && cols[cols.length - 1].fillRate === 0 && !cols[cols.length - 1].header) {
    cols.pop();
  }

  // Score each column for each role
  function scoreQ(c: ColInfo) {
    let s = 0;
    if (Q_KEYWORDS.test(c.header)) s += 4;
    if (c.avgLen > 60) s += 3;
    else if (c.avgLen > 30) s += 1;
    if (c.fillRate > 0.7) s += 2;
    return s;
  }
  function scoreA(c: ColInfo, qLetter: string) {
    let s = 0;
    if (c.letter === qLetter) return -99;
    if (A_KEYWORDS.test(c.header)) s += 4;
    if (c.fillRate < 0.2) s += 3; // mostly empty = good target
    else if (c.fillRate < 0.5) s += 1;
    return s;
  }
  function scoreS(c: ColInfo, qLetter: string, aLetter: string) {
    let s = 0;
    if (c.letter === qLetter || c.letter === aLetter) return -99;
    if (S_KEYWORDS.test(c.header)) s += 4;
    if (c.fillRate < 0.2) s += 2;
    return s;
  }

  const qBest = [...cols].sort((a, b) => scoreQ(b) - scoreQ(a))[0]?.letter ?? "A";
  const aBest = [...cols].sort((a, b) => scoreA(b, qBest) - scoreA(a, qBest))[0]?.letter ?? "B";
  const sBest = [...cols].sort((a, b) => scoreS(b, qBest, aBest) - scoreS(a, qBest, aBest))[0]?.letter ?? "C";

  const dataRowCount = Math.max(0, lastRow - headerRowNum);

  return {
    cols,
    totalDataRows: dataRowCount,
    detectedHeaderRows: headerRowNum,
    suggested: { questionCol: qBest, answerCol: aBest, statusCol: sBest, headerRows: headerRowNum },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuestionnaireResponder({ bidId }: { bidId: string }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();

  // Prior completed questionnaires for this bid
  const { data: priorDocs = [] } = useDocuments({ bidId, type: "questionnaire" });

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [savedDocId, setSavedDocId] = useState<string | null>(null);

  // Multi-sheet
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState(0);

  // Analysis
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiDetectionFailed, setAiDetectionFailed] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // User-confirmed config (seeded from analysis.suggested)
  const [questionCol, setQuestionCol] = useState("A");
  const [answerCol, setAnswerCol] = useState("B");
  const [statusCol, setStatusCol] = useState("C");
  const [headerRows, setHeaderRows] = useState(1);
  // Columns that provide per-row context for each question (e.g. Domain, Category)
  const [contextCols, setContextCols] = useState<string[]>([]);

  const [additionalContext, setAdditionalContext] = useState("");

  // Flow
  const [step, setStep] = useState<"upload" | "detecting" | "confirm" | "preview" | "answering" | "done">("upload");
  const [questions, setQuestions] = useState<ParsedRow[]>([]);
  const [answered, setAnswered] = useState<AnswerRow[]>([]);
  const [progress, setProgress] = useState(0);

  // ── File handling ───────────────────────────────────────────────────────────

  // Stored workbook reference so we can re-analyze when user switches sheet
  const wbRef = useRef<ExcelJS.Workbook | null>(null);

  function applyHeuristic(a: SheetAnalysis) {
    setAnalysis(a);
    setQuestionCol(a.suggested.questionCol);
    setAnswerCol(a.suggested.answerCol);
    setStatusCol(a.suggested.statusCol);
    setHeaderRows(a.suggested.headerRows);
    setContextCols([]); // heuristic doesn't detect context cols
  }

  async function runAiDetection(a: SheetAnalysis, token: string) {
    setAiDetectionFailed(false);
    setAiReasoning(null);
    try {
      const result = await detectColumnsFn({
        data: {
          columns: a.cols.map((c) => ({ letter: c.letter, header: c.header, samples: c.samples })),
          totalRows: a.totalDataRows,
          availableLetters: a.cols.map((c) => c.letter),
        },
        headers: { authorization: `Bearer ${token}` },
      });
      setQuestionCol(result.questionCol);
      setAnswerCol(result.answerCol);
      setStatusCol(result.statusCol);
      setHeaderRows(result.headerRows);
      setContextCols(result.contextCols ?? []);
      setAiReasoning(result.reasoning);
    } catch {
      // Haiku failed — keep heuristic values, flag it
      setAiDetectionFailed(true);
    }
    setStep("confirm");
  }

  async function handleFile(f: File) {
    setFile(f);
    setParseError(null);
    setAnalysis(null);
    setAiReasoning(null);
    setAiDetectionFailed(false);
    setManualMode(false);

    try {
      const buf = await f.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      wbRef.current = wb;

      const names = wb.worksheets.map((s) => s.name);
      if (!names.length) throw new Error("No worksheets found in this file.");
      setSheetNames(names);

      const EN_PREF = /\ben\b|english|eng/i;
      const bestIdx = names.findIndex((n) => EN_PREF.test(n));
      const idx = bestIdx >= 0 ? bestIdx : 0;
      setSelectedSheet(idx);

      const a = analyzeWorksheet(wb.worksheets[idx]);
      applyHeuristic(a); // seed with heuristic while Haiku runs
      setStep("detecting");

      const { data: { session } } = await supabase.auth.getSession();
      await runAiDetection(a, session?.access_token ?? "");
    } catch (e: any) {
      setParseError(e.message ?? "Failed to parse file.");
      setStep("upload");
    }
  }

  async function switchSheet(idx: number) {
    if (!wbRef.current) return;
    setSelectedSheet(idx);
    const ws = wbRef.current.worksheets[idx];
    if (!ws) return;
    const a = analyzeWorksheet(ws);
    applyHeuristic(a);
    setStep("detecting");
    const { data: { session } } = await supabase.auth.getSession();
    await runAiDetection(a, session?.access_token ?? "");
  }

  // ── Parse questions with confirmed config ───────────────────────────────────

  function confirmAndPreview() {
    if (!file || !analysis) return;
    setParseError(null);

    // Use the cached workbook + selected sheet
    const wb = wbRef.current;
    if (!wb) return;
    const ws = wb.worksheets[selectedSheet];
    if (!ws) return;

    void (async () => {

      const qColNum = colLetterToNum(questionCol);
      // Build context column descriptors (letter → column number + header label)
      const ctxCols = contextCols
        .filter((l) => l !== questionCol && l !== answerCol && l !== statusCol)
        .map((l) => ({
          num: colLetterToNum(l),
          header: analysis?.cols.find((c) => c.letter === l)?.header || l,
        }));

      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum <= headerRows) return;
        const text = String(row.getCell(qColNum).value ?? "").trim();
        if (!text) return;

        // Prefix context column values onto the question text
        const ctxParts = ctxCols
          .map(({ num, header }) => {
            const val = String(row.getCell(num).value ?? "").trim();
            return val ? `${header}: ${val}` : null;
          })
          .filter(Boolean) as string[];

        const enriched = ctxParts.length ? `[${ctxParts.join(" | ")}]\n${text}` : text;
        rows.push({ row: rowNum, text: enriched });
      });

      if (!rows.length) {
        setParseError("No questions found in column " + questionCol + ". Check your column assignment.");
        return;
      }
      setQuestions(rows);
      setStep("preview");
    })();
  }

  // ── Answering ───────────────────────────────────────────────────────────────

  async function startAnswering() {
    if (!user || !questions.length) return;
    setStep("answering");
    setAnswered([]);
    setProgress(0);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";

    try {
      const resp = (await answerQuestionnaireFn({
        data: {
          questions,
          bidId,
          additionalContext: additionalContext.trim() || undefined,
        },
        headers: { authorization: `Bearer ${token}` },
      })) as unknown as Response;

      if (!resp.ok || !resp.body) throw new Error(`Server error: ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line);
            const q = questions.find((q) => q.row === r.row);
            if (q) {
              setAnswered((prev) => [...prev, { ...r, text: q.text }]);
              setProgress((prev) => prev + 1);
            }
          } catch { /* skip malformed */ }
        }
      }
      setStep("done");
      void saveToBidDocs();
    } catch (e: any) {
      setParseError(e.message ?? "Answering failed.");
      setStep("preview");
    }
  }

  // ── Answer again (go back to preview with same file) ─────────────────────────

  function answerAgain() {
    setAnswered([]);
    setProgress(0);
    setParseError(null);
    setSavedDocId(null);
    setStep("preview");
  }

  // ── Build result buffer (shared between download + save) ────────────────────
  //
  // Strategy: re-load the original file from disk into a fresh workbook so all
  // client-side formatting (fills, fonts, borders, merged cells) is preserved
  // exactly. Then write only into the answer and status columns. Nothing else
  // is touched — no style overrides, no column width changes, no header rewrites
  // unless the header cell was already empty.

  async function buildResultBuffer(): Promise<{ buf: ArrayBuffer; filename: string } | null> {
    if (!file || !answered.length) return null;

    const aColNum = colLetterToNum(answerCol);
    const sColNum = colLetterToNum(statusCol);
    const answerMap = new Map(answered.map((a) => [a.row, a]));

    // Fresh load of the original file — preserves all client-side formatting
    const originalBuf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(originalBuf);

    const ws = wb.worksheets[selectedSheet];
    if (!ws) return null;

    // Write only to answer + status columns; leave all other cells untouched
    for (const [rowNum, a] of answerMap) {
      const row = ws.getRow(rowNum);

      const ansCell = row.getCell(aColNum);
      ansCell.value = a.answer;
      ansCell.alignment = { wrapText: true, vertical: "top" };

      const stCell = row.getCell(sColNum);
      stCell.value = CONFIDENCE_LABEL[a.confidence];
      stCell.alignment = { horizontal: "center", vertical: "top" };
    }

    // Add header labels only if those cells are currently empty
    const headerRowIdx = headerRows > 0 ? headerRows : 1;
    const hRow = ws.getRow(headerRowIdx);
    if (!String(hRow.getCell(aColNum).value ?? "").trim()) {
      hRow.getCell(aColNum).value = "iMocha Response";
    }
    if (!String(hRow.getCell(sColNum).value ?? "").trim()) {
      hRow.getCell(sColNum).value = "Coverage";
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `${file.name.replace(/\.xlsx$/i, "")} iMocha Responses.xlsx`;
    return { buf, filename };
  }

  // ── Download ────────────────────────────────────────────────────────────────

  async function downloadResult() {
    const result = await buildResultBuffer();
    if (!result) return;
    const { buf, filename } = result;
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Save to bid documents ────────────────────────────────────────────────────

  async function saveToBidDocs(): Promise<boolean> {
    const result = await buildResultBuffer();
    if (!result) return false;
    const { buf, filename } = result;

    // Each questionnaire file gets its own storage path — multiple per bid supported
    const storagePath = `${bidId}/questionnaire/${filename}`;
    const fileBlob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const { error: storageErr } = await supabase.storage
      .from("bid-documents")
      .upload(storagePath, fileBlob, { upsert: true });

    if (storageErr) {
      toast.error("Failed to save questionnaire response.");
      return false;
    }

    const { data: session } = await supabase.auth.getSession();
    const { data: doc } = await (supabase as any).from("bid_documents").insert({
      bid_id: bidId,
      name: filename,
      type: "questionnaire",
      stage: "rfi",
      storage_path: storagePath,
      size_bytes: buf.byteLength,
      uploaded_by: session?.session?.user?.id ?? user?.id,
      source: "generated",
    }).select("id").single();

    if (doc?.id) setSavedDocId(doc.id);
    qc.invalidateQueries({ queryKey: ["documents"] });
    return true;
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  function reset() {
    setFile(null);
    setAnalysis(null);
    setAiReasoning(null);
    setAiDetectionFailed(false);
    setManualMode(false);
    setContextCols([]);
    setSheetNames([]);
    setSelectedSheet(0);
    wbRef.current = null;
    setQuestions([]);
    setAnswered([]);
    setParseError(null);
    setProgress(0);
    setSavedDocId(null);
    setAdditionalContext("");
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  }

  const progressPct = questions.length > 0 ? Math.round((progress / questions.length) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 border-b hairline border-border px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold">Vendor Assessment Autopilot</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Upload a prospect questionnaire XLSX — AI detects the structure and answers each question from iMocha's Knowledge Base.
          </p>
        </div>
        {step !== "upload" && (
          <button
            onClick={reset}
            className="h-7 px-2.5 rounded-md hairline border border-border bg-card text-[11px] text-muted-foreground inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
          >
            <X className="size-3" /> Start over
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* ── Prior completed questionnaires ─────────────────────────────── */}
        {priorDocs.length > 0 && (
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Completed questionnaires
            </p>
            <div className="rounded-lg hairline border border-border overflow-hidden">
              {priorDocs.map((doc, i) => (
                <PriorDocRow key={doc.id} doc={doc} isLast={i === priorDocs.length - 1} />
              ))}
            </div>
          </div>
        )}

        {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="max-w-lg space-y-4">
            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground text-center">
                Drop your prospect's questionnaire XLSX here or click to browse
              </p>
              <p className="text-[10px] text-muted-foreground text-center">
                Any format — AI will detect question and response columns automatically
              </p>
              <span className="text-[11px] text-primary font-medium">Choose file</span>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            {parseError && (
              <div className="flex items-start gap-2 text-[12px] text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Detecting ───────────────────────────────────────────────────── */}
        {step === "detecting" && (
          <div className="max-w-lg flex flex-col items-center justify-center py-16 gap-4">
            <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="size-5 text-primary animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-[13px] font-medium">Analysing spreadsheet structure…</p>
              <p className="text-[11px] text-muted-foreground mt-1">Haiku is reading column headers and sample data to identify questions and response columns</p>
            </div>
            <Loader2 className="size-4 text-primary animate-spin" />
          </div>
        )}

        {/* ── Step 2: Confirm structure ───────────────────────────────────── */}
        {step === "confirm" && analysis && (
          <div className="max-w-2xl space-y-5">
            {/* File summary */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border hairline border-primary/20">
              <FileSpreadsheet className="size-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-foreground truncate">{file?.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {analysis.cols.length} columns detected · ~{analysis.totalDataRows} data rows
                  {analysis.detectedHeaderRows > 1 && (
                    <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                      title row detected — headers read from row {analysis.detectedHeaderRows}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Sheet selector — shown when workbook has multiple sheets */}
            {sheetNames.length > 1 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Sheet
                </p>
                <div className="flex flex-wrap gap-2">
                  {sheetNames.map((name, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => switchSheet(idx)}
                      className={[
                        "h-7 px-3 rounded-md text-[11px] font-medium border hairline transition-colors",
                        selectedSheet === idx
                          ? "bg-primary text-white border-primary"
                          : "bg-card text-foreground border-border hover:bg-muted",
                      ].join(" ")}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Select the sheet that contains the questionnaire to answer
                </p>
              </div>
            )}

            {/* AI-detected column table */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Detected columns
              </p>
              <div className="rounded-lg hairline border border-border overflow-hidden">
                <div className="grid grid-cols-[2rem_1fr_1fr_6rem_6rem] bg-muted border-b hairline border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <div className="px-3 py-2">Col</div>
                  <div className="px-2 py-2">Header</div>
                  <div className="px-2 py-2">Sample content</div>
                  <div className="px-2 py-2 text-center">Avg. length</div>
                  <div className="px-2 py-2 text-center">Fill rate</div>
                </div>
                {analysis.cols.map((col) => {
                  const isQ = col.letter === questionCol;
                  const isA = col.letter === answerCol;
                  const isS = col.letter === statusCol;
                  const role = isQ ? "Questions" : isA ? "Responses" : isS ? "Coverage" : null;
                  const roleColor = isQ
                    ? "bg-primary/10 text-primary"
                    : isA
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : isS
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : null;
                  return (
                    <div
                      key={col.letter}
                      className={`grid grid-cols-[2rem_1fr_1fr_6rem_6rem] border-b hairline border-border last:border-0 text-[11px] ${role ? "bg-primary/5" : ""}`}
                    >
                      <div className="px-3 py-2.5 font-mono font-bold text-foreground">{col.letter}</div>
                      <div className="px-2 py-2.5">
                        <span className="font-medium text-foreground">{col.header || <span className="text-muted-foreground italic">(no header)</span>}</span>
                        {role && (
                          <span className={`ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded ${roleColor}`}>
                            {role}
                          </span>
                        )}
                      </div>
                      <div className="px-2 py-2.5 text-muted-foreground truncate">
                        {col.samples[0] ? col.samples[0].slice(0, 60) + (col.samples[0].length > 60 ? "…" : "") : <span className="italic">empty</span>}
                      </div>
                      <div className="px-2 py-2.5 text-center text-muted-foreground">{col.avgLen > 0 ? `${col.avgLen} chars` : "—"}</div>
                      <div className="px-2 py-2.5 text-center text-muted-foreground">{col.fillRate > 0 ? `${Math.round(col.fillRate * 100)}%` : "—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Editable column assignment */}
            <div>
              {/* AI reasoning / failure banner */}
              {aiReasoning && !aiDetectionFailed && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border hairline border-primary/20 mb-3">
                  <Sparkles className="size-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px] text-foreground leading-relaxed">
                    <span className="font-semibold text-primary">Haiku: </span>{aiReasoning}
                  </p>
                </div>
              )}
              {aiDetectionFailed && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border hairline border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 mb-3">
                  <AlertCircle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">
                    AI detection failed — showing best-guess from column analysis. Please verify and adjust below.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Confirm column assignment
                </p>
                <button
                  type="button"
                  onClick={() => setManualMode((m) => !m)}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <Pencil className="size-3" />
                  {manualMode ? "Back to dropdowns" : "Type column letters manually"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {manualMode ? (
                  <>
                    <ManualColInput label="Read questions from" value={questionCol} onChange={setQuestionCol} accent="primary" hint="Column letter containing the questions / requirements" />
                    <ManualColInput label="Write iMocha responses to" value={answerCol} onChange={setAnswerCol} accent="emerald" hint="Empty column where AI answers will be written" />
                    <ManualColInput label="Write coverage badge to" value={statusCol} onChange={setStatusCol} accent="amber" hint="Column for Supported / Partial / Review Required" />
                  </>
                ) : (
                  <>
                    <ColPicker
                      label="Read questions from"
                      value={questionCol}
                      onChange={setQuestionCol}
                      cols={analysis.cols}
                      accent="primary"
                      hint="Column that contains the vendor's questions / requirements"
                    />
                    <ColPicker
                      label="Write iMocha responses to"
                      value={answerCol}
                      onChange={setAnswerCol}
                      cols={analysis.cols}
                      accent="emerald"
                      hint="Blank column where AI answers will be written"
                    />
                    <ColPicker
                      label="Write coverage badge to"
                      value={statusCol}
                      onChange={setStatusCol}
                      cols={analysis.cols}
                      accent="amber"
                      hint="Column for Supported / Partial / Review Required badge"
                    />
                  </>
                )}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                    Header rows to skip
                  </label>
                  <input
                    type="number" min={0} max={5} value={headerRows}
                    onChange={(e) => setHeaderRows(Number(e.target.value))}
                    className="w-full h-8 rounded-md hairline border border-border bg-card px-3 text-[12px] text-foreground text-center font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Rows at the top that contain headers, not questions</p>
                </div>
              </div>

              {/* Context columns — optional per-row enrichment */}
              <div className="mt-4 pt-4 border-t hairline border-border">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Context columns
                  </p>
                  <span className="text-[10px] text-muted-foreground font-normal normal-case">(optional)</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2.5 leading-relaxed">
                  Select columns whose values help clarify each question — e.g. Domain, Category, Section.
                  Their values will be prefixed to each question when Claude generates answers.
                </p>
                <div className="flex flex-wrap gap-2">
                  {analysis.cols
                    .filter((c) => c.letter !== questionCol && c.letter !== answerCol && c.letter !== statusCol)
                    .map((c) => {
                      const active = contextCols.includes(c.letter);
                      return (
                        <button
                          key={c.letter}
                          type="button"
                          onClick={() =>
                            setContextCols((prev) =>
                              active ? prev.filter((l) => l !== c.letter) : [...prev, c.letter],
                            )
                          }
                          className={[
                            "h-7 px-2.5 rounded-md text-[11px] border hairline transition-colors inline-flex items-center gap-1.5",
                            active
                              ? "bg-primary text-white border-primary"
                              : "bg-card text-foreground border-border hover:bg-muted",
                          ].join(" ")}
                        >
                          <span className="font-mono font-bold">{c.letter}</span>
                          {c.header && (
                            <span className={`text-[10px] ${active ? "opacity-80" : "text-muted-foreground"}`}>
                              — {c.header.slice(0, 22)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
                {contextCols.length > 0 && (
                  <p className="text-[10px] text-primary mt-2">
                    Column{contextCols.length > 1 ? "s" : ""} {contextCols.join(", ")} will be included as context with each question
                  </p>
                )}
              </div>
            </div>

            {parseError && (
              <div className="flex items-start gap-2 text-[12px] text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> {parseError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={confirmAndPreview}
                className="h-8 px-4 rounded-md bg-primary text-white text-[12px] font-semibold hover:opacity-90 transition-opacity"
              >
                Looks right — show questions →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Preview ─────────────────────────────────────────────── */}
        {step === "preview" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-medium">{file?.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {questions.length} questions · column {questionCol} · responses → {answerCol} · badge → {statusCol}
                  {contextCols.length > 0 && (
                    <span className="ml-1 text-primary">· context: {contextCols.join(", ")}</span>
                  )}
                </p>
              </div>
              <button
                onClick={startAnswering}
                className="h-8 px-3.5 rounded-md bg-primary text-white text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-primary/90 transition-colors"
              >
                Answer {questions.length} questions
              </button>
            </div>

            <div className="rounded-lg hairline border border-border overflow-hidden">
              <div className="bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b hairline border-border">
                Preview (first {Math.min(5, questions.length)} questions)
              </div>
              {questions.slice(0, 5).map((q) => (
                <div key={q.row} className="px-3 py-2 border-b hairline border-border last:border-0 text-[12px]">
                  <span className="text-muted-foreground mr-2 font-mono text-[10px]">row {q.row}</span>
                  {q.text}
                </div>
              ))}
              {questions.length > 5 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">+ {questions.length - 5} more questions</div>
              )}
            </div>

            {/* Additional context for the AI */}
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1.5">
                Additional context for the AI
                <span className="ml-1.5 text-[10px] font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="e.g. Focus on TA product only. We do not support SAP SF. Client is a government entity — avoid mentioning pricing tiers."
                rows={3}
                className="w-full rounded-md hairline border border-border bg-card px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Constraints, product focus, or client-specific notes applied to every answer.
              </p>
            </div>

            {parseError && (
              <div className="flex items-start gap-2 text-[12px] text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" /> {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Answering ───────────────────────────────────────────── */}
        {step === "answering" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 text-primary animate-spin" />
              <div>
                <p className="text-[12px] font-medium">Answering {progress} / {questions.length}…</p>
                <p className="text-[11px] text-muted-foreground">Processing in batches of 5</p>
              </div>
              <span className="ml-auto text-[11px] font-mono text-muted-foreground">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${progressPct}%` }} />
            </div>
            {answered.length > 0 && (
              <div className="rounded-lg hairline border border-border overflow-hidden">
                <div className="bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b hairline border-border">
                  Live results
                </div>
                <div className="divide-y hairline divide-border max-h-72 overflow-y-auto">
                  {answered.map((a) => <AnswerCard key={a.row} a={a} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Done ────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="max-w-2xl space-y-4">
            {/* Success banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border hairline border-emerald-500/30">
              <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {answered.length} questions answered
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {answered.filter((a) => a.confidence === "high").length} supported ·{" "}
                  {answered.filter((a) => a.confidence === "medium").length} partial ·{" "}
                  {answered.filter((a) => a.confidence === "low").length} review required
                </p>
                {savedDocId
                  ? <p className="text-[11px] text-emerald-600 mt-1 font-medium">✓ Saved to bid documents</p>
                  : <p className="text-[11px] text-muted-foreground mt-1">Saving to bid documents…</p>
                }
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={answerAgain}
                  className="h-8 px-3 rounded-md hairline border border-border bg-card text-[11px] text-foreground font-medium inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
                >
                  <RotateCcw className="size-3" /> Answer again
                </button>
                <button
                  onClick={downloadResult}
                  className="h-8 px-3.5 rounded-md bg-primary text-white text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-primary/90 transition-colors"
                >
                  <Download className="size-3.5" /> Download XLSX
                </button>
              </div>
            </div>

            {/* Process another questionnaire */}
            <div
              onClick={reset}
              className="flex items-center gap-3 p-3 rounded-lg hairline border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors"
            >
              <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Plus className="size-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[12px] font-medium">Process another questionnaire</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Upload a second XLSX for this bid — answers will be saved alongside this one</p>
              </div>
            </div>

            {/* All answers */}
            <div className="rounded-lg hairline border border-border overflow-hidden">
              <div className="bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b hairline border-border">
                All answers
              </div>
              <div className="divide-y hairline divide-border max-h-[60vh] overflow-y-auto">
                {answered.map((a) => <AnswerCard key={a.row} a={a} />)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PriorDocRow({ doc, isLast }: { doc: BidDocument; isLast: boolean }) {
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const { data } = await supabase.storage
        .from("bid-documents")
        .createSignedUrl(doc.storage_path, 120);
      if (!data?.signedUrl) throw new Error("No signed URL");
      const res = await fetch(data.signedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent — user can retry
    } finally {
      setDownloading(false);
    }
  }

  const created = new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${isLast ? "" : "border-b hairline border-border"}`}>
      <FileSpreadsheet className="size-4 text-emerald-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium truncate">{doc.name}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{created}</p>
      </div>
      <button
        onClick={download}
        disabled={downloading}
        className="h-7 px-2.5 rounded-md hairline border border-border bg-card text-[11px] text-foreground inline-flex items-center gap-1.5 hover:bg-muted transition-colors disabled:opacity-50"
      >
        {downloading ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        Download
      </button>
    </div>
  );
}

function ColPicker({
  label, value, onChange, cols, accent, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  cols: ColInfo[];
  accent: "primary" | "emerald" | "amber";
  hint: string;
}) {
  const ring = accent === "primary" ? "focus:ring-primary/40" : accent === "emerald" ? "focus:ring-emerald-400/40" : "focus:ring-amber-400/40";
  const badge = accent === "primary"
    ? "bg-primary/10 text-primary"
    : accent === "emerald"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
        {label}
        <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${badge}`}>{value}</span>
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-8 rounded-md hairline border border-border bg-card px-2 pr-7 text-[12px] text-foreground appearance-none focus:outline-none focus:ring-2 ${ring}`}
        >
          {cols.map((c) => (
            <option key={c.letter} value={c.letter}>
              {c.letter}{c.header ? ` — ${c.header}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function ManualColInput({
  label, value, onChange, accent, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent: "primary" | "emerald" | "amber";
  hint: string;
}) {
  const ring = accent === "primary" ? "focus:ring-primary/40" : accent === "emerald" ? "focus:ring-emerald-400/40" : "focus:ring-amber-400/40";
  const badge = accent === "primary"
    ? "bg-primary/10 text-primary"
    : accent === "emerald"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
        {label}
        <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${badge}`}>{value || "?"}</span>
      </label>
      <input
        type="text"
        value={value}
        maxLength={3}
        placeholder="e.g. C"
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={`w-full h-8 rounded-md hairline border border-border bg-card px-3 text-[12px] text-foreground font-mono text-center focus:outline-none focus:ring-2 ${ring}`}
      />
      <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function AnswerCard({ a }: { a: AnswerRow }) {
  const label = CONFIDENCE_LABEL[a.confidence];
  const badgeClass =
    a.confidence === "high"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
      : a.confidence === "medium"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2 mb-1">
        <span className="text-[10px] text-muted-foreground font-mono mt-0.5 shrink-0">#{a.row}</span>
        <p className="text-[11px] text-muted-foreground flex-1 leading-relaxed">{a.text}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${badgeClass}`}>{label}</span>
      </div>
      <p className="text-[12px] leading-relaxed pl-5">{a.answer}</p>
      {a.sources.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1 pl-5">Sources: {a.sources.join(", ")}</p>
      )}
    </div>
  );
}
