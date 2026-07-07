# Stage Workspace Audit
**Date:** 2026-07-07  
**Scope:** All 8 pipeline stages — what exists, what's fake, what's missing, how they connect

---

## Pipeline map

```
Deal Qualification → RFI → RFP → Orals → Due Diligence → BAFO → Contract & Closure → Post Closure
     Stage 1          2      3      4           5            6           7                  8
```

Stages 1, 2, 3, 6, 7 have dedicated workspace components.  
Stages 4, 5, 8 fall through to a generic `StageWorkspace` — deliverables checklist only.

---

## Stage 1 — Deal Qualification

**Component:** `DealQualificationWorkspace.tsx`  
**Tabs:** Bid Details · Qualification · Qualification Result · Team · Activity Log

| Tab | Status | Notes |
|-----|--------|-------|
| Bid Details | ✅ Real | Editable KVs (title, client, value, deadline, portal, product type, contact). Edit mode with inline save. |
| Qualification | ✅ Real | 10-parameter scorecard, scored 0–4 per param. Persisted in `bids.assessment_data` JSONB. AI Insights auto-generated via streaming Haiku call. |
| Qualification Result | ✅ Real | Computed `totalScore`, win probability, go/no-go verdict. **Stage lock** — can't advance until a decision is recorded. |
| Team | ✅ Real | `useBidTeam` — assign/remove members, role badges. |
| Activity Log | ✅ Real | `useBidActivityLog` |

**What's missing:**
- No entry point to the AI Command Centre. "AI Insights" is a one-shot isolated call — its output doesn't become a session in the RFx Responder and can't be continued.
- Score thresholds (35 = go, 20 = caution) are hardcoded constants, not configurable.
- No document upload shortcut at this stage (user must navigate to Knowledge Hub separately).

---

## Stage 2 — RFI

**Component:** `RFIWorkspace.tsx`  
**Tabs:** Overview · Q&A · Team · Activity Log

| Tab | Status | Notes |
|-----|--------|-------|
| Overview | ✅ Real | Deliverables checklist (`useStageItems`), progress %, DocQuickPanel slide-in for documents |
| Q&A | ✅ Real | `bid_questions` for RFI stage. `QuestionRow` expands for inline response editing. `AddQuestionInline`. |
| Team | ✅ Real | Assign/remove members |
| Activity Log | ✅ Real | |

**AI integration:** Strong — "Open RFx Responder" button in Questions tab header routes to `/ai?bid=<id>`.

**What's missing:**
- No progress/health indicator for Q&A completion (e.g. "12/20 questions answered").
- No way to mark a question as "sent to client" vs "answered internally".

---

## Stage 3 — RFP

**Component:** `RFPWorkspace.tsx`  
**Tabs:** Overview · Clarifications · Team · Activity Log

| Tab | Status | Notes |
|-----|--------|-------|
| Overview | ✅ Real | Deliverables checklist. Full RFx Responder quick-action strip with 3 cards: "Draft Executive Summary", "Answer Evaluation Criteria", "Generate Proposal". |
| Clarifications | ⚠️ **Broken** | `bid_questions` for RFP stage render correctly but are **display-only** — no inline response editor, no expand-on-click. Regression vs RFI which has full editing. |
| Team | ✅ Real | |
| Activity Log | ✅ Real | |

**AI integration:** Strongest of all stages — full strip in Overview. "Generate Proposal" chip in the AI Command Centre is gated to RFP stage only.

**What's missing:**
- Clarifications tab response editor (P0 — should match RFI Q&A behaviour).
- No "Send to client" state on clarification items.
- No submission deadline tracker (RFP portal deadline is just the bid deadline — no separate submission deadline field).

---

## Stage 4 — Orals

**Component:** Generic `StageWorkspace` fallback  
**What it has:** Deliverables checklist, progress bar, "Advance to Due Diligence" button.

**Missing entirely:** Questions, Team, Documents, Activity Log, AI link, any Orals-specific context.

**What a real Orals workspace needs:**
- Presentation builder / run-of-show checklist
- Demo script / talking points (Q&A for likely panel questions)
- Attendees (client side + internal presenters) — distinct from bid team
- Presentation materials (link to docs)
- Outcome capture (panel feedback, follow-up items)
- AI link: "Prepare for Orals" quick actions in RFx Responder

---

## Stage 5 — Due Diligence

**Component:** Generic `StageWorkspace` fallback  
**What it has:** Same as Orals.

**What a real Due Diligence workspace needs:**
- Document request tracker (client asks for X, we submit Y — status per item)
- Security questionnaire workspace (similar to RFI Q&A but compliance-focused)
- Checklist with assigned owners and due dates
- Risk flags
- AI link: answer compliance/security questions using knowledge base

---

## Stage 6 — BAFO

**Component:** `BAFOWorkspace.tsx`  
**Tabs:** Overview · Pricing · Negotiation · Team · Activity Log

