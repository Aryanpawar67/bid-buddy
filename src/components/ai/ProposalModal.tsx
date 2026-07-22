import React, { useState, useEffect } from "react";
import { Loader2, X, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ProposalPreview, Intake } from "@/lib/api/generate-proposal";
import { usePreviewProposal, useGenerateProposal, useCheckProposalReadiness } from "@/lib/ai-queries";
import type { ReadinessCheck } from "@/lib/api/generate-proposal";

const FLAG_RE = /\[(CONFIRM|TO PROVIDE):[^\]]+\]/g;

function collectFlags(preview: ProposalPreview): { field: string; token: string }[] {
  const hits: { field: string; token: string }[] = [];
  function scan(field: string, text: string | undefined) {
    if (!text) return;
    for (const m of text.matchAll(FLAG_RE)) hits.push({ field, token: m[0] });
  }
  scan("Executive Summary — Pleased",    preview.exec_summary?.pleased);
  scan("Executive Summary — Aligned",    preview.exec_summary?.aligned);
  scan("Executive Summary — Confident",  preview.exec_summary?.confident);
  scan("Scope Introduction",             preview.scope_intro);
  scan("Integrations",                   preview.integrations);
  scan("Integrations Content",           preview.integrations_content);
  for (const [i, d] of (preview.deliverables ?? []).entries())
    scan(`Deliverable ${i + 1}`,         d);
  return hits;
}

type Props = {
  open: boolean;
  onClose: () => void;
  bidId: string;
  sessionId: string;
  clientName: string;
  onGenerated?: (preview: ProposalPreview) => void;
};

