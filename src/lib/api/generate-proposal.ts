import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexDocument } from "@/lib/api/doc-functions";

// ── Template cache ─────────────────────────────────────────────────────────────
const templateCache: Record<string, Buffer> = {};

async function getTemplateBuffer(filename: string): Promise<Buffer> {
  if (!templateCache[filename]) {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const p = join(process.cwd(), "src", "assets", filename);
    templateCache[filename] = readFileSync(p);
  }
  return templateCache[filename];
}

const TA_TEMPLATE = "TA_Proposal_template.docx";
const TM_TEMPLATE = "TM_Proposal_template.docx";

// ── Template configuration ──────────────────────────────────────────────────────
// Each template declares the placeholder tokens it uses and the substitution
// strategy for each. The engine (applySubstitutions) is generic — add a new
// template by adding a new TemplateConfig entry, no engine changes needed.
//
// Strategies:
//   "paragraph" — whole-paragraph exact match after decoding (handles split-run
//                 tokens that Word's spell-checker broke across multiple <w:r>s)
//   "direct"    — raw XML substring replacement (single-run tokens, XML-encoded
//                 placeholders like &lt;Token&gt;). Value is xmlEscape'd before insert.
//   "raw-xml"   — raw XML substring replacement where the value is already valid
//                 XML (e.g. a full <w:t> node). Value inserted verbatim.

type SubStrategy = "paragraph" | "direct" | "raw-xml";

type SubEntry = {
  token: string;
  value: (intake: Intake) => string;
  strategy: SubStrategy;
};

type TemplateConfig = {
  filename: string;
  substitutions: SubEntry[];
  headerFooter: Array<{ token: string; value: (i: Intake) => string }>;
  anchors: {
    deliverablesHeading: string;
    integrationsBookmark: string;
  };
};

const DEFAULT_INTEGRATIONS =
  "Workday, SAP SuccessFactors, Cornerstone OnDemand, Degreed, and other LTI-compliant LMS/LXP platforms";

const COVER_PAGE_NOTE = "Please find our proposal attached for your review.";

// ── TA template ─────────────────────────────────────────────────────────────────
// Uses XML-tag style placeholders: &lt;Token&gt; for most fields,
// a standalone <w:t>Name</w:t> run for Prepared For, and proofErr-split
// <Sales spoc name> for the SPOC name.
const TA_CONFIG: TemplateConfig = {
  filename: TA_TEMPLATE,
  anchors: {
    deliverablesHeading:   "2.1 In scope Key Deliverables",
    integrationsBookmark:  "_Integration_with_SAP",
  },
  headerFooter: [
    { token: "&lt;Customer Name&gt;", value: i => sanitize(i.customer_display_name) },
    { token: "&lt;RFP Name&gt;",      value: i => sanitize(i.rfp_name) },
    { token: "CUSTOMER NAME",         value: i => sanitize(i.customer_display_name) },
  ],
  substitutions: [
    { token: "&lt;RFP Name&gt;",                                                       strategy: "direct",    value: i => sanitize(i.rfp_name) },
    { token: "&lt;Customer Name&gt;",                                                  strategy: "direct",    value: i => sanitize(i.customer_display_name) },
    // Prepared For: "Name" is a standalone run after the "Prepared For:" label
    { token: "<w:t>Name</w:t>",                                                        strategy: "raw-xml",   value: i => `<w:t xml:space="preserve">${xmlEscape(sanitize(i.prepared_for))}</w:t>` },
    // SPOC name — split across runs by spell-checker
    { token: "<Sales spoc name>",                                                      strategy: "paragraph", value: i => sanitize(i.spoc_name) },
    { token: "Sales email id",                                                         strategy: "direct",    value: i => sanitize(i.spoc_email) },
    { token: "&lt;How we are pleased to provide the solution&gt;",                     strategy: "direct",    value: i => sanitize(i.exec_summary.pleased) },
    { token: "&lt;How we are aligned with customer goals and their requirement&gt;",   strategy: "direct",    value: i => sanitize(i.exec_summary.aligned) },
    { token: "&lt;How confident we are to deliver value&gt;",                          strategy: "direct",    value: i => sanitize(i.exec_summary.confident) },
    { token: "<How scope is aligned to what iMocha can deliver>",                      strategy: "paragraph", value: i => sanitize(i.scope_intro) },
    { token: "&lt;HRMS, LMS, LXP",                                                     strategy: "direct",    value: i => sanitize(i.integrations ?? DEFAULT_INTEGRATIONS) },
  ],
};

