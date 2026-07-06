# Pursuit Pipeline Fixes — Implementation Plan

**Date:** 2026-07-06
**Spec:** `docs/superpowers/specs/2026-07-06-pursuit-pipeline-fixes.md`
**Parked automation:** `docs/superpowers/notes/rfi-rfp-automation-roadmap.md`
**Depends on:** All existing hooks in `bid-queries.ts`, `useDocuments`, `useBidTeam`, `useTeamMembers`, `useUpdateBid`

---

## Goal

Fix every broken workflow in the pursuit pipeline identified by the E2E simulation run. Eleven discrete changes across 9 files, grouped into 11 waves ordered by dependency. Waves 1–7 require no DB migration. Waves 8–11 require applying the migration first.

---

## Pre-requisite: DB Migration

Apply before starting Wave 8–11 tasks. Safe to apply immediately — all four columns are nullable with no default:

```sql
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS product_type text CHECK (product_type IN ('TA', 'TM')),
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;
```

After applying, regenerate types:
```bash
supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

---

## Wave 1 — Prop pass-through + health fix (no-risk)

### Task 1.1 — Pass `onTabChange` to all custom stage workspaces
**File:** `src/components/bids/StageWorkspace.tsx`

Update all four custom workspace render lines (currently lines 26–29):

```tsx
// Before
if (stage === "rfi")  return <RFIWorkspace bid={bid} activeTab={activeTab} />;
if (stage === "rfp")  return <RFPWorkspace bid={bid} activeTab={activeTab} />;
if (stage === "bafo") return <BAFOWorkspace bid={bid} activeTab={activeTab} />;
if (stage === "contract_closure") return <ContractWorkspace bid={bid} activeTab={activeTab} />;

// After
if (stage === "rfi")  return <RFIWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
if (stage === "rfp")  return <RFPWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
if (stage === "bafo") return <BAFOWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
if (stage === "contract_closure") return <ContractWorkspace bid={bid} activeTab={activeTab} onTabChange={onTabChange} />;
```

Update the prop type of each workspace component signature to accept `onTabChange: (t: string) => void`.

Wire the dead "View all X questions →" div in `RFIWorkspace.tsx` (Overview tab, bottom of Questions card):
```tsx
// Before: <div className="... cursor-pointer ...">View all {questions.length} questions →</div>
// After:
<button onClick={() => onTabChange("questionnaire")} className="w-full px-4 py-2.5 border-t hairline border-border text-[11px] text-primary font-medium hover:bg-muted/40 text-left">
  View all {questions.length} questions →
</button>
```

Wire the Clarifications CTA in `RFPWorkspace.tsx` Overview tab similarly to `onTabChange("clarifications")`.

---

### Task 1.2 — Health "Not Started" state
**File:** `src/components/bids/RFIWorkspace.tsx` (lines ~45–47)

```tsx
// Before
const health = pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
const healthColor = pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
const healthBg = pct >= 70 ? "#dcfce7" : pct >= 40 ? "#fef9c3" : "#fee2e2";

