# Full Pipeline Simulation — Apex Capital Partners
**Date:** 2026-07-06  
**Method:** Supabase REST API via Python (terminal, no browser)  
**Bid ID:** `4e86e1e0-830b-4a90-a434-cce12ad6bec2`  
**Script:** `scratchpad/simulate.py`

---

## What Was Simulated

A complete pursuit lifecycle for a fictional TM (Talent Management) deal: **Apex Capital Partners — Skills Intelligence Platform**. Every stage from Deal Qualification to Post Closure was walked through, creating real rows in the database matching what a pre-sales analyst would produce manually.

---

## Stage-by-Stage Results

### Stage 1 — Deal Qualification

| Action | Result |
|---|---|
| Bid created with all fields (product_type=TM, contact, deadlines) | ✅ Row in `bids` with correct values |
| Stage history recorded | ✅ Row in `bid_stage_history` |
| Activity log: `bid_created` | ✅ |
| 3 team members assigned (Aryan, Shrenik, Nishant) | ✅ 3 rows in `bid_assignments` — but **invisible in UI** (see Bug 1) |
| 3 DQ questions answered with responses | ✅ Rows in `bid_questions` with `status=done` and `response_text` |
| 2 DQ deliverables (document, approval) | ✅ |
| Go/No-Go decision written: score=81, decision=go | ✅ `bids.gonogo_score=81`, `bids.gonogo_decision=go` — but **Qualification Result tab shows 0** (see Bug 2) |

**UI observation:** Bid Details tab renders correctly (contact card, Go/No-Go card, clarification deadline). Procurement Contact (Priya Nair) visible. Qualification Decision card shows correctly.

---

### Stage 2 — RFI

| Action | Result |
|---|---|
| Stage advanced to `rfi` | ✅ Stage pill highlights correctly in StageJourney |
| 8 client RFI questions added with full responses | ✅ All with `status=done` |
| Responses cover: skills inference, HRMS integrations, GDPR, case studies, SLA, implementation, analytics, pricing | ✅ |
| 3 deliverables (document×2, approval×1) | ✅ |

**UI observation:** RFI Questionnaire tab shows all 8 questions. Response editor expands correctly. Health card shows "On Track". Clarification deadline alert visible (deadline: 2026-07-18).

---

### Stage 3 — RFP

| Action | Result |
|---|---|
| Stage advanced to `rfp` | ✅ |
| 5 RFP questions answered | ✅ |
| 4 deliverables | ✅ |
| Activity: `rfp_submitted` | ✅ |

**UI observation:** RFP Questionnaire tab functions identically to RFI. Generate Proposal chip visible (RFP stage — correct, as per roadmap gating).

---

### Stage 4 — Orals

| Action | Result |
|---|---|
| Stage advanced to `orals` | ✅ |
| 3 deliverables attempted: document, document, **other** | ⚠️ 2 succeeded; 1 failed silently — `deliverable_type` enum has no `"other"` value (see Bug 3) |
| Activity: `orals_completed` | ✅ |

---

### Stage 5 — Due Diligence

| Action | Result |
|---|---|
| Stage advanced to `due_diligence` | ✅ |
| 2 questions answered (security questionnaire, financial audit) | ✅ |
| 3 deliverables (document×2, review×1) | ✅ |

---

### Stage 6 — BAFO

| Action | Result |
|---|---|
| Stage advanced to `bafo` | ✅ |
| 2 negotiation questions answered | ✅ |
| 3 deliverables | ✅ |

---

### Stage 7 — Contract & Closure

| Action | Result |
|---|---|
| Stage advanced to `contract_closure` | ✅ |
| 4 deliverables (MSA, DPA, SOW, PO) | ✅ |
| Bid marked WON: `status=won`, `value=465000` | ✅ |
| Activity: `bid_won` | ✅ |

---

### Stage 8 — Post Closure

| Action | Result |
|---|---|
| Stage advanced to `post_closure` | ✅ |
| 3 deliverables attempted — 2 succeeded, 1 failed (type "other") | ⚠️ Same enum bug |
| Activity: `pursuit_complete` | ✅ |

---

## Final DB State (Verified)

```
Questions    : 20 total | 20 answered
Deliverables : 22 total | 22 done  (3 failed silently due to enum gap)
Team members : 3 assigned (in DB, invisible in UI)
Activity log : 14 entries
Stage history: 8 entries (one per stage)
```

---

## Bugs Found

