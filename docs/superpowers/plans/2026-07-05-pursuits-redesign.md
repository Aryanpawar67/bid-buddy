# Pursuits Redesign — Implementation Plan

**Date:** 2026-07-05  
**Spec:** `docs/superpowers/specs/2026-07-05-pursuits-redesign.md`  
**Prototype:** `pursuits-v3.html`  
**Depends on:** `useBids`, `useBidTeam`, `useAssessmentData`, `useBidActivity`, `useUpdateBid`, `useGenerateQualResult`, `useGenerateDealBrief` (all existing)

---

## Goal

Replace the current `/pipeline` page layout with the v3 design: dark indigo roster panel, bid header bar with stage journey timeline, 5-tab nav (names unchanged), always-visible right rail. Tab content is preserved as-is except the Assessment tab gets the score matrix tile layout.

---

## Tasks

### Task 1 — CSS tokens
**File:** `src/styles.css`

Add three new CSS variables to `:root` (or confirm they already exist):

```css
--roster:        #100A28;
--roster-hover:  #1C1440;
--roster-border: rgba(255,255,255,.07);
```

---

### Task 2 — `StageJourney` component (new)
**File:** `src/components/bids/StageJourney.tsx`

Props:
```ts
type Props = {
  bidStage: StageKey;      // the bid's real current stage
  viewStage: StageKey;     // the stage being viewed (may differ)
  onViewStage: (s: StageKey) => void;
}
```

Renders a horizontal flex row of 8 stage items from `STAGES`. Each item:
- State: `done` (index < currentIdx), `active` (index === currentIdx), `pending` (index > currentIdx)
- `view` class added when `index === viewIdx` (extra ring)
- Connector line between items, coloured by state
- Clicking calls `onViewStage(stage.key)`

No external data fetch — pure derived from props.

---

### Task 3 — `PursuitRoster` component (new)
**File:** `src/components/bids/PursuitRoster.tsx`

Props:
```ts
type Props = {
  bids: Bid[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  q: string;
  onQ: (q: string) => void;
  filter: "all" | "mine" | "legal" | "urgent";
  onFilter: (f: "all" | "mine" | "legal" | "urgent") => void;
}
```

Internal logic:
- Group `bids` into three buckets using `daysLeft` helper: urgent (≤3d), needs-attention (4–14d), on-track (>14d or closed)
- Each `co-row` gets a `::before` stripe colour: `#EF4444` / `#F59E0B` / `#22C55E`
- Stage chip colour derived from stage key (reuse existing stage color map from `bid-constants`)
- Stage bar fill width: `(STAGES.findIndex(s => s.key === bid.stage) / (STAGES.length - 1)) * 100`%
- Active row: `selectedId === bid.id`

Styles: inline or a co-located CSS module — use the token variables from Task 1. Dark text on dark background — all foreground text uses `rgba(255,255,255,X)` scale.

---

### Task 4 — `BidWorkspaceRail` component (new)
**File:** `src/components/bids/BidWorkspaceRail.tsx`

Props:
```ts
type Props = {
  bid: Bid;
  isDealQual: boolean;
}
```

**Deal Qual rail sections (when `isDealQual`):**

1. **Score gauge** — derive `score` from `bid.assessment_data` (reuse existing `computeScore` logic already in `DealQualificationWorkspace`). Colour: `score >= 65` → `var(--go)`, `score >= 45` → `var(--warn)`, else `var(--no)`.

2. **Lock Decision** — 3 `dec-btn` buttons calling:
   ```ts
   useUpdateBid().mutateAsync({ id: bid.id, patch: { gonogo_decision: value } })
   ```
   Show currently-locked decision with a filled/active state. Disable all three while mutation is pending.

3. **Generate Documents** — "Qual Result Doc" calls `useGenerateQualResult`, "C-Suite Deal Brief" calls `useGenerateDealBrief`. Mirror the existing button wiring from `DealQualificationWorkspace`'s Qualification Result tab.

4. **Bid Details KV** — read from `bid` object: `bid_type`, `product_line`, `portal`, `priority`, `region`.

5. **Recent Activity** — `useBidActivity(bid.id)`, slice first 3, timeline dot style.

**Non-Deal-Qual rail (when `!isDealQual`):**
- Bid Details KV (same as above)
- "Advance to next stage" button (reuse `advance()` logic from `StageWorkspace`)
- "View full activity" link

---

### Task 5 — `BidHeaderBar` component (new)
**File:** `src/components/bids/BidHeaderBar.tsx`

Props:
```ts
type Props = {
  bid: Bid;
  viewStage: StageKey;
  onViewStage: (s: StageKey) => void;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
}
```

Renders three stacked rows (no padding between, separated by `border-bottom`):

**Row 1 — Identity strip:**  
`[avatar initials] [bid name + title] [spacer] [value] [divider] [deadline] [divider] [decision badge] [divider] [AI Session btn] [Activity btn]`

- Avatar bg: derive deterministic colour from `bid.client_name` (reuse `initials()` from `bid-constants`)
- Deadline colour: reuse `urgencyClass(bid.deadline)`
- Decision badge: map `bid.gonogo_decision` → `go`/`cond`/`nogo`/`pending` class

**Row 2 — Stage Journey:**  
`<StageJourney bidStage={bid.stage} viewStage={viewStage} onViewStage={onViewStage} />`

