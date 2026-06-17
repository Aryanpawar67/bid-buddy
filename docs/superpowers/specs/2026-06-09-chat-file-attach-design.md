# Chat File Attach — Design Spec

**Goal:** Add a paperclip attach button to the AI Command Center chat composer so users can upload files directly mid-conversation, have them indexed, and immediately ask the AI about them — without leaving the chat.

---

## Current State (Broken / Missing)

| Step | Status | Issue |
|------|--------|-------|
| User can `@mention` already-uploaded bid docs | ✅ | Works |
| User can upload files via bid Documents tab | ✅ | Works |
| User can upload a file from inside the chat | ❌ | No attach UI in composer |
| Uploaded file is immediately retrievable by AI | ❌ | `useUploadDocument` fires indexing fire-and-forget; chunks don't exist until indexing finishes (~3–8s); AI returns nothing if you send too early |

---

## Decisions

| Question | Decision |
|----------|----------|
| Where is attach available? | **Bid sessions only** — no attach in global chat |
| Send timing | **Block send until indexing completes** — chunks must exist before RAG can retrieve |
| Default doc type | **`reference`**, scoped to the active bid (`bid_id` = active bid) |
| Who can attach? | `pre_sales` and `admin` roles only (matches `BidDocSection` permission gate) |

---

## Critical Constraint — Why Indexing Must Be Awaited

Server-side pinned retrieval uses `fetchPinnedChunks` (`src/lib/api/stream-chat.ts:80`), which reads from `bid_document_chunks`. Those rows only exist **after `indexDocument` finishes**. The existing `useUploadDocument` fires `indexDocument` as fire-and-forget (resolves on DB insert, not indexing). `UploadModal`'s "Indexing…" status is cosmetic — the mutation has already resolved. For chat attach, we need a new hook (`useUploadAndIndexDocument`) that **awaits** `indexDocument` so the mutation resolves only when chunks exist and the file is truly retrievable.

---

## Architecture / Data Flow

```
User clicks 📎 (bid mode only, pre_sales/admin)
  → hidden <input type="file" accept=".pdf,.docx,.xlsx" multiple>
  → validate: ≤25MB, allowed extension — reject others with toast.warning
  → attachment chip added: "Uploading…"
  → chip → "Indexing…"
  → useUploadAndIndexDocument.mutateAsync({ file, type: "reference", bidId: activeBid.id, stage: null })
       ├─ storage upload: bid-documents bucket, path = `${uuid}/${filename}`
       ├─ INSERT bid_documents (bid_id = activeBid.id, source: "uploaded", type: "reference")
       └─ AWAIT indexDocument({ documentId })   ← real completion; chunks now in bid_document_chunks
  → invalidate ["documents"] → doc appears in bid's Documents tab (Reference filter)
  → chip → "Ready"; attachedDocId stored in component state
  → Send button unlocks
  → user types optional message and clicks Send
  → handleSend merges attachedDocIds → mentionedDocIds
  → streamChat calls fetchPinnedChunks(mentionedDocIds) → AI answers with file content
```

No server-side changes needed. `mentionedDocIds` → `fetchPinnedChunks` already handles pinned retrieval, and `["documents"]` invalidation auto-refreshes both the composer's `@mention` dropdown and the Documents tab.

---

## UI Design

### Composer — attachment chips row (new, above the textarea row)
```
┌─────────────────────────────────────────────────────────────────┐
│ [📎 report.pdf  ◌ Indexing…  ×]  [📎 sow.docx  ✓ Ready  ×]    │
│                                                                   │
│ ┌────────────────────────────────────────────────────┐  [Send] │
│ │ Ask anything about the attached doc...              │         │
│ └────────────────────────────────────────────────────┘         │
│                                    Indexing attachment — send unlocks when ready │
└─────────────────────────────────────────────────────────────────┘
```

- **📎 button:** `h-9 w-9` icon button, sits before the textarea in the composer flex row. Disabled during `isStreaming` or while any attachment is pending. Hidden unless `canAttach`.
- **Chips:** filename + status icon (spinner for uploading/indexing, check for ready, red × for error) + dismiss × (only when not pending). Styled to match existing quick-action chips.
- **Hint line:** swaps from "Enter to send · Shift+Enter for new line" to "Indexing attachment — send unlocks when ready" while any chip is pending.

### Status states per chip

| Status | Icon | Label | Color |
|--------|------|-------|-------|
| uploading | `Loader2` spin | Uploading… | `text-primary` |
| indexing | `Loader2` spin | Indexing… | `text-primary` |
| ready | `Check` | Ready | `text-green-600` |
| error | `X` | error message | `text-destructive` |

### Send guard

```
canSend = !isStreaming && !!sessionId && !attachmentsPending
          && (inputValue.trim().length > 0 || readyDocIds.length > 0)
```

Attachment-only send (no text) is allowed — `handleSend` falls back to the prompt `"Please review the attached document(s)."` when text is empty but docs are ready.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Global session | Attach button hidden (`canAttach = false`) |
| Legal / finance role | No attach button; `@mention` existing docs still works |
| Unsupported extension (`.txt`, `.pptx`, etc.) | `toast.warning`, no chip added |
| File > 25 MB | `toast.warning`, no chip added |
| Duplicate filename (same name already in bid) | Storage `upsert: false` throws → chip shows "Already exists — use Documents tab to replace" |
| Scanned / unreadable PDF (0 chunks after indexing) | Chip shows "Couldn't read text — attached but not searchable"; doc still saved to bid |
| User navigates away mid-index | Upload + DB row already persisted; indexing continues server-side; doc lands in Documents tab |
| Multiple files attached at once | Each gets its own chip; uploaded + indexed sequentially |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/lib/doc-queries.ts` | Add `useUploadAndIndexDocument()` — mirrors `useUploadDocument` but **awaits** `indexDocument` |
| `src/components/ai/AiChatPanel.tsx` | Add attach state, file validation, chips row, paperclip button, updated `canSend` + `handleSend` |
| `src/routes/_app/ai.tsx` | No change — `bidDocs` already refreshes on `["documents"]` invalidation |
| `src/lib/api/stream-chat.ts` | No change — `fetchPinnedChunks` already handles by doc ID |

---

## Out of Scope (Future)

- Drag-and-drop onto chat
- Attach in global sessions (bid_id null)
- Persisting attachment metadata on the `Message` object
- Per-chunk progress (currently shows phase labels only, not %)
- Attach from mobile / responsive layout adjustments
