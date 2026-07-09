import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import { AzureOpenAI } from "openai";
import type OpenAI from "openai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Fix 5: module-level singleton — one client object reused across all requests
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "azure-gpt-5.4",
  "azure-oss-120b",
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
  mentionedDocIds: z.array(z.string().uuid()).optional(),
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
  // Fix 4: nothing to reorder when candidates already fit within top_k
  if (chunks.length <= 8) return chunks;
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

async function fetchPinnedChunks(docIds: string[]): Promise<ChunkRow[]> {
  if (!docIds.length) return [];
  try {
    const { data } = await (supabaseAdmin
      .from("bid_document_chunks") as any)
      .select("chunk_text, document_id, bid_documents(name)")
      .in("document_id", docIds)
      .order("chunk_index", { ascending: true });
    return (data ?? []).map((r: any) => ({
      doc_name: r.bid_documents?.name ?? "Unknown",
      chunk_text: r.chunk_text,
    })) as ChunkRow[];
  } catch {
    return [];
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

const RFI_RFP_PERSONA = `You are the iMocha Sales Assistant. Answer RFP/RFI questions EXCLUSIVELY from 15 KB documents. You are a retrieval system — not an AI with general knowledge.

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

async function getActiveSystemPrompt(): Promise<string | null> {
  try {
    const { data } = await (supabaseAdmin as any)
      .from("prompt_versions")
      .select("prompt_text")
      .eq("is_active", true)
      .maybeSingle();
    return data?.prompt_text ?? null;
  } catch {
    return null;
  }
}

async function buildSystemBlocks(
  bidId: string | null
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const exportInstruction = 'When the user explicitly asks to export, download, or save the current response as a document, prepend your entire response with this exact line (replacing <suggested-name> with a descriptive filename, no spaces, no extension): \x1eEXPORT\x1e{"format":"docx","filename":"<suggested-name>.docx"}\n';

  if (!bidId) {
    // Fix 2: single query, no parallelism needed for global mode
    const activePrompt = await getActiveSystemPrompt();
    const basePersona = activePrompt ?? RFI_RFP_PERSONA;
    return [
      // Fix 1: persona alone in its own cached block — never invalidated by bid data changes
      { type: "text", text: basePersona, cache_control: { type: "ephemeral" } },
      { type: "text", text: exportInstruction },
    ];
  }

  // Fix 2: fetch all four data sources in parallel
  const [activePrompt, bidResult, questionsResult, deliverablesResult] = await Promise.all([
    getActiveSystemPrompt(),
    supabaseAdmin
      .from("bids")
      .select("client_name, title, type, value, status, stage, deadline, procurement_portal")
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
  ]);

  const basePersona = activePrompt ?? RFI_RFP_PERSONA;
  const bid = bidResult.data;
  const questions = questionsResult.data;
  const deliverables = deliverablesResult.data;

  // Build the dynamic bid context block (changes per bid/turn)
  const contextParts: string[] = [];
  if (bid) {
    contextParts.push("## Active Bid Context");
    contextParts.push(`Client: ${bid.client_name}`);
    contextParts.push(`Title: ${bid.title}`);
    contextParts.push(`Type: ${bid.type?.toUpperCase()}`);
    contextParts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    contextParts.push(`Stage: ${bid.stage}`);
    contextParts.push(`Deadline: ${bid.deadline}`);
    if (bid.procurement_portal) contextParts.push(`Portal: ${bid.procurement_portal}`);
    contextParts.push("");
  }
  if (questions?.length) {
    contextParts.push("## Bid Questions");
    for (const q of questions) contextParts.push(`- [${q.stage}] ${q.question_text}`);
    contextParts.push("");
  }
  if (deliverables?.length) {
    contextParts.push("## Bid Deliverables");
    for (const d of deliverables) contextParts.push(`- [${d.stage}] ${d.label}`);
    contextParts.push("");
  }

  // Fix 1: persona in Block 1 (cached independently), bid context in Block 2 (cached separately),
  // export instruction in Block 3 (tiny, no cache needed).
  // Block 1 cache survives bid data changes; Block 2 cache survives across turns within same session.
  return [
    { type: "text", text: basePersona, cache_control: { type: "ephemeral" } },
    ...(contextParts.length > 0
      ? [{ type: "text" as const, text: contextParts.join("\n"), cache_control: { type: "ephemeral" as const } }]
      : []),
    { type: "text", text: exportInstruction },
  ];
}

// ── tool definitions ───────────────────────────────────────────────────────────

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

const AZURE_SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_knowledge_base",
    description: SEARCH_TOOL.description,
    parameters: SEARCH_TOOL.input_schema as Record<string, unknown>,
  },
};

// ── provider loops ─────────────────────────────────────────────────────────────

async function runAnthropicLoop(
  data: z.infer<typeof InputSchema>,
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  controller: ReadableStreamDefaultController
) {
  const MAX_ROUNDS = 3;

  type AnthropicMsg = Anthropic.Messages.MessageParam;
  const messages: AnthropicMsg[] = data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let rounds = 0;

  while (true) {
    const isLastRound = rounds >= MAX_ROUNDS;

    const supportsThinking =
      data.model === "claude-opus-4-8" || data.model === "claude-sonnet-4-6";

    const apiStream = anthropicClient.messages.stream({
      model: data.model,
      max_tokens: 4096,
      ...(supportsThinking ? { thinking: { type: "adaptive" } } : {}),
      system: systemBlocks,
      tools: isLastRound ? undefined : [SEARCH_TOOL],
      messages,
    });

    for await (const event of apiStream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        controller.enqueue(new TextEncoder().encode(event.delta.text));
      }
    }

    const final = await apiStream.finalMessage();

    if (final.stop_reason !== "tool_use" || isLastRound) break;

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
}

async function runAzureLoop(
  data: z.infer<typeof InputSchema>,
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  controller: ReadableStreamDefaultController
) {
  const deploymentName =
    data.model === "azure-oss-120b"
      ? (process.env.AZURE_OSS120B_DEPLOYMENT ?? "")
      : (process.env.AZURE_GPT54_DEPLOYMENT ?? "");
  const azureClient = new AzureOpenAI({
    endpoint: process.env.AZURE_ENDPOINT ?? "",
    apiKey: process.env.AZURE_API_KEY ?? "",
    apiVersion: process.env.AZURE_API_VERSION ?? "2024-12-01-preview",
    deployment: deploymentName,
  });

  const systemText = systemBlocks.map((b) => b.text).join("\n");

  type AzureMsg = OpenAI.Chat.ChatCompletionMessageParam;
  const messages: AzureMsg[] = [
    { role: "system", content: systemText },
    ...data.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const MAX_ROUNDS = 3;
  let rounds = 0;

  while (true) {
    const isLastRound = rounds >= MAX_ROUNDS;

    const stream = azureClient.chat.completions.stream({
      model: deploymentName,
      max_completion_tokens: 4096,
      messages,
      tools: isLastRound ? undefined : [AZURE_SEARCH_TOOL],
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        controller.enqueue(new TextEncoder().encode(content));
      }
    }

    const final = await stream.finalChatCompletion();
    const finishReason = final.choices[0]?.finish_reason;

    if (finishReason !== "tool_calls" || isLastRound) break;

    const assistantMessage = final.choices[0].message;
    messages.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: assistantMessage.tool_calls,
    });

    const toolCalls = assistantMessage.tool_calls ?? [];
    for (const toolCall of toolCalls) {
      if (toolCall.function.name !== "search_knowledge_base") continue;
      const { query } = JSON.parse(toolCall.function.arguments) as { query: string };
      controller.enqueue(statusLine("search", query));
      const chunks = await runSearch(query, data.bidId);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: formatChunks(chunks),
      });
    }

    rounds++;
  }
}

// ── server function ────────────────────────────────────────────────────────────

export const streamChatFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    console.log("[stream-chat] handler called, model:", data.model, "bidId:", data.bidId);
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) { console.error("[stream-chat] no auth token"); return new Response("Unauthorized", { status: 401 }); }
    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) { console.error("[stream-chat] auth failed:", authErr); return new Response("Unauthorized", { status: 401 }); }
    console.log("[stream-chat] auth ok, building system blocks");

    let systemBlocks;
    try {
      systemBlocks = await buildSystemBlocks(data.bidId);
    } catch (err) {
      console.error("[stream-chat] buildSystemBlocks failed:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
    if (data.mentionedDocIds?.length) {
      const pinned = await fetchPinnedChunks(data.mentionedDocIds);
      if (pinned.length) {
        systemBlocks = [
          ...systemBlocks,
          {
            type: "text" as const,
            text: `## Pinned Documents (user referenced with @)\n\nThe user has explicitly referenced these documents. Their full indexed content is provided below:\n\n${formatChunks(pinned)}`,
          },
        ];
      }
    }
    console.log("[stream-chat] system blocks built, starting stream");

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isAzureModel(data.model)) {
            await runAzureLoop(data, systemBlocks, controller);
          } else {
            await runAnthropicLoop(data, systemBlocks, controller);
          }
        } catch (err) {
          console.error("[stream-chat] stream error:", err);
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
