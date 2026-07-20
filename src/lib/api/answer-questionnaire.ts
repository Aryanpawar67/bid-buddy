import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

async function runSearch(query: string, bidId: string | null): Promise<ChunkRow[]> {
  try {
    const embedding = await embedText(query);
    const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 50,
      min_similarity: 0.35,
    });
    const candidates = (data ?? []) as ChunkRow[];
    // lightweight rerank: just slice top-8 by RRF score (already sorted by RPC)
    return candidates.slice(0, 8);
  } catch {
    try {
      const zero = JSON.stringify(new Array(1024).fill(0));
      const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
        query_text: query,
        query_embedding: zero,
        match_bid_id: bidId,
        match_count: 8,
        semantic_weight: 0,
      });
      return ((data ?? []) as ChunkRow[]).slice(0, 8);
    } catch {
      return [];
    }
  }
}

function formatChunks(chunks: ChunkRow[]): string {
  if (!chunks.length) return "";
  return chunks.map((c) => `[${c.doc_name}]\n${c.chunk_text}`).join("\n---\n");
}

function confidenceFor(chunkCount: number): "high" | "medium" | "low" {
  if (chunkCount >= 3) return "high";
  if (chunkCount >= 1) return "medium";
  return "low";
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function answerOne(
  row: number,
  question: string,
  bidId: string | null,
): Promise<{ row: number; answer: string; confidence: "high" | "medium" | "low"; sources: string[] }> {
  const chunks = await runSearch(question, bidId);
  const context = formatChunks(chunks);
  const sources = [...new Set(chunks.map((c) => c.doc_name))];

  const systemPrompt = context
    ? `You are an iMocha RFP response specialist. Answer the vendor assessment question below using ONLY the knowledge base excerpts provided. Be specific, factual, and concise (2–4 sentences). If the excerpts don't fully cover the question, answer what you can from them and note any gaps briefly.`
    : `You are an iMocha RFP response specialist. No knowledge base content was retrieved for this question. Provide a short, honest placeholder answer based on iMocha's general product capabilities (TA: assessments, AI interviews, ATS integrations; TM: skills intelligence, competency management, HRIS integrations; both: SOC2 Type II, ISO 27001, SSO/SAML, REST API). Keep it to 2 sentences and note that detailed confirmation is required.`;

  const userContent = context
    ? `KNOWLEDGE BASE EXCERPTS:\n${context}\n\nVENDOR ASSESSMENT QUESTION:\n${question}`
    : `VENDOR ASSESSMENT QUESTION:\n${question}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const answer = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  return { row, answer, confidence: confidenceFor(chunks.length), sources };
}

export type AnswerQuestionnaireInput = {
  questions: { row: number; text: string }[];
  bidId: string | null;
};

export const answerQuestionnaireFn = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: AnswerQuestionnaireInput }) => {
    const token =
      getRequest().headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { questions, bidId } = data;
    const enc = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const BATCH = 5;
        for (let i = 0; i < questions.length; i += BATCH) {
          const batch = questions.slice(i, i + BATCH);
          const results = await Promise.all(
            batch.map((q) => answerOne(q.row, q.text, bidId)),
          );
          for (const r of results) {
            controller.enqueue(enc.encode(JSON.stringify(r) + "\n"));
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    });
  },
);