### Bug 1 — Team members invisible in UI (code bug, P0)

**Symptom:** "Bid Team Details" tab shows "0 members" and "No team members assigned". Clicking "Assign member" shows "All members already assigned." — meaning the DB rows exist but the component renders nothing.

**Root cause:** `useBidTeam` in `bid-queries.ts` runs:
```ts
.select("id, user_id, profiles(full_name, email), user_roles(role)")
```
`bid_assignments` has **two foreign keys to `profiles`**: `user_id` and `assigned_by`. PostgREST returns `PGRST201` (ambiguous relationship) and the query fails silently — the error is swallowed, `data` is undefined, and the component renders the empty state.

**Fix:** Use explicit FK hint in the select:
```ts
.select("id, user_id, profiles!bid_assignments_user_id_fkey(full_name, email), user_roles(role)")
```

**Also affects:** `AssignMemberPopover` in `useBidAssignments` — needs the same fix to correctly identify already-assigned members.

---

### Bug 2 — Qualification Result shows 0 even after Go/No-Go is locked (design gap, P1)

**Symptom:** Qualification Result tab shows "0 out of 100 / Insufficient Data" even though `bids.gonogo_score = 81` and `bids.gonogo_decision = go` are set.

**Root cause — two separate score stores:**
- `bids.gonogo_score` (numeric) — written when the user locks the decision via the UI, or set directly via API
- `bids.assessment_data` (JSONB) — `{ scores: { param_id: 0–5 }, comments: {} }` — written parameter by parameter via the Bid Assessment tab

`computeScore()` reads **only** from `assessment_data.scores`. If `assessment_data` is `{}`, the result is always 0 regardless of what `gonogo_score` says.

**Two sub-problems:**
1. When a bid arrives with a pre-existing score (imported from HubSpot, API-seeded, or historically migrated), the Qualification Result tab is blind to it.
2. There is no fallback: if `assessment_data` is empty but `gonogo_score` is set, the UI should at least acknowledge that a locked decision exists — not show "Insufficient Data" next to a visible "Decision Locked: Go" card.

**Fix:** When `assessment_data.scores` is empty but `bid.gonogo_score` is non-null, the Qualification Result tab should show the stored score with a note: "Score was set without individual parameter breakdown." The Decision Locked card already shows correctly — the summary card above it should not contradict it.

---

### Bug 3 — `deliverable_type` enum missing common values (data model gap, P2)

**Symptom:** Deliverables with `type: "other"` fail silently with `22P02: invalid input value for enum deliverable_type`.

**Root cause:** The `deliverable_type` enum only contains: `document | review | approval`. Missing real-world deliverable types that appear throughout a pursuit.

**Fix:** DB migration to extend the enum:
```sql
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'presentation';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'meeting';
```
And update the `type` select in all workspace `AddDeliverableInline` forms to include these options.

---

### Non-Bug Observations (expected limitations)

| Observation | Root cause | Action needed |
|---|---|---|
| Documents section empty | Binary file upload can't be done via REST API without actual file bytes. The simulation is terminal-only. | None — expected. Real users upload via UI. |
| Bid Assessment tab empty | 10-parameter form was never filled; only `gonogo_score` was written directly. | Covered by Bug 2 fix. |
| `gonogo_completed_at` shows as "06/07/2026" | Locale: JS `toLocaleDateString()` with no explicit locale shows MM/DD. The date is correct (July 6), just displayed in US format. | Minor UX — consider `{ day: 'numeric', month: 'short', year: 'numeric' }` locale-safe format. |
| `useBidAssignments` `primary_role` field | The hook joins `user_roles` to get role; but `user_roles` can have multiple rows per user. Currently takes first row. | No data loss — first row is correct for single-role users. |

---

## What the Simulation Proved

1. **The stage progression mechanics work end-to-end** — all 8 stages advance correctly, history is recorded, activity log is accurate.
2. **Questions and deliverables are the backbone** — 20 questions and 22 deliverables across stages are the primary unit of work. The UI surfaces them correctly per stage.
3. **The team assignment query is broken** — a real pursuit can't function without seeing who's assigned. This blocks daily use.
4. **The Qualification workflow has a UX contradiction** — a bid can show "Decision: Go" in one panel and "0/100 Insufficient Data" in the adjacent panel. This breaks trust in the tool.
5. **The `deliverable_type` enum is too narrow** — real pursuits need presentation, meeting, and miscellaneous deliverable types. Silent failures are dangerous in a data entry tool.
