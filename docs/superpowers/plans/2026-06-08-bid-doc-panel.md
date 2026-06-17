# Bid-Scoped Documents Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Documents view to the bid detail page where users can upload and manage RFP/client documents scoped to a specific bid, keeping iMocha's global KB separate.

**Architecture:** A "Documents" view toggle is added to the bid detail left sidebar. When active, it renders a new `BidDocSection` component that uses the existing `useDocuments({ bidId })` query (already scoped), `DocCard`, `DocPreviewModal`, and a lightly extended `UploadModal` (new `prefilledBidId` prop locks the bid selector). No DB migrations, no new server functions.

**Tech Stack:** React 19, TanStack Query, TailwindCSS v4, shadcn/ui (Radix Dialog), existing `doc-queries.ts` hooks, existing `DocCard`/`DocPreviewModal`/`UploadModal` components.

---

## File Map

| File | Change |
|---|---|
| `src/components/docs/UploadModal.tsx` | Add `prefilledBidId?: string` prop — locks bid selector when uploading from bid workspace |
| `src/components/bids/BidDocSection.tsx` | **New** — bid-scoped doc list with type filters, DocCard grid, empty state, upload trigger |
| `src/routes/_app/bids.$id.tsx` | Add `view: "stages" \| "documents"` state + toggle buttons + conditional render |

---

## Task 1: Add `prefilledBidId` prop to UploadModal

**Files:**
- Modify: `src/components/docs/UploadModal.tsx:36-48` (Props type + component signature + state init + handleClose reset)

- [ ] **Step 1: Update Props type and component signature**

In `UploadModal.tsx`, find the `Props` type and `export function UploadModal(...)` line. Replace both:

```ts
type Props = {
  open: boolean;
  onClose: () => void;
  bids: Bid[];
  prefilledBidId?: string;
};

export function UploadModal({ open, onClose, bids, prefilledBidId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [docType, setDocType] = useState<DocType>("template");
  const [bidId, setBidId] = useState<string>(prefilledBidId ?? "");
  const [stage, setStage] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Fix handleClose to reset bidId to the prefilled value**

Find `handleClose` and replace it:

```ts
  function handleClose() {
    setFiles([]);
    setDocType("template");
    setBidId(prefilledBidId ?? "");
    setStage("");
    onClose();
  }
```

- [ ] **Step 3: Hide "Link to Bid" selector when prefilledBidId is set**

Find the "Link to Bid" `<div>` block in the right metadata panel (the one with `<select value={bidId} ...>`). Wrap it in a conditional:

```tsx
              {!prefilledBidId && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Link to Bid
                  </div>
                  <select
                    value={bidId}
                    onChange={(e) => setBidId(e.target.value)}
                    className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                  >
                    <option value="">— Global Template —</option>
                    {bids.map((b) => (
                      <option key={b.id} value={b.id}>{b.client_name}</option>
                    ))}
                  </select>
                </div>
              )}
```

- [ ] **Step 4: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

Expected: `✓ built in ...ms` with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/docs/UploadModal.tsx
git commit -m "feat: add prefilledBidId prop to UploadModal — locks bid selector when opened from bid workspace"
```

---

## Task 2: Create BidDocSection component

**Files:**
- Create: `src/components/bids/BidDocSection.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { useState } from "react";
import { DocCard } from "@/components/docs/DocCard";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import { useDocuments, type BidDocument, type DocType } from "@/lib/doc-queries";
import { useCurrentUser } from "@/lib/auth";
import type { Bid } from "@/lib/bid-queries";

type FilterKey = "all" | DocType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "rfp",       label: "RFP" },
  { key: "proposal",  label: "Proposal" },
  { key: "legal",     label: "Legal" },
  { key: "reference", label: "Reference" },
  { key: "template",  label: "Template" },
];

type Props = {
  bid: Bid;
};

export function BidDocSection({ bid }: Props) {
  const { data: docs = [], isLoading } = useDocuments({ bidId: bid.id });
  const { primaryRole } = useCurrentUser();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const canUpload = primaryRole === "pre_sales" || primaryRole === "admin";

  const filtered = filter === "all" ? docs : docs.filter((d) => d.type === filter);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {filtered.length} doc{filtered.length !== 1 ? "s" : ""}
        </span>
        {canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-medium inline-flex items-center gap-1 hover:opacity-90"
          >
            + Upload
          </button>
        )}
      </div>

      {/* Doc grid */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-[12px] text-muted-foreground">
            Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
            <div className="text-3xl opacity-20">📁</div>
            <div className="text-[13px]">No documents yet</div>
            {canUpload && (
              <div className="text-[11px]">Upload the client RFP, SOW, or any reference files using the button above</div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                onPreview={setPreviewDoc}
              />
            ))}
          </div>
        )}
      </div>

      <DocPreviewModal
        doc={previewDoc}
        allDocs={docs}
        onClose={() => setPreviewDoc(null)}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        bids={[]}
        prefilledBidId={bid.id}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

Expected: `✓ built in ...ms` with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/bids/BidDocSection.tsx
git commit -m "feat: BidDocSection — bid-scoped doc list with type filters and upload"
```