// After
const health      = total === 0 ? "Not Started" : pct >= 70 ? "On Track" : pct >= 40 ? "Needs Attention" : "At Risk";
const healthColor = total === 0 ? "var(--color-muted-foreground)" : pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626";
const healthBg    = total === 0 ? "var(--color-muted)" : pct >= 70 ? "#dcfce7" : pct >= 40 ? "#fef9c3" : "#fee2e2";
```

Update the three `HealthCheck` rows when `total === 0`:
```tsx
<HealthCheck label={total === 0 ? "Add your first question to begin" : "Questions assigned"} ok={total > 0} />
<HealthCheck label="Responses on schedule" ok={total > 0 && pct >= 40} />
<HealthCheck label="Deadline not overdue" ok={dl >= 0} />
```

Apply the same pattern to `RFPWorkspace.tsx`.

---

## Wave 2 — New bid-queries.ts hooks

**File:** `src/lib/bid-queries.ts`

Add three new exported functions after the existing `useToggleQuestion` (around line 140):

```ts
// ── useCreateQuestion ─────────────────────────────────────────────────────────
export function useCreateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bidId: string;
      stage: StageKey;
      questionText: string;
      assignedTeam: "pre_sales" | "legal" | "finance";
    }) => {
      const { error } = await supabase.from("bid_questions").insert({
        bid_id: payload.bidId,
        stage: payload.stage,
        question_text: payload.questionText,
        assigned_team: payload.assignedTeam,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}

// ── useCreateDeliverable ──────────────────────────────────────────────────────
export function useCreateDeliverable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bidId: string;
      stage: StageKey;
      label: string;
      assignedTeam: "pre_sales" | "legal" | "finance";
      type?: string;
    }) => {
      const { error } = await supabase.from("bid_deliverables").insert({
        bid_id: payload.bidId,
        stage: payload.stage,
        label: payload.label,
        assigned_team: payload.assignedTeam,
        type: (payload.type ?? "document") as never,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}

// ── useUpdateQuestionResponse ─────────────────────────────────────────────────
export function useUpdateQuestionResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      responseText,
      internalNotes,
      status,
    }: {
      id: string;
      responseText: string;
      internalNotes?: string;
      status?: "pending" | "in_progress" | "done";
    }) => {
      const patch: Record<string, unknown> = { response_text: responseText };
      if (internalNotes !== undefined) patch.internal_notes = internalNotes;
      if (status) patch.status = status;
      const { error } = await supabase.from("bid_questions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stage-items"] }),
  });
}
```

---

## Wave 3 — Three-state question toggle

**Files:** `src/components/bids/RFIWorkspace.tsx`, `src/components/bids/RFPWorkspace.tsx`

### QuestionRow changes

Replace the `onToggle: (next: "pending" | "done") => void` prop with `onCycle: () => void`:

```tsx
function QuestionRow({ num, question, onCycle, onExpand, expanded, ...}: {
  num: number;
  question: any;
  onCycle: () => void;
  onExpand: () => void;
  expanded: boolean;
  // ...
})
```

The toggle button `onClick` calls `onCycle` directly (no status arg needed):

```tsx
<button
  onClick={(e) => { e.stopPropagation(); onCycle(); }}
  className={[
    "size-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 hairline border transition-colors",
    done    ? "bg-success-soft border-[#97C459]"
    : inProg ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
    : "border-dashed border-border-strong",
  ].join(" ")}
>
  {done    && <Check className="size-3 text-success-foreground" strokeWidth={2.5} />}
  {inProg  && <div className="size-2 rounded-full bg-amber-400" />}
  {!done && !inProg && <Circle className="size-2 text-muted-foreground/40" />}
</button>
```

The caller passes the cycle function:
```tsx
onCycle={() => {
  const next = q.status === "pending" ? "in_progress"
    : q.status === "in_progress" ? "done"
    : "pending";
  toggleQ.mutate({ id: q.id, status: next });
}}
```

---

## Wave 4 — Add Question / Add Deliverable inline forms + response editor

**Files:** `RFIWorkspace.tsx`, `RFPWorkspace.tsx`, `BAFOWorkspace.tsx`, `ContractWorkspace.tsx`

### AddQuestionInline component (add to RFIWorkspace.tsx, import in others)

```tsx
function AddQuestionInline({
  bidId, stage, onCreate,
}: { bidId: string; stage: StageKey; onCreate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [team, setTeam] = useState<"pre_sales" | "legal" | "finance">("pre_sales");
  const create = useCreateQuestion();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2.5 text-[11px] text-primary font-medium hover:bg-muted/30 transition-colors flex items-center gap-1.5 justify-center border-t hairline border-border"
      >
        <Plus className="size-3.5" /> Add question
      </button>
    );
  }

  return (
    <div className="px-4 py-3 border-t hairline border-border bg-muted/20">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter question text…"
        className="w-full text-[12px] bg-card hairline border rounded-md p-2 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center gap-2 mt-2">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value as any)}
          className="h-7 px-2 text-[11px] bg-card hairline border rounded-md"
        >
          <option value="pre_sales">Pre-Sales</option>
          <option value="legal">Legal</option>
          <option value="finance">Finance</option>
        </select>
        <button
          onClick={async () => {
            if (!text.trim()) return;
            await create.mutateAsync({ bidId, stage, questionText: text.trim(), assignedTeam: team });
            setText(""); setOpen(false); onCreate?.();
          }}
          disabled={!text.trim() || create.isPending}
          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50"
        >
          {create.isPending ? "…" : "Add"}
        </button>
        <button onClick={() => { setText(""); setOpen(false); }} className="h-7 px-3 rounded-md hairline border text-[11px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

Add `<AddQuestionInline bidId={bid.id} stage="rfi" />` at the bottom of the Questions card (both Overview + Questionnaire tabs).

Build `AddDeliverableInline` with the same pattern — `label` text input + `type` select (Document / Review / Approval / Other) + `assignedTeam` select.

