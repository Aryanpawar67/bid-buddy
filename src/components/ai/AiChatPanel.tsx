import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/lib/ai-queries";
import type { Bid } from "@/lib/bid-queries";
import { stageLabel } from "@/lib/bid-constants";

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
  onSend: (text?: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  requestCount: number;
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
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = !isStreaming && !!sessionId && inputValue.trim().length > 0;
  const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;
  const isRfiRfpStage = activeBid?.stage === "rfi" || activeBid?.stage === "rfp";
  const quickActions = isRfiRfpStage ? QUICK_ACTIONS_RFI_RFP : QUICK_ACTIONS_GENERIC;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

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
              onClick={() => onSend(action.prompt)}
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
          <div className="flex gap-2 items-end">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isGlobal
                  ? "Ask anything…"
                  : `Ask about ${activeBid?.client_name ?? "this bid"}…`
              }
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: "36px" }}
            />
            <button
              onClick={() => onSend()}
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
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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

        {/* Copy button — assistant only, shown after streaming completes */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center">
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
