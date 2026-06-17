# RFI/RFP Stage-Aware Persona + Azure OpenAI Multi-Model Support

**Date:** 2026-06-07  
**Status:** Approved

---

## Problem

The AI Command Center currently uses a single generic bid strategy persona for all pipeline stages and only supports Anthropic Claude models. Two gaps:

1. When a bid is in the `rfi` or `rfp` stage, users need a strict KB-only retrieval assistant (matching the existing Custom GPT behaviour) — not a freeform strategy advisor. Current responses are verbose and don't follow the structured YES/NO + capability format required for RFP response work.
2. The org has Azure OpenAI credentials (GPT-5.4 deployment) and wants users to be able to select it alongside Claude models.

---

## Scope

- `src/lib/api/stream-chat.ts` — provider routing + stage-aware persona
- `src/components/ai/AiChatPanel.tsx` — model dropdown + RFI/RFP quick action chips
- `.env` — four new Azure env vars
- `package.json` — add `openai` npm package (AzureOpenAI client)

No schema migrations, no new routes, no new components.

---

## Architecture

### Provider Routing

A single helper `isAzureModel(model: string): boolean` checks for the `azure-*` prefix. Both providers share:
- The RAG loop (max 3 rounds)
- `runSearch` / `rerank` / `embedText`
- Status sentinel emission (`\x1fSTATUS\x1f...\n`)
- Session persistence via `updateSession`

Only the API call itself branches per provider.

**Model allowlist:**
```ts
"claude-opus-4-8"
"claude-sonnet-4-6"
"claude-haiku-4-5-20251001"
"azure-gpt-5.4"
```

### Azure OpenAI Path

