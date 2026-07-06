# Pursuit Pipeline Fixes — Design Spec

**Date:** 2026-07-06
**Status:** Approved → Ready for Implementation
**Scope:** All stage workspaces (`/pipeline`), Bid intake, `/ai` route, `bid-queries.ts`
**Related plan:** `docs/superpowers/plans/2026-07-06-pursuit-pipeline-fixes.md`
**Parked automation note:** `docs/superpowers/notes/rfi-rfp-automation-roadmap.md`

---

## Problem

The pursuit pipeline was rebuilt with new stage workspaces (RFI, RFP, BAFO, Contract) but the core mechanics of actually *working* on a bid were never wired up. The result is a pipeline that looks complete but breaks the moment a pre-sales analyst tries to do real work:

- There is no way to add questions or deliverables to any stage — every workspace starts empty with no creation path
- Questions can be toggled "done" but the actual written response is never captured anywhere
- Clicking "View all questions →" or "Switch to Clarifications" does nothing — `onTabChange` is never passed to stage workspaces
- The question status circle only toggles pending↔done — the `in_progress` state renders beautifully but is unreachable
- Navigating to the AI agent from a stage workspace drops you in a context-free global session with no bid pre-selected
- The clarification deadline entered at intake is saved to the DB but is invisible in the RFI stage — a separate and earlier deadline than submission
- Custom stage workspaces (DQ, RFI, RFP, BAFO, Contract) have no "Advance Stage" button — only the generic fallback does
- There is no way to mark a bid as Won or Lost from within the pipeline — the Closure page reads `bid.status` but nothing can set it
- `product_type` (TA vs TM) is not on the bid — proposal generation has to guess from chat context
- Contact person (procurement contact name/email) has no home in the data model

These are not UX polish issues. They are broken core workflows that make the tool unusable for its stated purpose.

---

## What Changes

### New capabilities (things that did not exist before)

| Capability | Where it appears |
|---|---|
| Add a question inline to any stage | Questionnaire/overview tab — bottom of every question list |
| Add a deliverable inline to any stage | Deliverables section — bottom of every deliverable list |
| Write and save a response to a question | Expandable response editor on each QuestionRow |
| Three-state question status (pending → in_progress → done) | QuestionRow toggle button — single click cycles |
| See clarification deadline separately in RFI | RFI Details card + alert banner when ≤ 3 days out |
| Navigate to AI pre-seeded with this bid | All "Open RFx Responder" and AI links carry `?bidId=` |
| Advance stage from any workspace | `AdvanceStageFooter` component in every custom workspace |
| Mark bid as Won / Lost with close-out fields | Contract stage overview — two action buttons + modal |
| Record product type (TA or TM) on bid | Intake modal + Bid Details edit form |
| Record procurement contact on bid | Intake modal + Bid Details edit form |
| View documents without leaving the questionnaire tab | Collapsible document panel in RFI questionnaire tab |
| Assign a team member from within the bid workspace | "Assign member" popover in all Team tabs |

### Issues fixed (things that were broken)

| Bug | Fix |
|---|---|
| `onTabChange` never reached RFI/RFP/BAFO/Contract workspaces | Passed through in `StageWorkspace.tsx` — 4 lines |
| "View all questions →" div does nothing | Wired to `onTabChange("questionnaire")` |
| Health card shows "At Risk" with 0 questions (fresh stage) | `total === 0` → "Not Started" state |
| `/ai` link drops context — no bid pre-selected | `?bidId=` search param + `useEffect` seed on AI route |

---

## DB Changes

### Migration (two columns added to `bids`)

```sql
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS product_type text CHECK (product_type IN ('TA', 'TM')),
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;
```

**No migration needed for `bid_questions`** — `response_text`, `internal_notes`, `due_date`, `assigned_to` already exist in the schema and in `types.ts`. They were never exposed in the UI.

---

## Component Inventory

### New components

| Component | File | Purpose |
|---|---|---|
| `AddQuestionInline` | `RFIWorkspace.tsx` (local) | Inline form: add a question to a stage |
| `AddDeliverableInline` | `RFIWorkspace.tsx` (local, reused across workspaces) | Inline form: add a deliverable to a stage |
| `AdvanceStageFooter` | `StageWorkspace.tsx` (exported) | Footer row: Advance to next stage + gate check |
| `CloseoutModal` | `ContractWorkspace.tsx` (local) | Won / Lost confirmation with close-out fields |
| `DocQuickPanel` | `RFIWorkspace.tsx` (local) | Collapsible right panel showing bid documents |

### New hooks (`bid-queries.ts`)

| Hook | Purpose |
|---|---|
| `useCreateQuestion` | Insert a new `bid_questions` row |
| `useCreateDeliverable` | Insert a new `bid_deliverables` row |
| `useUpdateQuestionResponse` | Patch `response_text` (and optional `status`) on a question |