// ── TM template ─────────────────────────────────────────────────────────────────
// Uses all-caps CUSTOMER as a token (no XML tags), "Sales person" for SPOC name,
// "@imocha.io" hyperlink text for SPOC email. Many tokens are split across runs
// by the spell-checker so require paragraph-level matching.
// Order matters within each strategy pass — more-specific tokens before solo CUSTOMER
// so "CUSTOMER Team" is handled as prepared_for before "CUSTOMER" fires.
const TM_CONFIG: TemplateConfig = {
  filename: TM_TEMPLATE,
  anchors: {
    deliverablesHeading:   "Key Deliverables: ",
    integrationsBookmark:  "_Integration_with_SAP",
  },
  headerFooter: [
    { token: "&lt;RFP Name&gt;", value: i => sanitize(i.rfp_name) },
    { token: "CUSTOMER",         value: i => sanitize(i.customer_display_name) },
  ],
  substitutions: [
    // ── Paragraph-level (split-run tokens, must run before direct CUSTOMER) ───
    // Cover page title — runs: "Customer" + " (" + "CUSTOMER" + ")"
    { token: "Customer (CUSTOMER)",          strategy: "paragraph", value: i => sanitize(i.customer_display_name) },
    // Prepared For — runs: "CUSTOMER" + " Team"
    { token: "CUSTOMER Team",                strategy: "paragraph", value: i => sanitize(i.prepared_for) },
    // Cover letter To: line — runs: "To:" + "CUSTOMER" + " Team"
    { token: "To:CUSTOMER Team",             strategy: "paragraph", value: i => "To:" + sanitize(i.prepared_for) },
    // Cover letter Dear line — runs: "Dear " + "&lt;Customer name&gt;" + ","
    { token: "Dear <Customer name>,",        strategy: "paragraph", value: i => "Dear " + sanitize(i.customer_display_name) + "," },
    // Cover letter body placeholder
    { token: "<Cover page details>",         strategy: "paragraph", value: _ => COVER_PAGE_NOTE },
    // SPOC name — same text appears in Prepared By (×2) and cover letter sign-off
    { token: "Sales person",                 strategy: "paragraph", value: i => sanitize(i.spoc_name) },
    // Scope intro
    { token: "<How scope is aligned to what iMocha can deliver>", strategy: "paragraph", value: i => sanitize(i.scope_intro) },

    // ── Direct (single-run XML tokens) ───────────────────────────────────────
    { token: "&lt;RFP Name&gt;",                                                       strategy: "direct",    value: i => sanitize(i.rfp_name) },
    { token: "&lt;Mention subject for cover page&gt;",                                 strategy: "direct",    value: i => sanitize(i.rfp_name) },
    // Remaining CUSTOMER in body paragraphs (paragraph-level already handled the
    // whole-paragraph cases above, so only long body-text instances remain)
    { token: "CUSTOMER",                                                               strategy: "direct",    value: i => sanitize(i.customer_display_name) },
    // Dear line fallback — single run if spell-checker didn't split it
    { token: "&lt;Customer name&gt;",                                                  strategy: "direct",    value: i => sanitize(i.customer_display_name) },
    // Cover page details fallback — single run if it wasn't paragraph-matched
    { token: "&lt;Cover page details&gt;",                                             strategy: "direct",    value: _ => COVER_PAGE_NOTE },
    // SPOC email — "@imocha.io" is the hyperlink text in the Prepared By block
    { token: "@imocha.io",                                                             strategy: "direct",    value: i => sanitize(i.spoc_email) },
    // Exec summary (may not exist in TM template — harmless if no match)
    { token: "&lt;How we are pleased to provide the solution&gt;",                     strategy: "direct",    value: i => sanitize(i.exec_summary.pleased) },
    { token: "&lt;How we are aligned with customer goals and their requirement&gt;",   strategy: "direct",    value: i => sanitize(i.exec_summary.aligned) },
    { token: "&lt;How confident we are to deliver value&gt;",                          strategy: "direct",    value: i => sanitize(i.exec_summary.confident) },
    { token: "&lt;HRMS, LMS, LXP",                                                     strategy: "direct",    value: i => sanitize(i.integrations ?? DEFAULT_INTEGRATIONS) },
  ],
};

const TEMPLATE_CONFIGS: Record<string, TemplateConfig> = {
  [TA_TEMPLATE]: TA_CONFIG,
  [TM_TEMPLATE]: TM_CONFIG,
};

// ── Intake schema ──────────────────────────────────────────────────────────────
export const IntakeSchema = z.object({
  product: z.enum(["TA", "TM"]),
  rfp_name: z.string(),
  customer_display_name: z.string(),
  prepared_for: z.string(),
  spoc_name: z.string(),
  spoc_email: z.string(),
  exec_summary: z.object({
    pleased: z.string(),
    aligned: z.string(),
    confident: z.string(),
  }),
  scope_intro: z.string(),
  deliverables: z.array(z.string()),
  integrations: z.string().optional(),         // comma-separated platform names for heading
  integrations_content: z.string().optional(), // full paragraph injected into section body
});

