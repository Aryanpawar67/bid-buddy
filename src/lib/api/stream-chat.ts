import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  bidId: z.string().uuid().nullable(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      created_at: z.string(),
    })
  ),
  model: z.enum(ALLOWED_MODELS),
});

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Voyage error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function buildSystemPrompt(
  bidId: string,
  lastUserMessage: string
): Promise<string> {
  const parts: string[] = [
    "You are an expert bid strategy assistant for iMocha's pre-sales team.",
    "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
    "Be concise, strategic, and specific to the bid context provided.",
    "",
  ];

  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, status, stage, deadline, procurement_portal")
    .eq("id", bidId)
    .single();

  if (bid) {
    parts.push("## Active Bid Context");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase()}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    if (bid.procurement_portal) parts.push(`Portal: ${bid.procurement_portal}`);
    parts.push("");
  }

  const { data: questions } = await supabaseAdmin
    .from("bid_questions")
    .select("text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (questions && questions.length > 0) {
    parts.push("## Bid Questions");
    for (const q of questions) parts.push(`- [${q.stage}] ${q.text}`);
    parts.push("");
  }

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("title, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (deliverables && deliverables.length > 0) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- [${d.stage}] ${d.title}`);
    parts.push("");
  }

  // Skipped gracefully if VOYAGE_API_KEY absent or no indexed documents
  try {
    const embedding = await embedText(lastUserMessage);
    const { data: chunks } = await supabaseAdmin.rpc("match_bid_document_chunks", {
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 8,
    });
    if (chunks && chunks.length > 0) {
      parts.push("## Relevant Document Excerpts");
      for (const chunk of chunks as { chunk_text: string }[]) {
        parts.push(chunk.chunk_text);
        parts.push("---");
      }
      parts.push("");
    }
  } catch {
    // continue without doc chunks
  }

  return parts.join("\n");
}

export const streamChatFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    // Validate auth — rejects if no bearer token or token is invalid
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const lastUserMsg = [...data.messages].reverse().find((m) => m.role === "user");
    const systemPrompt =
      data.bidId && lastUserMsg
        ? await buildSystemPrompt(data.bidId, lastUserMsg.content)
        : "You are an expert bid strategy assistant for iMocha's pre-sales team. Help with RFP analysis, win themes, risk identification, and executive summaries.";

    const anthropicMessages = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = anthropic.messages.stream({
            model: data.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: anthropicMessages,
          });
          for await (const chunk of anthropicStream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    // Returning a Response causes TanStack Start to set x-tss-raw: true
    // and forward the raw streaming response to the client.
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
