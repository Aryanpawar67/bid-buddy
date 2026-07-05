# Qualification Result Documents — Implementation Plan

**Scope:** Two DOCX generation buttons on the Qualification Result tab + auto-generation of
AI insights when assessment scores are saved (no manual button needed).

---

## Part A — Auto-generate AI Insights on Assessment Save

### Goal
Remove the manual "Generate with AI" button. Insights are generated automatically the moment
scores are saved, and cached in `assessment_data.insights`. A small "Regenerate" icon stays
for manual refresh.

### Changes

#### 1. `src/components/bids/DealQualificationWorkspace.tsx`

**In `QualificationResultTab`:**

```tsx
// Add after the useMemo for totalScore:
const generateInsights = useGenerateQualificationInsights();

useEffect(() => {
  if (hasScores && !insights && !generateInsights.isPending) {
    generateInsights.mutate(bid.id);
  }
}, [hasScores, !!insights, bid.id]);
```

- `hasScores` is already computed (scoredCount > 0).
- The effect fires once when the tab mounts with scores but no cached insights.
- It does NOT fire again once insights exist (guarded by `!insights`).
- Dependency on `!!insights` (boolean) prevents re-triggering on insight object identity changes.

**Remove** the "Generate with AI" button from the AI Analysis card header.
**Keep** a small `<RefreshCw>` icon button labelled "Regenerate" that is only visible when
`insights` already exists — placed at top-right of the AI Analysis card, same position.

New button:
```tsx
{insights && (
  <button
    onClick={() => generateInsights.mutate(bid.id)}
    disabled={generateInsights.isPending}
    className="h-7 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors"
    title="Regenerate AI insights"
  >
    <RefreshCw className={`size-3 ${generateInsights.isPending ? "animate-spin" : ""}`} />
  </button>
)}
```

**Update empty state copy:**

| Condition | Copy |
|---|---|
| `!hasScores && !insights` | "Score all parameters in the Bid Assessment tab first." |
| `hasScores && !insights && isPending` | loading skeleton (3 animated bars, same as now) |
| `hasScores && !insights && !isPending` | "Generating AI analysis…" (should not be seen long) |

#### 2. `src/lib/bid-queries.ts` — `useSaveAssessment` (optional enhancement)

After the `onSuccess` invalidations, also fire insights auto-generation if the saved data has
any scores. This ensures insights refresh when scores change — not just on first view of the
Qualification Result tab.

```ts
onSuccess: async (_d, v) => {
  qc.invalidateQueries({ queryKey: ["assessment-data", v.bidId] });
  qc.invalidateQueries({ queryKey: ["bid", v.bidId] });
  // Auto-trigger insights if any scores were saved
  const hasAnyScore = Object.values(v.data.scores ?? {}).some((s) => s > 0);
  if (hasAnyScore) {
    // Lazy-import same as useGenerateQualificationInsights does
    const { generateQualificationInsightsFn } = await import("@/lib/api/generate-qualification-insights");
    const { data: { session } } = await supabase.auth.getSession();
    generateQualificationInsightsFn({
      data: { bidId: v.bidId },
      headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
    }).catch(() => {}); // fire-and-forget; UI will invalidate via query key
  }
},
```

> **Note:** This is fire-and-forget — the result updates Supabase directly, and the existing
> query invalidation in `useGenerateQualificationInsights.onSuccess` handles the UI refresh.
> No double-spinner needed in `BidAssessmentTab` since the effect in `QualificationResultTab`
> already covers cold-load.

---

## Part B — DOCX Document Generation

### New file: `src/lib/api/generate-qual-docs.ts`

Two `createServerFn` exports following the same pattern as `generate-qualification-insights.ts`.

#### Data fetched in parallel inside each handler:

```
bid          → bids (all columns)
assessmentData → bids.assessment_data
insights     → assessmentData.insights (already in assessment_data)
team         → bid_team_members view (full_name, role, email)
currentUser  → profiles (full_name) via supabaseAdmin.auth.getUser(token)
logo         → fs.readFileSync("src/assets/imocha-symbol.png") → base64
```

#### `generateQualResultFn` — Bid Qualification Result DOCX

Server function signature:
```ts
export const generateQualResultFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { bidId: string })
  .handler(async ({ data }) => { ... });
```

Returns: `Response` with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
and `Content-Disposition: attachment; filename="iMocha_{ClientName}_QualResult_{date}.docx"`.

DOCX structure (in order):
1. **Header band** — `#491AEB` shaded paragraph, logo ImageRun (22×22px), "CONFIDENTIAL — INTERNAL" right-aligned
2. **Title block** — client_name (18pt bold purple), bid title (11pt muted), deal value far-right
3. **Decision banner** — coloured `Paragraph` with `ShadingType.SOLID`:
   - Go → `#1A7F3C`  |  Conditional Go → `#B45309`  |  No Go → `#C0392B`
   - Text: "● GO / CONDITIONAL GO / NO GO — Score: XX/100 · Locked: [date]"