export type Intake = z.infer<typeof IntakeSchema>;
export type ProposalPreview = Omit<Intake, "prepared_for" | "spoc_name" | "spoc_email">;

const InputSchema = z.object({
  bidId: z.string().uuid(),
  sessionId: z.string().uuid(),
  intakeJson: z.string().optional(), // JSON-encoded Intake — avoids Seroval object serialization issues
  format: z.enum(["docx", "pdf"]).default("docx"),
  force: z.boolean().optional(),
});

// ── RAG helpers ────────────────────────────────────────────────────────────────
type ChunkRow = { doc_name: string; chunk_text: string };

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Voyage embed error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function searchChunks(query: string, bidId: string, topK = 5): Promise<ChunkRow[]> {
  try {
    const embedding = await embedText(query);
    const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 20,
      min_similarity: 0.35,
    });
    return ((data ?? []) as ChunkRow[]).slice(0, topK);
  } catch {
    // Voyage down — FTS-only fallback with zero vector
    try {
      const zero = JSON.stringify(new Array(1024).fill(0));
      const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
        query_text: query,
        query_embedding: zero,
        match_bid_id: bidId,
        match_count: topK,
        semantic_weight: 0,
      });
      return (data ?? []) as ChunkRow[];
    } catch {
      return [];
    }
  }
}

function formatChunks(chunks: ChunkRow[], heading: string): string {
  if (!chunks.length) return "";
  return `## ${heading}\n${chunks.map((c) => `[${c.doc_name}]\n${c.chunk_text}`).join("\n---\n")}\n\n`;
}

// ── Document context via RAG (P0 fix: uploaded RFP docs now reach the proposal) ─
type DocContext = {
  requirementsText: string;
  integrationsText: string;
  customStructureText: string;
  hasCustomStructure: boolean;
};

async function buildDocumentContext(bidId: string): Promise<DocContext> {
  const [reqChunks, intChunks, structChunks] = await Promise.all([
    searchChunks("scope requirements deliverables timeline evaluation criteria", bidId, 6),
    searchChunks("integration HRMS ATS LMS LXP system platform API connector webhook SSO", bidId, 5),
    searchChunks("proposal format table of contents structure required sections response format", bidId, 4),
  ]);

  const hasCustomStructure =
    structChunks.length >= 2 &&
    structChunks.some((c) =>
      /table of contents|section \d+|required format|proposal structure|bid format|response format/i.test(
        c.chunk_text
      )
    );

  return {
    requirementsText: formatChunks(reqChunks, "RFP Excerpts — Requirements & Scope"),
    integrationsText: formatChunks(intChunks, "RFP Excerpts — Integration Requirements"),
    customStructureText: hasCustomStructure
      ? formatChunks(structChunks, "Customer Proposal Format Requirements")
      : "",
    hasCustomStructure,
  };
}

