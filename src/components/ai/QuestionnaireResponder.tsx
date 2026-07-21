import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, X, ChevronDown } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { useBids } from "@/lib/bid-queries";
import { supabase } from "@/integrations/supabase/client";
import { answerQuestionnaireFn } from "@/lib/api/answer-questionnaire";
import ExcelJS from "exceljs";

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

const Q_KEYWORDS = /question|requirement|specification|description|criterion|item|parameter|ask|query|field|statement|topic/i;
const A_KEYWORDS = /answer|response|vendor|reply|comment|your response|proposal|provided by|fill|input/i;
const S_KEYWORDS = /status|coverage|confidence|rating|score|evaluation|result|assessment|verdict/i;

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

export function QuestionnaireResponder() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bidId, setBidId] = useState<string>("__global");

  // Analysis
  const [analysis, setAnalysis] = useState<SheetAnalysis | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // User-confirmed config (seeded from analysis.suggested)
  const [questionCol, setQuestionCol] = useState("A");
  const [answerCol, setAnswerCol] = useState("B");
  const [statusCol, setStatusCol] = useState("C");
  const [headerRows, setHeaderRows] = useState(1);

  // Flow
  const [step, setStep] = useState<"upload" | "confirm" | "preview" | "answering" | "done">("upload");
  const [questions, setQuestions] = useState<ParsedRow[]>([]);
  const [answered, setAnswered] = useState<AnswerRow[]>([]);
  const [progress, setProgress] = useState(0);

  // ── File handling ───────────────────────────────────────────────────────────

  async function handleFile(f: File) {
    setFile(f);
    setParseError(null);
    setAnalysis(null);

    try {
      const buf = await f.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No worksheets found in this file.");

      const a = analyzeWorksheet(ws);
      setAnalysis(a);
      setQuestionCol(a.suggested.questionCol);
      setAnswerCol(a.suggested.answerCol);
      setStatusCol(a.suggested.statusCol);
      setHeaderRows(a.suggested.headerRows);
      setStep("confirm");
    } catch (e: any) {
      setParseError(e.message ?? "Failed to parse file.");
    }
  }

  // ── Parse questions with confirmed config ───────────────────────────────────

  function confirmAndPreview() {
    if (!file || !analysis) return;
    setParseError(null);

    // Re-parse using confirmed column settings
    file.arrayBuffer().then(async (buf) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) return;

      const qColNum = colLetterToNum(questionCol);
      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum <= headerRows) return;
        const cell = row.getCell(qColNum);
        const text = String(cell.value ?? "").trim();
        if (text) rows.push({ row: rowNum, text });
      });

      if (!rows.length) {
        setParseError("No questions found in column " + questionCol + ". Check your column assignment.");
        return;
      }
      setQuestions(rows);
      setStep("preview");
    });
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
        data: { questions, bidId: bidId === "__global" ? null : bidId },
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
    } catch (e: any) {
      setParseError(e.message ?? "Answering failed.");
      setStep("preview");
    }
  }

  // ── Download ────────────────────────────────────────────────────────────────

  async function downloadResult() {
    if (!file || !answered.length) return;

    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return;

    const aCol = colLetterToNum(answerCol);
    const sCol = colLetterToNum(statusCol);

    if (headerRows > 0) {
      const hRow = ws.getRow(1);
      hRow.getCell(aCol).value = "iMocha Response";
      hRow.getCell(aCol).font = { bold: true };
      hRow.getCell(sCol).value = "Coverage";
      hRow.getCell(sCol).font = { bold: true };
    }

    for (const a of answered) {
      const wsRow = ws.getRow(a.row);
      wsRow.getCell(aCol).value = a.answer;
      wsRow.getCell(aCol).alignment = { wrapText: true };

      const label = CONFIDENCE_LABEL[a.confidence];
      const color = CONFIDENCE_COLOR[a.confidence].replace("#", "").toUpperCase();
      wsRow.getCell(sCol).value = label;
      wsRow.getCell(sCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
      wsRow.getCell(sCol).font = { bold: true, color: { argb: "FFFFFFFF" } };
      wsRow.getCell(sCol).alignment = { horizontal: "center" };
    }

    ws.getColumn(aCol).width = 60;
    ws.getColumn(sCol).width = 18;

    const out = await wb.xlsx.writeBuffer();
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.xlsx$/i, "")} — iMocha Responses.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  function reset() {
    setFile(null);
    setAnalysis(null);
    setQuestions([]);
    setAnswered([]);
    setParseError(null);
    setProgress(0);
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

        {/* ── Step 1: Upload ─────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="max-w-lg space-y-4">
            {/* Bid context */}
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                Bid context (optional)
              </label>
              <div className="relative">
                <select
                  value={bidId}
                  onChange={(e) => setBidId(e.target.value)}
                  className="w-full h-8 rounded-md hairline border border-border bg-card px-2 pr-7 text-[12px] text-foreground appearance-none"
                >
                  <option value="__global">Global KB only (no bid docs)</option>
                  {bids.map((b) => (
                    <option key={b.id} value={b.id}>{b.client_name} — {b.title}</option>
                  ))}
                </select>
                <ChevronDown className="size-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

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
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                Confirm column assignment
              </p>
              <div className="grid grid-cols-2 gap-3">
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
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border hairline border-emerald-500/30">
              <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Done — {answered.length} questions answered
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {answered.filter((a) => a.confidence === "high").length} supported ·{" "}
                  {answered.filter((a) => a.confidence === "medium").length} partial ·{" "}
                  {answered.filter((a) => a.confidence === "low").length} review required
                </p>
              </div>
              <button
                onClick={downloadResult}
                className="h-8 px-3.5 rounded-md bg-primary text-white text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-primary/90 transition-colors shrink-0"
              >
                <Download className="size-3.5" /> Download XLSX
              </button>
            </div>
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
