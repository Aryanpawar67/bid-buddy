# Pursuits Redesign — Design Spec

**Date:** 2026-07-05  
**Status:** Approved → Ready for Implementation  
**Scope:** `/pipeline` route — full shell, roster panel, bid header, stage journey, tab nav, right rail  
**Prototype:** `pursuits-v3.html` (scratchpad artifact)

---

## Problem

The current `/pipeline` page uses a generic light-sidebar `BidCard` list, a disconnected `StageNav` strip, and a flat `StageWorkspace` area. The design:

- Makes it hard to scan urgency across all bids at a glance
- Duplicates stage navigation (sidebar strip + workspace header)
- Buries the Go/No-Go decision and document generation inside tabs — they're primary actions that should always be visible
- Uses no visual encoding for urgency or pipeline health on the roster itself

---

## New Layout

```
┌──────┬────────────────┬────────────────────────────────┐
│ 48px │  232px          │  flex-1                         │
│ Icon │  Dark Roster    │  Canvas                         │
│ bar  │  (indigo-black) │  ├─ Bid header bar (identity)   │
│      │                 │  ├─ Stage journey timeline       │
│      │                 │  ├─ Tab nav (5 tabs)             │
│      │                 │  └─ ws-body                      │
│      │                 │       ├─ ws-main (tab content)   │
│      │                 │       └─ ws-rail 254px (fixed)   │
└──────┴────────────────┴────────────────────────────────┘
```

The app-level `Sidebar` already provides the icon bar at 48px. The new roster replaces the current 260px light `<aside>` in `PipelinePage`.

---

## Color Tokens (add to CSS variables if not present)

```css
--roster:       #100A28;   /* deep indigo-black panel bg */
--roster-hover: #1C1440;   /* row hover */
--roster-border: rgba(255,255,255,.07);
```

All other tokens (`--p`, `--p10`, `--p70`, `--o`, `--go`, `--warn`, `--no`, `--surface`, `--card`, `--border`) already exist.

---

## Component Inventory

### New components

| Component | File | Purpose |
|---|---|---|
| `PursuitRoster` | `src/components/bids/PursuitRoster.tsx` | Dark indigo sidebar — company rows grouped by urgency |
| `BidHeaderBar` | `src/components/bids/BidHeaderBar.tsx` | Bid identity, stats, decision badge, AI/Activity buttons |
| `StageJourney` | `src/components/bids/StageJourney.tsx` | Horizontal 8-dot timeline with done/active/pending states |
| `BidWorkspaceRail` | `src/components/bids/BidWorkspaceRail.tsx` | Fixed right rail: score gauge, lock decision, generate docs, details, activity |

### Modified components / files

| File | Change |
|---|---|
| `src/routes/_app/pipeline.tsx` | Replace current layout with new 3-panel shell; remove old `<aside>` + `StageNav` |
| `src/components/bids/DealQualificationWorkspace.tsx` | Remove its own internal stage-nav strip; tab bar moves to `BidHeaderBar` area |
| `src/components/bids/StageWorkspace.tsx` | Remove its own header/stats block; outer chrome now provided by `BidHeaderBar` |

---

## Roster Panel — `PursuitRoster`