// ── System blocks ──────────────────────────────────────────────────────────────
async function buildProposalSystemBlocks(
  bidId: string
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const [
    { data: bid },
    { data: questions },
    { data: deliverables },
    docCtx,
  ] = await Promise.all([
    supabaseAdmin
      .from("bids")
      .select("client_name, title, type, product_type, contact_name, value, stage, deadline")
      .eq("id", bidId)
      .single(),
    supabaseAdmin
      .from("bid_questions")
      .select("question_text, stage")
      .eq("bid_id", bidId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("bid_deliverables")
      .select("label, stage")
      .eq("bid_id", bidId)
      .order("created_at", { ascending: true }),
    buildDocumentContext(bidId),
  ]);

  const parts: string[] = [
    "You are the iMocha proposal author assistant.",
    "Author variable content for an iMocha branded proposal grounded in all context below.",
    "Every claim must be traceable to the provided context — do not invent capabilities, statistics, or certifications.",
    "",
  ];

  if (bid) {
    parts.push("## Bid Metadata");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase() ?? "RFP"}`);
    if ((bid as any).product_type) parts.push(`Product: ${(bid as any).product_type}`);
    if ((bid as any).contact_name) parts.push(`Procurement Contact: ${(bid as any).contact_name}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    parts.push("");
  }

  if (questions?.length) {
    parts.push("## Bid Questions (client requirements)");
    for (const q of questions) parts.push(`- ${q.question_text}`);
    parts.push("");
  }

  if (deliverables?.length) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- ${d.label}`);
    parts.push("");
  }

  if (docCtx.requirementsText) parts.push(docCtx.requirementsText);
  if (docCtx.integrationsText) parts.push(docCtx.integrationsText);

  if (docCtx.hasCustomStructure) {
    parts.push(docCtx.customStructureText);
    parts.push(
      "IMPORTANT: The customer has specified a proposal format/structure above. " +
        "Follow their section structure and requirements when authoring scope_intro and deliverables content."
    );
    parts.push("");
  }

  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}

// ── Authoring prompt (shared by Sonnet preview and Haiku fallback) ─────────────
function buildAuthorPrompt(chatText: string, includeSpoc: boolean): string {
  const spocFields = includeSpoc
    ? `
  "prepared_for": "[TO PROVIDE: contact name and title at client org]",
  "spoc_name": "[TO PROVIDE: Sales SPOC full name]",
  "spoc_email": "[TO PROVIDE: Sales SPOC email address]",`
    : "";

  const chatSection = chatText
    ? `\n<chat_history>\n${chatText}\n</chat_history>\n`
    : "";

  return `Author the variable content for an iMocha proposal based on all context in your system blocks.${chatSection}

## Flagging rule — read this before writing any field
Whenever a field requires client-specific information that is NOT explicitly present in the system context (bid metadata, uploaded documents, bid questions, or chat history), you MUST insert a [CONFIRM: <short description of what is missing>] marker in place of assumed content. Do NOT invent, infer, or use generic stand-ins. The analyst will edit these markers in Word before sending to the client.

Output a single valid JSON object with this exact schema (no markdown, no code blocks, no extra text):
{
  "product": "Use the Product field from Bid Metadata if present (TA or TM). Otherwise infer from context: TA for hiring/recruitment/assessment/candidates, TM for skills/competency/workforce development.",
  "rfp_name": "bid title verbatim + ' — iMocha Proposal'",
  "customer_display_name": "client name exactly as it should appear throughout the document",${spocFields}
  "exec_summary": {
    "pleased": "SHORT paragraph — 2 to 3 sentences. Warmly introduce iMocha [TA or TM] as the recommended platform for [client name]. State the headline value iMocha delivers. Be direct and confident.",
    "aligned": "MEDIUM paragraph — 3 to 5 sentences. Open by naming the client's specific challenge or stated requirement drawn from the uploaded documents or bid questions. If no specific challenge is found in the context, start the paragraph with [CONFIRM: client pain point not found in uploaded documents — describe the actual business challenge here]. Then explain how iMocha addresses each named requirement. Close with any explicit scope exclusions or boundaries stated in the RFP.",
    "confident": "MEDIUM paragraph — 3 to 5 sentences. Lead with iMocha's proof points: Azure SaaS infrastructure, ISO 27001, SOC 2 Type II, 99.9% uptime SLA. Then name the specific integration platforms relevant to this client — these MUST match the 'integrations' field you are about to write; if that field has a [CONFIRM: ...] token, write [CONFIRM: integration platform unconfirmed — update to match client's actual tech stack] here instead of guessing. Close with a forward-looking partnership statement."
  },
  "scope_intro": "One concise paragraph. Describe the in-scope work by citing specific requirements found in the uploaded documents or bid questions. If no specific requirements are traceable to the context, start the paragraph with [CONFIRM: scope requirements not found in uploaded documents — replace with actual in-scope items from the RFP]. Close with a sentence listing explicit out-of-scope exclusions; if none stated, write [CONFIRM: out-of-scope items not specified — confirm with client].",
  "integrations": "Comma-separated list of HRMS, ATS, LMS, or LXP platform names that are explicitly named in the uploaded documents, bid questions, or chat history. ONLY list platforms you can directly trace to the provided context. If no specific platforms are mentioned anywhere, output exactly: [CONFIRM: ATS/HRMS/LMS platform not specified — verify with client before sending]. Do NOT assume or invent platform names.",
  "integrations_content": "2 to 3 sentences on how iMocha integrates with the platforms in 'integrations' — REST API, SAML 2.0 SSO, LTI 1.3, or pre-built connectors as applicable. If 'integrations' contains a [CONFIRM: ...] token, output: [CONFIRM: integration details unknown — update once ATS/HRMS/LMS platform is confirmed with client].",
  "deliverables": ["8 to 12 concise bullets. Each bullet MUST map a specific client requirement (traceable to the uploaded documents, bid questions, or chat history) to a named iMocha capability. Start each with an action verb. If a bullet cannot be grounded in the provided context, write it as: [CONFIRM: requirement not found in documents — replace with actual client requirement] → iMocha capability. Never write generic bullets that apply to any client."]
}`;
}

// ── XML helpers ────────────────────────────────────────────────────────────────

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Strip newlines — Word <w:t> nodes don't render \n as line breaks.
// Each exec-summary field and scope_intro is already its own <w:p>; within a
// single paragraph, sentences should flow continuously.
function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

// ── Substitution helpers ───────────────────────────────────────────────────────

// Word's spell-checker splits certain placeholders across multiple <w:r> runs by
// wrapping flagged words (e.g. "spoc", "iMocha") in <w:proofErr> elements. Direct
// string replacement can't find those tokens. This function extracts the full text
// of each paragraph by concatenating all <w:t> nodes, matches against known tokens,
// and replaces the entire paragraph with a clean single run — preserving the
// original paragraph and run formatting.
function applyParagraphLevelSubstitutions(xml: string, subs: [string, string][]): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const tMatches = [...para.matchAll(/<w:t(?:[^>]*)>([^<]*)<\/w:t>/g)];
    const fullText = tMatches
      .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
      .join("");

    for (const [token, value] of subs) {
      if (fullText === token) {
        const pAttrsMatch = para.match(/^<w:p([^>]*)>/);
        const pAttrs = pAttrsMatch ? pAttrsMatch[1] : "";
        const pPrMatch = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
        const pPr = pPrMatch ? pPrMatch[0] : "";
        const rPrMatch = para.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
        const rPr = rPrMatch ? rPrMatch[0] : "";
        return `<w:p${pAttrs}>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(value)}</w:t></w:r></w:p>`;
      }
    }
    return para;
  });
}

// Generic substitution engine — driven entirely by TemplateConfig.
// Pass order is deterministic: paragraph → direct → raw-xml.
// Entries within each pass run in config declaration order, which is
// why more-specific tokens (e.g. "CUSTOMER Team") are listed before
// less-specific ones (e.g. solo "CUSTOMER") in each template config.
function applySubstitutions(xml: string, intake: Intake, config: TemplateConfig): string {
  // Pass 1: paragraph-level (whole-paragraph exact match, decoded text)
  const paragraphSubs = config.substitutions
    .filter(s => s.strategy === "paragraph")
    .map(s => [s.token, s.value(intake)] as [string, string]);
  let result = paragraphSubs.length
    ? applyParagraphLevelSubstitutions(xml, paragraphSubs)
    : xml;

  // Pass 2: direct XML-string replacement (value is xmlEscape'd before insert)
  for (const sub of config.substitutions.filter(s => s.strategy === "direct")) {
    result = result.split(sub.token).join(xmlEscape(sub.value(intake)));
  }

  // Pass 3: raw-xml replacement (value is already valid XML, inserted verbatim)
  for (const sub of config.substitutions.filter(s => s.strategy === "raw-xml")) {
    result = result.split(sub.token).join(sub.value(intake));
  }

  return result;
}

function discoverBulletNumId(xml: string): string | null {
  const numIdMatch = xml.match(/<w:numId w:val="(\d+)"\/>/);
  return numIdMatch ? numIdMatch[1] : null;
}

function buildBulletParagraphs(deliverables: string[], numId: string | null): string {
  const nId = numId ?? "1";
  return deliverables
    .map(
      (text) =>
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${nId}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
    )
    .join("\n");
}

// ── TOC field injection ────────────────────────────────────────────────────────
// Both templates have either a blank TOC1 placeholder (TA) or pre-baked static
// TOC entries with hardcoded page numbers from a prior proposal (TM). Either way
// the generated document shows the wrong content in the TOC section.
//
// Fix: replace all consecutive TOC1/TOC2 styled paragraphs with a single
// auto-update field instruction. Word marks it dirty=true so it regenerates
// the correct headings + page numbers on first open.
function replaceTocWithField(xml: string): string {
  // The TOC field paragraph Word needs to auto-generate the table of contents.
  // w:dirty="true" forces Word to rebuild it on open.
  const tocField =
    `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>` +
    `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>Please open in Word and press Ctrl+A then F9 to update the Table of Contents.</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
    `</w:p>`;

  // Match one or more consecutive paragraphs styled TOC1 or TOC2
  const tocBlockRe = /(<w:p[ >](?:(?!<w:p[ >]).)*?<w:pStyle w:val="TOC[12]"[^/]?\/>(?:(?!<\/w:p>).)*?<\/w:p>\s*)+/gs;

  let replaced = false;
  const result = xml.replace(tocBlockRe, () => {
    if (replaced) return ""; // swallow extra matches (shouldn't happen)
    replaced = true;
    return tocField + "\n";
  });

  if (!replaced) {
    console.warn("[replaceTocWithField] no TOC1/TOC2 paragraphs found — TOC field not injected");
  }
  return result;
}