**Row 3 — Tab nav:**  
5 `tn-btn` buttons. Active tab has `border-bottom: 2.5px solid var(--p)` and `color: var(--p)`.  
Import and reuse `TABS` constant from `DealQualificationWorkspace` — do not duplicate.

Export `Tab` type from `DealQualificationWorkspace` so `BidHeaderBar` can import it.

---

### Task 6 — Score matrix in Assessment tab
**File:** `src/components/bids/DealQualificationWorkspace.tsx`

In the `AssessmentTab` render section, replace the existing `criteria-list` table rows with a 2×5 CSS grid of `sm-tile` cards.

Each tile:
- CSS class: `sm-tile g{score}` where score is 0–5 (0 = unscored)
- Contains: criterion name (10px 600), score number (26px 900), 5-dot bar, weight label
- Background + border colours hardcoded per grade level (green shades for 4–5, amber for 3, orange/red for 1–2, dashed surface for 0)

The `assessment_data`, `DEFAULT_CRITERIA`, `handleScore`, and `computeScore` logic are **unchanged** — this is purely a rendering swap.

---

### Task 7 — `DealQualificationWorkspace` cleanup
**File:** `src/components/bids/DealQualificationWorkspace.tsx`

- **Remove** the internal tab bar render (the `<div className="flex border-b ...">` tabs strip) — tab switching now handled by `BidHeaderBar`
- **Add** `activeTab` and `onTabChange` as props (passed down from the pipeline page)
- **Export** the `Tab` type and `TABS` constant for use by `BidHeaderBar`
- Keep all tab panel content, hooks, and mutations exactly as-is

```ts
// Before (self-contained)
export function DealQualificationWorkspace({ bid }: { bid: Bid })

// After (tab state lifted)
export function DealQualificationWorkspace({
  bid,
  activeTab,
  onTabChange,
}: {
  bid: Bid;
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
})
```

---

### Task 8 — `StageWorkspace` cleanup
**File:** `src/components/bids/StageWorkspace.tsx`

- **Remove** the header block (stage label, blurb, deal value) — now in `BidHeaderBar`
- **Remove** the `Metric` cards row — deadline/progress now in `BidWorkspaceRail`
- Keep the checklist/deliverable body, progress bar, advance button, and `DealQualificationWorkspace` delegation

Props signature stays the same: `{ bid: Bid; stage: StageKey }`.

---

### Task 9 — `PipelinePage` rewire
**File:** `src/routes/_app/pipeline.tsx`

Full replace of the component body. New state:

```ts
const [selectedId, setSelectedId] = useState<string | null>(null);
const [viewStage, setViewStage] = useState<StageKey | null>(null);
const [activeTab, setActiveTab] = useState<Tab>("bid_details");
const [q, setQ] = useState("");
const [filter, setFilter] = useState<Filter>("all");
```

New render:

```tsx
<div className="h-full flex overflow-hidden">
  <PursuitRoster
    bids={filtered}
    selectedId={selected?.id ?? null}
    onSelect={(id) => { setSelectedId(id); setViewStage(null); setActiveTab("bid_details"); }}
    q={q} onQ={setQ} filter={filter} onFilter={setFilter}
  />

  {selected ? (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <BidHeaderBar
        bid={selected}
        viewStage={viewStage ?? selected.stage}
        onViewStage={setViewStage}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto p-5">
          <StageWorkspace
            bid={selected}
            stage={viewStage ?? selected.stage}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
        <BidWorkspaceRail
          bid={selected}
          isDealQual={(viewStage ?? selected.stage) === "deal_qualification"}
        />
      </div>
    </div>
  ) : (
    <EmptyState />
  )}
</div>
```

Remove all imports of `BidCard`, `StageNav`. Import the four new components.

---

## Build Order

```
Task 1 (tokens)
  → Task 2 (StageJourney)
  → Task 3 (PursuitRoster)
  → Task 4 (BidWorkspaceRail)   ← needs computeScore extracted first
  → Task 5 (BidHeaderBar)       ← needs StageJourney + Tab export
  → Task 6 (score matrix)       ← isolated visual swap
  → Task 7 (DQW cleanup)        ← lift tab state
  → Task 8 (StageWorkspace cleanup)
  → Task 9 (PipelinePage rewire) ← everything wired together
```

Tasks 2–4 are new files with no side effects and can be written in parallel.  
Tasks 7–9 touch existing files and must be done in order.

---

## Verification

1. `bun run build` — zero TypeScript errors
2. `/pipeline` loads — dark roster visible with company rows grouped by urgency
3. Urgency stripes: red/amber/green match `daysLeft` thresholds
4. Clicking a company updates the bid header (name, value, deadline, decision badge)
5. Stage journey dots reflect `bid.stage` — done/active/pending correctly coloured
6. Clicking a future stage dot sets view mode — banner shown — tab content doesn't break
7. Clicking back to current stage clears banner
8. All 5 tabs switch correctly: Bid Details, Bid Team Details, Bid Assessment, Qualification Result, Activity Log
9. Assessment tab renders score matrix tiles — grade colours correct per score value
10. Right rail score gauge colour matches Go/Cond/No-Go threshold
11. Lock Decision buttons update `gonogo_decision` — badge in header updates reactively
12. Generate Qual Result Doc and Deal Brief buttons fire existing mutations (check network tab)
13. For a non-Deal-Qual bid (e.g. Walmart at BAFO) — slim rail shows, no score gauge
14. Search and filter pills in roster correctly narrow the list
15. Selecting a new bid resets tab to Bid Details
