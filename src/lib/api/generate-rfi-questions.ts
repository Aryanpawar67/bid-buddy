import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ChunkRow = { chunk_id?: string; doc_name: string; chunk_text: string };

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Voyage embed error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function searchChunks(query: string, bidId: string, topK = 6): Promise<ChunkRow[]> {
  try {
    const embedding = await embedText(query);
    const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 20,
      min_similarity: 0.3,
    });
    return ((data ?? []) as ChunkRow[]).slice(0, topK);
  } catch {
    try {
      const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
        query_text: query,
        query_embedding: JSON.stringify(new Array(1024).fill(0)),
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

function dedupeChunks(batches: ChunkRow[][]): ChunkRow[] {
  const seen = new Set<string>();
  const out: ChunkRow[] = [];
  for (const batch of batches) {
    for (const c of batch) {
      const key = c.chunk_id ?? `${c.doc_name}::${c.chunk_text.slice(0, 80)}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}

function formatContext(chunks: ChunkRow[]): string {
  return chunks.map((c) => `[${c.doc_name}]\n${c.chunk_text}`).join("\n---\n");
}

export const RFI_CATEGORIES = [
  "Integration & Technical",
  "Security & Compliance",
  "Scope & Delivery",
  "Commercial & Legal",
  "Stakeholder & Governance",
  "Product Fit",
] as const;

export type RfiCategory = (typeof RFI_CATEGORIES)[number];

export interface RfiQuestion {
  category: RfiCategory;
  question: string;
}

const OutputSchema = z.object({
  questions: z
    .array(
      z.object({
        category: z.enum(RFI_CATEGORIES),
        question: z.string().min(10),
      })
    )
    .min(1)
    .max(20),
});

function buildPrompt(bid: { client_name: string; type?: string; value?: number }, contextText: string): string {
  return `You are an experienced iMocha pre-sales professional writing a formal clarification letter to ${bid.client_name}.

iMocha platform — core capabilities:
- Skills Assessments (TA): pre-hire and internal assessments, 3000+ skills, 25+ languages
- Skills Intelligence (TM): skill gap analysis, workforce planning, internal mobility
- Integrations: Workday, SuccessFactors, Oracle HCM, SAP, MS Teams, Slack — SSO (SAML/OIDC), SCIM, REST API
- Compliance: SOC2 Type II, ISO 27001, GDPR-ready, configurable data residency

CONTEXT (use to inform the questions — do NOT cite this in the questions):
${contextText || "No documents uploaded — generate questions typical for an enterprise skills assessment procurement."}

Generate up to 20 targeted clarification questions that iMocha must have answered before drafting a proposal.
HARD LIMIT: never exceed 20 questions total. Do not pad to reach 20 — only include questions that are genuinely necessary given the client's documents. Fewer is better than generic. Rank by priority: questions that block the proposal scope or commercial terms come first.

CRITICAL LANGUAGE RULES — violations will be rejected:
1. PERSPECTIVE (most important): Every question must be iMocha asking the customer for information. The subject of every question is the customer's requirement, environment, preference, or expected behaviour — never iMocha's features or capabilities.
   Wrong: "Does iMocha support SAML 2.0?" / "Can iMocha integrate with our ATS?" / "Is iMocha SOC 2 certified?"
   Right: "Could you confirm whether SAML 2.0 or OIDC is required for SSO integration?" / "Could you confirm which ATS platform is currently in use?"
   If a question asks about iMocha, reframe it as: what does the customer require, use, or expect — then ask that.
2. NEVER start a question with "The RFP/RFI/document references...", "As stated in...", "The document mentions...", "Based on the RFP...", "The evaluation criteria...", or any phrase that cites a document or source.
3. Write each question as a natural, direct inquiry — as a knowledgeable professional would ask it in a meeting or letter, without referencing where you read the requirement.
4. Wrong: "The RFP references 'UAE data hosting' as a scored requirement. Could you confirm..."
   Right: "Could you confirm whether UAE-based data residency is a mandatory pass/fail requirement or an evaluation preference?"
5. Wrong: "The evaluation criteria award four points for competency framework mapping — could DET share..."
   Right: "Would you be able to share the existing behavioural and technical competency frameworks so iMocha can assess mapping coverage?"
6. Use "we understand", "we'd like to confirm", "could you confirm", "would you be able to share" — never attribute the question to a document, and never imply the customer is asking iMocha anything.

CONTENT RULES:
- Specific — informed by the context above, not generic boilerplate
- Actionable — the answer directly affects iMocha's proposed solution, integration plan, or commercial terms
- Professional — suitable for a formal clarification letter sent to the client
- Cover as many of the 6 categories as the document warrants; do not force questions into a category just to fill it

Categories: ${RFI_CATEGORIES.join(" | ")}

Return ONLY valid JSON — no markdown fences, no explanation:
{ "questions": [{ "category": "...", "question": "..." }, ...] }`;
}

export const generateRfiQuestionsFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    const token = getRequest().headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { bidId } = data;
    const { data: bid } = await (supabaseAdmin as any)
      .from("bids")
      .select("client_name, type, value")
      .eq("id", bidId)
      .single();
    if (!bid) throw new Error("Bid not found");

    // 4 parallel RAG searches — match_bid_id includes bid docs + global iMocha KB
    const [a, b, c, d] = await Promise.all([
      searchChunks("HRMS LMS SSO SAML API integration connector requirements", bidId, 6),
      searchChunks("security compliance data residency GDPR certifications privacy", bidId, 6),
      searchChunks("project scope timeline user volume assessment deliverables milestones", bidId, 6),
      searchChunks("evaluation criteria budget pricing commercial contract terms", bidId, 6),
    ]);

    const contextText = formatContext(dedupeChunks([a, b, c, d]));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: buildPrompt(bid, contextText) }],
    });

    const raw = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("");
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = OutputSchema.parse(JSON.parse(cleaned));

    return { questions: parsed.questions };
  });

// ── regenerateRfiCategoryFn — regenerate questions for a single category ───────

const CATEGORY_QUERIES: Record<string, string> = {
  "Integration & Technical": "HRMS LMS SSO SAML API integration connector requirements",
  "Security & Compliance": "security compliance data residency GDPR certifications privacy",
  "Scope & Delivery": "project scope timeline user volume assessment deliverables milestones",
  "Commercial & Legal": "evaluation criteria budget pricing commercial contract terms",
  "Stakeholder & Governance": "governance stakeholders decision makers approval process",
  "Product Fit": "product requirements features evaluation criteria skills assessment",
};

export const regenerateRfiCategoryFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string; category: string } }) => {
    const token = getRequest().headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { bidId, category } = data;
    const { data: bid } = await (supabaseAdmin as any)
      .from("bids")
      .select("client_name, type, value")
      .eq("id", bidId)
      .single();
    if (!bid) throw new Error("Bid not found");

    const query = CATEGORY_QUERIES[category] ?? category;
    const chunks = await searchChunks(query, bidId, 6);
    const contextText = formatContext(chunks);

    const SingleSchema = z.object({
      questions: z.array(z.object({
        category: z.string(),
        question: z.string().min(10),
      })).min(1).max(1),
    });

    const prompt = `You are an experienced iMocha pre-sales professional writing a formal clarification letter to ${bid.client_name}.

iMocha platform: Skills Assessments (TA), Skills Intelligence (TM), integrations (Workday, SAP, SSO/SAML/SCIM), SOC2 Type II / ISO 27001.

CONTEXT:
${contextText || "No documents uploaded — use typical enterprise procurement knowledge."}

Generate exactly 1 targeted clarification question for the "${category}" category.
It must be the single most important unanswered question in this category given the context above — specific, actionable, and directly relevant to iMocha's proposal.

RULES:
1. PERSPECTIVE (most important): iMocha is asking the customer for information. The question must be about the customer's requirement, environment, or preference — never about iMocha's capabilities. Wrong: "Does iMocha support X?" Right: "Could you confirm whether X is required?"
2. NEVER reference documents: no "The RFP states…", "As mentioned…", "Based on the document…"
3. Write as a knowledgeable professional asking directly in a meeting or letter
4. Use "we understand", "we'd like to confirm", "could you confirm", or "would you be able to share"

Return ONLY valid JSON — no markdown fences:
{ "questions": [{ "category": "${category}", "question": "..." }] }`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = resp.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = SingleSchema.parse(JSON.parse(cleaned));

    return { questions: parsed.questions };
  });