// Word's spell-checker splits heading text across multiple <w:r> runs, so a plain
// indexOf on the heading string will miss it. We scan paragraph by paragraph,
// concatenate all <w:t> node values, and match against the anchor text — the same
// technique used in applyParagraphLevelSubstitutions.
function findHeadingParaEnd(xml: string, headingText: string): number {
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml)) !== null) {
    const tMatches = [...m[0].matchAll(/<w:t(?:[^>]*)>([^<]*)<\/w:t>/g)];
    const full = tMatches.map(t => t[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join("");
    if (full.trim() === headingText.trim()) {
      return m.index + m[0].length; // position right after </w:p>
    }
  }
  return -1;
}

function injectDeliverables(xml: string, deliverables: string[], config: TemplateConfig): string {
  const numId = discoverBulletNumId(xml);
  const bullets = buildBulletParagraphs(deliverables, numId);

  const insertAt = findHeadingParaEnd(xml, config.anchors.deliverablesHeading);
  if (insertAt === -1) {
    console.warn("[injectDeliverables] heading not found:", config.anchors.deliverablesHeading, "— appending at body end");
    return xml.replace("</w:body>", `${bullets}</w:body>`);
  }

  return xml.slice(0, insertAt) + "\n" + bullets + xml.slice(insertAt);
}

function injectIntegrationsContent(xml: string, content: string, config: TemplateConfig): string {
  if (!content) return xml;

  const anchorIdx = xml.indexOf(config.anchors.integrationsBookmark);
  if (anchorIdx === -1) return xml;

  const paraEnd = xml.indexOf("</w:p>", anchorIdx) + "</w:p>".length;

  // Use Poppins 11pt to match the template body text style
  const rPr = `<w:rPr><w:rFonts w:ascii="Poppins" w:hAnsi="Poppins" w:cs="Poppins"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;
  const pPr = `<w:pPr><w:pStyle w:val="NormalWeb"/>${rPr}</w:pPr>`;
  const contentPara = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(sanitize(content))}</w:t></w:r></w:p>`;

  return xml.slice(0, paraEnd) + "\n" + contentPara + xml.slice(paraEnd);
}

function applyHeaderFooterSubstitutions(xml: string, intake: Intake, config: TemplateConfig): string {
  let result = xml;
  for (const { token, value } of config.headerFooter) {
    result = result.split(token).join(xmlEscape(value(intake)));
  }
  return result;
}

// ── Pre-generate readiness check (zero AI tokens) ─────────────────────────────
export type ReadinessCheck = {
  metadata: {
    hasProductType: boolean;
    hasBidType: boolean;
    hasContactName: boolean;
    hasValue: boolean;
    productType: string | null;
    bidType: string | null;
  };
  documents: {
    uploadedCount: number;
    indexedChunkCount: number;
  };
  questions: {
    count: number;
  };
  likelyFlags: Array<{ field: string; reason: string }>;
  existingProposal: { id: string; name: string; downloadUrl: string } | null;
};

export const checkProposalReadinessFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bidId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const [bidRes, docRes, chunkRes, questionRes, existingProposalRes] = await Promise.all([
      supabaseAdmin
        .from("bids")
        .select("product_type, type, contact_name, value")
        .eq("id", data.bidId)
        .single(),
      (supabaseAdmin.from("bid_documents") as any)
        .select("id", { count: "exact", head: true })
        .eq("bid_id", data.bidId),
      (supabaseAdmin.from("bid_document_chunks") as any)
        .select("id", { count: "exact", head: true })
        .eq("bid_id", data.bidId),
      supabaseAdmin
        .from("bid_questions")
        .select("id", { count: "exact", head: true })
        .eq("bid_id", data.bidId),
      (supabaseAdmin.from("bid_documents") as any)
        .select("id, name, storage_path")
        .eq("bid_id", data.bidId)
        .eq("type", "proposal")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const bid = bidRes.data as any;
    const uploadedCount: number = docRes.count ?? 0;
    const indexedChunkCount: number = chunkRes.count ?? 0;
    const questionCount: number = questionRes.count ?? 0;
    const hasContext = indexedChunkCount > 0 || questionCount > 0;

    const likelyFlags: Array<{ field: string; reason: string }> = [];

    if (!hasContext) {
      likelyFlags.push({
        field: "Executive Summary — Alignment",
        reason: "No RFP documents indexed and no bid questions — client pain points will be flagged",
      });
      likelyFlags.push({
        field: "Scope Introduction",
        reason: "No requirements traceable to context — scope will be flagged",
      });
      likelyFlags.push({
        field: "Deliverables",
        reason: "All bullets require traceable requirements — most will be flagged",
      });
    }

    if (!hasContext || indexedChunkCount === 0) {
      likelyFlags.push({
        field: "Integrations (ATS / HRMS / LMS)",
        reason: "Platform names not found in uploaded documents — will be flagged",
      });
    }

    if (!bid?.product_type) {
      likelyFlags.push({
        field: "Product Type (TA vs TM)",
        reason: "Not set on the bid — AI will infer from context, may be wrong",
      });
    }

    if (!bid?.contact_name) {
      likelyFlags.push({
        field: "Prepared For (cover page)",
        reason: "Procurement contact name not set on the bid",
      });
    }

    let existingProposal: ReadinessCheck["existingProposal"] = null;
    if (existingProposalRes.data) {
      const { data: signed } = await supabaseAdmin.storage
        .from("bid-documents")
        .createSignedUrl(existingProposalRes.data.storage_path, 300);
      existingProposal = {
        id: existingProposalRes.data.id,
        name: existingProposalRes.data.name,
        downloadUrl: signed?.signedUrl ?? "",
      };
    }

    const result: ReadinessCheck = {
      metadata: {
        hasProductType: !!bid?.product_type,
        hasBidType: !!bid?.type,
        hasContactName: !!bid?.contact_name,
        hasValue: !!(bid?.value && bid.value > 0),
        productType: bid?.product_type ?? null,
        bidType: bid?.type ?? null,
      },
      documents: { uploadedCount, indexedChunkCount },
      questions: { count: questionCount },
      likelyFlags,
      existingProposal,
    };

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  });

// ── Preview server function (Sonnet + RAG + chat history → ProposalPreview) ────
export const previewProposalFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bidId: z.string().uuid(), sessionId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const { data: sessionRow } = await (supabaseAdmin.from("ai_sessions") as any)
      .select("messages")
      .eq("id", data.sessionId)
      .single();

    const chatText = ((sessionRow?.messages as any[]) ?? [])
      .map((m: any) => `<${m.role}>\n${m.content}\n</${m.role}>`)
      .join("\n\n");

    const systemBlocks = await buildProposalSystemBlocks(data.bidId);
    const userContent = buildAuthorPrompt(chatText, false);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemBlocks,
      messages: [{ role: "user", content: userContent }],
    });

    const rawText = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.Messages.TextBlock).text)
      .join("");

    let preview: ProposalPreview;
    try {
      const cleaned = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
      preview = JSON.parse(cleaned) as ProposalPreview;
    } catch {
      return new Response("Preview author failed: invalid JSON from Sonnet", { status: 500 });
    }

    if (!preview.exec_summary?.pleased)
      preview.exec_summary = { ...preview.exec_summary, pleased: "[TO PROVIDE: exec summary — pleased]" };
    if (!preview.exec_summary?.aligned)
      preview.exec_summary = { ...preview.exec_summary, aligned: "[TO PROVIDE: exec summary — aligned]" };
    if (!preview.exec_summary?.confident)
      preview.exec_summary = { ...preview.exec_summary, confident: "[TO PROVIDE: exec summary — confident]" };
    if (!preview.scope_intro) preview.scope_intro = "[TO PROVIDE: scope intro]";
    if (!Array.isArray(preview.deliverables) || !preview.deliverables.length)
      preview.deliverables = ["[TO PROVIDE: deliverables]"];
    if (!preview.rfp_name) preview.rfp_name = "[TO PROVIDE: rfp name]";
    if (!preview.customer_display_name) preview.customer_display_name = "[TO PROVIDE: customer name]";
    if (!preview.product) preview.product = "TA";

    return new Response(JSON.stringify(preview), {
      headers: { "Content-Type": "application/json" },
    });
  });

