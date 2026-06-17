# Chat File Attach — Implementation Plan

**Goal:** Paperclip attach button in the AI chat composer — uploads to the active bid, awaits real indexing completion, then unlocks send so the AI can immediately retrieve and answer about the file.

**Spec:** `docs/superpowers/specs/2026-06-09-chat-file-attach-design.md`

**Tech Stack:** React 19, TanStack Query, TailwindCSS v4, shadcn/ui, Supabase (Storage + Postgres), Bun

---

## File Map

| File | Change |
|------|--------|
| `src/lib/doc-queries.ts` | Add `useUploadAndIndexDocument()` hook |
| `src/components/ai/AiChatPanel.tsx` | Attach UI, state, chips, `canSend`, `handleSend` wiring |

---

## Task 1: `useUploadAndIndexDocument` hook

**File:** `src/lib/doc-queries.ts`

- [ ] **Step 1: Read the file**, verify the exact insert columns used in `useUploadDocument` (lines 72–87), then append the new hook:

```ts
// ── useUploadAndIndexDocument ──────────────────────────────────────────────────
// Like useUploadDocument but AWAITS indexDocument so chunks exist on resolve.
export function useUploadAndIndexDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      type: DocType;
      bidId: string | null;
      stage: string | null;
    }) => {
      const docId = crypto.randomUUID();
      const path = `${docId}/${input.file.name}`;

      const { error: upErr } = await supabase.storage
        .from("bid-documents")
        .upload(path, input.file, { upsert: false });
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: doc, error: insertErr } = await (supabase as any)
        .from("bid_documents")
        .insert({
          id: docId,
          bid_id: input.bidId,
          name: input.file.name,
          type: input.type,
          stage: input.stage,
          storage_path: path,
          size_bytes: input.file.size,
          uploaded_by: user.id,
          source: "uploaded",
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // Await real indexing — not fire-and-forget.
      // fetchPinnedChunks in stream-chat.ts reads bid_document_chunks,
      // which only exist after this resolves.
      await indexDocument({ data: { documentId: (doc as BidDocument).id } });
      return doc as BidDocument;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}
```

- [ ] **Step 2: Verify build**
```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```bash
git add src/lib/doc-queries.ts
git commit -m "feat: useUploadAndIndexDocument — awaits real indexing for chat attach"
```

---

## Task 2: Attach UI in AiChatPanel

**File:** `src/components/ai/AiChatPanel.tsx`

- [ ] **Step 1: Add imports**

  Add `Paperclip, CheckCircle2, X` to the lucide import line.
  Add `useUploadAndIndexDocument` to the `@/lib/doc-queries` import.
  Add `useCurrentUser` from `@/lib/auth`.
  Add `toast` from `sonner` (already used elsewhere in the app).

- [ ] **Step 2: Add attachment state + constants** (after the mention state block, ~line 100)

```ts
// Attachment state
const fileInputRef = useRef<HTMLInputElement>(null);
type Attachment = {
  localId: string;
  name: string;
  status: "uploading" | "indexing" | "ready" | "error";
  docId?: string;
  error?: string;
};
const [attachments, setAttachments] = useState<Attachment[]>([]);
const uploadAndIndex = useUploadAndIndexDocument();
const { primaryRole } = useCurrentUser();

const MAX_ATTACH_BYTES = 26_214_400; // 25 MB
const ATTACH_EXT = /\.(pdf|docx|xlsx)$/i;

const canAttach = !isGlobal && !!activeBid &&
  (primaryRole === "pre_sales" || primaryRole === "admin");
const attachmentsPending = attachments.some(
  (a) => a.status === "uploading" || a.status === "indexing"
);
const readyDocIds = attachments
  .filter((a) => a.status === "ready" && a.docId)
  .map((a) => a.docId!);
