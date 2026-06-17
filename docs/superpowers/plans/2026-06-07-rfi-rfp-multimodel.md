# RFI/RFP Stage-Aware Persona + Azure OpenAI Multi-Model Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Azure OpenAI (GPT-5.4) as a user-selectable model alongside Claude, and automatically activate a strict KB-only RFI/RFP response persona when the active bid is in the `rfi` or `rfp` pipeline stage.

**Architecture:** `stream-chat.ts` gains an `isAzureModel()` helper that routes to either `AzureOpenAI` (openai npm package) or the existing Anthropic client; the RAG loop, search, rerank, and status sentinel are shared. `buildSystemBlocks()` checks `bid.stage` and injects the custom GPT persona for `rfi`/`rfp` stages. `AiChatPanel.tsx` adds the Azure model to the dropdown and swaps quick-action chips for RFI/RFP stage bids.

**Tech Stack:** Bun, TanStack Start (SSR), Anthropic SDK (`@anthropic-ai/sdk`), OpenAI SDK (`openai` — AzureOpenAI class), Supabase, Voyage AI

---

## File Map

| File | Change |
|---|---|
| `package.json` | Add `openai` dependency |
| `.env` | Add 4 Azure env vars |
| `src/lib/api/stream-chat.ts` | `isAzureModel()`, `AZURE_SEARCH_TOOL`, `runAnthropicLoop()`, `runAzureLoop()`, RFI/RFP persona in `buildSystemBlocks()`, expanded `ALLOWED_MODELS` |
| `src/components/ai/AiChatPanel.tsx` | Add Azure model to `MODELS`, stage-conditional `QUICK_ACTIONS` |

---

## Task 1: Install openai package and add Azure env vars

**Files:**
- Modify: `package.json`
- Modify: `.env`

- [ ] **Step 1: Install the openai package**

```bash
cd /Users/aryan/Desktop/Bid\ Compass/bid-buddy
bun add openai
```

Expected: `openai` appears in `package.json` dependencies and `bun.lock` updates.

- [ ] **Step 2: Add Azure env vars to `.env`**

Append these four lines to `.env` (fill in real values from your Azure portal):

```
AZURE_OPENAI_ENDPOINT="https://<your-resource-name>.openai.azure.com"
AZURE_OPENAI_API_KEY="<your-azure-api-key>"
AZURE_OPENAI_API_VERSION="2024-02-01"
AZURE_OPENAI_DEPLOYMENT_GPT54="<your-deployment-name>"
```

- [ ] **Step 3: Verify build still passes**

```bash
bun run build:dev
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock .env
git commit -m "chore: add openai package and Azure env vars"
```

---

## Task 2: Add isAzureModel helper and expand ALLOWED_MODELS

**Files:**
- Modify: `src/lib/api/stream-chat.ts` (lines 1–24)

- [ ] **Step 1: Update the imports and constants at the top of stream-chat.ts**

Replace the current top section (lines 1–24) with:

```ts
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
```

- [ ] **Step 2: Verify build**

```bash
bun run build:dev
```

