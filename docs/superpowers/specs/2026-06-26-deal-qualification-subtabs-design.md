# Deal Qualification — Subtabs Design Spec

**Date:** 2026-06-26  
**Status:** Approved → In Implementation  
**Scope:** Pursuits > Deal Qualification stage workspace

---

## Problem

The Deal Qualification stage currently renders the same generic `StageWorkspace` as every other stage — a flat list of Bid Details + a Checklist + a link to a separate Go/No-Go scorecard route. This provides no structured way to capture team composition, run a weighted bid assessment, or view a qualification decision inline.

---

## Decision

Replace the generic workspace for `deal_qualification` with a dedicated tabbed component. Remove the old `/bids/$id/gonogo` route entirely — its purpose is absorbed by the new **Bid Assessment** and **Qualification Result** subtabs.

---

## Architecture

### Component boundary

`StageWorkspace.tsx` gains a single conditional at the top of its render:

```tsx
if (stage === "deal_qualification") {
  return <DealQualificationWorkspace bid={bid} />;
}
// ...existing generic workspace
```

All existing helpers (`Metric`, `Card`, `KV`, `ChecklistRow`) stay in `StageWorkspace.tsx` and are imported by the new component.

### New file

`src/components/bids/DealQualificationWorkspace.tsx` — single file, all 5 subtabs co-located (~450–550 lines).

### Deleted file

`src/routes/_app/bids.$id.gonogo.tsx` — removed. The `gonogo_score`, `gonogo_decision`, `gonogo_completed_at`, `gonogo_completed_by` columns on `bids` are retained and written by the Qualification Result tab.

### Database change

```sql
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS assessment_data jsonb NOT NULL DEFAULT '{}'::jsonb;
```

Shape: `{ scores: { [criterionId: string]: number }, comments: { [criterionId: string]: string } }`

---

## Subtabs

### 1. Bid Details

**Data:** `bid` object from `useBid()` (already in scope — no extra fetch).

**Displays:**
- Client name, bid title, type (RFP/RFI/RFQ/Direct), priority, procurement portal
- Deadline + urgency label, deal value, clarification deadline
- Current stage status badge
- Go/No-Go summary row (score + decision) when `gonogo_decision` is set

**No edit UI in v1** — values come from intake. May add inline editing in a future iteration.

---

### 2. Bid Team Details

**Data:** `useBidTeam(bidId)` — new hook that joins `bid_assignments` with `profiles`.

**Displays:**
- Table: Avatar initials · Full name · Role · Email
- Empty state: "No team members assigned to this bid yet."

**Read-only in v1.** Team assignment is managed in Settings > Team.

---

### 3. Bid Assessment

**Data:** `useAssessmentData(bidId)` / `useSaveAssessment()` — reads/writes `bids.assessment_data`.

**Table columns:** `#` · `Assessment Parameter` · `What should be assessed?` · `Weight` · `Score (1–5)` · `Comments` · `Weighted Score`

**Default criteria (10 rows):**

| # | Parameter | Focus | Weight |
|---|-----------|-------|--------|
| 1 | Strategic Opportunity Fit | Alignment with iMocha core offerings | 15% |
| 2 | Business Problem Clarity | Clearly defined challenge + measurable outcomes | 10% |
| 3 | Use Case Alignment | Supported by iMocha without major customisation | 10% |
| 4 | Customer Stakeholder & Decision Readiness | Executive sponsor, decision makers engaged | 10% |
| 5 | Commercial Attractiveness | Deal size, ARR, expansion potential, logo value | 10% |
| 6 | Competitive Position | Clear differentiators, incumbents understood | 10% |
| 7 | Implementation Feasibility | Realistic delivery within timeline + resources | 10% |
| 8 | Technical & Security Fit | API, SSO, HRMS/LMS, compliance, hosting | 10% |
| 9 | Proposal Risk Assessment | Scope ambiguity, timeline, customisation risk | 10% |
| 10 | Value Realization & Expansion Potential | Measurable outcomes, future expansion doors | 5% |