// ── Main server function ───────────────────────────────────────────────────────
export const generateProposalFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    console.log("[generateProposalFn] received data keys:", Object.keys(data), "format:", data.format, "force:", data.force, "hasIntakeJson:", !!data.intakeJson);
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) { console.error("[generateProposalFn] no auth token"); return new Response("Unauthorized", { status: 401 }); }

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) { console.error("[generateProposalFn] auth failed:", authErr); return new Response("Unauthorized", { status: 401 }); }

    // ── Conflict check: one proposal per bid ──────────────────────────────────
    const { data: existingProposal } = await (supabaseAdmin.from("bid_documents") as any)
      .select("id, name, storage_path")
      .eq("bid_id", data.bidId)
      .eq("type", "proposal")
      .order("size_bytes", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingProposal && !data.force) {
      return new Response(
        JSON.stringify({ conflict: true, existingName: existingProposal.name, existingId: existingProposal.id }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    if (existingProposal && data.force) {
      await supabaseAdmin.storage.from("bid-documents").remove([existingProposal.storage_path]);
      await (supabaseAdmin.from("bid_documents") as any).delete().eq("id", existingProposal.id);
    }

    // ── Phase 1: Author via Haiku (skipped when pre-authored intake provided) ─
    let intake: Intake;
    const parsedIntake = data.intakeJson ? JSON.parse(data.intakeJson) as Intake : null;
    console.log("[generateProposalFn] phase1 — parsedIntake:", parsedIntake ? `product=${parsedIntake.product}` : "null — will call Haiku");
    if (parsedIntake) {
      intake = parsedIntake;
    } else {
      const systemBlocks = await buildProposalSystemBlocks(data.bidId);
      const intakePrompt = buildAuthorPrompt("", true);

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const authorResp = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: systemBlocks,
        messages: [{ role: "user", content: intakePrompt }],
      });

      const rawText = authorResp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.Messages.TextBlock).text)
        .join("");

      try {
        const cleaned = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
        intake = JSON.parse(cleaned) as Intake;
      } catch {
        return new Response("Proposal author failed: invalid JSON from Haiku", { status: 500 });
      }

      const required: (keyof Intake)[] = [
        "product", "rfp_name", "customer_display_name", "exec_summary", "scope_intro", "deliverables",
      ];
      for (const k of required) {
        if (!intake[k]) intake[k as "rfp_name"] = `[TO PROVIDE: ${k}]`;
      }
      if (!Array.isArray(intake.deliverables) || !intake.deliverables.length) {
        intake.deliverables = ["[TO PROVIDE: deliverables]"];
      }
    }

    // ── Phase 2: Assemble DOCX ────────────────────────────────────────────────
    console.log("[generateProposalFn] phase2 — assembling DOCX, product:", intake.product, "deliverables:", intake.deliverables?.length);
    const templateFilename = intake.product === "TM" ? TM_TEMPLATE : TA_TEMPLATE;
    const config = TEMPLATE_CONFIGS[templateFilename];
    const templateBuffer = await getTemplateBuffer(templateFilename);

    const zip = await JSZip.loadAsync(templateBuffer);

    const docXml = await zip.file("word/document.xml")!.async("string");
    let editedDocXml = applySubstitutions(docXml, intake, config);
    editedDocXml = injectDeliverables(editedDocXml, intake.deliverables, config);
    if (intake.integrations_content) {
      editedDocXml = injectIntegrationsContent(editedDocXml, intake.integrations_content, config);
    }
    editedDocXml = replaceTocWithField(editedDocXml);
    zip.file("word/document.xml", editedDocXml);

    for (const filename of Object.keys(zip.files)) {
      if (
        (filename.startsWith("word/header") || filename.startsWith("word/footer")) &&
        filename.endsWith(".xml")
      ) {
        const hfXml = await zip.file(filename)!.async("string");
        zip.file(filename, applyHeaderFooterSubstitutions(hfXml, intake, config));
      }
    }

    const docxBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // ── Phase 3: Optionally convert to PDF via LibreOffice ───────────────────
    const safeClient = intake.customer_display_name.replace(/[^a-z0-9]/gi, "_");
    const format = data.format ?? "docx";

    let outputBuffer: Buffer = docxBuffer;
    let contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    let ext = "docx";

    if (format === "pdf") {
      try {
        const { execSync } = await import("node:child_process");
        const { writeFileSync, readFileSync, rmSync, mkdirSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");

        const tmpDir = join(tmpdir(), `proposal-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
        const tmpDocx = join(tmpDir, "proposal.docx");
        writeFileSync(tmpDocx, docxBuffer);

        const soffice =
          ["/opt/homebrew/bin/soffice", "/usr/bin/soffice", "soffice"].find((p) => {
            try { execSync(`"${p}" --version`, { stdio: "pipe" }); return true; } catch { return false; }
          }) ?? "soffice";

        execSync(`"${soffice}" --headless --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`, {
          timeout: 30_000,
          stdio: "pipe",
        });

        const pdfPath = join(tmpDir, "proposal.pdf");
        outputBuffer = readFileSync(pdfPath);
        rmSync(tmpDir, { recursive: true, force: true });
        contentType = "application/pdf";
        ext = "pdf";
      } catch (err) {
        console.error("[generate-proposal] PDF conversion failed, falling back to DOCX:", err);
        // fall back to DOCX silently
      }
    }

    // ── Phase 4: Upload to Knowledge Hub ─────────────────────────────────────
    const filename = `iMocha_${safeClient}_${intake.product}_Proposal_DRAFT.${ext}`;
    const storagePath = `${data.bidId}/proposals/${filename}`;

    console.log("[generateProposalFn] phase4 — uploading to storage:", storagePath, "size:", outputBuffer.length);
    const { error: storageErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .upload(storagePath, outputBuffer, { contentType, upsert: true });
    if (storageErr) console.error("[generateProposalFn] storage upload error:", storageErr);

    const { data: insertedDoc } = await (supabaseAdmin.from("bid_documents") as any).insert({
      bid_id: data.bidId,
      name: filename,
      type: "proposal",
      stage: null,
      storage_path: storagePath,
      size_bytes: outputBuffer.length,
      uploaded_by: user.id,
      source: "generated",
    }).select("id").single();

    if (insertedDoc?.id) {
      indexDocument({ data: { documentId: insertedDoc.id } }).catch((err) =>
        console.error("[generate-proposal] indexDocument failed:", err)
      );
    }

    const { data: signedData } = await supabaseAdmin.storage
      .from("bid-documents")
      .createSignedUrl(storagePath, 120);

    console.log("[generateProposalFn] done — signedUrl:", signedData?.signedUrl ? "generated" : "null", "filename:", filename);
    return new Response(
      JSON.stringify({ downloadUrl: signedData?.signedUrl ?? null, filename }),
      { headers: { "Content-Type": "application/json" } }
    );
  });