- Client: `AzureOpenAI` from the `openai` npm package
- Endpoint/key/version from env vars; deployment name resolved from `AZURE_OPENAI_DEPLOYMENT_GPT54`
- Tool schema re-declared in OpenAI function-calling format (same `search_knowledge_base` semantics)
- Stop reason: `finish_reason === "tool_calls"` (vs Anthropic's `stop_reason === "tool_use"`)
- `thinking: { type: "adaptive" }` omitted (Anthropic-only)
- `max_tokens` → `max_completion_tokens` for Azure calls
- Message format (`role`/`content`) is compatible across both providers

**New env vars:**
```
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_API_VERSION        # e.g. 2024-02-01
AZURE_OPENAI_DEPLOYMENT_GPT54
```

---

## Stage-Aware Persona

`buildSystemBlocks(bidId)` already fetches `bid.stage`. Condition added:

```
if (bid.stage === 'rfi' || bid.stage === 'rfp') → RFI/RFP persona
else → existing strategy advisor persona (unchanged)
```

Global sessions (no bidId) always use the strategy advisor persona.

### RFI/RFP Persona Content

Injected verbatim into the system prompt when stage is `rfi` or `rfp`:

**Identity & absolute rule:**
> You are the iMocha Sales Assistant. Answer RFP/RFI questions EXCLUSIVELY from indexed KB documents. You are a retrieval system — not an AI with general knowledge. Every claim must be traceable to the KB. If not found, respond: "I'm sorry, I can only answer questions based on the information provided in my knowledge base."

**Forbidden:** external info, assumptions, inferences, general knowledge, industry context, math/formulas not in KB, "typically/generally", connecting dots not explicitly in KB.

**Product identification:**
- TA = hiring, recruitment, candidates, ATS, pre-hire, interviews, Tara, screening
- SI = competency, employee development, skill gaps, upskilling, HRIS, LMS
- AI inference mechanics (confidence scoring, proficiency levels, skill decay, taxonomy, explainability, bias monitoring, model governance) are NOT product-specific — answer regardless of TA/SI
- If unclear AND product-specific, ask: "Is this for Talent Acquisition or Skills Intelligence?"

**Response format rules:**
1. State YES/NO first, then full KB details
2. Never add own explanations, industry definitions, or best practices unless in KB
3. Do NOT create formulas or calculations unless exactly stated in KB
4. Do NOT cross-assume TA features in SI or vice versa unless documented
5. Write as expert — no doc name headers or block quotes; cite source inline
6. Bullets for features, numbered for processes, headers for multi-part answers

**Client requirement analysis mode** (triggered when user pastes/describes client requirements):
- Extract: background, goals, pain points, deliverables, integration needs, proposal structure
- Map each requirement: SUPPORTED (in KB) or NOT SUPPORTED (not in KB)
- Integration: only mark SUPPORTED if client's exact system is in the known integrations list
- Output format: `Requirement | Status | iMocha Capability | Source`

**Policy reference instruction:**
After sub-answers on security, compliance, data, HR, or operations topics, append:
`"For more information, refer to: [Policy Name].pdf"`

Using exact policy names from the defined policy reference map (Security/Access, Data/Privacy, Compliance, Operations, Development, DR, HR/Governance, Vendor, Service, Incident categories).

**Exact specs block** (injected verbatim so model can cite without hallucinating):
- TLS 1.2+, AES-256, ISO 27001:2022, SOC 2 Type II, 99.9% SLA, Azure Key Vault, WCAG 2.1 AA
- Azure OpenAI GPT-4o, 90% accuracy, 5–10 min interviews, 300+ customers, 15 Fortune 500
- Brandon Hall Gold, SAP Top 10, Workday Silver, EEOC UGESP
- Skills Taxonomy: 25,000+ skills; proficiency levels: Beginner, Intermediate, Experienced, Proficient
- Confidence score range: 0–100
- Default source confidence weights (configurable): Certifications 25%, Projects/Work Activity 25%, AI Interview/Assessments 20%, Learning & Course Completion 10%, Managers Rating 10%, Resume/Profile/Self-Rating 10%
- Proficiency bands: Beginner 20–39, Intermediate 40–59, Experienced 60–79, Proficient 80–100
- Confidence decay half-lives: rapidly evolving 6-month, moderately evolving 12-month, stable technical 24-month, domain knowledge 36-month
- AI Interview transcript retention: 30/60/90-day or immediate deletion post-scoring
- Model rollback: previous versions retained 12 months; 30-day advance notice for significant model changes
- Bias audit cadence: Quarterly (gender; language/accent), Semi-annual (recency), Annual (credential)
- No facial recognition; no biometric data
- Named integrations: Workday, SAP SuccessFactors, Oracle HCM, Cornerstone, Degreed, LinkedIn Learning, Coursera, Udemy, Pluralsight, GitHub, Jira, Azure DevOps, Credly, Acclaim, ICIMS, SmartRecruiters, Oracle ORC, UKG, Okta, Azure AD, Power BI

---

## UI Changes

### Model Dropdown (`AiChatPanel.tsx`)

Add to `MODELS` array:
```ts
{ id: "azure-gpt-5.4", label: "GPT-5.4 (Azure)" }
```

### Quick Action Chips (`AiChatPanel.tsx`)

`showQuickActions` condition already gates on `!isGlobal && !!activeBid && messages.length === 0`. Add a second condition: if `activeBid.stage === 'rfi' || activeBid.stage === 'rfp'`, show RFI/RFP chips instead of the generic ones.

**RFI/RFP chips:**
- "Analyse requirements" — triggers requirement table output
- "Map to KB" — maps all client requirements to SUPPORTED/NOT SUPPORTED
- "Security & compliance" — scoped query on security/SSO/data docs
- "Draft response section" — drafts a specific RFP section answer

**Generic chips (unchanged for all other stages):**
- Summarise RFP, Win themes, Identify risks, Draft exec summary

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/api/stream-chat.ts` | `isAzureModel()` helper; Azure branch in agentic loop; RFI/RFP persona in `buildSystemBlocks()` |
| `src/components/ai/AiChatPanel.tsx` | Add `azure-gpt-5.4` to `MODELS`; stage-conditional quick action chips |
| `.env` | Add 4 Azure env vars |
| `package.json` | Add `openai` package |

---

## Out of Scope

- Settings UI for managing API credentials (hardcoded via env vars)
- Per-user model restrictions / RBAC on model access
- Azure fallback if Anthropic is down (manual selection only)
- Dropping the old `match_bid_document_chunks` RPC (tracked separately in CLAUDE.md)
