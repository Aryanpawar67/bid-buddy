import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
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

export function QuestionnaireResponder() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  // Config
  const [questionCol, setQuestionCol] = useState("A");
  const [answerCol, setAnswerCol] = useState("B");
  const [statusCol, setStatusCol] = useState("C");
  const [headerRows, setHeaderRows] = useState(1);
  const [bidId, setBidId] = useState<string>("__global");

  // Parsed
  const [questions, setQuestions] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  // Answering
  const [step, setStep] = useState<"upload" | "preview" | "answering" | "done">("upload");
  const [answered, setAnswered] = useState<AnswerRow[]>([]);
  const [progress, setProgress] = useState(0);

  function colLetter(letter: string): number {
    letter = letter.toUpperCase().trim();
    let n = 0;
    for (let i = 0; i < letter.length; i++) {
      n = n * 26 + (letter.charCodeAt(i) - 64);
    }
    return n;
  }

  async function handleFile(f: File) {
    setFile(f);
    setParseError(null);
    setQuestions([]);
    try {
      const buf = await f.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No worksheets found in this file.");

      const qCol = colLetter(questionCol);
      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum <= headerRows) return;
        const cell = row.getCell(qCol);
        const text = cell.text?.trim() ?? "";
        if (text) rows.push({ row: rowNum, text });
      });

      if (!rows.length) throw new Error("No questions found. Check the column letter and header rows setting.");
      setQuestions(rows);
      setStep("preview");
    } catch (e: any) {
      setParseError(e.message ?? "Failed to parse file.");
    }
  }

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

      if (!resp.ok || !resp.body) {
        throw new Error(`Server error: ${resp.status}`);
      }

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
          } catch {
            // skip malformed lines
          }
        }
      }

      setStep("done");
    } catch (e: any) {
      setParseError(e.message ?? "Answering failed.");
      setStep("preview");
    }
  }

  async function downloadResult() {
    if (!file || !answered.length) return;

    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return;

    const aCol = colLetter(answerCol);
    const sCol = colLetter(statusCol);

    // Write header labels if header rows > 0
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
      wsRow.getCell(sCol).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${color}` },
      };
      wsRow.getCell(sCol).font = { bold: true, color: { argb: "FFFFFFFF" } };
      wsRow.getCell(sCol).alignment = { horizontal: "center" };
    }

    // Auto-width answer column
    ws.getColumn(aCol).width = 60;
    ws.getColumn(sCol).width = 18;

    const out = await wb.xlsx.writeBuffer();
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const origName = file.name.replace(/\.xlsx$/i, "");
    a.download = `${origName} — iMocha Responses.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setFile(null);
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
            Upload a prospect questionnaire XLSX — AI answers each question from iMocha's Knowledge Base.
          </p>
        </div>
        {step !== "upload" && (
          <button
            onClick={reset}
            className="h-7 px-2.5 rounded-md hairline border border-border bg-card text-[11px] text-muted-foreground inline-flex items-center gap-1.5 hover:bg-muted transition-colors"
          >
            <X className="size-3" />
            Start over
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* ── Step 1: Upload + Config ── */}
        {step === "upload" && (
          <div className="max-w-lg space-y-4">
            {/* Bid context selector */}
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                Bid context (optional)
              </label>
              <select
                value={bidId}
                onChange={(e) => setBidId(e.target.value)}
                className="w-full h-8 rounded-md hairline border border-border bg-card px-2 text-[12px] text-foreground"
              >
                <option value="__global">Global KB only (no bid docs)</option>
                {bids.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.client_name} — {b.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Column config */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Question column", value: questionCol, set: setQuestionCol },
                { label: "Answer column", value: answerCol, set: setAnswerCol },
                { label: "Status column", value: statusCol, set: setStatusCol },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={value}
                    maxLength={3}
                    onChange={(e) => set(e.target.value.toUpperCase())}
                    className="w-full h-8 rounded-md hairline border border-border bg-card px-2 text-[12px] text-foreground text-center font-mono"
                  />
                </div>
              ))}
            </div>

            <div className="w-32">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                Header rows
              </label>
              <input
                type="number"
                min={0}
                max={5}
                value={headerRows}
                onChange={(e) => setHeaderRows(Number(e.target.value))}
                className="w-full h-8 rounded-md hairline border border-border bg-card px-2 text-[12px] text-foreground text-center font-mono"
              />
            </div>

            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <FileSpreadsheet className="size-8 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground text-center">
                Drop an XLSX questionnaire here or click to browse
              </p>
              <span className="text-[11px] text-primary font-medium">Choose file</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {parseError && (
              <div className="flex items-start gap-2 text-[12px] text-destructive bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {step === "preview" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] font-medium">{file?.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {questions.length} questions found · question column {questionCol}
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
                Preview (first {Math.min(3, questions.length)} questions)
              </div>
              {questions.slice(0, 3).map((q) => (
                <div key={q.row} className="px-3 py-2 border-b hairline border-border last:border-0 text-[12px]">
                  <span className="text-muted-foreground mr-2">#{q.row}</span>
                  {q.text}
                </div>
              ))}
              {questions.length > 3 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  + {questions.length - 3} more questions
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Answering ── */}
        {step === "answering" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 text-primary animate-spin" />
              <div>
                <p className="text-[12px] font-medium">
                  Answering {progress} / {questions.length}…
                </p>
                <p className="text-[11px] text-muted-foreground">Processing in batches of 5</p>
              </div>
              <span className="ml-auto text-[11px] font-mono text-muted-foreground">{progressPct}%</span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Live results */}
            {answered.length > 0 && (
              <div className="rounded-lg hairline border border-border overflow-hidden">
                <div className="bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b hairline border-border">
                  Live results
                </div>
                <div className="divide-y hairline divide-border max-h-72 overflow-y-auto">
                  {answered.map((a) => (
                    <AnswerCard key={a.row} a={a} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Done ── */}
        {step === "done" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border hairline border-emerald-500/30">
              <CheckCircle2 className="size-5 text-emerald-600" />
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
                className="h-8 px-3.5 rounded-md bg-primary text-white text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <Download className="size-3.5" />
                Download XLSX
              </button>
            </div>

            <div className="rounded-lg hairline border border-border overflow-hidden">
              <div className="bg-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b hairline border-border">
                All answers
              </div>
              <div className="divide-y hairline divide-border max-h-[60vh] overflow-y-auto">
                {answered.map((a) => (
                  <AnswerCard key={a.row} a={a} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
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
        <p className="text-[10px] text-muted-foreground mt-1 pl-5">
          Sources: {a.sources.join(", ")}
        </p>
      )}
    </div>
  );
}
