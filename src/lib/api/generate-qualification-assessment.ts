import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Criteria match DEFAULT_CRITERIA in DealQualificationWorkspace
const CRITERIA = [
  { id: "strategic_fit",    parameter: "Strategic Opportunity Fit",                   focus: "Does this opportunity align with iMocha's core offerings (Skills Intelligence, Assessments, Internal Mobility, Workforce Planning)?",  weight: 0.15 },
  { id: "business_problem", parameter: "Business Problem Clarity",                    focus: "Is the client's business challenge clearly defined with measurable outcomes? Can iMocha solve it?",                                    weight: 0.10 },
  { id: "use_case",         parameter: "Use Case Alignment",                          focus: "Are the requested use cases directly supported by iMocha capabilities without major customisation?",                                   weight: 0.10 },
  { id: "stakeholder",      parameter: "Customer Stakeholder & Decision Readiness",   focus: "Executive sponsor identified? Decision makers engaged? Procurement-only or business-led?",                                             weight: 0.10 },
  { id: "commercial",       parameter: "Commercial Attractiveness",                   focus: "Deal size, expansion potential, ARR opportunity, strategic logo value, long-term revenue potential.",                                  weight: 0.10 },
  { id: "competitive",      parameter: "Competitive Position",                        focus: "Does iMocha have clear differentiators? Incumbents, competitor strengths, evaluation criteria understood?",                            weight: 0.10 },
  { id: "implementation",   parameter: "Implementation Feasibility",                  focus: "Can iMocha deliver within the expected timeline, considering resources, integrations, and complexity?",                                weight: 0.10 },
  { id: "technical",        parameter: "Technical & Security Fit",                    focus: "API readiness, SSO, HRMS/LMS integration, security/compliance requirements, hosting feasibility.",                                    weight: 0.10 },
  { id: "proposal_risk",    parameter: "Proposal Risk Assessment",                    focus: "Scope ambiguity, unrealistic timelines, missing information, customisation risk, contractual risks.",                                  weight: 0.10 },
  { id: "value_realization",parameter: "Value Realization & Expansion Potential",     focus: "Can this generate measurable business outcomes and open doors for future use cases or geographies?",                                   weight: 0.05 },
] as const;

type CriterionId = typeof CRITERIA[number]["id"];

// ── RAG helpers (same pattern as generate-proposal.ts) ─────────────────────────

type ChunkRow = { chunk_id?: string; doc_name: string; chunk_text: string };

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