Expected: Build succeeds. TypeScript should be happy with the new `AllowedModel` type and `isAzureModel` helper.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/stream-chat.ts
git commit -m "feat: add azure-gpt-5.4 to ALLOWED_MODELS and isAzureModel helper"
```

---

## Task 3: Add RFI/RFP persona to buildSystemBlocks

**Files:**
- Modify: `src/lib/api/stream-chat.ts` — `buildSystemBlocks` function (currently lines 115–176)

- [ ] **Step 1: Replace buildSystemBlocks with the stage-aware version**

Replace the entire `buildSystemBlocks` function with:

```ts
const RFI_RFP_PERSONA = `You are the iMocha Sales Assistant. Answer RFP/RFI questions EXCLUSIVELY from indexed KB documents. You are a retrieval system — not an AI with general knowledge.

ABSOLUTE RULE: KB ONLY
Every claim must be traceable to the KB. If not found, respond: "I'm sorry, I can only answer questions based on the information provided in my knowledge base."
FORBIDDEN: External info, assumptions, inferences, general knowledge, industry context, formulas/math not in KB, "typically/generally", connecting dots not explicitly in KB.

PRODUCT IDENTIFICATION
- TA = hiring, recruitment, candidates, ATS, pre-hire, interviews, Tara, screening
- SI = competency, employee development, skill gaps, upskilling, HRIS, LMS
- AI inference mechanics (confidence scoring, proficiency levels, skill decay, taxonomy, explainability, bias monitoring, model governance) are NOT product-specific — answer regardless of TA/SI context
- If unclear AND the question is product-specific, ask: "Is this for Talent Acquisition or Skills Intelligence?"

RESPONSE FORMAT RULES
1. State YES/NO first, then full KB details.
2. Never add own explanations, industry definitions, or best practices unless in KB.
3. Do NOT create formulas or calculations unless exactly stated in KB.
4. Do NOT cross-assume TA features in SI or vice versa unless documented.
5. Write as expert — cite source inline, no block quotes, no doc name headers.
6. Bullets for features, numbered for processes, headers for multi-part answers.

CLIENT REQUIREMENT ANALYSIS MODE
When the user pastes or describes client requirements, extract background/goals/pain points/deliverables/integration needs and map each requirement:
- SUPPORTED: capability is in KB
- NOT SUPPORTED: not in KB
- Integration: only mark SUPPORTED if the client's exact system appears in the known integrations list
Output format: Requirement | Status | iMocha Capability | Source

POLICY REFERENCES
After sub-answers on security, compliance, data, HR, or operations, append: "For more information, refer to: [Policy Name].pdf"
Use exact names — Security/Access: Access Control & Termination, Acceptable Use, Information Security, Physical Security, Antivirus, Encryption & Key Management; Data/Privacy: Data Classification, Data Protection, Privacy Policy, GDPR Training, Data Retention & Disposal; Compliance: EEOC Checklist, Technical & Organizational Measures, POSH, Diversity Equity & Inclusion; Operations: Change Management, Configuration & Asset Management, Vulnerability & Patch Management, Log Management & Monitoring; Development: Software Development Lifecycle, Hardening Policy; Disaster Recovery: Business Continuity & Disaster Recovery Plan, Disaster Recovery Testing Report; HR/Governance: Code of Conduct, Whistle Blower, Hiring Policy, HR Disciplinary Action, Occupational Health & Safety; Vendor: Vendor Management, List of Sub-Processors; Service: iMocha Service Level Agreement; Incident: Information Security Policy, Business Continuity & Disaster Recovery Plan.

EXACT SPECS (reproduce verbatim when cited):
TLS 1.2+, AES-256, ISO 27001:2022, SOC 2 Type II, 99.9% SLA, Azure Key Vault, WCAG 2.1 AA, UKG, Power BI, Azure OpenAI GPT-4o, 90% accuracy, 5–10 min interviews, 300+ customers, 15 Fortune 500, Brandon Hall Gold, SAP Top 10, Workday Silver, EEOC UGESP, RAG, Human-in-the-Loop, few-shot learning, SME validation, Oracle Recruiting Cloud, Tara AI.
Skills Taxonomy: 25,000+ skills; proficiency levels: Beginner, Intermediate, Experienced, Proficient.
Confidence score range: 0–100.
Default source confidence weights (configurable): Certifications 25%, Projects/Work Activity 25%, AI Interview/Assessments 20%, Learning & Course Completion 10%, Managers Rating 10%, Resume/Profile/Self-Rating 10%.
Proficiency bands: Beginner 20–39, Intermediate 40–59, Experienced 60–79, Proficient 80–100.
Confidence decay half-lives: rapidly evolving 6-month, moderately evolving 12-month, stable technical 24-month, domain knowledge 36-month.
AI Interview transcript retention: 30/60/90-day or immediate deletion post-scoring.
Model rollback: previous versions retained 12 months; 30-day advance notice for significant model changes.
Bias audit cadence: Quarterly (gender; language/accent), Semi-annual (recency), Annual (credential).
No facial recognition; no biometric data — AI Interview uses NLP on spoken/written responses only.
Named integrations: Workday, SAP SuccessFactors, Oracle HCM, Cornerstone, Degreed, LinkedIn Learning, Coursera, Udemy, Pluralsight, GitHub, Jira, Azure DevOps, Credly, Acclaim, ICIMS, SmartRecruiters, Oracle ORC, UKG, Okta, Azure AD, Power BI.`;