---

## Task 3: Add Documents view toggle to bids.$id.tsx

**Files:**
- Modify: `src/routes/_app/bids.$id.tsx`

- [ ] **Step 1: Replace the entire file content**

```tsx
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StageNav } from "@/components/bids/StageNav";
import { StageWorkspace } from "@/components/bids/StageWorkspace";
import { BidDocSection } from "@/components/bids/BidDocSection";
import { useBid } from "@/lib/bid-queries";
import type { StageKey } from "@/lib/bid-constants";

export const Route = createFileRoute("/_app/bids/$id")({
  component: BidDetail,
});

type View = "stages" | "documents";

function BidDetail() {
  const { id } = useParams({ from: "/_app/bids/$id" });
  const { data: bid, isLoading } = useBid(id);
  const [stage, setStage] = useState<StageKey | null>(null);
  const [view, setView] = useState<View>("stages");
  const navigate = useNavigate();

  useEffect(() => {
    if (bid && !stage) setStage(bid.stage);
  }, [bid, stage]);

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (!bid) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-2">
        <div className="text-sm">Bid not found.</div>
        <button onClick={() => navigate({ to: "/dashboard" })} className="text-[12px] text-primary underline">
          Back to pipeline
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Left sidebar */}
      <div className="w-[260px] shrink-0 bg-surface hairline border-r p-4 flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bid</div>
        <div className="text-[14px] font-medium leading-tight">{bid.client_name}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{bid.title}</div>

        {/* View toggle */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setView("stages")}
            className={[
              "flex-1 text-[10px] py-1.5 rounded-md border hairline transition-colors",
              view === "stages"
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:bg-background",
            ].join(" ")}
          >
            Stages
          </button>
          <button
            onClick={() => setView("documents")}
            className={[
              "flex-1 text-[10px] py-1.5 rounded-md border hairline transition-colors",
              view === "documents"
                ? "bg-primary text-white border-primary"
                : "border-border text-muted-foreground hover:bg-background",
            ].join(" ")}
          >
            Documents
          </button>
        </div>
      </div>

      {/* Main content */}
      {view === "stages" && stage && (
        <>
          <StageNav current={bid.stage} selected={stage} onSelect={setStage} />
          <StageWorkspace bid={bid} stage={stage} />
        </>
      )}
      {view === "documents" && (
        <BidDocSection bid={bid} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

Expected: `✓ built in ...ms` with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_app/bids.$id.tsx
git commit -m "feat: Documents view toggle on bid detail page"
```

---

## Task 4: Smoke test in browser

- [ ] **Step 1: Start the dev server**

```bash
bun start
```

- [ ] **Step 2: Test Stages view still works**

Open any bid. Confirm the left sidebar shows "Stages" and "Documents" toggle buttons. Confirm "Stages" is active by default and the stage workspace renders as before.

- [ ] **Step 3: Test Documents view — empty state**

Click "Documents". Confirm the panel shows the empty state (📁 icon + "No documents yet" + "Upload the client RFP..." message).

- [ ] **Step 4: Test upload flow**

Click "+ Upload". Confirm the modal opens **without** the "Link to Bid" selector. Upload a PDF. Confirm it appears in the doc grid. Confirm the `✦ AI` badge appears after a few seconds (indexing complete).

- [ ] **Step 5: Test AI search picks up the new document**

Go to `/ai`, select the same bid, open a session, ask something about the content of the uploaded document. Confirm the assistant cites it.

- [ ] **Step 6: Confirm Knowledge Hub is unaffected**

Go to `/docs`. Confirm the newly uploaded document does NOT appear in the global Knowledge Hub (it has `bid_id` set, so it's bid-scoped only). The global templates should be unchanged.

- [ ] **Step 7: Final commit (debug logging cleanup)**

Remove the `console.log` and `console.error` lines added to `stream-chat.ts` during debugging:

```bash
# Open src/lib/api/stream-chat.ts and remove the [stream-chat] log lines
# then:
git add src/lib/api/stream-chat.ts
git commit -m "chore: remove debug logging from stream-chat handler"
```
