# Stage Workspace Overhaul — Implementation Plan
**Date:** 2026-07-07  
**Source audit:** `docs/superpowers/notes/stage-workspace-audit.md`  
**Scope:** All 8 pipeline stages

---

## Phase 1 — P0 fixes (no new tables needed)

### 1a. RFP Clarifications — restore response editor

**File:** `src/components/bids/RFPWorkspace.tsx`  
**Problem:** Clarifications tab renders questions display-only. No `QuestionRow` expand, no `response_text` editor.  
**Fix:** Replace the static list with the same `QuestionRow` component used in `RFIWorkspace.tsx`. Wire `useUpdateQuestionResponse` mutation. Add `AddQuestionInline`.

Estimated effort: ~30 min (copy pattern from RFI).

---

### 1b. BAFO — add AI link + fix Team assign/remove

**File:** `src/components/bids/BAFOWorkspace.tsx`

**Fix 1:** Add "Open RFx Responder" button to Overview tab header (same pattern as RFI).  
**Fix 2:** Replace static Team list with `AssignMemberPopover` + remove button (same pattern as DealQual Team tab).

Estimated effort: ~20 min.

---

### 1c. Deal Qualification — add RFx Responder entry point

**File:** `src/components/bids/DealQualificationWorkspace.tsx`  
**Fix:** Add a "Continue in RFx Responder →" link in the AI Insights section footer, and a small Qualification tab callout suggesting the AI for deeper analysis.

Estimated effort: ~15 min.

---

## Phase 2 — BAFO real data model

### 2a. Replace fake Pricing/Negotiation with real structure

**Option A (simpler — no migration):** Keep using `bid_questions` as the backing store but add a `category` field to questions. Replace the regex filter with `.eq("category", "pricing")` and `.eq("category", "negotiation")`. Add a category selector to `AddQuestionInline` for BAFO stage.

**Option B (proper — requires migration):** New tables `bafo_pricing_lines` and `bafo_negotiation_log`.

**Recommendation:** Option A for now. It's honest — BAFO line items and negotiation points are question-like in nature (text + response). A proper pricing model is a separate product feature.

**Migration (Option A):**
```sql
ALTER TABLE public.bid_questions
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'general'
    CHECK (category IN ('general','pricing','negotiation','compliance','security','technical'));
```

---

## Phase 3 — Dedicated workspaces for Orals, Due Diligence, Post Closure

### 3a. Orals workspace

**New file:** `src/components/bids/OralsWorkspace.tsx`

**Tabs:**
| Tab | Backing data | Notes |
|-----|-------------|-------|
| Overview | `bid_deliverables` (orals stage) | Progress checklist + run-of-show |
| Presentation Q&A | `bid_questions` (orals stage) | Likely panel questions + prepared answers |
| Attendees | `bid_assignments` (display) + freeform client attendees JSONB on `bids` | Internal team + client panel |
| Documents | `bid_documents` | Presentation decks, leave-behinds |
| Activity Log | `bid_activity_log` | |

**AI integration:** "Prepare for Orals" quick actions in RFx Responder — "What questions is the panel likely to ask?", "Summarise our key differentiators".

**Schema addition:**
```sql
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS orals_attendees jsonb DEFAULT '[]';
```

---

### 3b. Due Diligence workspace

**New file:** `src/components/bids/DueDiligenceWorkspace.tsx`

**Tabs:**
| Tab | Backing data | Notes |
|-----|-------------|-------|
| Overview | `bid_deliverables` (due_diligence stage) | Document request tracker |
| Security Q&A | `bid_questions` (due_diligence stage) | Compliance/security questionnaire |
| Team | `bid_assignments` | |
| Documents | `bid_documents` | |
| Activity Log | `bid_activity_log` | |

**AI integration:** "Open RFx Responder" → answer security/compliance questions from the knowledge base. High value — this is where iMocha's security docs (ISO certs, SOC2, data residency) get referenced repeatedly.

---

### 3c. Post Closure workspace

**New file:** `src/components/bids/PostClosureWorkspace.tsx`