4. **Deal Snapshot** — 2-col `Table` (Client, Title, Type, Priority, Portal, Deadline on left; Value, Score, Decision, Bid Strength, Locked On, Prepared On on right)
5. **Assessment Parameter Table** — full-width `Table`, 7 cols: #, Parameter, Weight, Score/5, Status, Weighted Score, Notes
   - Status cell: coloured pill text (Go / Review / Caution / —)
   - Footer row: purple bg, white text, total weighted score
6. **AI Analysis section** — section heading + three sub-sections:
   - Key Strengths (green heading, bulleted `insights.strengths`)
   - Key Risks (amber heading, bulleted `insights.risks`)
   - Recommendation Summary (purple heading, paragraph `insights.recommendation`)
   - 8pt disclaimer: "AI-generated by Claude based on assessment scores."
7. **Bid Team** — 3-col Table: Name, Role, Email
8. **Page footer** (every page) — "Prepared by [name] via iMocha Bid Compass · [date] · CONFIDENTIAL" + page numbers

Brand colours in docx (hex strings, no `#`):
```
PURPLE_DARK  = "491AEB"
NAVY         = "1A0A4A"
ORANGE       = "FD5B0E"
PURPLE_TINT  = "F0EEFF"
GO_GREEN     = "1A7F3C"
WARN_AMBER   = "B45309"
NOGO_RED     = "C0392B"
MUTED        = "7B6FA8"
```

After building the buffer:
1. Upload to `bid-documents` storage: `{bidId}/qual-result/iMocha_{ClientName}_QualResult_{date}.docx`
2. Insert `bid_documents` row: `{ bid_id, name, type: "reference", stage: "deal_qualification", source: "generated", size_bytes, storage_path, uploaded_by: user.id }`
3. Return the buffer as `Response`

#### `generateDealBriefFn` — C-Suite Deal Brief DOCX

Server function signature: same pattern, same validator.

DOCX structure:
1. **Cover strip** — `#1A0A4A` bg, logo left, "DEAL BRIEF — LEADERSHIP REVIEW" center small-caps, date right; then client_name (24pt white bold), bid title (12pt white/60)
2. **4-box KPI grid** — 2×2 `Table`, no outer border, each cell shaded:
   - Deal Value — `#FD5B0E` large number
   - Qualification Score — coloured by band
   - Decision badge — full colour cell
   - Bid Strength — "Strong" / "Moderate" / "Weak"
3. **Strategic Rationale** — "Why we should pursue this" heading + top-3 bullets from `insights.strengths`
4. **Key Risks** — "Risks to manage" heading + top-3 bullets from `insights.risks`; each bullet has left amber border via paragraph border
5. **Recommendation** — `#F0EEFF` shaded box, full `insights.recommendation` text, large decision badge below
6. **Next Steps** — 3 stage-aware bullets derived from `gonogo_decision`:
   - go → "Advance to RFI", "Brief team on RFI deliverables", "Confirm client engagement timeline"
   - conditional_go → "Resolve open conditions", "Schedule stakeholder review", "Confirm go/no-go"
   - no_go → "Notify client of withdrawal", "Capture lessons learned", "Archive assets"
7. **Footer** — "Prepared by [team lead] · iMocha Bid Compass · [date] · LEADERSHIP USE ONLY"

After building the buffer:
1. Upload to `bid-documents` storage: `{bidId}/deal-brief/iMocha_{ClientName}_DealBrief_{date}.docx`
2. Insert `bid_documents` row: `{ ..., type: "reference", source: "generated" }`
3. Return the buffer as `Response`

---

### Updates to `src/lib/bid-queries.ts`

Add two mutation hooks after `useGenerateQualificationInsights`:

```ts
// ── useGenerateQualResult ──────────────────────────────────────────────────────
export function useGenerateQualResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string) => {
      const { generateQualResultFn } = await import("@/lib/api/generate-qual-docs");
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await generateQualResultFn({
        data: { bidId },
        headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
      }) as Response;
      if (!resp.ok) throw new Error("Generation failed");
      const blob = await resp.blob();
      const cd = resp.headers.get("Content-Disposition") ?? "";
      const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? "QualResult.docx";
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { filename };
    },
    onSuccess: (_d, bidId) => {
      qc.invalidateQueries({ queryKey: ["documents", bidId] });
    },
  });
}

// ── useGenerateDealBrief ───────────────────────────────────────────────────────
export function useGenerateDealBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string) => {
      const { generateDealBriefFn } = await import("@/lib/api/generate-qual-docs");
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await generateDealBriefFn({
        data: { bidId },
        headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
      }) as Response;
      if (!resp.ok) throw new Error("Generation failed");
      const blob = await resp.blob();
      const cd = resp.headers.get("Content-Disposition") ?? "";
      const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? "DealBrief.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { filename };
    },
    onSuccess: (_d, bidId) => {
      qc.invalidateQueries({ queryKey: ["documents", bidId] });
    },
  });
}
```

---