### Modified files

| File | Changes |
|---|---|
| `src/lib/bid-queries.ts` | 3 new hooks above |
| `src/routes/_app/ai.tsx` | `validateSearch` for `bidId`; `useEffect` to seed `selectedBidId` |
| `src/components/bids/StageWorkspace.tsx` | Pass `onTabChange` to all 4 custom workspaces; export `AdvanceStageFooter` |
| `src/components/bids/RFIWorkspace.tsx` | `onTabChange` prop; 3-state toggle; response editor; add forms; clarif deadline; health fix; doc panel; team assign; advance footer |
| `src/components/bids/RFPWorkspace.tsx` | `onTabChange` prop; 3-state toggle; response editor; add forms; advance footer; bidId link |
| `src/components/bids/BAFOWorkspace.tsx` | `onTabChange` prop; add forms; advance footer; bidId link |
| `src/components/bids/ContractWorkspace.tsx` | `onTabChange` prop; Won/Lost closeout modal; advance footer; bidId link |
| `src/components/bids/DealQualificationWorkspace.tsx` | product_type + contact fields in BidDetailsTab; team assign in BidTeamTab; advance footer |
| `src/components/bids/IntakeModal.tsx` | `product_type`, `contact_name`, `contact_email` fields |

---

## Feature Specs

### 1. Add Question / Add Deliverable (inline forms)

Both are collapsed by default — only a `+ Add question` / `+ Add deliverable` text link is shown at the bottom of the relevant list. Clicking it expands an inline form.

**Add Question fields:**
- `question_text` — `<textarea>` 2 rows, placeholder "Enter question text…"
- `assigned_team` — `<select>` with Pre-Sales / Legal / Finance
- Submit → `useCreateQuestion` → collapse form → list refreshes

**Add Deliverable fields:**
- `label` — `<input>` text, placeholder "Deliverable name…"
- `type` — `<select>` with Document / Review / Approval / Other
- `assigned_team` — same select
- Submit → `useCreateDeliverable` → collapse → refresh

The `+ Add` link always appears, even when the list is empty. This replaces the "No questions for this stage" empty state — the empty state message remains but the add link sits below it.

---

### 2. Response editor on QuestionRow

Clicking anywhere on the question text row (not the status toggle) expands a response panel below it.

**Expanded panel:**
```
┌─────────────────────────────────────────────────────┐
│ [question text]                              [▲ close]│
│─────────────────────────────────────────────────────│
│ Your response:                                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ textarea — 4 rows, auto-grow                     │ │
│ └─────────────────────────────────────────────────┘ │
│ [Internal notes (optional)]                         │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 1-row input (internal_notes field)               │ │
│ └─────────────────────────────────────────────────┘ │
│ [Saves automatically on blur]                       │
└─────────────────────────────────────────────────────┘
```

- Saves `response_text` + `internal_notes` on blur (`useUpdateQuestionResponse`)
- If saved response is non-empty, automatically upgrades status to `in_progress` (if still `pending`) or leaves `done` alone
- A small `FileText` icon appears on the QuestionRow when `response_text` is non-null (indicator that a response exists)

---

### 3. Three-state question status toggle

The circular toggle button on `QuestionRow` cycles through three states on each click:

| State | Visual | Click result |
|---|---|---|
| `pending` | Dashed border, empty | → `in_progress` |
| `in_progress` | Solid amber border, amber dot | → `done` |
| `done` | Green fill, checkmark | → `pending` |

The status cycle calls the existing `useToggleQuestion` mutation which already accepts all four status values.

---

### 4. Clarification deadline in RFI

**In the RFI Details card** — two new rows appended after "Time Remaining":
- `Clarif. Deadline` — formatted date
- `Clarif. Time Left` — days countdown, styled urgent (amber) when ≤ 5 days

**Alert banner** — shown at the very top of the RFI Overview tab when `clarification_deadline` is within 3 days (or already past). Amber background, `AlertTriangle` icon, mentions the contact name if available (`bid.contact_name ?? "the client"`).

The banner is suppressed when `clarification_deadline` is null.

---

### 5. `/ai` bidId context

**Route change (`ai.tsx`):**
```ts
validateSearch: (s) => ({ bidId: s.bidId as string | undefined })
```

On mount, if `bidId` search param is present and `selectedBidId` is not yet set:
- Set `mode = "bid"`
- Set `selectedBidId = bidId`
- The existing `useEffect` on `bidSessionsQuery.data` auto-selects the most recent session for this bid, or the user can start a new one

**All workspace links:**
```tsx
<Link to="/ai" search={{ bidId: bid.id }}>Open RFx Responder</Link>
```
Affects 6 occurrences across 3 files.

---

### 6. AdvanceStageFooter