```

- [ ] **Step 3: Add `handleFilesSelected` function** (after mention helper functions, ~line 160)

```ts
async function handleFilesSelected(files: FileList | null) {
  if (!files || !activeBid) return;
  // Reset input so same file can be re-picked after error
  if (fileInputRef.current) fileInputRef.current.value = "";

  const valid: File[] = [];
  for (const f of Array.from(files)) {
    if (!ATTACH_EXT.test(f.name)) {
      toast.warning(`${f.name}: only PDF, DOCX, and XLSX are supported`);
      continue;
    }
    if (f.size > MAX_ATTACH_BYTES) {
      toast.warning(`${f.name}: file must be under 25 MB`);
      continue;
    }
    valid.push(f);
  }

  for (const file of valid) {
    const localId = crypto.randomUUID();
    setAttachments((prev) => [...prev, { localId, name: file.name, status: "uploading" }]);

    try {
      setAttachments((prev) =>
        prev.map((a) => a.localId === localId ? { ...a, status: "indexing" } : a)
      );
      const doc = await uploadAndIndex.mutateAsync({
        file,
        type: "reference",
        bidId: activeBid.id,
        stage: null,
      });
      setAttachments((prev) =>
        prev.map((a) => a.localId === localId ? { ...a, status: "ready", docId: doc.id } : a)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const display = msg.includes("upsert") || msg.includes("already exists")
        ? "Already exists — use Documents tab to replace"
        : msg;
      setAttachments((prev) =>
        prev.map((a) => a.localId === localId ? { ...a, status: "error", error: display } : a)
      );
    }
  }
}
```

- [ ] **Step 4: Update `canSend` and `handleSend`** (~lines 194, 188)

Replace `canSend`:
```ts
const canSend = !isStreaming && !!sessionId && !attachmentsPending &&
  (inputValue.trim().length > 0 || readyDocIds.length > 0);
```

Replace `handleSend`:
```ts
function handleSend(overrideText?: string) {
  const text = (overrideText ?? inputValue) ||
    (readyDocIds.length ? "Please review the attached document(s)." : "");
  const mentioned = resolveMentionedDocIds(text);
  const ids = [...new Set([...mentioned, ...readyDocIds])];
  onSend(text || undefined, ids.length ? ids : undefined);
  setAttachments([]);
}
```

- [ ] **Step 5: Add JSX — attachment chips row + paperclip button + hidden input**

  In the composer outer div (line ~361), **before** the `<div className="relative flex gap-2 items-end">` row, insert:

```tsx
{/* Attachment chips */}
{attachments.length > 0 && (
  <div className="flex flex-wrap gap-1.5 mb-2">
    {attachments.map((a) => (
      <div
        key={a.localId}
        className={[
          "flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border hairline",
          a.status === "error"
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-border bg-background text-foreground",
        ].join(" ")}
      >
        {(a.status === "uploading" || a.status === "indexing") && (
          <Loader2 className="size-3 animate-spin text-primary shrink-0" />
        )}
        {a.status === "ready" && (
          <CheckCircle2 className="size-3 text-green-600 shrink-0" />
        )}
        {a.status === "error" && (
          <X className="size-3 shrink-0" />
        )}
        <span className="truncate max-w-[140px]">{a.name}</span>
        <span className={a.status === "error" ? "text-destructive" : "text-muted-foreground"}>
          {a.status === "uploading" ? "Uploading…"
            : a.status === "indexing" ? "Indexing…"
            : a.status === "ready" ? "Ready"
            : a.error ?? "Error"}
        </span>
        {a.status !== "uploading" && a.status !== "indexing" && (
          <button
            type="button"
            onClick={() => setAttachments((prev) => prev.filter((x) => x.localId !== a.localId))}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-2.5" />
          </button>
        )}
      </div>
    ))}
  </div>
)}
```

  In the `<div className="relative flex gap-2 items-end">` row, **before** the `<textarea>`, insert:

```tsx
{/* Paperclip attach button */}
{canAttach && (
  <>
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf,.docx,.xlsx"
      multiple
      className="hidden"
      onChange={(e) => handleFilesSelected(e.target.files)}
    />
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={attachmentsPending || isStreaming}
      title="Attach file (PDF, DOCX, XLSX)"
      className="h-9 w-9 flex items-center justify-center rounded-lg border hairline border-border text-muted-foreground hover:bg-background hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
    >
      <Paperclip className="size-4" strokeWidth={1.5} />
    </button>
  </>
)}
```

  Update the hint line (~line 432) to swap text while indexing:

```tsx
<div className="text-[9px] text-muted-foreground mt-1.5 text-right">
  {attachmentsPending
    ? "Indexing attachment — send unlocks when ready"
    : "Enter to send · Shift+Enter for new line"}
</div>
```

- [ ] **Step 6: Verify build**
```bash
cd "/Users/aryan/Desktop/Bid Compass/bid-buddy" && bun run build:dev 2>&1 | tail -5
```

- [ ] **Step 7: Commit**
```bash
git add src/components/ai/AiChatPanel.tsx
git commit -m "feat: chat file attach — paperclip button, indexing chips, send gate"
```

---

## Task 3: End-to-End Smoke Test

- [ ] Start dev server: `bun start`
- [ ] Log in as pre_sales or admin
- [ ] Go to `/ai` → Bid mode → select a bid → open/create a session
- [ ] Confirm 📎 appears in the composer
- [ ] Switch to Global mode → confirm 📎 is **not** shown
- [ ] Back to bid mode → click 📎, pick a small PDF
- [ ] Chip shows "Uploading…" then "Indexing…"; Send button is **disabled**
- [ ] Chip flips to "Ready"; Send unlocks
- [ ] Send (no text) → AI responds summarising the file content
- [ ] Open bid's **Documents tab** → file appears under **Reference** filter
- [ ] Back in chat, type `@` → attached file appears in the mention dropdown
- [ ] Attach a `.txt` file → rejected with toast (no chip)
- [ ] Attach a >25MB file → rejected with toast (no chip)