**Weighted Score per row** = `(score / 5) × weight × 100` — displayed as `e.g. 12.0 / 15.0`

**Footer:** Total Weighted Score out of 100.

**Interaction:**
- Score: 5 clickable pill buttons (1–5), purple when selected (matching existing scorecard style)
- Comments: inline single-line text input, expands on focus
- Save button: explicit save (not auto-save) to avoid noisy writes; button disabled when no unsaved changes

**Editability (deferred):** Criteria labels, focus descriptions, and weights are hardcoded as `DEFAULT_CRITERIA` in v1. A future admin settings panel will allow org-wide customisation. This is noted as a `// TODO: load from org_settings` comment in the constant.

---

### 4. Qualification Result

**Data:** Computed from `assessment_data.scores` + `DEFAULT_CRITERIA` weights. Writes to `bids.gonogo_score`, `bids.gonogo_decision`, `bids.gonogo_completed_at`, `bids.gonogo_completed_by`.

**Displays:**
- Large score number (0–100) with coloured verdict ring:
  - ≥ 65 → Go (success green)
  - 45–64 → Conditional Go (warning amber)
  - < 45 → No Go (danger red)
- Decision badge with label
- Breakdown table: each criterion's weighted contribution
- **"Lock Go/No-Go Decision"** button → `useUpdateBid()` writes the four gonogo fields
- When locked: shows locked state with `gonogo_completed_at` timestamp + user initials from `gonogo_completed_by`

**Gate:** The Advance to RFI hard-block in `StageWorkspace.advance()` continues checking `bid.gonogo_decision !== null` — unchanged behaviour.

**Score computation:** Criteria not yet scored (score = 0 or missing) contribute 0 to the total, so the result is live/partial until all 10 are scored.

---

### 5. Activity Log

**Data:** `useBidActivity(bidId)` — new hook querying `bid_activity_log` ordered by `created_at DESC`.

**Displays:**
- Timeline list: timestamp · actor initials avatar · action description
- Empty state: "No activity recorded yet."
- Read-only.

---

## UI Conventions

All within existing design system — no new tokens or utilities needed:

| Element | Class pattern |
|---------|---------------|
| Tab bar | Same pill style as Stages/Documents toggle in `bids.$id.tsx` |
| Cards | `bg-card hairline border rounded-xl p-3.5 mb-3.5` |
| Table rows | `text-[12px]`, `divide-y hairline divide-border` |
| Score pills | `size-7 rounded-md text-[11px] hairline border` (existing Go/No-Go style) |
| Active tab | `bg-primary text-white border-primary` |
| CTA (Lock Decision) | `bg-accent text-accent-foreground` |
| Verdict colours | Existing `success-soft`, `warning-soft`, `danger-soft` tokens |

The **Advance to RFI** button is pinned to the bottom of the workspace, visible regardless of active subtab.

---

## New Query Hooks

Added to `src/lib/bid-queries.ts`:

```ts
// Read team members assigned to a bid
useBidTeam(bidId: string)
// → { members: { id, full_name, email, primaryRole, initials }[] }

// Read assessment scores + comments for a bid
useAssessmentData(bidId: string)
// → { scores: Record<string, number>, comments: Record<string, string> }

// Save assessment data
useSaveAssessment()
// → mutate({ bidId, data: { scores, comments } })

// Read activity log for a bid
useBidActivity(bidId: string)
// → { events: { id, action, actor_name, created_at }[] }
```

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260626120000_assessment_data.sql` | New — adds `assessment_data` column |
| `src/lib/bid-queries.ts` | Add 4 new hooks |
| `src/components/bids/DealQualificationWorkspace.tsx` | New — full tabbed workspace |
| `src/components/bids/StageWorkspace.tsx` | Add conditional render + import |
| `src/routes/_app/bids.$id.gonogo.tsx` | Deleted |

---

## Out of Scope (v1)

- Editable criteria/weights via admin settings panel
- Team member assignment UI within the tab
- Inline editing of Bid Details fields
- Assessment data export / PDF
