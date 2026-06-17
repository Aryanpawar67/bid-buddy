# Generate Proposal — Redesign Spec
**Date:** 2026-06-09
**Status:** Approved for implementation

---

## Problem

The current "Generate Proposal" chip is placed in the quick-actions bar that only renders when a session has zero messages. This is exactly backwards: the button is most valuable *after* the user has analysed requirements in chat, which is when chat context exists to produce a high-quality proposal. Additionally, the current flow is a black box — no preview, no cover-field input — so the output always contains `[TO PROVIDE: …]` placeholders and cannot be reviewed before the DOCX is assembled.

---

## Goal

Surface the Generate Proposal action persistently throughout a bid session, use accumulated chat context to author better proposal content via Sonnet, give the user a reviewable preview before assembly, and collect the three cover fields that the current flow always leaves blank.

---

## Scope

- Applies to bid-mode sessions only (not global chat)
- Applies to bids at stage `rfi` or `rfp` (unchanged from current)
- Roles: `pre_sales` and `admin` (unchanged)

Out of scope: editing individual proposal sections inline, versioning proposals, multi-language support.

---

## User Flow

```
1. User chats in RFx Responder — analyses requirements, maps to iMocha capabilities
2. User clicks "✦ Generate Proposal" chip (always visible above input bar)
3. Modal opens → Phase 1: Sonnet call reads chat messages + bid data → authors intake JSON
4. Modal shows scrollable content preview (exec summary, scope intro, deliverables)
   └─ Per-section "↺ Regen" button available
5. User clicks "Next: Cover Details →"
6. Phase 2: User fills prepared_for, spoc_name, spoc_email
7. User clicks "✦ Generate DOCX"
8. Existing generateProposalFn assembles DOCX from confirmed intake
9. DOCX downloaded to browser + saved to bid's Knowledge Hub
```

---

## Button Placement

**Remove** the chip from the empty-session quick-actions bar.

**Add** a persistent `✦ Generate Proposal` chip in the input bar footer strip — the same row as the existing contextual chips (`Summarise RFP`, `Identify risks`, etc.) — rendered above the textarea. Visibility condition: same as before (`!isGlobal && isRfiRfpStage`), but no longer gated on `messages.length === 0`.

Styling: orange pill chip, matches the existing `btn-proposal-footer-chip` aesthetic (`orange-soft` bg, orange border/text on idle; solid orange on hover).

---

## Phase 1 — Content Preview

### New server function: `previewProposalFn`

**Input:** `{ bidId: string, sessionId: string }`

**What it does:**
1. Fetches bid record (client_name, title, type, value, stage, deadline)
2. Fetches bid questions + deliverables
3. Fetches `ai_sessions.messages` for the given sessionId
4. Builds a Sonnet prompt that summarises the chat and authors proposal content
5. Returns a structured JSON object (not a DOCX)

**Model:** `claude-sonnet-4-6` (more reasoning quality than Haiku for this authored content)

**Output shape:**
```ts
type ProposalPreview = {
  product: "TA" | "TM";
  rfp_name: string;
  customer_display_name: string;
  exec_summary: { pleased: string; aligned: string; confident: string };
  scope_intro: string;
  deliverables: string[];  // 8–12 bullets
}
```

**Prompt strategy:** Feed the full message thread as a `<chat_history>` block in the system. The model is instructed to extract client requirements from the chat, map them to iMocha capabilities from the voice guide, and author content per the existing voice guide rules. All capability claims must come from the KB/chat context — no hallucination.

### Modal — Phase 1 UI

- Opens immediately on button click; shows spinner while Sonnet streams
- On completion, renders four collapsible preview sections:
  - Executive Summary (Pleased / Aligned / Confident — shown as three paragraphs)
  - Scope of Work Intro (one paragraph)
  - Key Deliverables (bullet list)
- Each section has a per-section `↺ Regen` button (re-calls `previewProposalFn` with a variation hint for that section only — or simply re-runs the full call)
- "Next →" button is disabled while generating, enabled once preview is ready

---

## Phase 2 — Cover Details

Three text inputs:

| Field | Label | Placeholder |
|-------|-------|-------------|
| `prepared_for` | Prepared For — contact name & title | `e.g. Sarah Chen, VP Talent Acquisition` |
| `spoc_name` | Sales SPOC Name | `e.g. Rohan Mehta` |
| `spoc_email` | Sales SPOC Email | `e.g. rohan.mehta@imocha.io` |

Auto-filled (read-only, shown in info strip):
- Template: `TA_Proposal_template.docx` or `TM_Proposal_template.docx` (from `product` field)
- RFP name: from `preview.rfp_name`
- Client: from `preview.customer_display_name`

"Generate DOCX" button calls the existing `generateProposalFn` with the confirmed intake (preview content + cover fields merged). No changes to `generateProposalFn` internals.

---

## Component Architecture

```
AiChatPanel.tsx
  └─ footer strip
       └─ GenerateProposalChip (button)  ← replaces current chip location

ProposalModal.tsx  (new component)
  ├─ Phase 1: ProposalPreviewPhase
  │    ├─ PreviewSection (exec_summary)
  │    ├─ PreviewSection (scope_intro)
  │    └─ PreviewSection (deliverables)
  └─ Phase 2: ProposalCoverPhase
       └─ 3× form inputs + auto-filled strip
```

State lives in `ProposalModal` — `phase`, `preview: ProposalPreview | null`, `coverFields`, `isGenerating`.

---

## Error Handling

- `previewProposalFn` failure: show inline error in modal with retry button
- `generateProposalFn` failure: existing toast error handling (unchanged)
- Empty session (no messages): button is still shown; `previewProposalFn` falls back to bid metadata only (same as current behaviour)

---

## What Does NOT Change

- `generateProposalFn` — no changes to DOCX assembly, template selection, KH upload, or header/footer substitution
- `useGenerateProposal` hook — no changes needed (called with confirmed intake)
- Quick-actions chips (Summarise RFP, Map to KB, etc.) — unchanged
- RFI/RFP stage gate — unchanged
- Role gate (pre_sales + admin) — unchanged