### Response editor in QuestionRow

QuestionRow gains local state `[expanded, setExpanded]` and `[draft, setDraft]` (initialised from `question.response_text ?? ""`).

Clicking the question text row calls `setExpanded(true)`. The expanded panel renders below the question text:

```tsx
{expanded && (
  <div className="mt-2 pl-0">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Your response</div>
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      placeholder="Draft your response here… (auto-saves on blur)"
      className="w-full text-[12px] bg-muted/30 hairline border rounded-md p-2 resize-none min-h-[5rem] focus:outline-none focus:ring-1 focus:ring-ring"
      onBlur={() => {
        if (draft !== (question.response_text ?? "")) {
          const nextStatus = question.status === "pending" && draft.trim()
            ? "in_progress" : undefined;
          updateResponse.mutate({ id: question.id, responseText: draft, status: nextStatus });
        }
      }}
    />
    <button onClick={() => setExpanded(false)} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground">
      ▲ Collapse
    </button>
  </div>
)}
```

If `question.response_text` is non-null, add a small `FileText` icon in the question row meta row (grey, 12px).

---

## Wave 5 — Clarification deadline in RFI

**File:** `src/components/bids/RFIWorkspace.tsx`

### Step 1 — compute clarDays at the top of the component

```tsx
const clarDays = bid.clarification_deadline
  ? Math.ceil((new Date(bid.clarification_deadline).getTime() - Date.now()) / 86400000)
  : null;
```

### Step 2 — Alert banner (above the stats row)

```tsx
{clarDays !== null && clarDays <= 3 && (
  <div className="mb-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border hairline border-amber-400 text-[11px] text-amber-700 dark:text-amber-400">
    <AlertTriangle className="size-3.5 shrink-0" />
    <span>
      Clarification deadline {clarDays <= 0 ? "is overdue" : `in ${clarDays}d`} — questions due to{" "}
      <strong>{bid.contact_name ?? "the client"}</strong> by{" "}
      {new Date(bid.clarification_deadline!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
    </span>
  </div>
)}
```

### Step 3 — Two new KV rows in the RFI Details card (after "Time Remaining")

```tsx
{bid.clarification_deadline && (
  <>
    <KV
      label="Clarif. Deadline"
      value={new Date(bid.clarification_deadline).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
    />
    <KV
      label="Clarif. Time Left"
      value={clarDays! <= 0 ? `${Math.abs(clarDays!)}d over` : `${clarDays}d left`}
      urgent={clarDays! <= 5}
    />
  </>
)}
```

---

## Wave 6 — `/ai` bidId context

### Task 6.1 — Add search param to ai route
**File:** `src/routes/_app/ai.tsx`

```tsx
// Add to Route definition
export const Route = createFileRoute("/_app/ai")({
  validateSearch: (search: Record<string, unknown>) => ({
    bidId: typeof search.bidId === "string" ? search.bidId : undefined,
  }),
  component: AiPage,
});
```

In `AiPage`, after the existing state declarations:
```tsx
const { bidId: initialBidId } = Route.useSearch();

useEffect(() => {
  if (initialBidId && !selectedBidId) {
    setMode("bid");
    setSelectedBidId(initialBidId);
  }
}, []); // run once on mount only
```

### Task 6.2 — Update all /ai links in workspaces
**Files:** `RFIWorkspace.tsx:212`, `RFPWorkspace.tsx:71,267,282`, `ContractWorkspace.tsx:406,422`

Change every `to="/ai"` link to:
```tsx
<Link to="/ai" search={{ bidId: bid.id }}>…</Link>
```

---

## Wave 7 — AdvanceStageFooter in all custom workspaces

### Task 7.1 — Create the shared component
**File:** `src/components/bids/StageWorkspace.tsx` (export from here for reuse)

Add after existing helper components:

