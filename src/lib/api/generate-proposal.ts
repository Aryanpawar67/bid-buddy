import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  bidId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

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

// ── Intake schema ──────────────────────────────────────────────────────────────
type Intake = {
  product: "TA" | "TM";
  rfp_name: string;
  customer_display_name: string;
  prepared_for: string;
  spoc_name: string;
  spoc_email: string;
  exec_summary: { pleased: string; aligned: string; confident: string };
  scope_intro: string;
  deliverables: string[];
};

// ── Substitution helpers ───────────────────────────────────────────────────────
function applySubstitutions(xml: string, intake: Intake): string {
  const subs: [string, string][] = [
    ["Customer Name (CUSTOMER NAME)", intake.customer_display_name],
    ["&lt;RFP Name&gt;", intake.rfp_name],
    ["&lt;Customer Name&gt;", intake.customer_display_name],
    ["CUSTOMER NAME", intake.customer_display_name],
    ["&lt;Sales spoc name&gt;", intake.spoc_name],
    ["Sales email id", intake.spoc_email],
    ["&lt;How we are pleased to provide the solution&gt;", intake.exec_summary.pleased],
    ["&lt;How we are aligned with customer goals and their requirement&gt;", intake.exec_summary.aligned],
    ["&lt;How confident we are to deliver value&gt;", intake.exec_summary.confident],
    ["&lt;How scope is aligned to what iMocha can deliver&gt;", intake.scope_intro],
  ];

  let result = xml;
  for (const [token, value] of subs) {
    result = result.split(token).join(value);
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
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${nId}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`
    )
    .join("\n");
}

function injectDeliverables(xml: string, deliverables: string[]): string {
  const numId = discoverBulletNumId(xml);
  const bullets = buildBulletParagraphs(deliverables, numId);

  const headingMarker = "2.1 In scope Key Deliverables";
  const headingIdx = xml.indexOf(headingMarker);
  if (headingIdx === -1) {
    return xml.replace("</w:body>", `${bullets}</w:body>`);
  }

  const headingParaEnd = xml.indexOf("</w:p>", headingIdx) + "</w:p>".length;
  return xml.slice(0, headingParaEnd) + "\n" + bullets + xml.slice(headingParaEnd);
}

function applyHeaderFooterSubstitutions(xml: string, intake: Intake): string {
  return xml
    .split("&lt;Customer Name&gt;").join(intake.customer_display_name)
    .split("&lt;RFP Name&gt;").join(intake.rfp_name)
    .split("CUSTOMER NAME").join(intake.customer_display_name);
}

// ── System blocks for proposal authoring ──────────────────────────────────────
async function buildProposalSystemBlocks(
  bidId: string
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, stage, deadline")
    .eq("id", bidId)
    .single();

  const { data: questions } = await supabaseAdmin
    .from("bid_questions")
    .select("question_text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("label, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  const parts: string[] = [
    "You are the iMocha proposal author assistant.",
    "Author variable content for an iMocha branded proposal based on the bid context below.",
    "Every claim must come from the provided context — do not invent capabilities, statistics, or certifications.",
    "",
  ];

  if (bid) {
    parts.push("## Bid Context");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase() ?? "RFP"}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    parts.push("");
  }

  if (questions?.length) {
    parts.push("## Bid Questions (requirements)");
    for (const q of questions) parts.push(`- ${q.question_text}`);
    parts.push("");
  }

  if (deliverables?.length) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- ${d.label}`);
    parts.push("");
  }

  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}

// ── Main server function ───────────────────────────────────────────────────────
export const generateProposalFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    // ── Phase 1: Author via Haiku ─────────────────────────────────────────────
    const systemBlocks = await buildProposalSystemBlocks(data.bidId);

    const intakePrompt = `Based on the bid context in your system blocks, author the variable content for an iMocha proposal.

Output a single valid JSON object with this exact schema (no markdown, no code blocks, no extra text):
{
  "product": "TA or SI — TA for hiring/recruitment/assessment, SI for skills/competency/workforce",
  "rfp_name": "bid title + iMocha Proposal",
  "customer_display_name": "client name as it should appear throughout",
  "prepared_for": "[TO PROVIDE: contact name & title]",
  "spoc_name": "[TO PROVIDE: Sales SPOC name]",
  "spoc_email": "[TO PROVIDE: Sales SPOC email]",
  "exec_summary": {
    "pleased": "Paragraph 1: introduce iMocha TA or SI as recommended platform for this client",
    "aligned": "Paragraph 2: restate client requirements from context; note any exclusions",
    "confident": "Paragraph 3: proof points — Azure SaaS, ISO 27001, SOC 2 Type II, 99.9% SLA, named integrations, commercial model"
  },
  "scope_intro": "One paragraph: in-scope work + closing sentence with explicit exclusions",
  "deliverables": ["8 to 12 bullets mapping bid requirements to iMocha capabilities"]
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const authorResp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemBlocks,
      messages: [{ role: "user", content: intakePrompt }],
    });

    const rawText = authorResp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.Messages.TextBlock).text)
      .join("");

    let intake: Intake;
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
    if (!Array.isArray(intake.deliverables) || intake.deliverables.length === 0) {
      intake.deliverables = ["[TO PROVIDE: deliverables]"];
    }

    // ── Phase 2: Assemble DOCX ────────────────────────────────────────────────
    const templateFilename = intake.product === "TM" ? TM_TEMPLATE : TA_TEMPLATE;
    const templateBuffer = await getTemplateBuffer(templateFilename);

    const zip = await JSZip.loadAsync(templateBuffer);

    const docXml = await zip.file("word/document.xml")!.async("string");
    let editedDocXml = applySubstitutions(docXml, intake);
    editedDocXml = injectDeliverables(editedDocXml, intake.deliverables);
    zip.file("word/document.xml", editedDocXml);

    for (const filename of Object.keys(zip.files)) {
      if (
        (filename.startsWith("word/header") || filename.startsWith("word/footer")) &&
        filename.endsWith(".xml")
      ) {
        const hfXml = await zip.file(filename)!.async("string");
        zip.file(filename, applyHeaderFooterSubstitutions(hfXml, intake));
      }
    }

    const docxBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // ── Phase 3: Upload to Knowledge Hub ─────────────────────────────────────
    const safeClient = intake.customer_display_name.replace(/[^a-z0-9]/gi, "_");
    const filename = `iMocha_${safeClient}_${intake.product}_Proposal_DRAFT.docx`;
    const storagePath = `${data.bidId}/proposals/${filename}`;

    const { error: storageErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .upload(storagePath, docxBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (storageErr) console.error("[generate-proposal] storage upload error:", storageErr);

    await (supabaseAdmin.from("bid_documents") as any).insert({
      bid_id: data.bidId,
      name: filename,
      type: "proposal",
      stage: null,
      storage_path: storagePath,
      size_bytes: docxBuffer.length,
      uploaded_by: user.id,
      source: "generated",
    });

    return new Response(docxBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Open-Items": JSON.stringify([
          "prepared_for — contact name & title not set (fill in DOCX cover page)",
          "spoc_name — sales SPOC name not set (fill in DOCX cover page)",
          "spoc_email — sales SPOC email not set (fill in DOCX cover page)",
          `Template used: ${templateFilename}`,
        ]),
      },
    });
  });
