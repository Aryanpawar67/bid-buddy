# Generate Proposal — Implementation Plan
**Date:** 2026-06-09
**Spec:** `docs/superpowers/specs/2026-06-09-generate-proposal-redesign.md`
**Depends on:** existing `generateProposalFn`, `useGenerateProposal`, `AiChatPanel`

---

## Goal

Move the Generate Proposal button to a persistent footer chip, add a 2-phase modal (Sonnet content preview → cover fields), and wire the confirmed intake into the existing DOCX assembly pipeline.

---

## Tasks

### Task 1 — `previewProposalFn` server function
**File:** `src/lib/api/generate-proposal.ts`

Add a new exported server function alongside the existing `generateProposalFn`:

```ts
export const previewProposalFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ bidId: z.string().uuid(), sessionId: z.string().uuid() }))
  .handler(async ({ data }) => { ... })
```

Steps inside handler:
1. Auth check (same pattern as `generateProposalFn`)
2. Fetch bid record + questions + deliverables (reuse `buildProposalSystemBlocks`)
3. Fetch `ai_sessions` row → extract `messages` JSONB array for the sessionId
4. Build Sonnet prompt with chat history serialised as `<chat_history>` block
5. Call `claude-sonnet-4-6`, `max_tokens: 2500`, expect JSON output matching `ProposalPreview` type
6. Parse + validate, fill missing fields with `[TO PROVIDE: …]` fallbacks
7. Return `ProposalPreview` as JSON response

Export `ProposalPreview` type for use in the modal component.

---

### Task 2 — `usePreviewProposal` client hook
**File:** `src/lib/ai-queries.ts`

Add a TanStack mutation hook:

```ts
export function usePreviewProposal() {
  return useMutation({
    mutationFn: async (input: { bidId: string; sessionId: string }) => {
      const res = await previewProposal(input);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<ProposalPreview>;
    },
  });
}
```

Import `previewProposalFn` and create a typed client wrapper `previewProposal` in `src/lib/api/ai-functions.ts` (same pattern as `generateProposal`).

---

### Task 3 — `ProposalModal` component
**File:** `src/components/ai/ProposalModal.tsx` (new file)

Props:
```ts
type Props = {
  open: boolean;
  onClose: () => void;
  bidId: string;
  sessionId: string;
  clientName: string;
}
```

Internal state:
- `phase: 1 | 2`
- `preview: ProposalPreview | null`
- `coverFields: { prepared_for: string; spoc_name: string; spoc_email: string }`
- `isSubmitting: boolean`

**Phase 1 render:**
- Call `usePreviewProposal` on mount (`mutate({ bidId, sessionId })`)
- While pending: spinner + "Authoring proposal content… · Sonnet"
- On success: render four `PreviewSection` sub-components (exec_summary ×3 paragraphs, scope_intro, deliverables)
- Each `PreviewSection` has a `↺ Regen` button that re-triggers the mutation
- "Next →" disabled while pending, enabled on success

**Phase 2 render:**
- Auto-filled info strip (template filename, rfp_name, customer_display_name) — read-only
- Three controlled text inputs for cover fields
- "← Back" returns to phase 1 (preview already in state, no re-fetch)
- "✦ Generate DOCX" calls `handleGenerateDocx`

**`handleGenerateDocx`:**
- Merges `preview` + `coverFields` into full intake
- Calls existing `useGenerateProposal().mutateAsync({ bidId, sessionId })`
- On success: `onClose()` + toast "Proposal saved to Knowledge Hub"
- On error: inline error message

Design tokens: use existing CSS variables (`--primary`, `--orange`, `hairline border`, `text-[11px]`, etc.) — match `AiChatPanel` density.

---

### Task 4 — Wire modal into `AiChatPanel`
**File:** `src/components/ai/AiChatPanel.tsx`

1. Import `ProposalModal`
2. Add state: `const [proposalModalOpen, setProposalModalOpen] = useState(false)`
3. **Remove** the `Generate Proposal` chip from the `showQuickActions` block (lines ~380–398)
4. **Add** chip to the footer strip (above textarea, same row as contextual chips):

```tsx
{!isGlobal && isRfiRfpStage && canAttach && (
  <div className="footer-chips flex gap-2 mb-2 flex-wrap">
    <button
      onClick={() => setProposalModalOpen(true)}
      disabled={isStreaming || !sessionId}
      className="text-[10px] px-3 py-1.5 rounded-full border hairline border-orange-400/60
                 text-orange-500 bg-orange-50/50 hover:bg-orange-500 hover:text-white
                 hover:border-orange-500 disabled:opacity-40 transition-colors
                 dark:text-orange-400 dark:bg-orange-950/20 flex items-center gap-1"
    >
      ✦ Generate Proposal
    </button>
  </div>
)}
```

5. Render `<ProposalModal>` at the bottom of the component return:

```tsx
{activeBid && sessionId && (
  <ProposalModal
    open={proposalModalOpen}
    onClose={() => setProposalModalOpen(false)}
    bidId={activeBid.id}
    sessionId={sessionId}
    clientName={activeBid.client_name}
  />
)}
```

6. Remove now-unused `proposalError` state and `handleGenerateProposal` function from `AiChatPanel` (logic moves into `ProposalModal`).

---

### Task 5 — Update `generateProposalFn` to accept pre-authored intake
**File:** `src/lib/api/generate-proposal.ts`

The current function calls Haiku internally to author the intake. With the new flow, the intake arrives pre-authored from the modal. Two options:

**Chosen approach:** Add an optional `intake` field to the input schema. If provided, skip the Haiku authoring step and use it directly. If absent, fall back to the existing Haiku path (keeps backward compatibility).

```ts
const InputSchema = z.object({
  bidId: z.string().uuid(),
  sessionId: z.string().uuid(),
  intake: IntakeSchema.optional(),   // pre-authored from modal
});
```

Pass `intake` from `ProposalModal.handleGenerateDocx` → `useGenerateProposal` mutation → `generateProposalFn`.

Update `useGenerateProposal` hook signature to accept optional `intake` param.

---

## Build Order

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

Tasks 1–2 are pure server/query additions with no UI impact.
Task 3 is a self-contained new component.
Tasks 4–5 touch existing files and should be done together in one pass.

---

## Verification

1. `bun run build:dev` — no TypeScript errors
2. Open a bid at RFI/RFP stage → "✦ Generate Proposal" chip visible above textarea
3. Send a message first (e.g. "Summarise requirements") → chip still visible
4. Click chip → modal opens, spinner shown
5. Preview renders with exec summary, scope intro, deliverables
6. Click "↺ Regen" on one section → re-fetches and updates
7. Click "Next" → cover fields form shown with auto-filled info strip
8. Fill cover fields → click "Generate DOCX"
9. DOCX downloads with client name in filename, no `[TO PROVIDE: …]` in cover fields
10. Bid's Documents tab shows the new generated proposal
11. On an empty session (no messages) → button still present, generation falls back to bid metadata only