**Tabs:**
| Tab | Backing data | Notes |
|-----|-------------|-------|
| Overview | `bid_deliverables` (post_closure stage) | Handover checklist |
| Debrief | New JSONB column on `bids` or separate table | Win/loss structured debrief |
| Obligations | New `contract_obligations` table (Phase 4 of contract overhaul) | Recurring post-signature deliverables |
| Documents | `bid_documents` | Case study, references |
| Activity Log | `bid_activity_log` | |

**AI integration:** "Draft case study from this bid", "Generate win/loss retrospective".

**Schema additions:**
```sql
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS debrief_data jsonb DEFAULT '{}';
-- debrief_data structure: { win_factors: [], loss_factors: [], lessons: [], competitor: "" }
```

---

## Phase 4 — Contract: risk register + obligations (continuation of contract overhaul)

### 4a. Risk register on bid_questions

```sql
ALTER TABLE public.bid_questions
  ADD COLUMN IF NOT EXISTS risk_level    text CHECK (risk_level IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS risk_category text CHECK (risk_category IN ('commercial','legal','operational','financial','technical'));
```

Replace positional Key Risks in `ContractWorkspace` Overview with real risk-tagged questions.

### 4b. Contract obligations table

```sql
CREATE TABLE public.contract_obligations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id     uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  title      text NOT NULL,
  frequency  text CHECK (frequency IN ('once','monthly','quarterly','annually')),
  next_due   date,
  owner      uuid REFERENCES public.profiles(id),
  status     text DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue')),
  created_at timestamptz DEFAULT now()
);
```

Surfaces on Dashboard "Needs Attention" strip for won bids.

---

## Phase 5 — Cross-stage AI context (no new schema)

**Problem:** RFI responses don't carry forward into RFP context.  
**Solution (AI layer):** Already partially solved — all bid documents are indexed and searchable by the RAG pipeline across stages. The gap is in the *prompt*, not the data.

**Fix:** In `buildSystemBlocks()` in `stream-chat.ts`, when `bid.stage` is `rfp`, add a block telling the model: "RFI responses are available in the knowledge base — search for them when answering clarification questions." No schema change needed.

---

## Migration summary

| Migration file | What it adds | Phase |
|----------------|-------------|-------|
| `20260707200000_bafo_question_category.sql` | `bid_questions.category` enum | 2a |
| `20260707210000_orals_attendees.sql` | `bids.orals_attendees` JSONB | 3a |
| `20260707220000_post_closure.sql` | `bids.debrief_data` JSONB | 3c |
| `20260707230000_contract_risk_obligations.sql` | `bid_questions.risk_level/category`, `contract_obligations` table | 4a/4b |

---

## Implementation order (recommended)

```
Phase 1a — RFP Clarifications editor      (30 min, no migration)
Phase 1b — BAFO AI link + Team fix        (20 min, no migration)
Phase 1c — DealQual AI entry point        (15 min, no migration)
── discuss & approve ──────────────────────────────────────────
Phase 2a — BAFO question categories       (migration + 1hr UI)
Phase 3a — Orals workspace                (migration + 3hr UI)
Phase 3b — Due Diligence workspace        (no migration + 2hr UI)
Phase 3c — Post Closure workspace         (migration + 2hr UI)
Phase 4a — Risk register                  (migration + 1hr UI)
Phase 4b — Contract obligations           (migration + 2hr UI)
Phase 5  — Cross-stage AI prompt fix      (30 min, no migration)
```

---

## Open questions for internal discussion

1. **BAFO Pricing model depth** — Option A (questions with category) vs Option B (dedicated line-item table). Line items would unlock proper price comparison, discount tracking, and margin calculation. Worth the extra schema complexity?

2. **Orals attendees** — JSONB on `bids` is quick but can't be linked to `profiles` for internal attendees. Should internal attendees come from `bid_assignments` and only client-side panel be freeform?

3. **Post Closure obligations** — Should these surface on the Dashboard "Needs Attention" strip for won bids? This changes the Dashboard query.

4. **Debrief data** — JSONB on `bids` vs a separate `bid_debriefs` table. A table would let you run analytics across all debriefs (common win factors, recurring loss reasons). Worth it for the analytics view?

5. **Cross-stage question carryover** — Should RFI responses auto-copy to RFP as starting points? Or keep them separate and rely on the AI to bridge them? Manual copy could pollute the RFP Q&A with RFI-specific content.