**Background:** `var(--roster)` (#100A28)

### Urgency groups

| Group label | Rule |
|---|---|
| Urgent · 3d or less | `daysLeft <= 3` |
| Needs attention · 14d | `4 ≤ daysLeft ≤ 14` |
| On track | `daysLeft > 14` or closed |

### Company row anatomy

```
[left urgency stripe 3px] [avatar 30px] [co-info flex-1] [value]
                                          ├ co-name (12.5px 600)
                                          ├ co-meta: [stage chip] [days label]
                                          └ co-stagebar 2px fill
```

**Left stripe colors:** urgent = `#EF4444`, needs-attention = `#F59E0B`, on-track = `#22C55E`

**Active row:** `background: rgba(73,26,235,.25)` + 2px right edge in `var(--p)`

### Roster head

- Title: "PURSUITS" (11px 700 uppercase, rgba white .85)  
- Search input (dark ghost style)  
- Filter pills: All · Mine · Urgent · Legal

---

## Bid Header Bar — `BidHeaderBar`

Single `<div class="bid-bar">` stuck to top of canvas, `background: var(--card)`.

### Top row (13px 0 padding)
`[avatar 36px] [name 18px 800] [title 11.5px muted] [spacer] [Deal Value] [divider] [Deadline] [divider] [Decision badge] [divider] [AI Session btn] [Activity btn]`

**Decision badge variants:** `go` (green), `cond` (amber), `nogo` (red), `pending` (purple-muted)

### Stage Journey row

Sits directly below the top row, above the tab nav.  
See `StageJourney` spec below.

### Tab nav row

Underline-style tabs, `border-top: 1px solid var(--border)`:

| Tab key | Label | Icon |
|---|---|---|
| `bid_details` | Bid Details | document |
| `bid_team` | Bid Team Details | users |
| `bid_assessment` | Bid Assessment | chart-bar |
| `qualification_result` | Qualification Result | circle-check |
| `activity_log` | Activity Log | clock |

**These tab keys and labels are unchanged** from the existing `DealQualificationWorkspace` TABS constant. No rename.

---

## Stage Journey — `StageJourney`

**8 stages:** Deal Qual · RFI · RFP · Orals · Due Diligence · BAFO · Contract · Post Closure

Each stage item is a flex column: `[dot 26px] [label 9.5px]`

| State | Dot style | Connector |
|---|---|---|
| done | `bg: var(--go10)`, `border: 2px solid var(--go)`, green checkmark SVG | solid green |
| active (bid's real stage) | `bg: var(--p)`, `border: 2px solid var(--p)`, `box-shadow: 0 0 0 4px rgba(73,26,235,.15)`, white circle SVG | purple→border gradient |
| view (clicked, ≠ active) | active + extra outer ring `0 0 0 9px rgba(73,26,235,.07)` | — |
| pending | `bg: var(--surface)`, `border: 1.5px dashed rgba(73,26,235,.25)`, empty | `var(--border)` |

**Clicking a dot** changes which stage content is *viewed* but does NOT change `bid.stage`. Viewing a non-current stage shows a read-only banner: "Viewing [Stage Name] — this bid is currently at [Current Stage]."

---

## Right Rail — `BidWorkspaceRail`

`width: 254px`, `background: var(--card)`, `border-left: 1px solid var(--border)`  
Always visible regardless of active tab.

### Sections (top to bottom)

1. **Qualification Score** — large score gauge (36px 900 in `var(--warn)`/`var(--go)`/`var(--no)` based on threshold), label, 5px progress bar, tick labels `No Go <45 · Cond 45–65 · >65 Go`

2. **Lock Go / No-Go Decision** — note text + 3 decision buttons (Go · Conditional Go · No Go). Calls existing `useUpdateBid` patch on `gonogo_decision`.

3. **Generate Documents** — "Qual Result Doc" + "C-Suite Deal Brief" buttons. Calls existing `useGenerateQualResult` / `useGenerateDealBrief`.

4. **Bid Details** — compact KV list: Type · Product · Portal · Priority · Region

5. **Recent Activity** — last 3 activity items from `useBidActivity`, timeline dot style

**The rail only renders for `deal_qualification` stage.** For other stages it renders a slimmer rail with: Bid Details KV + "Advance to next stage" button + "View full activity" link.

---

## Tab Content

Tab content is **unchanged from the current `DealQualificationWorkspace`** implementation. The redesign only changes the outer chrome (roster, header, journey, rail). The 5 tab panel components stay as-is.

**One exception — Assessment tab visual upgrade:**  
Replace the current dot-track score rows with a **2×5 score matrix** of heat-map tiles (the design from v3 prototype). Each tile shows criterion name, large score number, 5-dot bar, and weight. Background colour encodes grade (green → amber → red). This is a pure rendering change — the underlying `assessment_data` schema and `DEFAULT_CRITERIA` constant are unchanged.

---

## Responsive / scroll behaviour

- Roster scrolls independently (`overflow-y: auto` with thin scrollbar)
- `ws-main` scrolls independently — `ws-rail` is fixed height with its own scroll
- Stage journey scrolls horizontally on narrow canvases (`overflow-x: auto; scrollbar-width: none`)
- Tab nav does not wrap — scrolls horizontally if needed

---

## What is NOT changing

- All data fetching hooks (`useBids`, `useBidTeam`, `useAssessmentData`, etc.)
- All server functions
- The `DealQualificationWorkspace` tab logic, form state, and mutation calls
- The `StageWorkspace` checklist/deliverable logic for non-Deal-Qual stages
- The `gonogo_decision` / `assessment_data` database schema
- All existing tab key names and labels