```tsx
export function AdvanceStageFooter({ bid, stage }: { bid: Bid; stage: StageKey }) {
  const updateBid = useUpdateBid();
  const stageIdx   = STAGES.findIndex((s) => s.key === stage);
  const currentIdx = STAGES.findIndex((s) => s.key === bid.stage);
  const next       = STAGES[currentIdx + 1];

  if (!next || stageIdx !== currentIdx) return null;

  async function advance() {
    if (next.key === "rfi") {
      if (bid.gonogo_decision !== "go" && bid.gonogo_decision !== "conditional_go") {
        alert("Set a Go or Conditional Go decision in the Qualification Result tab before advancing to RFI.");
        return;
      }
    }
    await updateBid.mutateAsync({ id: bid.id, patch: { stage: next.key }, currentStage: bid.stage });
  }

  return (
    <div className="mt-6 pt-4 border-t hairline border-border flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">
        Stage: <strong className="text-foreground">{stageLabel(stage)}</strong>
      </span>
      <button
        onClick={advance}
        disabled={updateBid.isPending}
        className="h-9 px-4 rounded-md bg-accent text-accent-foreground text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {updateBid.isPending ? "…" : <>Advance to {next.short} <ArrowRight className="size-3.5" /></>}
      </button>
    </div>
  );
}
```

### Task 7.2 — Import and render in each workspace