function dedupeChunks(batches: ChunkRow[][]): ChunkRow[] {
  const seen = new Set<string>();
  const result: ChunkRow[] = [];
  for (const batch of batches) {
    for (const chunk of batch) {
      const key = chunk.chunk_id ?? `${chunk.doc_name}::${chunk.chunk_text.slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(chunk);
      }
    }
  }
  return result;
}

function formatContext(chunks: ChunkRow[]): string {
  return chunks
    .map((c) => `[${c.doc_name}]\n${c.chunk_text}`)
    .join("\n---\n");
}

// ── Output schema ───────────────────────────────────────────────────────────────

const ScoreSchema = z.record(z.number().int().min(1).max(5));
const RationaleSchema = z.record(z.string());
const InsightsSchema = z.object({
  strengths: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  recommendation: z.string(),
});

const AssessmentOutputSchema = z.object({
  scores: ScoreSchema,
  rationales: RationaleSchema,
  insights: InsightsSchema,
});

const CRITERION_IDS = CRITERIA.map((c) => c.id).join(", ");

function buildAuthorPrompt(
  bid: { client_name: string; title: string; type: string; value: number; priority: string },
  contextText: string,
): string {
  const criteriaBlock = CRITERIA.map((c, i) =>
    `${i + 1}. "${c.id}" — ${c.parameter}\n   Focus: ${c.focus}`,
  ).join("\n");

  return `You are a senior bid qualification analyst at iMocha, a Skills Intelligence platform.

Your task: score a new sales opportunity across 10 qualification parameters, using ONLY the customer documents and iMocha knowledge base context provided below. Do not invent information not present in the documents.

## Bid Details
- Client: ${bid.client_name}
- Opportunity: ${bid.title}
- Type: ${bid.type.toUpperCase()}
- Value: $${(bid.value ?? 0).toLocaleString()}
- Priority: ${bid.priority}

## Customer Documents + iMocha Knowledge Base
${contextText || "(No documents indexed for this bid — score 0 for all criteria and flag as information gaps)"}

## Qualification Criteria
${criteriaBlock}

## Output Format
Return a single JSON object with exactly this structure — no markdown, no explanation:
{
  "scores": {
    ${CRITERION_IDS.split(", ").map((id) => `"${id}": <integer 1–5>`).join(",\n    ")}
  },
  "rationales": {
    ${CRITERION_IDS.split(", ").map((id) => `"${id}": "<one sentence citing specific evidence from the documents>"`).join(",\n    ")}
  },
  "insights": {
    "strengths": ["<3–5 specific strengths referencing high-scoring criteria>"],
    "risks": ["<3–5 specific risks or gaps referencing low-scoring or absent criteria>"],
    "recommendation": "<2–3 sentence executive recommendation>"
  }
}

Rules:
- Score 1–5: 5 = strong evidence, 3 = partial evidence, 1 = little/no evidence
- Use score 0 ONLY if no information exists; explain as "Insufficient information in provided documents."
- Keep rationale to one sentence; cite the specific document or requirement where possible
- Strengths should reference criteria scored ≥ 4; risks should reference criteria scored ≤ 3 or 0
- Return ONLY the JSON — no fences, no extra text`;
}

// ── Server function ─────────────────────────────────────────────────────────────

export const generateQualificationAssessmentFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    try {
      const authHeader = getRequest().headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "");
      if (!token) throw new Error("Unauthorized");

      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !user) throw new Error(`Auth failed: ${authErr?.message}`);

      // Fetch bid metadata + existing assessment_data (to preserve user comments)
      const { data: bid, error: bidErr } = await supabaseAdmin
        .from("bids")
        .select("client_name, title, type, value, priority, assessment_data")
        .eq("id", data.bidId)
        .maybeSingle();
      if (bidErr || !bid) throw new Error(`Bid not found: ${bidErr?.message}`);

      const existingData = (bid as any).assessment_data as {
        comments?: Record<string, string>;
      } | null ?? {};

      // 4 parallel RAG searches covering the 10 criteria themes
      const [productChunks, problemChunks, techChunks, commercialChunks] = await Promise.all([
        searchChunks("iMocha skills assessment capabilities use case strategic fit workforce transformation goals", data.bidId, 6),
        searchChunks("customer requirements business problem pain points challenges needs evaluation criteria", data.bidId, 6),
        searchChunks("technical requirements integration API HRMS LMS security compliance hosting data", data.bidId, 6),
        searchChunks("stakeholder decision maker budget commercial deal value competitive alternatives incumbent pricing", data.bidId, 6),
      ]);

      const allChunks = dedupeChunks([productChunks, problemChunks, techChunks, commercialChunks]);
      const contextText = formatContext(allChunks);

      // Author with Sonnet
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: buildAuthorPrompt(bid as any, contextText) }],
      });

      const rawText = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.Messages.TextBlock).text)
        .join("");

      // Parse + validate + backfill
      let parsed: z.infer<typeof AssessmentOutputSchema>;
      try {
        const cleaned = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
        const raw = JSON.parse(cleaned);
        const result = AssessmentOutputSchema.safeParse(raw);
        if (result.success) {
          parsed = result.data;
        } else {
          // Partial parse: use what we have and backfill missing criteria
          parsed = {
            scores: raw.scores ?? {},
            rationales: raw.rationales ?? {},
            insights: raw.insights ?? { strengths: [], risks: [], recommendation: "" },
          };
        }
      } catch {
        throw new Error("Failed to parse AI assessment response");
      }

      // Backfill any missing criteria
      const scores: Record<string, number> = {};
      const rationales: Record<string, string> = {};
      for (const c of CRITERIA) {
        const score = parsed.scores[c.id];
        scores[c.id] = typeof score === "number" && score >= 1 && score <= 5 ? score : 0;
        rationales[c.id] = parsed.rationales[c.id] ?? "Insufficient information in provided documents.";
      }

      const now = new Date().toISOString();
      const updated = {
        // Preserve user-entered notes; overwrite AI fields
        comments: (existingData as any).comments ?? {},
        scores,
        rationales,
        ai_scored: true,
        ai_scored_at: now,
        insights: {
          strengths: parsed.insights.strengths,
          risks: parsed.insights.risks,
          recommendation: parsed.insights.recommendation,
          generated_at: now,
        },
      };

      await supabaseAdmin
        .from("bids")
        .update({ assessment_data: updated } as never)
        .eq("id", data.bidId);

      return updated;
    } catch (e) {
      console.error("[qual-assessment] error:", e);
      throw e;
    }
  });