A shared component rendered at the bottom of every custom workspace's main content area.

**Conditions to show:**
- `stageIdx === currentIdx` — only shown when viewing the bid's current active stage
- At least one more stage exists after the current one

**Advance gate (DQ → RFI only):**
- Checks `bid.gonogo_decision === "go" || "conditional_go"`
- If not set: shows an `alert()` (same as existing generic workspace behaviour)
- All other stage advances have no gate

**Layout:**
```
[Stage: Deal Qualification]           [Advance to RFI →]
```
Left: muted label showing current stage. Right: orange/accent CTA button.

---

### 7. Won / Lost closeout (Contract stage)

Two buttons appear in the Contract Overview top row, to the right of the approval status:
- `Mark as Won` — green button, only shown when `bid.status === "active" || "submitted"`
- `Mark as Lost` — red ghost button, same condition

Clicking either opens a `CloseoutModal` dialog:

**Won:**
```
Mark as Won
─────────────────────────────────────
Final contract value: [number input, pre-filled with bid.value]
                                      [Cancel]  [Confirm Won ✓]
```

**Lost:**
```
Mark as Lost
─────────────────────────────────────
Reason lost (optional): [text area]
Final value (optional): [number input]
                                      [Cancel]  [Confirm Lost ✗]
```

On confirm:
1. `useUpdateBid` patches `{ status: "won" | "lost", value: finalValue }`
2. `supabase.from("bid_activity_log").insert` with action `bid_won` or `bid_lost` and metadata `{ reason_lost, final_value }`
3. Modal closes; bid disappears from the active pipeline; appears on `/closure`

---

### 8. Product type + contact fields

**IntakeModal additions:**
- `product_type` select — TA (Talent Acquisition / Skills Assessment) or TM (Talent Management / Skills Intelligence). Optional at intake. Placed in the row with `type` and `portal`.
- `contact_name` text input — "Procurement contact name" (optional)
- `contact_email` text input — "Contact email" (optional)

**BidDetailsTab additions:**
- Show `product_type`, `contact_name`, `contact_email`, `contact_phone` in the details grid
- Editable in the existing edit mode

**generateProposalFn (`generate-proposal.ts`):**
- Read `bid.product_type` from the fetched `bid` row in `buildProposalSystemBlocks`
- Pass it directly in the author prompt: `"product": "${bid.product_type ?? 'TA'}"` — removes the AI guessing logic

---

### 9. Document quick-viewer panel (RFI questionnaire tab)

A collapsible right panel added to the RFI Questionnaire tab layout.

**Default state:** collapsed (no extra width). A `FileText` icon button in the questionnaire card header toggles it open.

**Expanded state:** `w-64` panel slides in from the right. Shows:
- Header: "Documents (n)" with an X close button
- List of `useDocuments({ bidId: bid.id })` — file name, type badge, size
- Clicking a document opens the existing `DocPreviewModal`

The questionnaire list itself stays scrollable on the left. The split is `flex gap-4`:
- `flex-1 min-w-0` — questionnaire list
- `w-64 shrink-0` — doc panel (hidden when collapsed)

---

### 10. Inline team assignment

In the Team tabs of `DealQualificationWorkspace`, `RFIWorkspace`, and `RFPWorkspace` — an "Assign member" button shown at the bottom of the team list (or in the empty state).

**Popover contents:**
- Lists all `useTeamMembers()` active members not already assigned to this bid
- Each row: avatar, name, role badge, `+ Assign` button
- On click: `supabase.from("bid_assignments").insert({ bid_id, user_id })` → invalidate `["bid-team", bid.id]`

Existing assignments show a `Remove` (X) button instead.

---

## Health State — Not Started

When `total questions === 0` in `RFIWorkspace`:

| Property | Value |
|---|---|
| Badge label | "Not Started" |
| Badge colour | `var(--color-muted-foreground)` on `var(--color-muted)` |
| Health check 1 | "Add your first question" — info state (not warn) |
| Health check 2 | "Responses on schedule" — info / N/A |
| Health check 3 | "Deadline not overdue" — check actual deadline |

Same logic should apply to `RFPWorkspace` health.

---

## What is NOT Changing

- All AI / RAG plumbing (`stream-chat.ts`, `ai-queries.ts`, `doc-functions.ts`)
- The `generateProposalFn` template assembly logic — only `product_type` sourcing changes
- The `DealQualificationWorkspace` assessment scoring / insights / Go-No-Go generation
- All existing `bid_questions` and `bid_deliverables` DB columns (no removals, no renames)
- The `BidHeaderBar`, `StageJourney`, `PursuitRoster`, `BidWorkspaceRail` from the pursuits redesign
- The `/closure` page — it already reads `bid.status` correctly; it just gains new data to show
- RBAC / permissions model
- HubSpot sync