Import `AdvanceStageFooter` from `./StageWorkspace` in:
- `DealQualificationWorkspace.tsx` — append inside the `QualificationResultTab` render (bottom of that tab's div) and also as the last element of the outer `<div className="p-5">` in `DealQualificationWorkspace`
- `RFIWorkspace.tsx` — append at the bottom of the Overview, Questionnaire, and Team tab renders
- `RFPWorkspace.tsx` — same
- `BAFOWorkspace.tsx` — same
- `ContractWorkspace.tsx` — same

Each workspace already has a top-level `<div className="px-6 py-5 ...">` — append the footer as the last child.

---

## Wave 8 — Won / Lost closeout modal

**File:** `src/components/bids/ContractWorkspace.tsx`

### Task 8.1 — CloseoutModal component (add locally)

```tsx
function CloseoutModal({
  bid, outcome, onClose,
}: { bid: Bid; outcome: "won" | "lost"; onClose: () => void }) {
  const updateBid = useUpdateBid();
  const { user } = useCurrentUser();
  const [finalValue, setFinalValue] = useState(String(bid.value));
  const [reasonLost, setReasonLost] = useState("");

  async function confirm() {
    await updateBid.mutateAsync({
      id: bid.id,
      patch: { status: outcome, value: parseFloat(finalValue) || bid.value },
    });
    await supabase.from("bid_activity_log").insert({
      bid_id: bid.id,
      user_id: user!.id,
      action: outcome === "won" ? "bid_won" : "bid_lost",
      metadata: { reason_lost: reasonLost || null, final_value: parseFloat(finalValue) },
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {outcome === "won" ? "Mark as Won" : "Mark as Lost"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[12px]">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Final contract value (USD)
            </div>
            <input type="number" value={finalValue} onChange={(e) => setFinalValue(e.target.value)}
              className="w-full h-8 px-2 rounded-md hairline border bg-card text-[12px] focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          {outcome === "lost" && (
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Reason lost (optional)
              </div>
              <textarea value={reasonLost} onChange={(e) => setReasonLost(e.target.value)}
                placeholder="e.g. Lost to competitor on pricing…"
                className="w-full h-16 px-2 py-1.5 rounded-md hairline border bg-card text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-8 px-3 rounded-md hairline border text-[12px]">Cancel</button>
          <button
            onClick={confirm}
            disabled={updateBid.isPending}
            className={`h-8 px-3 rounded-md text-[12px] font-semibold disabled:opacity-50 ${
              outcome === "won"
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-destructive text-destructive-foreground hover:opacity-90"
            }`}
          >
            {updateBid.isPending ? "…" : outcome === "won" ? "Confirm Won ✓" : "Confirm Lost ✗"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Task 8.2 — Add buttons to Contract Overview top row

In the existing approval summary card in `ContractWorkspace.tsx` Overview, add after the approval status badges:

```tsx
{(bid.status === "active" || bid.status === "submitted") && (
  <div className="flex items-center gap-2 mt-3 pt-3 border-t hairline border-border">
    <button onClick={() => setCloseout("won")}
      className="h-7 px-3 rounded-md bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700">
      Mark as Won
    </button>
    <button onClick={() => setCloseout("lost")}
      className="h-7 px-3 rounded-md hairline border border-destructive text-destructive text-[11px] font-semibold hover:bg-destructive/10">
      Mark as Lost
    </button>
  </div>
)}
{closeout && <CloseoutModal bid={bid} outcome={closeout} onClose={() => setCloseout(null)} />}
```

Add `const [closeout, setCloseout] = useState<"won" | "lost" | null>(null)` to the component.

---

## Wave 9 — Product type + contact fields

### Task 9.1 — Update IntakeModal schema + form
**File:** `src/components/bids/IntakeModal.tsx`

Add to Zod schema:
```ts
product_type: z.enum(["TA", "TM"]).optional().or(z.literal("")),
contact_name: z.string().optional().or(z.literal("")),
contact_email: z.string().email().optional().or(z.literal("")),
```

Add to `insert` object in `onSubmit`:
```ts
product_type: (data.product_type as "TA" | "TM") || null,
contact_name: data.contact_name || null,
contact_email: data.contact_email || null,
```

Add form fields (insert after the `type` / `procurement_portal` row):
```tsx
<F label="Product type">
  <select {...register("product_type")} className={inputCls}>
    <option value="">— select —</option>
    <option value="TA">TA — Talent Acquisition / Skills Assessment</option>
    <option value="TM">TM — Talent Management / Skills Intelligence</option>
  </select>
</F>
<F label="Contact name (optional)">
  <input {...register("contact_name")} className={inputCls} placeholder="e.g. David Kim" />
</F>
<F label="Contact email (optional)" err={errors.contact_email?.message}>
  <input {...register("contact_email")} className={inputCls} placeholder="david.kim@client.com" />
</F>
```

### Task 9.2 — Show in BidDetailsTab
**File:** `src/components/bids/DealQualificationWorkspace.tsx`

Add `product_type`, `contact_name`, `contact_email` to the details grid in `BidDetailsTab`. In edit mode, add inputs for these fields (mirroring existing `client_name` / `title` edit pattern).

### Task 9.3 — Wire product_type to generateProposalFn
**File:** `src/lib/api/generate-proposal.ts`

In `buildProposalSystemBlocks`, the `bids` select already fetches several columns. Add `product_type` to the select:
```ts
.select("client_name, title, type, value, stage, deadline, product_type, contact_name")
```

In `buildAuthorPrompt`, change the `"product"` field instruction to include the known value:
```ts
// In the JSON schema comment for "product":
`"product": "${bid?.product_type ?? 'auto-detect: TA for hiring/recruitment/assessment/candidates, TM for skills/competency/workforce development'}"`,
```

---

## Wave 10 — Document quick-viewer panel in RFI Questionnaire tab

**File:** `src/components/bids/RFIWorkspace.tsx`

### Add DocQuickPanel component

```tsx
function DocQuickPanel({ bidId, onClose }: { bidId: string; onClose: () => void }) {
  const { data: docs = [] } = useDocuments({ bidId });
  const [preview, setPreview] = useState<BidDocument | null>(null);

  return (
    <>
      <div className="w-60 shrink-0 bg-card hairline border rounded-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 border-b hairline border-border">
          <span className="text-[11px] font-semibold">Documents ({docs.length})</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {docs.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-muted-foreground">No documents.</div>
          ) : (
            <ul className="divide-y hairline divide-border">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setPreview(d)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 text-left"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[11px] truncate">{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {preview && <DocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
```

### Update Questionnaire tab render

Wrap the questionnaire card and the panel in a flex row:

```tsx
if (activeTab === "questionnaire") {
  return (
    <div className="px-6 py-5 max-w-[1100px]">
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 bg-card hairline border rounded-xl overflow-hidden">
          {/* header row */}
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border">
            <h3 className="text-[13px] font-semibold">RFI Questions</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{answered}/{total} answered</span>
              <button onClick={() => setDocPanelOpen((o) => !o)}
                title="Toggle documents"
                className={`p-1 rounded hover:bg-muted ${docPanelOpen ? "text-primary" : "text-muted-foreground"}`}>
                <FileText className="size-3.5" />
              </button>
            </div>
          </div>
          {/* question list + add form */}
          ...
        </div>
        {docPanelOpen && <DocQuickPanel bidId={bid.id} onClose={() => setDocPanelOpen(false)} />}
      </div>
    </div>
  );
}
```

Add `const [docPanelOpen, setDocPanelOpen] = useState(false)` to the component.

Import `useDocuments`, `DocPreviewModal`, `type BidDocument` from their respective paths.

---

## Wave 11 — Inline team assignment

**Files:** `DealQualificationWorkspace.tsx` (BidTeamTab), `RFIWorkspace.tsx` (Team tab), `RFPWorkspace.tsx` (Team tab)

### AssignMemberPopover component

```tsx
function AssignMemberPopover({ bidId, assignedUserIds }: { bidId: string; assignedUserIds: string[] }) {
  const { data: members = [] } = useTeamMembers();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const unassigned = members.filter(
    (m) => m.status === "active" && !assignedUserIds.includes(m.user_id)
  );

  async function assign(userId: string) {
    await (supabase as any).from("bid_assignments").insert({ bid_id: bidId, user_id: userId });
    qc.invalidateQueries({ queryKey: ["bid-team", bidId] });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="h-7 px-3 rounded-md hairline border text-[11px] font-medium hover:bg-muted inline-flex items-center gap-1.5">
          <UserPlus className="size-3.5" /> Assign member
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {unassigned.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">All team members already assigned.</div>
        ) : (
          <ul>
            {unassigned.map((m) => (
              <li key={m.user_id}>
                <button onClick={() => assign(m.user_id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 rounded-md text-left">
                  <div className="size-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                    {initials(m.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate">{m.full_name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{m.primary_role.replace(/_/g, " ")}</div>
                  </div>
                  <UserPlus className="size-3 text-muted-foreground ml-auto shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

### Remove assignment

Add an X button to each row in the existing team member list:

```tsx
<button
  onClick={async () => {
    await (supabase as any).from("bid_assignments").delete()
      .eq("id", m.assignment_id);
    qc.invalidateQueries({ queryKey: ["bid-team", bid.id] });
  }}
  className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
>
  <X className="size-3.5" />
</button>
```

### Placement

In each Team tab, add `<AssignMemberPopover bidId={bid.id} assignedUserIds={team.map(m => m.user_id)} />` in the card header (right side), next to the title.

---

## Build Order

```
Wave 1  (prop pass + health fix)         — no deps, start immediately
Wave 2  (new hooks)                      — no deps, run in parallel with Wave 1
Wave 3  (3-state toggle)                 — needs Wave 2 (useToggleQuestion already exists, just UI)
Wave 4  (add forms + response editor)    — needs Wave 2 (useCreateQuestion, useUpdateQuestionResponse)
Wave 5  (clarif deadline)                — no deps
Wave 6  (/ai bidId)                      — no deps
Wave 7  (AdvanceStageFooter)             — no deps
Wave 8  (Won/Lost closeout)              — no deps (uses existing useUpdateBid)
─── apply DB migration ───────────────────────────────────────────────────────
Wave 9  (product_type + contact fields)  — needs migration
Wave 10 (doc quick-viewer)               — no deps (can do before migration)
Wave 11 (team assignment)                — no deps (can do before migration)
```

Waves 1, 2, 5, 6, 7, 8, 10, 11 are independent and can be done in any order before/after the migration.

---

## Verification Checklist

### P0 — Core workflows
- [ ] Navigate to RFI stage of any bid → "Add question" link visible at bottom of Questions card → click → form expands → submit → question appears in list
- [ ] Click question text → response panel expands → type response → blur → row shows FileText indicator
- [ ] Question status: click toggle circle → pending → in_progress (amber dot) → done (green check) → pending again
- [ ] "View all X questions →" in Overview → switches to Questionnaire tab
- [ ] "Switch to Clarifications" in RFP Overview → switches to Clarifications tab

### P1 — Significant friction
- [ ] Bid with clarification_deadline ≤ 3 days → amber banner visible in RFI Overview
- [ ] RFI Details card shows Clarif. Deadline + Clarif. Time Left rows
- [ ] "Open RFx Responder" from RFI → lands on /ai with this bid pre-selected (bid sessions load for it)
- [ ] Stage with 0 questions → health shows "Not Started" (not "At Risk")
- [ ] From RFI workspace Overview → "Advance to RFP" button visible → click → bid.stage updates → StageJourney dot moves
- [ ] From DQ workspace: no go/no-go set → Advance to RFI → alert fires; set Go → Advance works
- [ ] Contract overview shows "Mark as Won" + "Mark as Lost" for active bids → modal opens → confirm → bid appears on /closure Won tab
- [ ] Lost bid with reason → shows on /closure Lost tab

### P2 — Field completeness
- [ ] Intake modal shows product_type select + contact_name + contact_email fields
- [ ] Saved bid shows product_type in Bid Details tab
- [ ] generateProposalFn no longer guesses TA/TM — reads bid.product_type from DB
- [ ] RFI Questionnaire tab → FileText icon in header → click → document panel slides open → click a PDF → DocPreviewModal opens
- [ ] Team tab → "Assign member" button → popover shows unassigned active members → click assigns → member appears in list with X button
- [ ] X on assigned member removes them from bid

### Build
- [ ] `bun run build:dev` — zero TypeScript errors after all waves
