# AI Command Center — Stub Plan
_Status: PENDING — requires design session before implementation_
_Created: 2026-06-05_

## Goal
An AI-powered copilot sidebar/page where users can interact with pursuit-specific AI assistance: summarise RFPs, generate win themes, identify risks, draft executive summaries.

## Proposed Features (from mockup)
- Chat interface: free-text prompt + suggested quick actions
- Suggested actions: "Summarise ABC Bank RFP", "Generate win themes", "Identify risks", "Draft executive summary"
- Context-aware: responses scoped to a specific pursuit (passed as context)
- Session memory within a pursuit

## Backend Requirements
- **Anthropic API integration** — Claude API (claude-sonnet-4-6 or claude-haiku-4-5)
- **Server function:** TanStack Start server function (not exposed directly to client) to proxy AI calls
- **Context injection:** Pull relevant bid fields + documents from Supabase and prepend as system prompt
- **Optional:** Store chat history in a new `ai_sessions` table per bid

## Proposed New Tables
```sql
ai_sessions (
  id uuid pk,
  bid_id uuid fk bids,
  user_id uuid fk profiles,
  messages jsonb,  -- [{role, content, created_at}]
  created_at timestamptz
)
```

## Key Questions Before Building
1. Should AI context include uploaded documents (Knowledge Hub) or just structured bid fields?
2. Streaming responses or single-shot?
3. Per-bid sessions or global assistant?
4. Rate limiting / cost guardrails?

## Rough Effort
~3–5 days: server function setup, prompt engineering, chat UI, optional session persistence.

## Dependencies
- Anthropic API key in env
- Knowledge Hub (for document context) — can be built independently first
