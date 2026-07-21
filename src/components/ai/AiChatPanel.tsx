import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Copy, Check, Download, FileText, Paperclip, CheckCircle2, X, MoreHorizontal, Search, FileDown, BrainCircuit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, StreamingStatusEvent } from "@/lib/ai-queries";
import type { Bid } from "@/lib/bid-queries";
import { ProposalModal } from "@/components/ai/ProposalModal";
import { BidDocsDrawer } from "@/components/ai/BidDocsDrawer";
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
      "Search the knowledge base and map iMocha's capabilities to the key requirement categories for this bid (functional, technical, security, compliance, SLA, integrations, AI/ethics). If client RFI/RFP documents have been attached with @, extract each requirement from them first. Output format: Requirement | Status (SUPPORTED / NOT SUPPORTED / PARTIAL) | iMocha Capability | KB Source.",
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
  streamingStatus: StreamingStatusEvent[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (text?: string, mentionedDocIds?: string[], attachmentNames?: string[]) => void;
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
  streamingStatus,
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
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

  // Auto-resize textarea to content, capped at ~8 lines
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputValue]);

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
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + doc.name.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  async function handleFilesSelected(files: FileList | null) {
    console.log("[attach] onChange fired", { filesCount: files?.length ?? 0, activeBid: activeBid?.id ?? null, canAttach });
    if (!files || !activeBid) {
      console.log("[attach] early return — files:", !!files, "activeBid:", !!activeBid);
      return;
    }
    const fileArray = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = "";

    const valid: File[] = [];
    for (const f of fileArray) {
      console.log("[attach] checking file", f.name, f.size);
      if (!ATTACH_EXT.test(f.name)) {
        console.log("[attach] rejected — bad extension:", f.name);
        toast.warning(`${f.name}: only PDF, DOCX, and XLSX are supported`);
        continue;
      }
      if (f.size > MAX_ATTACH_BYTES) {
        console.log("[attach] rejected — too large:", f.size);
        toast.warning(`${f.name}: file must be under 25 MB`);
        continue;
      }
      valid.push(f);
    }

    console.log("[attach] valid files:", valid.map((f) => f.name));

    for (const file of valid) {
      const localId = crypto.randomUUID();
      console.log("[attach] starting upload:", file.name, localId);
      setAttachments((prev) => [...prev, { localId, name: file.name, status: "uploading" }]);

      try {
        console.log("[attach] calling mutateAsync…");
        const doc = await uploadAndIndex.mutateAsync({
          file,
          type: "reference",
          bidId: activeBid.id,
          stage: null,
        });
        console.log("[attach] upload+index done:", doc.id);
        setAttachments((prev) =>
          prev.map((a) => a.localId === localId ? { ...a, status: "ready", docId: doc.id } : a)
        );
      } catch (err) {
        console.error("[attach] upload error:", err);
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
    const names = attachments
      .filter((a) => a.status === "ready")
      .map((a) => a.name);
    onSend(text || undefined, ids.length ? ids : undefined, names.length ? names : undefined);
    setAttachments([]);
  }

  const canSend = !isStreaming && !!sessionId && !attachmentsPending &&
    (inputValue.trim().length > 0 || readyDocIds.length > 0);
  const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;
  const isRfiRfpStage = activeBid?.stage === "rfi" || activeBid?.stage === "rfp";
  const isRfpStage = activeBid?.stage === "rfp";
  const isRfiStage = activeBid?.stage === "rfi";
  const quickActions = isRfiRfpStage ? QUICK_ACTIONS_RFI_RFP : QUICK_ACTIONS_GENERIC;
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [docsDrawerOpen, setDocsDrawerOpen] = useState(false);

  // Close @ dropdown on outside click
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
    <div className="relative flex-1 flex flex-col h-full min-w-0">
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

        {/* 3-dot menu — only for bid sessions */}
        {!isGlobal && activeBid && (
          <button
            onClick={() => setDocsDrawerOpen((o) => !o)}
            title="Bid documents"
            className={[
              "w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0",
              docsDrawerOpen
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
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
              streamingStatus={
                isStreaming && i === messages.length - 1 && msg.role === "assistant"
                  ? streamingStatus
                  : []
              }
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input bar */}
      {sessionId && (
        <div className="shrink-0 px-4 py-3 border-t hairline border-border bg-card">
          {/* Generate Proposal — always visible for any bid session */}
          {!isGlobal && activeBid && canAttach && (
            <div className="flex gap-2 mb-2 flex-wrap">
              <button
                onClick={() => setProposalModalOpen(true)}
                disabled={isStreaming || !sessionId}
                className="text-[10px] px-3 py-1.5 rounded-full border hairline border-orange-400/60 text-orange-500 bg-orange-50/50 hover:bg-orange-500 hover:text-white hover:border-orange-500 disabled:opacity-40 transition-colors dark:text-orange-400 dark:bg-orange-950/20 flex items-center gap-1"
              >
                ✦ Generate Proposal
              </button>
            </div>
          )}

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

            {/* File input — kept outside canAttach gate so it's never unmounted mid-pick */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />

            {/* Paperclip attach button — gated by role/bid/mode */}
            {canAttach && (
              <button
                type="button"
                onClick={() => {
                  console.log("[attach] paperclip clicked, fileInputRef:", !!fileInputRef.current);
                  fileInputRef.current?.click();
                }}
                disabled={attachmentsPending || isStreaming}
                title="Attach file (PDF, DOCX, XLSX)"
                className="h-9 w-9 flex items-center justify-center rounded-lg border hairline border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
              >
                <Paperclip className="size-4" strokeWidth={1.5} />
              </button>
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
              className="flex-1 resize-none text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50 overflow-y-auto"
              style={{ minHeight: "36px", maxHeight: "200px" }}
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
          <div className="text-[9px] mt-1.5 text-right flex items-center justify-end gap-1.5">
            {isStreaming ? (
              <>
                <span className="inline-block size-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-primary font-medium">Claude is responding — please wait</span>
              </>
            ) : attachmentsPending ? (
              <span className="text-muted-foreground">Indexing attachment — send unlocks when ready</span>
            ) : (
              <span className="text-muted-foreground">Enter to send · Shift+Enter for new line</span>
            )}
          </div>
        </div>
      )}

      {activeBid && sessionId && (
        <ProposalModal
          open={proposalModalOpen}
          onClose={() => setProposalModalOpen(false)}
          bidId={activeBid.id}
          sessionId={sessionId}
          clientName={activeBid.client_name}
        />
      )}

      {/* Bid docs drawer — slides in from the right within the chat pane */}
      {docsDrawerOpen && activeBid && (
        <BidDocsDrawer
          bidId={activeBid.id}
          clientName={activeBid.client_name}
          onClose={() => setDocsDrawerOpen(false)}
        />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
  streamingStatus,
  messageIndex,
  sessionId,
}: {
  message: Message;
  isStreaming: boolean;
  streamingStatus: StreamingStatusEvent[];
  messageIndex: number;
  sessionId: string;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const isExportMessage = !isUser && !!message.exportMeta;

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
    // Convert markdown to styled HTML for proper PDF rendering
    const md = message.content;
    const htmlLines: string[] = [];
    const lines = md.split("\n");
    let inList = false;
    let listTag = "ul";

    const escHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const inlineHtml = (s: string) =>
      escHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");

    function closeList() {
      if (inList) { htmlLines.push(`</${listTag}>`); inList = false; }
    }

    for (const line of lines) {
      if (/^# (.+)/.test(line)) {
        closeList();
        htmlLines.push(`<h1>${inlineHtml(line.slice(2).trim())}</h1>`);
      } else if (/^## (.+)/.test(line)) {
        closeList();
        htmlLines.push(`<h2>${inlineHtml(line.slice(3).trim())}</h2>`);
      } else if (/^### (.+)/.test(line)) {
        closeList();
        htmlLines.push(`<h3>${inlineHtml(line.slice(4).trim())}</h3>`);
      } else if (/^[-*] /.test(line)) {
        if (!inList || listTag !== "ul") { closeList(); htmlLines.push("<ul>"); inList = true; listTag = "ul"; }
        htmlLines.push(`<li>${inlineHtml(line.slice(2).trim())}</li>`);
      } else if (/^\d+\. /.test(line)) {
        if (!inList || listTag !== "ol") { closeList(); htmlLines.push("<ol>"); inList = true; listTag = "ol"; }
        htmlLines.push(`<li>${inlineHtml(line.replace(/^\d+\. /, "").trim())}</li>`);
      } else if (/^---+$/.test(line.trim())) {
        closeList();
        htmlLines.push("<hr>");
      } else if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        if (/^[\s|:-]+$/.test(line)) continue; // separator row
        closeList();
        const cells = line.trim().slice(1, -1).split("|").map(c => c.trim());
        htmlLines.push(`<tr>${cells.map(c => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`);
      } else if (line.trim() === "") {
        closeList();
        htmlLines.push("<br>");
      } else {
        closeList();
        htmlLines.push(`<p>${inlineHtml(line)}</p>`);
      }
    }
    closeList();

    // Wrap table rows in <table>
    const html = htmlLines.join("\n").replace(/(<tr>.*?<\/tr>\n*)+/gs, (match) =>
      `<table>${match}</table>`
    );

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:850px;height:1100px";
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @media print { body { margin: 0; } }
      body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.55; max-width: 720px; margin: 36px auto; padding: 0 24px; color: #111; }
      h1 { font-size: 18pt; font-weight: 700; margin: 20px 0 8px; border-bottom: 2px solid #491AEB; padding-bottom: 4px; color: #1a1a2e; }
      h2 { font-size: 14pt; font-weight: 600; margin: 16px 0 6px; color: #2d2d4e; }
      h3 { font-size: 12pt; font-weight: 600; margin: 12px 0 4px; }
      p { margin: 4px 0 8px; }
      ul, ol { margin: 4px 0 8px; padding-left: 24px; }
      li { margin: 2px 0; }
      table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
      td, th { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
      tr:first-child td { background: #f0eeff; font-weight: 600; }
      code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: "Courier New", monospace; font-size: 10pt; }
      hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }
      strong { font-weight: 700; }
      em { font-style: italic; }
    </style></head><body>${html}</body></html>`;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 3000);
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
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end mb-0.5">
            {message.attachments.map((name) => {
              const ext = name.split(".").pop()?.toLowerCase() ?? "";
              const extLabel = ext === "pdf" ? "PDF" : ext === "docx" ? "DOC" : "XLS";
              const extColor = ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a";
              return (
                <div
                  key={name}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary border hairline border-primary/20"
                >
                  <span className="font-bold text-[9px]" style={{ color: extColor }}>{extLabel}</span>
                  <span className="truncate max-w-[160px]">{name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Export message — compact document-ready card */}
        {isExportMessage && !isStreaming ? (
          <div className="rounded-xl border hairline border-primary/20 bg-primary/5 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b hairline border-primary/10">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileDown className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-foreground">Document ready</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {message.exportMeta!.filename}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <button
                onClick={handleDownloadDocx}
                disabled={exporting}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-md border hairline border-primary/30 bg-primary/5 hover:bg-primary/10 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                Download DOCX
              </button>
              <button
                onClick={handleDownloadPdf}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md border hairline border-border hover:bg-muted"
              >
                <FileText className="size-3.5" />
                Save as PDF
              </button>
              <button
                onClick={handleCopy}
                className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded"
                title="Copy content to clipboard"
              >
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={[
              "rounded-xl px-3 py-2.5 text-[12px] leading-relaxed",
              isUser
                ? "bg-primary text-white rounded-tr-sm"
                : "bg-card border hairline border-border text-foreground rounded-tl-sm",
            ].join(" ")}
          >
            {/* Thinking steps — shown while streaming, above content */}
            {!isUser && isStreaming && streamingStatus.length > 0 && (
              <div className="mb-3 flex flex-col gap-1.5">
                {streamingStatus.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-[10px] text-primary/80 bg-primary/5 border hairline border-primary/15 rounded-md px-2.5 py-1.5"
                  >
                    {s.kind === "thinking" ? (
                      <>
                        <BrainCircuit className="size-3 shrink-0 text-primary/60 animate-pulse" />
                        <span className="font-medium">Extended thinking…</span>
                      </>
                    ) : (
                      <>
                        <Search className="size-3 shrink-0 text-primary/60" />
                        <span className="font-medium">Searching:</span>
                        <span className="truncate text-muted-foreground">{s.query}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

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
        )}

        {/* Assistant action row — copy + export chips (non-export messages only) */}
        {!isUser && !isExportMessage && message.content && !isStreaming && (
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
