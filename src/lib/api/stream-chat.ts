import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { AzureOpenAI } from "openai";
import type OpenAI from "openai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "azure-gpt-5.4",
] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

function isAzureModel(model: AllowedModel): boolean {
  return model.startsWith("azure-");
}

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

// ── helpers ────────────────────────────────────────────────────────────────────

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

type ChunkRow = { doc_name: string; chunk_text: string };

async function rerank(query: string, chunks: ChunkRow[]): Promise<ChunkRow[]> {
  if (!chunks.length) return chunks;
  try {
    const resp = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "rerank-2.5",
        query,
        documents: chunks.map((c) => c.chunk_text),
        top_k: 8,
      }),
    });
    if (!resp.ok) throw new Error(`Rerank error: ${resp.status}`);
    const json = (await resp.json()) as { data: { index: number }[] };
    return json.data.map((d) => chunks[d.index]);
  } catch {
    // Rerank failure → fall back to RRF order, slice top-8
    return chunks.slice(0, 8);
  }
}

async function runSearch(query: string, bidId: string | null): Promise<ChunkRow[]> {
  try {
    const embedding = await embedText(query);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 50,
      min_similarity: 0.4,
    });
    const candidates = (data ?? []) as ChunkRow[];
    return await rerank(query, candidates);
  } catch {
    // Voyage down → try FTS-only with zero vector, skip rerank
    try {
      const zero = JSON.stringify(new Array(1024).fill(0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabaseAdmin.rpc as any)("hybrid_search_chunks", {
        query_text: query,
        query_embedding: zero,
        match_bid_id: bidId,
        match_count: 8,
        semantic_weight: 0,
      });
      return (data ?? []) as ChunkRow[];
    } catch {
      return [];
    }
  }
}

function formatChunks(chunks: ChunkRow[]): string {
  if (!chunks.length) return "No relevant passages found for that query.";
  return chunks.map((c) => `[${c.doc_name}]\n${c.chunk_text}`).join("\n---\n");
}

// Status line sentinel — ASCII Unit Separator (0x1F), never appears in prose.
function statusLine(kind: string, detail: string): Uint8Array {
  return new TextEncoder().encode(
    `\x1fSTATUS\x1f${JSON.stringify({ kind, query: detail })}\n`
  );
}

// ── system prompt builder ──────────────────────────────────────────────────────

async function buildSystemBlocks(
  bidId: string | null
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const persona = [
    "You are an expert bid strategy assistant for iMocha's pre-sales team.",
    "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
    "Be concise, strategic, and specific to the context provided.",
    "When you use a document passage, name its source document.",
    "",
  ];

  if (!bidId) {
    return [{ type: "text", text: persona.join("\n"), cache_control: { type: "ephemeral" } }];
  }

  const parts = [...persona];

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
    .select("question_text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (questions?.length) {
    parts.push("## Bid Questions");
    for (const q of questions) parts.push(`- [${q.stage}] ${q.question_text}`);
    parts.push("");
  }

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("label, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (deliverables?.length) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- [${d.stage}] ${d.label}`);
    parts.push("");
  }

  // cache_control on the last block caches tools + system together
  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}

// ── tool definition ────────────────────────────────────────────────────────────

const SEARCH_TOOL: Anthropic.Messages.Tool = {
  name: "search_knowledge_base",
  description:
    "Search the indexed bid documents (RFPs, proposals, legal docs, templates, reference material) for passages relevant to a query. " +
    "Call this whenever answering requires specifics from the documents — requirements, pricing, dates, compliance clauses, scope, prior-proposal language. " +
    "You may call it multiple times to decompose a complex question or follow up after seeing initial results. " +
    "Do NOT call it for general strategy questions answerable from the bid metadata already provided in your context. " +
    "Returns the most relevant passages with their source document names for citation.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "A focused, self-contained search query. Rewrite conversational follow-ups into standalone queries (resolve pronouns and ellipsis from conversation context). Prefer specific terms over the user's verbatim phrasing.",
      },
    },
    required: ["query"],
  },
};

// ── server function ────────────────────────────────────────────────────────────

export const streamChatFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const systemBlocks = await buildSystemBlocks(data.bidId);

    type AnthropicMsg = Anthropic.Messages.MessageParam;
    const messages: AnthropicMsg[] = data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const MAX_ROUNDS = 3;

    const stream = new ReadableStream({
      async start(controller) {
        let rounds = 0;

        try {
          while (true) {
            const isLastRound = rounds >= MAX_ROUNDS;

            const apiStream = anthropic.messages.stream({
              model: data.model,
              max_tokens: 4096,
              thinking: { type: "adaptive" },
              system: systemBlocks,
              tools: isLastRound ? undefined : [SEARCH_TOOL],
              tool_choice: isLastRound ? undefined : undefined,
              messages,
            });

            // Stream text deltas immediately as they arrive
            for await (const event of apiStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                controller.enqueue(new TextEncoder().encode(event.delta.text));
              }
            }

            const final = await apiStream.finalMessage();

            if (final.stop_reason !== "tool_use" || isLastRound) {
              break;
            }

            // Handle tool calls
            messages.push({ role: "assistant", content: final.content });
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

            for (const block of final.content) {
              if (block.type !== "tool_use" || block.name !== "search_knowledge_base") continue;
              const query = (block.input as { query: string }).query;
              controller.enqueue(statusLine("search", query));
              const chunks = await runSearch(query, data.bidId);
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: formatChunks(chunks),
              });
            }

            messages.push({ role: "user", content: toolResults });
            rounds++;
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