export function ProposalModal({ open, onClose, bidId, sessionId, clientName, onGenerated }: Props) {
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [readiness, setReadiness] = useState<ReadinessCheck | null>(null);
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [coverFields, setCoverFields] = useState({
    prepared_for: "",
    spoc_name: "",
    spoc_email: "",
  });
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [error, setError] = useState<string | null>(null);

  const readinessMutation = useCheckProposalReadiness();
  const previewMutation = usePreviewProposal();
  const generateMutation = useGenerateProposal();

  useEffect(() => {
    if (open) {
      setReadiness(null);
      setPreview(null);
      setPhase(0);
      setError(null);
      setCoverFields({ prepared_for: "", spoc_name: "", spoc_email: "" });
      readinessMutation.mutate(
        { bidId },
        { onSuccess: (data) => setReadiness(data) }
      );
    }
  }, [open, bidId]);

  function handleProceedToPreview() {
    setPhase(1);
    previewMutation.mutate(
      { bidId, sessionId },
      { onSuccess: (data) => setPreview(data) }
    );
  }

  if (!open) return null;

  function handleRegen() {
    setPreview(null);
    previewMutation.mutate(
      { bidId, sessionId },
      { onSuccess: (data) => setPreview(data) }
    );
  }


  async function handleGenerateDocx(force = false) {
    if (!preview) return;
    setError(null);
    const intake: Intake = {
      ...preview,
      prepared_for: coverFields.prepared_for || "[TO PROVIDE: contact name & title]",
      spoc_name: coverFields.spoc_name || "[TO PROVIDE: Sales SPOC name]",
      spoc_email: coverFields.spoc_email || "[TO PROVIDE: Sales SPOC email]",
    };
    try {
      const result = await generateMutation.mutateAsync({ bidId, sessionId, intake, format, force });

      if (result.conflict) {
        toast.warning(`Proposal already exists: ${result.existingName}`, {
          description: "Replace it or keep the existing one.",
          action: {
            label: "Replace",
            onClick: () => handleGenerateDocx(true),
          },
        });
        return;
      }

      if (!result.downloadUrl) {
        throw new Error("No download URL returned from server");
      }
      const a = document.createElement("a");
      a.href = result.downloadUrl;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Proposal saved to Knowledge Hub");
      if (preview) onGenerated?.(preview);
      onClose();
    } catch (e) {
      console.error("[ProposalModal] generate failed:", e);
      setError(`Proposal generation failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const templateFilename = preview?.product === "TM"
    ? "TM_Proposal_template.docx"
    : "TA_Proposal_template.docx";

  const isPending = previewMutation.isPending;
  const isFailed = previewMutation.isError && !preview;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-card border hairline border-border rounded-xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b hairline border-border shrink-0">
            <span className="text-[11px] font-semibold text-foreground flex-1">
              ✦ Generate Proposal — {clientName}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${phase === 0 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                1 Check
              </span>
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${phase === 1 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                2 Preview
              </span>
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${phase === 2 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                3 Cover
              </span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-1">
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {phase === 0 && (
              <ReadinessPanel
                readiness={readiness}
                isLoading={readinessMutation.isPending}
                isFailed={readinessMutation.isError && !readiness}
                onRetry={() => readinessMutation.mutate({ bidId }, { onSuccess: (d) => setReadiness(d) })}
              />
            )}

            {phase === 1 && (
              <>
                {isPending && !preview && (
                  <div className="flex flex-col items-center justify-center py-14 gap-3">
                    <Loader2 className="size-5 animate-spin text-primary" />
                    <span className="text-[12px] text-muted-foreground">
                      Authoring proposal content… · Sonnet
                    </span>
                  </div>
                )}

                {isFailed && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <span className="text-[12px] text-destructive">Preview failed. Please try again.</span>
                    <button
                      onClick={handleRegen}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="size-3" /> Retry
                    </button>
                  </div>
                )}

                {preview && (
                  <div className="flex flex-col gap-3">
                    {collectFlags(preview).length > 0 && (
                      <FlagsWarning flags={collectFlags(preview)} />
                    )}
                    <PreviewSection
                      title="Executive Summary — How We're Pleased"
                      content={preview.exec_summary.pleased}
                      onRegen={handleRegen}
                      isPending={isPending}
                    />
                    <PreviewSection
                      title="Executive Summary — Alignment"
                      content={preview.exec_summary.aligned}
                      onRegen={handleRegen}
                      isPending={isPending}
                    />
                    <PreviewSection
                      title="Executive Summary — Confidence"
                      content={preview.exec_summary.confident}
                      onRegen={handleRegen}
                      isPending={isPending}
                    />
                    <PreviewSection
                      title="Scope Introduction"
                      content={preview.scope_intro}
                      onRegen={handleRegen}
                      isPending={isPending}
                    />
                    <FlaggedCard
                      title="Deliverables"
                      flagged={preview.deliverables.some(d => FLAG_RE.test(d))}
                      onRegen={handleRegen}
                      isPending={isPending}
                    >
                      <ul className="flex flex-col gap-1">
                        {preview.deliverables.map((d, i) => {
                          FLAG_RE.lastIndex = 0;
                          const hasFlag = FLAG_RE.test(d);
                          FLAG_RE.lastIndex = 0;
                          return (
                            <li key={i} className={["text-[12px] flex gap-2", hasFlag ? "text-amber-700 dark:text-amber-300" : "text-foreground"].join(" ")}>
                              <span className="text-muted-foreground shrink-0">·</span>
                              <span>{highlightFlags(d)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </FlaggedCard>

                    {(preview.integrations || preview.integrations_content) && (
                      <FlaggedCard
                        title="Integrations"
                        flagged={FLAG_RE.test(preview.integrations ?? "") || FLAG_RE.test(preview.integrations_content ?? "")}
                        onRegen={handleRegen}
                        isPending={isPending}
                      >
                        {preview.integrations && (
                          <p className="text-[11px] text-muted-foreground mb-1.5">
                            <span className="font-medium text-foreground">Platforms: </span>
                            {(() => { FLAG_RE.lastIndex = 0; return highlightFlags(preview.integrations); })()}
                          </p>
                        )}
                        {preview.integrations_content && (
                          <p className="text-[12px] text-foreground leading-relaxed">
                            {(() => { FLAG_RE.lastIndex = 0; return highlightFlags(preview.integrations_content); })()}
                          </p>
                        )}
                      </FlaggedCard>
                    )}
                  </div>
                )}
              </>
            )}

            {phase === 2 && preview && (
              <div className="flex flex-col gap-4">
                {collectFlags(preview).length > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border hairline border-amber-500/30 rounded-lg">
                    <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      {collectFlags(preview).length} item{collectFlags(preview).length !== 1 ? "s" : ""} need review — the DOCX will contain{" "}
                      <code className="text-[10px] font-mono">[CONFIRM: ...]</code> markers. Edit them in Word before sending to the client.
                    </span>
                  </div>
                )}
                <div className="bg-muted/40 border hairline border-border rounded-lg p-3">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Auto-filled
                  </div>
                  <InfoRow label="Template" value={templateFilename} />
                  <InfoRow label="RFP Name" value={preview.rfp_name} />
                  <InfoRow label="Client" value={preview.customer_display_name} />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Cover Fields
                  </div>
                  <LabeledInput
                    label="Prepared For (contact name & title)"
                    value={coverFields.prepared_for}
                    onChange={(v) => setCoverFields((p) => ({ ...p, prepared_for: v }))}
                    placeholder="e.g. Jane Smith, Head of Talent"
                  />
                  <LabeledInput
                    label="Sales SPOC Name"
                    value={coverFields.spoc_name}
                    onChange={(v) => setCoverFields((p) => ({ ...p, spoc_name: v }))}
                    placeholder="e.g. John Doe"
                  />
                  <LabeledInput
                    label="Sales SPOC Email"
                    value={coverFields.spoc_email}
                    onChange={(v) => setCoverFields((p) => ({ ...p, spoc_email: v }))}
                    placeholder="e.g. john.doe@imocha.io"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Output Format</label>
                  <div className="flex gap-2">
                    {(["docx", "pdf"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFormat(f)}
                        className={[
                          "text-[11px] px-4 py-1.5 rounded-full border hairline font-medium transition-colors",
                          format === f
                            ? "bg-primary text-white border-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-background",
                        ].join(" ")}
                      >
                        {f === "docx" ? "Word (.docx)" : "PDF (.pdf)"}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <span className="text-[11px] text-destructive">{error}</span>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t hairline border-border shrink-0 bg-card">
            {phase === 0 ? (
              <>
                {readiness?.existingProposal ? (
                  <button
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = readiness.existingProposal!.downloadUrl;
                      a.download = readiness.existingProposal!.name;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="text-[11px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-background transition-colors"
                  >
                    ↓ Open Existing
                  </button>
                ) : (
                  <div />
                )}
                <button
                  onClick={handleProceedToPreview}
                  disabled={readinessMutation.isPending || readinessMutation.isError}
                  className="text-[11px] px-4 py-1.5 rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {readiness?.existingProposal ? "Regenerate — New Preview →" : "Continue — Generate Preview →"}
                </button>
              </>
            ) : phase === 1 ? (
              <>
                <button
                  onClick={() => setPhase(0)}
                  className="text-[11px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-background transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setPhase(2)}
                  disabled={isPending || !preview}
                  className="text-[11px] px-4 py-1.5 rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  Next →
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setPhase(1)}
                  className="text-[11px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-background transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleGenerateDocx}
                  disabled={generateMutation.isPending}
                  className="text-[11px] px-4 py-1.5 rounded-full bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    `✦ Generate ${format === "pdf" ? "PDF" : "DOCX"}`
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function FlaggedCard({
  title,
  flagged,
  onRegen,
  isPending,
  children,
}: {
  title: string;
  flagged: boolean;
  onRegen: () => void;
  isPending: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={[
      "border hairline rounded-lg p-3",
      flagged ? "bg-amber-500/5 border-amber-500/30" : "bg-background border-border",
    ].join(" ")}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</span>
        <button
          onClick={onRegen}
          disabled={isPending}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="size-3" /> Regen
        </button>
      </div>
      {children}
    </div>
  );
}

function FlagsWarning({ flags }: { flags: { field: string; token: string }[] }) {
  return (
    <div className="border hairline border-amber-500/40 bg-amber-500/8 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">
          Review required before generating
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {flags.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px]">
            <span className="text-muted-foreground shrink-0 w-28 truncate">{f.field}</span>
            <code className="text-amber-600 dark:text-amber-400 font-mono text-[10px] leading-relaxed break-all">{f.token}</code>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        These markers will appear in the DOCX — edit them in Word before sending to the client.
      </p>
    </div>
  );
}

function highlightFlags(content: string): React.ReactNode {
  const parts = content.split(FLAG_RE);
  const matches = [...content.matchAll(FLAG_RE)];
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {matches[i] && (
        <mark className="bg-amber-400/25 text-amber-700 dark:text-amber-300 rounded px-0.5 font-mono text-[11px] not-italic">
          {matches[i][0]}
        </mark>
      )}
    </span>
  ));
}

function PreviewSection({
  title,
  content,
  onRegen,
  isPending,
}: {
  title: string;
  content: string;
  onRegen: () => void;
  isPending: boolean;
}) {
  const hasFlagInContent = FLAG_RE.test(content);
  FLAG_RE.lastIndex = 0; // reset stateful regex
  return (
    <div className={[
      "border hairline rounded-lg p-3",
      hasFlagInContent
        ? "bg-amber-500/5 border-amber-500/30"
        : "bg-background border-border",
    ].join(" ")}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {title}
        </span>
        <button
          onClick={onRegen}
          disabled={isPending}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="size-3" /> Regen
        </button>
      </div>
      <p className="text-[12px] text-foreground leading-relaxed">{highlightFlags(content)}</p>
    </div>
  );
}

function ReadinessPanel({
  readiness,
  isLoading,
  isFailed,
  onRetry,
}: {
  readiness: ReadinessCheck | null;
  isLoading: boolean;
  isFailed: boolean;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
        <span className="text-[12px] text-muted-foreground">Checking bid context…</span>
      </div>
    );
  }
  if (isFailed) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <span className="text-[12px] text-destructive">Context check failed. Please try again.</span>
        <button onClick={onRetry} className="text-[11px] text-primary hover:underline flex items-center gap-1">
          <RotateCcw className="size-3" /> Retry
        </button>
      </div>
    );
  }
  if (!readiness) return null;

  const existing = readiness.existingProposal;

  const { metadata, documents, questions, likelyFlags } = readiness;

  const hasAnyContext = documents.indexedChunkCount > 0 || questions.count > 0;

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: "Product type",
      ok: metadata.hasProductType,
      detail: metadata.hasProductType
        ? metadata.productType === "BOTH" ? "TA + TM" : (metadata.productType ?? "")
        : "Not set — AI will infer from context",
    },
    {
      label: "Bid type",
      ok: metadata.hasBidType,
      detail: metadata.hasBidType ? (metadata.bidType ?? "").toUpperCase() : "Not set",
    },
    {
      label: "Deal value",
      ok: metadata.hasValue,
      detail: metadata.hasValue ? "Set" : "Not set — will show TBD in proposal",
    },
    {
      label: "Procurement contact",
      ok: metadata.hasContactName,
      detail: metadata.hasContactName ? "Set on bid" : "Not set — will need manual entry",
    },
    {
      label: "RFP / RFI documents",
      ok: documents.uploadedCount > 0,
      detail: documents.uploadedCount > 0
        ? `${documents.uploadedCount} uploaded, ${documents.indexedChunkCount} chunks indexed`
        : "None uploaded — context-dependent fields will be flagged",
    },
    {
      label: "Indexed content (RAG)",
      ok: documents.indexedChunkCount > 0,
      detail: documents.indexedChunkCount > 0
        ? `${documents.indexedChunkCount} chunks ready for search`
        : "Nothing indexed — AI cannot ground content in documents",
    },
    {
      label: "Bid questions",
      ok: questions.count > 0,
      detail: questions.count > 0
        ? `${questions.count} question${questions.count !== 1 ? "s" : ""} — used as requirements context`
        : "None — less context for deliverables and scope",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {existing && (
        <div className="flex items-start gap-3 px-3 py-2.5 bg-primary/8 border hairline border-primary/25 rounded-lg">
          <span className="text-primary text-[13px] shrink-0 mt-px">✦</span>
          <div className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[11px] font-semibold text-foreground">Proposal already generated</span>
            <span className="text-[10px] text-muted-foreground truncate">{existing.name}</span>
            <span className="text-[10px] text-muted-foreground">
              Use <strong className="text-foreground">Open Existing</strong> to download it, or <strong className="text-foreground">Regenerate</strong> to replace it with a new AI-authored version.
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Bid context check
        </span>
        <div className="flex flex-col divide-y divide-border border hairline border-border rounded-lg overflow-hidden">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-3 px-3 py-2">
              <span className={["mt-px text-[13px] shrink-0", c.ok ? "text-green-500" : "text-amber-500"].join(" ")}>
                {c.ok ? "✓" : "⚠"}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-medium text-foreground">{c.label}</span>
                <span className="text-[10px] text-muted-foreground leading-relaxed">{c.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {likelyFlags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">
            Fields likely to require review ({likelyFlags.length})
          </span>
          <div className="flex flex-col gap-1 border hairline border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
            {likelyFlags.map((f, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-amber-500 text-[11px] shrink-0 mt-px">·</span>
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium text-foreground">{f.field}</span>
                  <span className="text-[10px] text-muted-foreground">{f.reason}</span>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground mt-1 pt-1 border-t hairline border-amber-500/20">
              These will appear as <code className="font-mono">[CONFIRM: ...]</code> markers in the generated DOCX.
              You can still generate — edit the markers in Word before sending.
            </p>
          </div>
        </div>
      )}

      {!hasAnyContext && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-muted/40 border hairline border-border rounded-lg">
          <span className="text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Tip:</strong> Upload the RFP or RFI document to the Knowledge Hub first — the AI will extract requirements, scope, and platform names automatically, reducing the number of flags.
          </span>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-[11px] text-foreground font-medium">{value}</span>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
      />
    </div>
  );
}
