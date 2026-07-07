# Contract & Legal Tab — Overhaul Plan
**Date:** 2026-07-07  
**Stage:** `contract_closure`  
**File:** `src/components/bids/ContractWorkspace.tsx`

---

## Current state (what exists today)

| Tab | What it does |
|-----|-------------|
| Overview | Progress donut, Contract Details KVs, Approvals mini-panel (derived), Mark as Won/Lost closeout, Milestones preview, Docs preview, Legal AI Engine link, Health checklist, Key Risks |
| Milestones | Full toggleable `bid_deliverables` list for `contract_closure` stage |
| Documents | All `bid_documents` for the bid |
| Approvals | 4-step workflow (Legal → Commercial → Finance → Executive) — status **inferred** by regex-matching deliverable labels, not from real data |
| Team | Assigned members with role badges |
| Activity Log | `bid_activity_log` audit trail |

### What is fake / derived today

- **Approvals** — regex on deliverable labels. No actual approval record, no who/when, not actionable by legal/finance roles.
- **Key Risks** — open `bid_questions`, ranked by array index (no severity field).
- **Milestone owners + due dates** — `bid_deliverables` has no `assigned_to` or `due_date` columns.
- **Document categories** — all docs look the same; no way to mark a doc as draft vs redline vs final signed contract.
- **Contract health** — 4 hard-coded % thresholds; not contract-aware.

---

## Implementation plan

### Phase 1 — DB migration + real approvals (this session)

#### 1a. New table: `contract_approvals`

```sql
CREATE TABLE public.contract_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id      uuid NOT NULL REFERENCES public.bids(id) ON DELETE CASCADE,
  stage       text NOT NULL CHECK (stage IN ('legal','commercial','finance','executive')),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (bid_id, stage)
);
```

**RLS:**
- Everyone authenticated can read
- `legal` role can update `stage = 'legal'`
- `finance` role can update `stage = 'finance'`
- `admin` can update any stage
- `pre_sales` read-only

Rows are upserted (one row per bid × stage) when the bid advances to `contract_closure`.

#### 1b. New columns on `bid_deliverables`

```sql
ALTER TABLE public.bid_deliverables
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS due_date     date;
```

#### 1c. New column on `bid_documents`

```sql
ALTER TABLE public.bid_documents
  ADD COLUMN IF NOT EXISTS doc_category text DEFAULT 'reference'
    CHECK (doc_category IN ('draft','redline','final','reference','supporting'));
```

#### 1d. New queries in `bid-queries.ts`

- `useContractApprovals(bidId)` — fetches all rows for the bid, with approver profile join
- `useActionApproval()` — mutation: upsert approval row with `status`, `approved_by`, `approved_at`, `notes`
- `useEnsureApprovals(bidId)` — called when stage = `contract_closure`, inserts any missing `pending` rows

#### 1e. ContractWorkspace UI changes

**Approvals tab:**
- Replace derived logic with live `contract_approvals` rows
- Each stage row shows: status chip, approver name + date (if actioned), a Notes field
- Action buttons per row:
  - Legal/Finance role sees "Approve" / "Reject" only for their own stage
  - Admin sees action buttons on all stages
  - Pre-sales sees read-only status
- Rejection requires a note (inline input, mandatory)

**Milestones tab + Overview milestone list:**
- Show `due_date` badge next to each deliverable
- Show assignee avatar/initials (from `assigned_to` → profiles join)
- Inline edit for due date and assignee (popover)

**Documents tab:**
- Show `doc_category` badge (Draft / Redline / Final / Reference / Supporting)
- "Final" docs get a distinct visual treatment (green border, bold label)
- Filter pill bar at top: All | Draft | Redline | Final | Supporting

---

### Phase 2 — Risk register (next session)

Replace the positional-rank question proxy with a real risk model.

**New columns on `bid_questions`** (contract stage only):

```sql
ALTER TABLE public.bid_questions
  ADD COLUMN IF NOT EXISTS risk_level    text CHECK (risk_level IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS risk_category text CHECK (risk_category IN ('commercial','legal','operational','financial','technical'));
```

**UI:** Risk register tab replaces the current "Key Risks" section. Each risk item is editable. Risk matrix heatmap (2×2, likelihood × impact) in Overview.

---

### Phase 3 — Clause tracker (future)

New table `contract_clauses`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `bid_id` | uuid | FK bids |
| `document_id` | uuid | FK bid_documents |
| `clause_title` | text | e.g. "Indemnification" |
| `page_ref` | text | "§12.3, p.47" |
| `status` | enum | `accepted \| redlined \| rejected \| pending` |
| `redline_text` | text | Proposed alternative language |
| `owner` | uuid | FK profiles — who owns the redline |
| `resolved_at` | timestamptz | |

This pairs with the AI Command Center — "What are the high risk clauses?" generates structured output that can be saved as clause rows.

---

### Phase 4 — Post-signature obligations (future)

New table `contract_obligations`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `bid_id` | uuid | FK bids |
| `title` | text | e.g. "Quarterly SLA report" |
| `frequency` | text | `once \| monthly \| quarterly \| annually` |
| `next_due` | date | |
| `owner` | uuid | FK profiles |
| `status` | text | `pending \| completed \| overdue` |

Surfaces on the Dashboard "Needs Attention" list for won bids.

---

## What this session implements

- [x] Migration: `contract_approvals` table + `bid_deliverables.assigned_to/due_date` + `bid_documents.doc_category`
- [x] Types updated
- [x] `useContractApprovals`, `useActionApproval`, `useEnsureApprovals` queries
- [x] Approvals tab — real data, role-gated action buttons
- [x] Milestones tab — due dates + assignee display
- [x] Documents tab — category badges + filter

Phase 2–4 deferred to follow-on sessions.