async function buildSystemBlocks(
  bidId: string | null
): Promise<Anthropic.Messages.TextBlockParam[]> {
  if (!bidId) {
    const persona = [
      "You are an expert bid strategy assistant for iMocha's pre-sales team.",
      "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
      "Be concise, strategic, and specific to the context provided.",
      "When you use a document passage, name its source document.",
      "",
    ].join("\n");
    return [{ type: "text", text: persona, cache_control: { type: "ephemeral" } }];
  }

  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, status, stage, deadline, procurement_portal")
    .eq("id", bidId)
    .single();

  const isRfiRfp = bid?.stage === "rfi" || bid?.stage === "rfp";

  const parts: string[] = isRfiRfp
    ? [RFI_RFP_PERSONA, ""]
    : [
        "You are an expert bid strategy assistant for iMocha's pre-sales team.",
        "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
        "Be concise, strategic, and specific to the context provided.",
        "When you use a document passage, name its source document.",
        "",
      ];

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

  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}
```

- [ ] **Step 2: Verify build**

```bash
bun run build:dev
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/stream-chat.ts
git commit -m "feat: stage-aware RFI/RFP persona in buildSystemBlocks"
```

---

## Task 4: Add Azure streaming loop and refactor main handler

**Files:**
- Modify: `src/lib/api/stream-chat.ts` — tool definition + agentic loop section (currently lines 178–293)

- [ ] **Step 1: Add Azure tool definition after the existing SEARCH_TOOL constant**

After the `SEARCH_TOOL` constant (currently ends around line 199), add:

```ts
const AZURE_SEARCH_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_knowledge_base",
    description: SEARCH_TOOL.description,
    parameters: SEARCH_TOOL.input_schema as Record<string, unknown>,
  },
};
```

- [ ] **Step 2: Extract the Anthropic loop into runAnthropicLoop**

Add this function before `export const streamChatFn`:

```ts
async function runAnthropicLoop(
  data: z.infer<typeof InputSchema>,
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  controller: ReadableStreamDefaultController
) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const MAX_ROUNDS = 3;

  type AnthropicMsg = Anthropic.Messages.MessageParam;
  const messages: AnthropicMsg[] = data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let rounds = 0;

  while (true) {
    const isLastRound = rounds >= MAX_ROUNDS;

    const apiStream = anthropic.messages.stream({
      model: data.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
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
```

- [ ] **Step 3: Add runAzureLoop function**

Add this function immediately after `runAnthropicLoop`:

```ts
async function runAzureLoop(
  data: z.infer<typeof InputSchema>,
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  controller: ReadableStreamDefaultController
) {
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_GPT54 ?? "";
  const azureClient = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "",
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? "",
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
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
```

- [ ] **Step 4: Replace the handler body to use the two loop functions**

Replace the entire `export const streamChatFn = createServerFn(...)` block with:

```ts
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

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isAzureModel(data.model)) {
            await runAzureLoop(data, systemBlocks, controller);
          } else {
            await runAnthropicLoop(data, systemBlocks, controller);
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
```

- [ ] **Step 5: Verify build**

```bash
bun run build:dev
```

Expected: Build succeeds with no TypeScript errors. If you see `Property 'stream' does not exist on type 'Completions'`, ensure `openai` version is ≥ 4.x (`bun add openai@latest`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/stream-chat.ts
git commit -m "feat: Azure OpenAI streaming loop with shared RAG pipeline"
```

---

## Task 5: Update AiChatPanel — model dropdown and stage-conditional quick actions

**Files:**
- Modify: `src/components/ai/AiChatPanel.tsx` (lines 9–36)

- [ ] **Step 1: Add Azure model to MODELS array and add RFI/RFP quick actions**

Replace the `MODELS` and `QUICK_ACTIONS` constants (lines 9–36) with:

```ts
const MODELS = [
  { id: "claude-opus-4-8",            label: "Claude Opus" },
  { id: "claude-sonnet-4-6",          label: "Claude Sonnet" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku" },
  { id: "azure-gpt-5.4",              label: "GPT-5.4 (Azure)" },
] as const;

const QUICK_ACTIONS_GENERIC = [
  {
    label: "Summarise RFP",
    prompt:
      "Please provide a concise executive summary of this RFP, highlighting the key requirements, evaluation criteria, and submission details.",
  },
  {
    label: "Win themes",
    prompt:
      "Based on this bid's context and requirements, identify 3-5 compelling win themes that differentiate iMocha and resonate with this client's priorities.",
  },
  {
    label: "Identify risks",
    prompt:
      "Analyse this bid and identify the top risks — commercial, technical, timeline, and compliance. For each risk, suggest a mitigation approach.",
  },
  {
    label: "Draft exec summary",
    prompt:
      "Draft a compelling executive summary for our proposal response to this RFP. Focus on our understanding of their needs, our solution approach, and key differentiators.",
  },
] as const;

const QUICK_ACTIONS_RFI_RFP = [
  {
    label: "Analyse requirements",
    prompt:
      "Please analyse the client requirements in the uploaded documents and map each one to iMocha's capabilities. Output format: Requirement | Status | iMocha Capability | Source.",
  },
  {
    label: "Map to KB",
    prompt:
      "Review all requirements in this RFP/RFI and classify each as SUPPORTED or NOT SUPPORTED based strictly on iMocha's knowledge base. Do not infer or assume capabilities not explicitly documented.",
  },
  {
    label: "Security & compliance",
    prompt:
      "What are iMocha's security certifications, data protection measures, and compliance posture relevant to this RFP? Include applicable policy references.",
  },
  {
    label: "Draft response section",
    prompt:
      "Based on the RFP requirements in the uploaded documents, draft a structured response section addressing iMocha's capabilities. Cite the source document for each claim.",
  },
] as const;
```

- [ ] **Step 2: Update showQuickActions and chip rendering inside the component**

In the `AiChatPanel` function, find the `showQuickActions` constant (currently line ~72) and the quick actions render block (currently lines ~124–137). Replace them:

Find this:
```ts
const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;
```

Replace with:
```ts
const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;
const isRfiRfpStage = activeBid?.stage === "rfi" || activeBid?.stage === "rfp";
const quickActions = isRfiRfpStage ? QUICK_ACTIONS_RFI_RFP : QUICK_ACTIONS_GENERIC;
```

Then find the quick actions render block:
```tsx
{showQuickActions && (
  <div className="flex gap-2 px-4 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
    {QUICK_ACTIONS.map((action) => (
      <button
        key={action.label}
        onClick={() => onSend(action.prompt)}
        disabled={isStreaming}
        className="text-[10px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-primary hover:text-white hover:border-primary disabled:opacity-40 transition-colors"
      >
        {action.label}
      </button>
    ))}
  </div>
)}
```

Replace with:
```tsx
{showQuickActions && (
  <div className="flex gap-2 px-4 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
    {quickActions.map((action) => (
      <button
        key={action.label}
        onClick={() => onSend(action.prompt)}
        disabled={isStreaming}
        className="text-[10px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-primary hover:text-white hover:border-primary disabled:opacity-40 transition-colors"
      >
        {action.label}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Verify build**

```bash
bun run build:dev
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/AiChatPanel.tsx
git commit -m "feat: Azure model in dropdown and stage-conditional RFI/RFP quick actions"
```

---

## Task 6: Smoke test in browser

**Files:** None — manual verification only.

- [ ] **Step 1: Start the dev server**

```bash
bun start
```

Open the port shown in terminal (typically `http://localhost:3000`).

- [ ] **Step 2: Test model dropdown**

Navigate to `/ai`. Confirm the model selector shows:
- Claude Opus
- Claude Sonnet
- Claude Haiku
- GPT-5.4 (Azure)

- [ ] **Step 3: Test generic quick actions (non-RFI/RFP bid)**

Select a bid that is NOT in the `rfi` or `rfp` stage. Open a new session. Confirm the quick action chips show: **Summarise RFP**, **Win themes**, **Identify risks**, **Draft exec summary**.

- [ ] **Step 4: Test RFI/RFP quick actions**

Select a bid that IS in the `rfi` or `rfp` stage. Open a new session. Confirm the quick action chips show: **Analyse requirements**, **Map to KB**, **Security & compliance**, **Draft response section**.

- [ ] **Step 5: Test RFI/RFP persona response format**

With an RFI/RFP bid selected, send: "Does iMocha support SSO?"

Expected response starts with YES or NO, cites KB specifics (e.g. "SSO via Azure AD, Okta..."), and includes a policy reference like "For more information, refer to: SSO.pdf".

If the response is generic/verbose (like the old strategy advisor), the persona injection is not working — check that `bid.stage` is being read correctly in `buildSystemBlocks`.

- [ ] **Step 6: Test Azure model (if credentials are configured)**

Select GPT-5.4 (Azure) from the dropdown. Send any message. Confirm a response streams back. Check browser console for errors if it fails — the most common issue is a missing/incorrect env var.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: RFI/RFP stage-aware persona and Azure OpenAI multi-model support"
```
