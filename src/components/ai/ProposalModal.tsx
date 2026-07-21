import { useState, useEffect } from "react";
import { Loader2, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ProposalPreview, Intake } from "@/lib/api/generate-proposal";
import { usePreviewProposal, useGenerateProposal } from "@/lib/ai-queries";

type Props = {
  open: boolean;
  onClose: () => void;
  bidId: string;
  sessionId: string;
  clientName: string;
};

export function ProposalModal({ open, onClose, bidId, sessionId, clientName }: Props) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const [preview, setPreview] = useState<ProposalPreview | null>(null);
  const [coverFields, setCoverFields] = useState({
    prepared_for: "",
    spoc_name: "",
    spoc_email: "",
  });
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [error, setError] = useState<string | null>(null);

  const previewMutation = usePreviewProposal();
  const generateMutation = useGenerateProposal();

  useEffect(() => {
    if (open) {
      setPreview(null);
      setPhase(1);
      setError(null);
      setCoverFields({ prepared_for: "", spoc_name: "", spoc_email: "" });
      previewMutation.mutate(
        { bidId, sessionId },
        { onSuccess: (data) => setPreview(data) }
      );
    }
  }, [open, bidId, sessionId]);

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

      const res = result._res;
      if (!res || typeof res.blob !== "function") {
        throw new Error(`Response is not a fetch Response — got: ${JSON.stringify(res)}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const contentDisposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "proposal.docx";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Proposal saved to Knowledge Hub");
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
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${phase === 1 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                1 Preview
              </span>
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${phase === 2 ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                2 Cover
              </span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-1">
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
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
                    <div className="bg-background border hairline border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Deliverables
                        </span>
                        <button
                          onClick={handleRegen}
                          disabled={isPending}
                          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40 transition-colors"
                        >
                          <RotateCcw className="size-3" /> Regen
                        </button>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {preview.deliverables.map((d, i) => (
                          <li key={i} className="text-[12px] text-foreground flex gap-2">
                            <span className="text-muted-foreground shrink-0">·</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {(preview.integrations || preview.integrations_content) && (
                      <div className="bg-background border hairline border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Integrations
                          </span>
                          <button
                            onClick={handleRegen}
                            disabled={isPending}
                            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40 transition-colors"
                          >
                            <RotateCcw className="size-3" /> Regen
                          </button>
                        </div>
                        {preview.integrations && (
                          <p className="text-[11px] text-muted-foreground mb-1.5">
                            <span className="font-medium text-foreground">Platforms: </span>
                            {preview.integrations}
                          </p>
                        )}
                        {preview.integrations_content && (
                          <p className="text-[12px] text-foreground leading-relaxed">
                            {preview.integrations_content}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {phase === 2 && preview && (
              <div className="flex flex-col gap-4">
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
            {phase === 1 ? (
              <>
                <div />
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
  return (
    <div className="bg-background border hairline border-border rounded-lg p-3">
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
      <p className="text-[12px] text-foreground leading-relaxed">{content}</p>
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
