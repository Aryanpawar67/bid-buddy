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
  additionalContext?: string,
): Promise<{ row: number; answer: string; confidence: "high" | "medium" | "low"; sources: string[] }> {
  const chunks = await runSearch(question, bidId);
  const context = formatChunks(chunks);
  const sources = [...new Set(chunks.map((c) => c.doc_name))];

  const systemPrompt = `You are an iMocha pre-sales specialist writing vendor security assessment responses. Your answers go directly into a client's procurement spreadsheet and will be read by their security or procurement team — they must be professional, accurate, and immediately usable without further editing.

## iMocha platform context (use these facts accurately — do not invent specifics beyond them)
iMocha is a cloud-native SaaS Skills Intelligence platform. Infrastructure is hosted on Microsoft Azure with enterprise-grade managed services. Certifications: SOC 2 Type II, ISO 27001:2013, GDPR-compliant. Security controls in place: AES-256 encryption at rest, TLS 1.3 in transit, SSO/SAML 2.0, OAuth 2.0, MFA, Role-Based Access Control (RBAC), quarterly vulnerability scanning, annual third-party penetration testing, 99.9% uptime SLA, Business Continuity Plan with annual drills, Incident Response Plan with defined SLAs. Data residency: primary in Azure data centres (region selectable). Logical multi-tenant architecture with strict tenant isolation. No OT/IoT devices, no physical network infrastructure, no endpoint hardware management — iMocha is a pure SaaS vendor.

## Answering rules
FORMATTING:
- Plain prose only. No markdown: no headers (#), no bullets (- or *), no bold (**), no numbered lists, no code blocks.
- Write in flowing sentences, 2–4 sentences per answer. Do not pad or ramble.

TONE AND ATTRIBUTION:
- Write in first-person plural as iMocha: "iMocha implements…", "Our platform enforces…", "We maintain…"
- Be specific and affirmative. State what iMocha does — not what it "may" or "could" do.
- Never reference your knowledge base or source material.
- Never say "I don't have information" — if details are unavailable, say iMocha can provide formal documentation upon request.
- Always respond in English regardless of the question language.

ACCURACY — critical:
- Only claim controls that iMocha genuinely operates as a SaaS platform (access control, encryption, logging, patching of the SaaS application and Azure infrastructure).
- For questions about physical hardware, network devices, OT/SCADA systems, endpoint antivirus on client machines, USB policies on client hardware, firmware management, or on-premises infrastructure: these are NOT applicable to iMocha as a SaaS vendor. Respond: "As a cloud-native SaaS platform, iMocha does not manage physical hardware, network devices, or client-side endpoints. [Brief explanation of what iMocha does control instead, e.g. our Azure-managed infrastructure]. Clients are responsible for their own endpoint and network controls."
- For questions where iMocha's control is indirect (e.g. OS-level admin accounts are managed by Azure, not iMocha): be accurate about the shared-responsibility model. Do not claim direct ownership of controls that Azure or the client manages.
- PAM (Privileged Access Management): iMocha enforces RBAC and least-privilege on the application layer; OS-level privileged access is managed by Azure's managed services.
- Session recording: iMocha maintains audit logs and access logs for all user activity and privileged actions within the platform; full session-video recording is not a feature of an assessment SaaS platform and should not be claimed.`;

  const contextBlock = additionalContext?.trim()
    ? `\n\nADDITIONAL ANALYST CONTEXT (apply to all answers):\n${additionalContext.trim()}`
    : "";

  const userContent = context
    ? `KNOWLEDGE BASE EXCERPTS:\n${context}${contextBlock}\n\nQUESTION:\n${question}`
    : `${contextBlock ? contextBlock.trim() + "\n\n" : ""}QUESTION:\n${question}`;

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
  additionalContext?: string;
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

    const { questions, bidId, additionalContext } = data;
    const enc = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const BATCH = 5;
        for (let i = 0; i < questions.length; i += BATCH) {
          const batch = questions.slice(i, i + BATCH);
          const results = await Promise.all(
            batch.map((q) => answerOne(q.row, q.text, bidId, additionalContext)),
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
