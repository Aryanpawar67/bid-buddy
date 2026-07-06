# Simulation Bug Fixes — Implementation Plan
**Date:** 2026-07-06  
**Source:** `docs/superpowers/simulation/2026-07-06-full-pipeline-simulation.md`  
**Priority order:** Bug 1 (P0) → Bug 2 (P1) → Bug 3 (P2)

---

## Bug 1 — Team members invisible (P0)

**File:** `src/lib/bid-queries.ts` — `useBidTeam()`  
**Change:** One line — add FK hint to the PostgREST embed.

```ts
// BEFORE
.select("id, user_id, profiles(full_name, email), user_roles(role)")

// AFTER
.select("id, user_id, profiles!bid_assignments_user_id_fkey(full_name, email), user_roles(role)")
```

**Also check:** `useBidAssignments` — if it embeds `profiles` via `bid_assignments`, apply the same hint.

---

## Bug 2 — Qualification Result shows 0 when score locked externally (P1)

**File:** `src/components/bids/DealQualificationWorkspace.tsx` — `QualificationResultTab`

The summary card at the top of the Qualification Result tab computes everything from `assessmentData`. When `assessmentData.scores` is empty, add a fallback path that reads `bid.gonogo_score` and `bid.gonogo_decision`.

**Logic:**
```
if assessment_data.scores has entries → compute from params (current behaviour)
else if bid.gonogo_score is set → show stored score with "No parameter breakdown available" note
else → show "Insufficient Data" (current empty state)
```

**Specific changes:**

1. `computeScore()` — no change needed; it already returns 0 for empty scores.

2. In `QualificationResultTab` component — before the "Insufficient Data" / score display block, check:
```tsx
const hasParamScores = Object.keys(assessmentData?.scores ?? {}).length > 0;
const fallbackScore = !hasParamScores && bid.gonogo_score !== null ? bid.gonogo_score : null;
```

3. When `fallbackScore !== null`:
   - Show the score donut/number with `bid.gonogo_score` instead of 0
   - Show "Score Achieved: X%" derived from the stored score  
   - Replace "Bid Strength: Insufficient Data" with "Bid Strength: [computed label]"
   - Show a muted info banner: "Score was recorded without individual parameter breakdown. Fill the Bid Assessment tab to add detail."
   - The "Assessment Summary by Parameter" section still shows the "Complete the Bid Assessment tab" prompt

4. The right-panel "QUALIFICATION SCORE" gauge already reads from `bid.gonogo_score` for the threshold bar — that part is already correct and doesn't need to change.

---

## Bug 3 — `deliverable_type` enum too narrow (P2)

### Step A — DB migration
```sql
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'presentation';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'meeting';
```

### Step B — Update `AddDeliverableInline` forms
All 4 inline forms in: `RFIWorkspace.tsx`, `RFPWorkspace.tsx`, `BAFOWorkspace.tsx`, `DealQualificationWorkspace.tsx`

Add the new options to the `<select>` inside `AddDeliverableInline`:
```tsx
<option value="document">Document</option>
<option value="review">Review</option>
<option value="approval">Approval</option>
<option value="presentation">Presentation</option>
<option value="meeting">Meeting</option>
<option value="other">Other</option>
```

### Step C — Update Supabase types
Add new values to the `deliverable_type` enum in `src/integrations/supabase/types.ts`:
```ts
// Before
type deliverable_type = "approval" | "document" | "review"
// After
type deliverable_type = "approval" | "document" | "meeting" | "other" | "presentation" | "review"
```

---

## Implementation order

1. **Bug 1** — single-line fix, ship immediately. Unblocks the entire team workflow.
2. **Bug 2** — UI-only change, no migration needed. Ship with Bug 1.
3. **Bug 3** — requires DB migration. Apply migration first, then update UI + types.
