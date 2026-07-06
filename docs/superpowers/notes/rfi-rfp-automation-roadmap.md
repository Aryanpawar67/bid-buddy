# Note: RFI/RFP Automation — Parked for Future Milestone

**Date:** 2026-07-06
**Status:** Parked — manual workflow in place for now

## The Actual Workflow (As Clarified)

1. **Client sends** an RFI as an Excel sheet or DOCX (50–200 numbered questions)
2. **Upload to BidBuddy** Knowledge Hub — document gets chunked and indexed (Voyage RAG)
3. **RFx Responder** (AI agent, `/ai`) — analyst manually asks the agent to draft answers to each question; agent searches the KH for relevant iMocha capabilities, case studies, certs
4. **Proposal generated** — the filled-out response document is assembled and submitted back to the client

## Current State vs. Ideal

| Step | Now | Ideal (future) |
|---|---|---|
| Upload RFI doc | ✅ Works — indexed for RAG | Same |
| Agent answers one question | ✅ Works — per-message, manual | Batch: iterate all questions |
| Extract questions from doc | ❌ Not built — analyst types them manually | Auto-parse numbered Q&A from XLSX/DOCX |
| Track Q + response in questionnaire | ❌ No creation UI (fixed in patch milestone) | Auto-populate from doc parse |
| Generate "RFI Response" doc | ❌ Not built — current "Generate Proposal" outputs an iMocha-branded proposal, not a filled client questionnaire | Separate output: fills client's format |
| Generate "iMocha Proposal" (for RFP) | ✅ Works — `generateProposalFn` with TA/TM template | Same, already correct for RFP |

## Key Distinction (Do Not Conflate)

- **RFI → RFI Response doc**: fill the client's own questionnaire. Output mirrors their format.
- **RFP → iMocha Proposal**: iMocha-branded proposal using TA/TM template. `generateProposalFn` is already correct for this stage.

The "Generate Proposal" chip in the RFI stage is misplaced — it generates an iMocha proposal, not an RFI response. Moving or gating it to RFP only is a near-term fix; building a proper "Generate RFI Response" document is a future milestone.

## What Needs to Be Built (Future)

### 1. Question Extractor
- On upload of a XLSX/DOCX to a bid, detect numbered Q&A structure
- AI pass: "Extract all client questions as a JSON array with number + question_text"
- Insert extracted questions into `bid_questions` with `stage = current_stage`
- Prompt: "Found 10 questions in Apex_Capital_RFI.pdf — import them to the questionnaire?"

### 2. Batch RFx Answering
- In RFI Questionnaire tab: "Draft answers with AI" button
- Iterates through all `pending` questions (max ~20 per batch to avoid context overflow)
- For each: `search_knowledge_base(question_text)` → draft response → save to `response_text`
- Shows a progress ticker; user can edit each answer after

### 3. RFI Response Document Generator
- Separate from `generateProposalFn` (which is for RFP/proposal)
- Takes all questions + response_text pairs for this bid/stage
- Compiles into a clean response document (table format: Q | iMocha Response)
- Optionally mirrors the client's original format structure if it was detected at extract time
- Uploads to Knowledge Hub as `source: "generated"`, `type: "proposal"`, `stage: "rfi"`

### 4. Gate "Generate Proposal" to RFP Stage
- The current chip in AiChatPanel should only appear when `bid.stage === "rfp"`
- In RFI stage, replace it with "Generate RFI Response" (the new generator above)

## Related
- `src/lib/api/generate-proposal.ts` — current proposal generator (RFP-only artifact)
- `src/components/ai/AiChatPanel.tsx` — Generate Proposal chip visibility
- `src/components/bids/RFIWorkspace.tsx` — questionnaire tab (where the batch answer UX lives)
- `docs/superpowers/notes/proposal-export-gap.md` — export gap note (related)