| Tab | Status | Notes |
|-----|--------|-------|
| Overview | ✅ Real | Deliverables checklist + `AddDeliverableInline` |
| Pricing | ❌ **Fake** | Regex filter on `bid_questions` matching `/price\|cost\|pricing\|budget\|rate/i`. No real pricing model. |
| Negotiation | ❌ **Fake** | Regex filter on `bid_questions` matching `/negotiat\|term\|condition\|clause\|discount/i`. Same underlying table as Pricing. |
| Team | ⚠️ Partial | Shows members, **no assign/remove buttons**. Display only. |
| Activity Log | ✅ Real | |

**AI integration:** None. Only dedicated stage with zero path to the RFx Responder.

**What's missing:**
- Real pricing model (line items, discount %, final price vs list price)
- Negotiation log (position changes, concessions, red lines)
- Assign/remove on Team tab
- AI link for "Compare our BAFO to competitor pricing" type queries

---

## Stage 7 — Contract & Closure

**Component:** `ContractWorkspace.tsx`  
**Tabs:** Overview · Milestones · Documents · Approvals · Team · Activity Log

| Tab | Status | Notes |
|-----|--------|-------|
| Overview | ✅ Real | Approval mini-panel (live `contract_approvals`), progress donut, milestone/docs preview, Legal AI Engine link, health checklist, Key Risks |
| Milestones | ✅ Real | `bid_deliverables` with `due_date` badge + `assigned_to` display |
| Documents | ✅ Real | `bid_documents` with `doc_category` filter pills (Draft/Redline/Final/Reference/Supporting) + badges |
| Approvals | ✅ Real | Live `contract_approvals` — role-gated Approve/Reject, rejection requires note, approver name + date shown |
| Team | ✅ Real | |
| Activity Log | ✅ Real | |

**AI integration:** "Legal AI Engine" link in Overview → `/ai?bid=<id>`.

**Remaining gaps:**
- Key Risks is still positional (first 5 open questions, ranked by array index). Phase 2 risk register needed.
- `useEnsureApprovals` must be called when bid advances to this stage, not just on component mount.
- No executed contract reference field (DocuSign link, effective date, contract number).
- No counterparty legal contact fields.

---

## Stage 8 — Post Closure

**Component:** Generic `StageWorkspace` fallback  
**What it has:** Deliverables checklist only.

**What a real Post Closure workspace needs:**
- Win/loss debrief capture (structured, not just a text field)
- Lessons learned log
- Obligation tracker (recurring deliverables post-signature: reports, SLA reviews, renewal notices)
- References/case study status
- Relationship contacts (account team handover)
- AI link: generate retrospective, draft case study

---

## Cross-stage data model

### What is bid-scoped (persists across all stages)
| Table | Scope | Notes |
|-------|-------|-------|
| `bid_documents` | Bid | All uploads visible in every stage |
| `bid_assignments` | Bid | Same team across all stages |
| `bid_activity_log` | Bid | Every mutation in every stage appears in every stage's log |
| `ai_sessions` | Bid | All sessions visible in RFx Responder sidebar regardless of stage |
| `contract_approvals` | Bid | Stage 7 only |
| `bids` (core record) | Bid | `stage`, `status`, `value`, `gonogo_score`, `assessment_data` |

### What is stage-scoped
| Table | Scope | Notes |
|-------|-------|-------|
| `bid_questions` | `stage` column | Each workspace only shows its own stage |
| `bid_deliverables` | `stage` column | Same |

### What doesn't flow forward
- RFI question responses don't pre-populate into RFP clarifications
- No context is programmatically passed between stage transitions
- The AI layer partially bridges this — documents uploaded at any stage are indexed and searchable in the RFx Responder across all stages

---

## AI Command Centre integration map

| Stage | Integration | Quality |
|-------|------------|---------|
| Deal Qualification | Inline AI Insights only (isolated, not a session) | ❌ Siloed |
| RFI | "Open RFx Responder" button in Q&A tab | ✅ Direct |
| RFP | Full RFx strip in Overview + banner in Clarifications | ✅ Best |
| Orals | None | ❌ Missing |
| Due Diligence | None | ❌ Missing |
| BAFO | **None** | ❌ Missing |
| Contract & Closure | "Legal AI Engine" link in Overview | ✅ Present |
| Post Closure | None | ❌ Missing |

**Session continuity:** Sessions are bid-scoped. A session started at RFI stage is still accessible at BAFO stage in the sidebar. The AI always has access to all indexed documents for the bid, regardless of which stage uploaded them.

---

## Summary of gaps by priority

| Priority | Gap | Stage |
|----------|-----|-------|
| P0 | RFP Clarifications tab has no response editor | RFP |
| P0 | BAFO has no AI link | BAFO |
| P1 | Orals — no dedicated workspace | Orals |
| P1 | Due Diligence — no dedicated workspace | Due Diligence |
| P1 | Post Closure — no dedicated workspace | Post Closure |
| P1 | BAFO Pricing/Negotiation tabs are regex fakes | BAFO |
| P1 | BAFO Team tab missing assign/remove | BAFO |
| P1 | Deal Qualification has no RFx Responder entry point | Deal Qual |
| P2 | Contract Key Risks still positional (no risk register) | Contract |
| P2 | No question status ("sent to client" vs "answered") | RFI, RFP |
| P3 | No cross-stage answer carryover (RFI → RFP) | RFI→RFP |
| P3 | Post Closure obligation tracker | Post Closure |
