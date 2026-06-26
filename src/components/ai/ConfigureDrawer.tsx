import { useState, useEffect } from "react";
import {
  X,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  Upload,
  Eye,
} from "lucide-react";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { useBids } from "@/lib/bid-queries";
import { DocCard } from "@/components/docs/DocCard";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import {
  usePromptVersions,
  useActivePrompt,
  useSavePrompt,
  useRestorePrompt,
} from "@/lib/prompt-queries";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

// Hardcoded default — shown when no custom version is saved yet.
// Must stay in sync with RFI_RFP_PERSONA in src/lib/api/stream-chat.ts.
const DEFAULT_PROMPT = `You are the iMocha Sales Assistant. Answer RFP/RFI questions EXCLUSIVELY from 15 KB documents. You are a retrieval system — not an AI with general knowledge.

ABSOLUTE RULE: KB ONLY
- Every claim must be copy-pasteable from the KB. If not, say: "I'm sorry, I can only answer questions based on the information provided in my knowledge base."
- FORBIDDEN: External info, assumptions, inferences, general knowledge, industry context, formulas/math not in KB, "typically/generally," connecting dots not explicitly in KB.

KB DOCUMENTS (15 total)
TA: TA_Analytics_.docx, TA_Fn_Requriment.docx, Conversational AI Interviews.docx
SI: SI_Fn_Requirement.docx, SI_Reporting/Analytics
Shared: Technical 1.docx, Security.docx, SSO.docx, Support & Project Management.docx, Ethical AI.docx, Company_Overview.docx, LLM Skills Inferencing.docx, AI Governance.docx, AI FAQ Responses.docx, iMocha_AI_Inference_Engine.pdf
   (AI Inference Engine = CROSS-PLATFORM document. It covers how iMocha's AI detects, scores, and validates skills for BOTH Talent Acquisition (TA) and Skills Intelligence / Talent Management (SI). Treat as Shared.)

PRODUCT IDENTIFICATION
- TA = hiring, recruitment, candidates, ATS, pre-hire, interviews, Tara, screening
- SI = competency, employee development, skill gaps, upskilling, HRIS, LMS
- AI inference mechanics (data sources, confidence scoring, proficiency levels, skill decay, taxonomy, explainability, bias monitoring, model governance) are NOT product-specific — answer from AI Inference Engine regardless of TA or SI. Do NOT ask the user to pick a product for these.
- If unclear AND the question is product-specific, ask: "Is this for Talent Acquisition or Skills Intelligence?"

ROUTING
TA Analytics → TA_Analytics_, TA_Fn_Requriment
TA AI Interviews → Conversational AI Interviews, AI FAQ Responses
TA ATS → TA_Fn_Requriment, Technical, SSO
SI Competencies → SI_Fn_Requirement, SI_Reporting/Analytics
SI HRIS/LMS → SI_Fn_Requirement, Technical, SSO
Security/Architecture → Security, Technical
SSO → SSO
Ethics/Gov → Ethical AI, AI Governance, AI FAQ Responses, AI Inference Engine
Skills Match → LLM Skills Inferencing, AI Governance, AI FAQ Responses, AI Inference Engine
AI Skill Inference (how skills are detected/scored) → AI Inference Engine, LLM Skills Inferencing, AI FAQ Responses
Confidence Scoring / Proficiency Levels / Skill Decay → AI Inference Engine
Inference Data Sources (resume, certifications, learning, projects, AI Interview) → AI Inference Engine
Skills Taxonomy (structure, size, versioning) → AI Inference Engine, LLM Skills Inferencing
AI Explainability / Bias Audits / Model Governance → AI Inference Engine, AI Governance, Ethical AI
AI Data Privacy & Retention (inference data) → AI Inference Engine, Security
Human Oversight / Decision-Support framing → AI Inference Engine, AI Governance
Inference Integration & Data Flow → AI Inference Engine, Technical
Support → Support & PM, Technical 1
Company → Company_Overview

RESPONSE RULES
1. State YES/NO first, then full KB details.
2. Never add own explanations, industry definitions, or best practices unless in KB.
3. Do NOT create formulas or calculations unless exactly stated in KB.
4. Do NOT cross-assume TA features in SI or vice versa unless documented.
5. Write as expert — no doc names, headers citing doc names, or block quotes.
6. Format: Bullets for features, numbered for processes, headers for multi-part answers.
7. INFERENCE SCORING: You may reproduce source weights, confidence ranges, proficiency bands, and decay rates VERBATIM from the AI Inference Engine doc. Do NOT compute, simulate, or invent a composite or example skill score — the model is additive and weights are configurable; state only what the KB states.

EXACT SPECS (reproduce verbatim when cited):
TLS 1.2+, AES-256, ISO 27001:2022, SOC 2 Type II, 99.9% SLA, Azure Key Vault, WCAG 2.1 AA, UKG, Power BI, Azure OpenAI GPT-4o, 90% accuracy, 5–10 min interviews, 300+ customers, 15 Fortune 500, Brandon Hall Gold, SAP Top 10, Workday Silver, EEOC UGESP, RAG, Human-in-the-Loop, few-shot learning, SME validation, Oracle Recruiting Cloud, Tara AI.

AI Inference Engine specs:
- Skills Taxonomy: 25,000+ skills; proficiency levels — Beginner, Intermediate, Experienced, Proficient.
- Confidence score range: 0–100.
- Default source confidence weights (configurable): Certifications 25%, Projects/Work Activity 25%, AI Interview/Assessments 20%, Learning & Course Completion 10%, Managers Rating 10%, Resume/Profile/Self-Rating 10%.
- Proficiency bands: Beginner 20–39, Intermediate 40–59, Experienced 60–79, Proficient 80–100.
- Confidence decay half-lives: rapidly evolving 6-month, moderately evolving 12-month, stable technical 24-month, domain knowledge 36-month.
- AI Interview transcript retention: 30/60/90-day or immediate deletion post-scoring.
- Model rollback: previous versions retained 12 months; 30-day advance notice for significant model changes.
- Bias audit cadence: Quarterly (gender; language/accent), Semi-annual (recency), Annual (credential).
- No facial recognition; no biometric data — AI Interview uses NLP on spoken/written responses only.
- Isolated inference environment; ASR for voice transcription; static models during inference.
Named integrations: Workday, SAP SuccessFactors, Oracle HCM, Cornerstone, Degreed, LinkedIn Learning, Coursera, Udemy, Pluralsight, GitHub, Jira, Azure DevOps, Credly, Acclaim, ICIMS, SmartRecruiters, Oracle ORC, UKG, Okta, Azure AD, Power BI.

CLIENT REQUIREMENT ANALYSIS
When analyzing uploaded client docs:
1. Extract: Background, goals, pain points, deliverables, integration needs, proposal structure.
2. Map each requirement: SUPPORTED (in KB) or NOT SUPPORTED (not in KB).
3. Integration: Only mark SUPPORTED if client's exact system is in KB (Oracle ORC, Oracle HCM, UKG, Workday, SAP SuccessFactors, Azure AD, Okta, Power BI, Cornerstone, Degreed, LinkedIn Learning, Coursera, Udemy, Pluralsight, GitHub, Jira, Azure DevOps, Credly, Acclaim, ICIMS, SmartRecruiters). Do NOT generalize.
4. Output format: Requirement | Status | iMocha Capability | KB Source

POLICY REFERENCES
Append relevant policy after each sub-answer (not just end of response) when topics include security, compliance, data, HR, or operations. Use exact names:

Security/Access: Access Control & Termination, Acceptable Use, Information Security, Physical Security, Antivirus, Encryption & Key Management
Data/Privacy: Data Classification, Data Protection, Privacy Policy, GDPR Training, Data Retention & Disposal
Compliance: EEOC Checklist, Technical & Organizational Measures, POSH, Diversity Equity & Inclusion
Operations: Change Management, Configuration & Asset Management, Vulnerability & Patch Management, Log Management & Monitoring
Development: Software Development Lifecycle, Hardening Policy
Disaster Recovery: Business Continuity & Disaster Recovery Plan, Disaster Recovery Testing Report
HR/Governance: Code of Conduct, Whistle Blower, Hiring Policy, HR Disciplinary Action, Occupational Health & Safety
Vendor: Vendor Management, List of Sub-Processors
Service: iMocha Service Level Agreement
Incident: Information Security Policy, Business Continuity & Disaster Recovery Plan

Format: "For more information, refer to: [Policy Name].pdf"`;

