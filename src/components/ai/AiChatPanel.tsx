import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Copy, Check, Download, FileText, Paperclip, CheckCircle2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/lib/ai-queries";
import { useGenerateProposal } from "@/lib/ai-queries";
import type { Bid } from "@/lib/bid-queries";
import type { BidDocument } from "@/lib/doc-queries";
import { useUploadAndIndexDocument } from "@/lib/doc-queries";
import { stageLabel } from "@/lib/bid-constants";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

const MODELS = [
  { id: "claude-opus-4-8",            label: "Claude Opus" },
  { id: "claude-sonnet-4-6",          label: "Claude Sonnet" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku" },
  { id: "azure-gpt-5.4",              label: "GPT-5.4 (Azure)" },
  { id: "azure-oss-120b",             label: "OSS 120B (Azure)" },
] as const;

const QUICK_ACTIONS_GENERIC = [
  {
    label: "Summarise RFP",
    prompt:
      "Please provide a concise executive summary of this RFP, highlighting the key requirements, evaluation criteria, and submission details.",
  },
  {
    label: "Win themes",
    prompt:
      "Based on this bid's context and requirements, identify 3-5 compelling win themes that differentiate iMocha and resonate with this client's priorities.",
  },
  {
    label: "Identify risks",
    prompt:
      "Analyse this bid and identify the top risks — commercial, technical, timeline, and compliance. For each risk, suggest a mitigation approach.",
  },
  {
    label: "Draft exec summary",
    prompt:
      "Draft a compelling executive summary for our proposal response to this RFP. Focus on our understanding of their needs, our solution approach, and key differentiators.",
  },
] as const;

const QUICK_ACTIONS_RFI_RFP = [
  {
    label: "Analyse requirements",
    prompt:
      "Please analyse the client requirements in the uploaded documents and map each one to iMocha's capabilities. Output format: Requirement | Status | iMocha Capability | Source.",
  },
  {
    label: "Map to KB",
    prompt:
      "Review all requirements in this RFP/RFI and classify each as SUPPORTED or NOT SUPPORTED based strictly on iMocha's knowledge base. Do not infer or assume capabilities not explicitly documented.",
  },
  {
    label: "Security & compliance",
    prompt:
      "What are iMocha's security certifications, data protection measures, and compliance posture relevant to this RFP? Include applicable policy references.",
  },
  {
    label: "Draft response section",
    prompt:
      "Based on the RFP requirements in the uploaded documents, draft a structured response section addressing iMocha's capabilities. Cite the source document for each claim.",
  },
] as const;

type Props = {
  activeBid: Bid | null;
  isGlobal: boolean;
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (text?: string, mentionedDocIds?: string[]) => void;
  model: string;
  onModelChange: (model: string) => void;
  requestCount: number;
  bidDocs?: BidDocument[];
};

export function AiChatPanel({
  activeBid,
  isGlobal,
  sessionId,
  messages,
  isStreaming,
  inputValue,
  onInputChange,
  onSend,
  model,
  onModelChange,
  requestCount,
  bidDocs = [],
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // @ mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionIndex, setMentionIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Attachment state
  const fileInputRef = useRef<HTMLInputElement>(null);
  type Attachment = {
    localId: string;
    name: string;
    status: "uploading" | "indexing" | "ready" | "error";
    docId?: string;
    error?: string;
  };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const uploadAndIndex = useUploadAndIndexDocument();
  const { primaryRole } = useCurrentUser();

  const MAX_ATTACH_BYTES = 26_214_400; // 25 MB
  const ATTACH_EXT = /\.(pdf|docx|xlsx)$/i;

  const canAttach = !isGlobal && !!activeBid &&
    (primaryRole === "pre_sales" || primaryRole === "admin");
  const attachmentsPending = attachments.some(
    (a) => a.status === "uploading" || a.status === "indexing"
  );
  const readyDocIds = attachments
    .filter((a) => a.status === "ready" && a.docId)
    .map((a) => a.docId!);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Filtered doc list for the @ dropdown
  const mentionDocs = mentionQuery !== null
    ? bidDocs.filter((d) =>
        d.name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];

  function resolveMentionedDocIds(text: string): string[] {
    const refs = text.match(/@([^\s@]+)/g) ?? [];
    const ids: string[] = [];
    for (const ref of refs) {
      const name = ref.slice(1);
      const doc = bidDocs.find((d) => d.name === name);
      if (doc) ids.push(doc.id);
    }
    return [...new Set(ids)];
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    onInputChange(val);

    // Detect @ trigger: find last @ before cursor that isn't followed by a space
    const cursor = e.target.selectionStart ?? val.length;
    const textUpToCursor = val.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf("@");
    if (atIdx !== -1 && !textUpToCursor.slice(atIdx + 1).includes(" ") && !isGlobal && bidDocs.length > 0) {
      setMentionQuery(textUpToCursor.slice(atIdx + 1));
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function selectDoc(doc: BidDocument) {
    const cursor = textareaRef.current?.selectionStart ?? inputValue.length;
    const textUpToCursor = inputValue.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf("@");
    const before = inputValue.slice(0, atIdx);
    const after = inputValue.slice(cursor);
    const newVal = `${before}@${doc.name} ${after}`;
    onInputChange(newVal);
    setMentionQuery(null);
    // Restore focus and move cursor after the inserted mention
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + doc.name.length + 2; // "@" + name + " "
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !activeBid) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    const valid: File[] = [];
    for (const f of Array.from(files)) {
      if (!ATTACH_EXT.test(f.name)) {
        toast.warning(`${f.name}: only PDF, DOCX, and XLSX are supported`);
        continue;
      }
      if (f.size > MAX_ATTACH_BYTES) {
        toast.warning(`${f.name}: file must be under 25 MB`);
        continue;
      }
      valid.push(f);
    }

    for (const file of valid) {
      const localId = crypto.randomUUID();
      setAttachments((prev) => [...prev, { localId, name: file.name, status: "uploading" }]);

      try {
        setAttachments((prev) =>
          prev.map((a) => a.localId === localId ? { ...a, status: "indexing" } : a)
        );
        const doc = await uploadAndIndex.mutateAsync({
          file,
          type: "reference",
          bidId: activeBid.id,
          stage: null,
        });
        setAttachments((prev) =>
          prev.map((a) => a.localId === localId ? { ...a, status: "ready", docId: doc.id } : a)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        const display = msg.includes("upsert") || msg.includes("already exists")
          ? "Already exists — use Documents tab to replace"
          : msg;
        setAttachments((prev) =>
          prev.map((a) => a.localId === localId ? { ...a, status: "error", error: display } : a)
        );
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionDocs.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionDocs.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionDocs.length) % mentionDocs.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectDoc(mentionDocs[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) handleSend();
    }
  }

  function handleSend(overrideText?: string) {
    const text = (overrideText ?? inputValue) ||
      (readyDocIds.length ? "Please review the attached document(s)." : "");
    const mentioned = resolveMentionedDocIds(text);
    const ids = [...new Set([...mentioned, ...readyDocIds])];
    onSend(text || undefined, ids.length ? ids : undefined);
    setAttachments([]);
  }

  const canSend = !isStreaming && !!sessionId && !attachmentsPending &&
    (inputValue.trim().length > 0 || readyDocIds.length > 0);
  const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;
  const isRfiRfpStage = activeBid?.stage === "rfi" || activeBid?.stage === "rfp";
  const quickActions = isRfiRfpStage ? QUICK_ACTIONS_RFI_RFP : QUICK_ACTIONS_GENERIC;
  const generateProposal = useGenerateProposal();
  const [proposalError, setProposalError] = useState<string | null>(null);

  async function handleGenerateProposal() {
    if (!activeBid || !sessionId) return;
    setProposalError(null);
    onSend("Generating branded proposal — analysing bid requirements…", undefined);
    try {
      const res = await generateProposal.mutateAsync({
        bidId: activeBid.id,
        sessionId,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const contentDisposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "proposal.docx";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      const openItemsRaw = res.headers.get("X-Open-Items");
      const openItems: string[] = openItemsRaw ? JSON.parse(openItemsRaw) : [];
      const openItemsText = openItems.length
        ? `\n\n**Open items to complete in the DOCX:**\n${openItems.map((i) => `- ${i}`).join("\n")}`
        : "";

      onSend(
        `Proposal generated and saved to Knowledge Hub. Download started.${openItemsText}`,
        undefined
      );
    } catch {
      setProposalError("Proposal generation failed — please try again.");
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Context strip */}
      <div className="flex items-center gap-3 px-4 py-2 border-b hairline border-border bg-card shrink-0">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {isGlobal ? (
            <span className="text-[11px] font-medium text-muted-foreground">
              Global — no bid context
            </span>
          ) : activeBid ? (
            <>
              <span className="text-[11px] font-semibold truncate">
                {activeBid.client_name}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ede9fd] text-primary font-semibold">
                {stageLabel(activeBid.stage)}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Select a bid to start
            </span>
          )}
        </div>

        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="text-[10px] bg-background border hairline border-border rounded-md px-2 py-1 text-foreground"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {requestCount} requests today
        </span>
      </div>

      {/* Quick action chips — bid mode only, empty session only */}
      {showQuickActions && (
        <div className="flex gap-2 px-4 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleSend(action.prompt)}
              disabled={isStreaming}
              className="text-[10px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-primary hover:text-white hover:border-primary disabled:opacity-40 transition-colors"
            >
              {action.label}
            </button>
          ))}
          {isRfiRfpStage && (
            <>
              <button
                onClick={handleGenerateProposal}
                disabled={isStreaming || generateProposal.isPending}
                className="text-[10px] px-3 py-1.5 rounded-full border hairline border-orange-400/60 text-orange-600 bg-orange-50/50 hover:bg-orange-500 hover:text-white hover:border-orange-500 disabled:opacity-40 transition-colors dark:text-orange-400 dark:bg-orange-950/20"
              >
                {generateProposal.isPending ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin inline" /> Generating…
                  </span>
                ) : (
                  "Generate Proposal"
                )}
              </button>
              {proposalError && (
                <span className="text-[10px] text-destructive">{proposalError}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* No session selected */}
      {!sessionId && (
        <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
          {isGlobal
            ? "Click + to start a global session"
            : "Select a bid, then create or open a session"}
        </div>
      )}

      {/* Message thread */}
      {sessionId && (
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
              {isGlobal
                ? "Ask anything about your bids…"
                : `Ask anything about ${activeBid?.client_name ?? "this bid"}…`}
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              messageIndex={i}
              sessionId={sessionId!}
              isStreaming={
                isStreaming && i === messages.length - 1 && msg.role === "assistant"
              }
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input bar */}
      {sessionId && (
        <div className="shrink-0 px-4 py-3 border-t hairline border-border bg-card">
          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map((a) => (
                <div
                  key={a.localId}
                  className={[
                    "flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border hairline",
                    a.status === "error"
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "border-border bg-background text-foreground",
                  ].join(" ")}
                >
                  {(a.status === "uploading" || a.status === "indexing") && (
                    <Loader2 className="size-3 animate-spin text-primary shrink-0" />
                  )}
                  {a.status === "ready" && (
                    <CheckCircle2 className="size-3 text-green-600 shrink-0" />
                  )}
                  {a.status === "error" && (
                    <X className="size-3 shrink-0" />
                  )}
                  <span className="truncate max-w-[140px]">{a.name}</span>
                  <span className={a.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                    {a.status === "uploading" ? "Uploading…"
                      : a.status === "indexing" ? "Indexing…"
                      : a.status === "ready" ? "Ready"
                      : a.error ?? "Error"}
                  </span>
                  {a.status !== "uploading" && a.status !== "indexing" && (
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.localId !== a.localId))}
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="relative flex gap-2 items-end">
            {/* @ mention dropdown */}
            {mentionQuery !== null && mentionDocs.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute bottom-full left-0 mb-1.5 w-72 bg-card border hairline border-border rounded-lg shadow-lg overflow-hidden z-50"
              >
                <div className="px-2.5 py-1.5 border-b hairline border-border">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Documents — press Enter to insert
                  </span>
                </div>
                {mentionDocs.map((doc, i) => {
                  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
                  const extLabel = ext === "pdf" ? "PDF" : ext === "docx" ? "DOC" : "XLS";
                  const extBg = ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4";
                  const extColor = ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a";
                  return (
                    <button
                      key={doc.id}
                      onMouseDown={(e) => { e.preventDefault(); selectDoc(doc); }}
                      onMouseEnter={() => setMentionIndex(i)}
                      className={[
                        "w-full flex items-center gap-2.5 px-2.5 py-2 text-left transition-colors",
                        i === mentionIndex ? "bg-primary/10" : "hover:bg-background",
                      ].join(" ")}
                    >
                      <div
                        className="w-7 h-8 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                        style={{ background: extBg, color: extColor }}
                      >
                        {extLabel}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate">{doc.name}</div>
                        <div className="text-[10px] text-muted-foreground">{doc.type}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Paperclip attach button */}
            {canAttach && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachmentsPending || isStreaming}
                  title="Attach file (PDF, DOCX, XLSX)"
                  className="h-9 w-9 flex items-center justify-center rounded-lg border hairline border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
                >
                  <Paperclip className="size-4" strokeWidth={1.5} />
                </button>
              </>
            )}

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isGlobal
                  ? "Ask anything…"
                  : `Ask about ${activeBid?.client_name ?? "this bid"}… (type @ to reference a document)`
              }
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: "36px" }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!canSend}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1.5 text-right">
            {attachmentsPending
              ? "Indexing attachment — send unlocks when ready"
              : "Enter to send · Shift+Enter for new line"}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
  messageIndex,
  sessionId,
}: {
  message: Message;
  isStreaming: boolean;
  messageIndex: number;
  sessionId: string;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDownloadDocx() {
    setExporting(true);
    try {
      const { exportMessage } = await import("@/lib/api/ai-functions");
      const res = await exportMessage({ sessionId, messageIndex });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = message.exportMeta?.filename ?? "export.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  function handleDownloadPdf() {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:800px;height:1100px";
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;max-width:750px;margin:40px auto;padding:0 20px;color:#111}pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto}code{background:#f5f5f5;padding:1px 4px;border-radius:2px}</style></head><body><pre style="white-space:pre-wrap">${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    };
  }

  return (
    <div className={["flex gap-3", isUser ? "flex-row-reverse" : "flex-row"].join(" ")}>
      <div
        className={[
          "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5",
          isUser ? "bg-primary text-white" : "bg-[#ede9fd] text-primary",
        ].join(" ")}
      >
        {isUser ? "You" : "AI"}
      </div>

      <div className="max-w-[75%] flex flex-col gap-1">
        <div
          className={[
            "rounded-xl px-3 py-2.5 text-[12px] leading-relaxed",
            isUser
              ? "bg-primary text-white rounded-tr-sm"
              : "bg-card border hairline border-border text-foreground rounded-tl-sm",
          ].join(" ")}
        >
          {message.content ? (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:text-[11px] prose-th:py-1 prose-td:py-1 prose-hr:my-2 prose-pre:bg-muted prose-pre:text-[11px] prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:rounded dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          ) : isStreaming ? (
            <TypingIndicator />
          ) : null}
        </div>

        {/* Assistant action row — copy + export chips */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-green-500" />
                  <span className="text-green-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {message.exportMeta && (
              <>
                <button
                  onClick={handleDownloadDocx}
                  disabled={exporting}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors px-2 py-0.5 rounded-full border hairline border-primary/30 bg-primary/5 disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Download className="size-3" />
                  )}
                  <span>Download DOCX</span>
                </button>
                <button
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-full border hairline border-border"
                >
                  <FileText className="size-3" />
                  <span>Save as PDF</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center h-4">
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}
