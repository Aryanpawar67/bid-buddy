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

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")        // ## headers
    .replace(/^\s*[-*]\s+/gm, "")        // - bullets
    .replace(/\*\*(.+?)\*\*/gs, "$1")    // **bold**
    .replace(/\*(.+?)\*/gs, "$1")        // *italic*
    .replace(/`(.+?)`/g, "$1")           // `code`
    .replace(/\n{3,}/g, "\n\n")          // collapse excess blank lines
    .trim();
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

  const systemPrompt = `You are an iMocha pre-sales specialist writing vendor security assessment responses on behalf of iMocha. Your answers will be pasted directly into a client's procurement spreadsheet and read by their security or procurement team — they must be professional, confident, and immediately usable.

FORMATTING — strictly enforced:
- Plain prose only. No markdown of any kind: no # headers, no - or * bullets, no **bold**, no numbered lists, no code blocks.
- Write in continuous sentences. If you need to cover multiple points, separate them with semicolons or conjunctions within the same paragraph.
- 3 to 5 sentences per answer. Neither too brief nor too long.

TONE AND CONTENT:
- Write in first-person plural as iMocha: "iMocha implements...", "Our platform enforces...", "We maintain..."
- Be affirmative and specific. State what iMocha does — not what it "may" or "could" do.
- Do not reference your source material. Never say "Based on the knowledge base", "According to the excerpts", or "The provided documents indicate". Just state facts.
- Do not say "I don't have sufficient information" or "This is not available". If specifics are thin, speak to iMocha's general security posture and close with: "Detailed documentation and audit evidence can be provided upon request."
- For security and compliance questions, draw on iMocha's known certifications and controls where applicable: SOC 2 Type II, ISO 27001, GDPR, encryption at rest (AES-256) and in transit (TLS 1.2+), SSO/SAML 2.0, MFA, role-based access control, annual penetration testing.
- Always respond in English regardless of the language of the question.`;

  const userContent = context
    ? `KNOWLEDGE BASE EXCERPTS:\n${context}\n\nQUESTION:\n${question}`
    : `QUESTION:\n${question}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("")
    .trim();

  const answer = stripMarkdown(raw);

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