### Updates to `src/components/bids/DealQualificationWorkspace.tsx`

**Import additions:**
```ts
import { useGenerateQualResult, useGenerateDealBrief } from "@/lib/bid-queries";
import { Mail, Download } from "lucide-react";
```

**In `QualificationResultTab`**, add after `generateInsights` line:
```ts
const generateQualResult = useGenerateQualResult();
const generateDealBrief = useGenerateDealBrief();
```

**`canGenerateDocs` flag:**
```ts
const canGenerateDocs = !!insights && hasScores;
```

**Add button row** at the bottom of the left column, before the closing `</div>`:

```tsx
{/* Document generation */}
<div className="flex gap-2 pt-1">
  <button
    onClick={() => {
      generateQualResult.mutate(bid.id);
      // After download registers (~800ms), open mailto
      setTimeout(() => {
        const subject = encodeURIComponent(
          `[Bid Compass] Qual Result — ${bid.client_name} | ${
            bid.gonogo_decision === "go" ? "GO" :
            bid.gonogo_decision === "conditional_go" ? "CONDITIONAL GO" : "NO GO"
          }`
        );
        const body = encodeURIComponent(
          `Hi team,\n\nThe Bid Qualification Result for ${bid.client_name} has been locked.\n\nDecision: ${bid.gonogo_decision?.replace(/_/g, " ")}\nScore: ${totalScore} / 100\n\nPlease find the attached Qualification Result document.\n\nBid Compass | iMocha`
        );
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      }, 800);
    }}
    disabled={generateQualResult.isPending || !canGenerateDocs}
    className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:opacity-90 inline-flex items-center justify-center gap-1.5 transition-opacity"
    title={!canGenerateDocs ? "Generate AI insights first" : undefined}
  >
    <Mail className="size-3.5" />
    {generateQualResult.isPending ? "Generating…" : "Notify Bid Team"}
  </button>
  <button
    onClick={() => generateDealBrief.mutate(bid.id)}
    disabled={generateDealBrief.isPending || !canGenerateDocs}
    className="flex-1 h-9 rounded-md hairline border bg-card text-[12px] font-medium disabled:opacity-40 hover:bg-muted inline-flex items-center justify-center gap-1.5 transition-colors"
    title={!canGenerateDocs ? "Generate AI insights first" : undefined}
  >
    <Download className="size-3.5" />
    {generateDealBrief.isPending ? "Generating…" : "Deal Brief"}
  </button>
</div>
```

**Note on mailto:** `teamEmails` from `useBidTeam` are only loaded in `BidTeamTab`. To pre-fill the mailto `To:` field, either:
- (a) Also call `useBidTeam(bid.id)` in `QualificationResultTab` — small extra fetch, cached
- (b) Set `To:` server-side and return it in the response payload (preferred — avoids extra client query)

Recommended: option (a) — `useBidTeam` is already cached by React Query after visiting Bid Team tab; if not cached it fetches in < 100ms.

```ts
const { data: teamMembers = [] } = useBidTeam(bid.id);
const teamEmails = teamMembers.map((m) => m.email).filter(Boolean).join(",");
// Then in mailto: `mailto:${teamEmails}?subject=...&body=...`
```

---

## File Map Summary

| File | Action | What changes |
|---|---|---|
| `src/lib/api/generate-qual-docs.ts` | **CREATE** | Two server fns: `generateQualResultFn`, `generateDealBriefFn` |
| `src/lib/bid-queries.ts` | **EDIT** | Add `useGenerateQualResult`, `useGenerateDealBrief`; update `useSaveAssessment.onSuccess` to fire-and-forget insights |
| `src/components/bids/DealQualificationWorkspace.tsx` | **EDIT** | Auto-insights `useEffect` in `QualificationResultTab`; remove "Generate with AI" button; add two doc-generation buttons; add `useGenerateQualResult`, `useGenerateDealBrief`, `useBidTeam` calls |

No new packages. No Supabase migrations. All DOCX generation uses the existing `docx` v9.7.1.

---

## Implementation Order

1. **Auto-insights** (Part A) — edit `DealQualificationWorkspace.tsx` and `bid-queries.ts`
   - Quickest visible win; removes friction from the existing UX
2. **Server fns** (Part B step 1) — create `generate-qual-docs.ts`
   - Build and test DOCX generation in isolation
3. **Hooks** (Part B step 2) — add mutations to `bid-queries.ts`
4. **Buttons** (Part B step 3) — wire up in `QualificationResultTab`
5. **Verify** — `bun run build` must pass with no TypeScript errors

---

## Guard Rails

- Both doc buttons are disabled (`!canGenerateDocs`) when `insights` is null — tooltip explains why
- Auto-insights `useEffect` is guarded by `!generateInsights.isPending` to prevent double-firing
- `useSaveAssessment.onSuccess` fire-and-forget is wrapped in `.catch(() => {})` — save never fails due to insights error
- Document upload errors are non-blocking — if Supabase Storage write fails, the DOCX is still returned and downloaded; error is logged server-side