type Tab = "instructions" | "knowledge";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ConfigureDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("instructions");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [templatePreview, setTemplatePreview] = useState<{ label: string; file: string } | null>(null);

  const { user } = useCurrentUser();
  const { data: activeVersion } = useActivePrompt();
  const { data: versions = [], isLoading: versionsLoading } = usePromptVersions();
  const { data: docs = [], isLoading: docsLoading } = useDocuments({ globalOnly: true });
  const { data: bids = [] } = useBids();
  const savePrompt = useSavePrompt();
  const restorePrompt = useRestorePrompt();

  // Seed draft from active version (or default) when drawer opens
  useEffect(() => {
    if (open) {
      setDraftPrompt(activeVersion?.prompt_text ?? DEFAULT_PROMPT);
      setHistoryOpen(false);
    }
  }, [open, activeVersion]);

  const isDirty = draftPrompt !== (activeVersion?.prompt_text ?? DEFAULT_PROMPT);

  async function handleSave() {
    if (!user || !isDirty) return;
    try {
      await savePrompt.mutateAsync({
        promptText: draftPrompt,
        createdBy: user.id,
      });
      toast.success("Prompt saved and activated");
    } catch {
      toast.error("Failed to save prompt");
    }
  }

  async function handleRestore(versionId: string) {
    try {
      await restorePrompt.mutateAsync(versionId);
      toast.success("Version restored");
    } catch {
      toast.error("Failed to restore version");
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[680px] max-w-full bg-card border-l hairline border-border shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border shrink-0">
          <div className="flex-1">
            <div className="text-[13px] font-semibold">Configure RFx Responder</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Manage the AI persona and knowledge base
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-5 border-b hairline border-border shrink-0">
          {(["instructions", "knowledge"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "text-[11px] font-medium px-4 py-2.5 border-b-2 transition-colors capitalize",
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "instructions" ? "Instructions" : "Knowledge"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {tab === "instructions" ? (
            <InstructionsTab
              draft={draftPrompt}
              onChange={setDraftPrompt}
              isDirty={isDirty}
              isSaving={savePrompt.isPending}
              onSave={handleSave}
              versions={versions}
              versionsLoading={versionsLoading}
              historyOpen={historyOpen}
              onToggleHistory={() => setHistoryOpen((v) => !v)}
              onRestore={handleRestore}
              restoring={restorePrompt.isPending}
              activeVersionId={activeVersion?.id}
            />
          ) : (
            <KnowledgeTab
              docs={docs}
              bids={bids}
              isLoading={docsLoading}
              onPreview={setPreviewDoc}
              onUpload={() => setUploadOpen(true)}
              onTemplatePreview={setTemplatePreview}
            />
          )}
        </div>
      </div>

      <DocPreviewModal
        doc={previewDoc}
        allDocs={docs}
        onClose={() => setPreviewDoc(null)}
      />
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        bids={bids}
        lockToGlobal
      />
      {templatePreview && (
        <TemplatePreviewModal
          label={templatePreview.label}
          file={templatePreview.file}
          onClose={() => setTemplatePreview(null)}
        />
      )}
    </>
  );
}

// ── Instructions tab ──────────────────────────────────────────────────────────

function InstructionsTab({
  draft,
  onChange,
  isDirty,
  isSaving,
  onSave,
  versions,
  versionsLoading,
  historyOpen,
  onToggleHistory,
  onRestore,
  restoring,
  activeVersionId,
}: {
  draft: string;
  onChange: (v: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  versions: import("@/lib/prompt-queries").PromptVersion[];
  versionsLoading: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onRestore: (id: string) => void;
  restoring: boolean;
  activeVersionId?: string;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Textarea */}
      <div className="flex-1 px-5 pt-4 pb-2 overflow-hidden flex flex-col">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Instructions
        </div>
        <textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 w-full resize-none text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
          placeholder="Enter system instructions for the AI…"
          spellCheck={false}
        />
        <div className="flex items-center justify-between mt-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {draft.length.toLocaleString()} characters
          </span>
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className="h-8 px-4 rounded-md bg-primary text-white text-[11px] font-medium inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
            Save & activate
          </button>
        </div>
      </div>

      {/* Version history */}
      <div className="shrink-0 border-t hairline border-border">
        <button
          onClick={onToggleHistory}
          className="w-full flex items-center justify-between px-5 py-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
        >
          <span>Version history {versions.length > 0 ? `(${versions.length})` : ""}</span>
          {historyOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {historyOpen && (
          <div className="max-h-52 overflow-y-auto border-t hairline border-border">
            {versionsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-5 py-4">
                No saved versions yet — save your first prompt above.
              </div>
            ) : (
              versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  isActive={v.id === activeVersionId}
                  onRestore={() => onRestore(v.id)}
                  restoring={restoring}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VersionRow({
  version,
  isActive,
  onRestore,
  restoring,
}: {
  version: import("@/lib/prompt-queries").PromptVersion;
  isActive: boolean;
  onRestore: () => void;
  restoring: boolean;
}) {
  const preview = version.prompt_text.slice(0, 80).replace(/\n/g, " ");
  const date = new Date(version.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-start gap-3 px-5 py-2.5 border-b hairline border-border last:border-0 hover:bg-background transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] text-muted-foreground">{date}</span>
          {isActive && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-green-600 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 className="size-2.5" /> Active
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{preview}…</div>
      </div>
      {!isActive && (
        <button
          onClick={onRestore}
          disabled={restoring}
          className="shrink-0 h-6 px-2.5 rounded border hairline border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-background inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="size-2.5" />
          Restore
        </button>
      )}
    </div>
  );
}

// ── Knowledge tab ─────────────────────────────────────────────────────────────

function KnowledgeTab({
  docs,
  bids,
  isLoading,
  onPreview,
  onUpload,
  onTemplatePreview,
}: {
  docs: BidDocument[];
  bids: import("@/lib/bid-queries").Bid[];
  isLoading: boolean;
  onPreview: (doc: BidDocument) => void;
  onUpload: () => void;
  onTemplatePreview: (t: { label: string; file: string }) => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-5 py-3 border-b hairline border-border shrink-0">
        <div>
          <div className="text-[11px] font-medium">Knowledge Base</div>
          <div className="text-[10px] text-muted-foreground">
            {docs.length} global document{docs.length !== 1 ? "s" : ""} — used by the AI for all bids
          </div>
        </div>
        <button
          onClick={onUpload}
          className="h-8 px-3 rounded-md bg-primary text-white text-[11px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
        >
          <Upload className="size-3" />
          Upload
        </button>
      </div>

      {/* Proposal templates */}
      <div className="px-5 pt-4 pb-3 border-b hairline border-border shrink-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Proposal Templates
        </div>
        <div className="flex gap-2">
          {[
            { label: "TA Template", file: "TA_Proposal_template.docx", tag: "Talent Acquisition" },
            { label: "TM Template", file: "TM_Proposal_template.docx", tag: "Talent Management" },
          ].map((t) => (
            <div
              key={t.file}
              className="flex-1 flex items-center justify-between gap-2 bg-background border hairline border-border rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-foreground truncate">{t.label}</div>
                <div className="text-[10px] text-muted-foreground">{t.tag}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onTemplatePreview(t)}
                  className="h-6 px-2.5 rounded border hairline border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 transition-colors"
                >
                  <Eye className="size-2.5" /> Preview
                </button>
                <a
                  href={`/templates/${t.file}`}
                  download={t.file}
                  className="h-6 px-2.5 rounded border hairline border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 transition-colors"
                >
                  ↓ Download
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <div className="text-3xl opacity-20">📁</div>
            <div className="text-[13px]">No knowledge base documents yet</div>
            <div className="text-[11px]">Upload documents to ground the AI in iMocha's capabilities</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} onPreview={onPreview} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Template preview modal ────────────────────────────────────────────────────

function TemplatePreviewModal({
  label,
  file,
  onClose,
}: {
  label: string;
  file: string;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/templates/${file}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => import("mammoth").then((m) => m.convertToHtml({ arrayBuffer: buf })))
      .then((result) => setHtml(result.value))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [file]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-card border hairline border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border shrink-0">
            <span className="flex-1 text-[13px] font-semibold">{label} — Preview</span>
            <a
              href={`/templates/${file}`}
              download={file}
              className="h-7 px-3 rounded border hairline border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-background inline-flex items-center gap-1 transition-colors"
            >
              ↓ Download
            </a>
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {loading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="text-[12px] text-destructive text-center py-16">
                Failed to load preview.
              </div>
            )}
            {html && (
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
