# Knowledge Hub — Design Spec
_Date: 2026-06-05_
_Reference mockup: `docs/design-mockups/knowledge-hub-layout.html` (Variant B + C)_

## Goal

Document management for bid-related files. Users upload PDFs, DOCX, and XLSX files either as global org-wide templates or attached to a specific bid. Documents are previewed in-app, AI-indexed for use in the AI Command Center via `@mention`, and replaceable with version confirmation.

---

## 1. Decisions

| Question | Decision |
|---|---|
| Global templates vs bid-scoped? | Both — `bid_id nullable` |
| Preview format | In-app for all formats (PDF native iframe, DOCX/XLSX via Office Online embed) |
| AI-readable? | Yes — pgvector embeddings on upload, `@mention` in AI chat |
| Versioning | Replace with confirmation dialog (shows file diff + re-index warning) |
| Max file size | 25 MB |
| Layout | Grid view (Variant B) + preview modal; upload flow (Variant C) |
| Who can upload | `pre_sales` and `admin` only |

---

## 2. Data Model

### `bid_documents`

```sql
create table bid_documents (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid references bids(id) on delete cascade nullable,
  name          text not null,
  type          text not null check (type in ('rfp','proposal','legal','template','reference')),
  stage         text nullable,
  storage_path  text not null,
  size_bytes    int not null,
  uploaded_by   uuid references profiles(id) not null,
  embedding     vector(1024) nullable,   -- document-level summary embedding (voyage-3 dims)
  created_at    timestamptz default now()
);

-- Fast document search by embedding
create index on bid_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

`bid_id = null` → global template. `stage` is optional metadata (e.g. "rfp", "due_diligence") indicating which bid stage the document is relevant to.

### `bid_document_chunks`

```sql
create table bid_document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references bid_documents(id) on delete cascade not null,
  chunk_index   int not null,
  chunk_text    text not null,
  embedding     vector(1024) not null,
  created_at    timestamptz default now()
);

-- Fast chunk retrieval by document + similarity
create index on bid_document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

### Storage

- **Bucket:** `bid-documents` (private, no public URLs)
- **Path pattern:** `{org_id}/{document_id}/{filename}`
- **Access:** signed URLs generated server-side; 1-hour expiry for preview, force-download header for download

### RLS

```sql
-- All org users can read
create policy "org members can read documents"
  on bid_documents for select
  using (auth.uid() is not null);

-- pre_sales and admin can insert
create policy "pre_sales and admin can upload"
  on bid_documents for insert
  with check (
    exists (
      select 1 from user_roles
      where user_id = auth.uid()
      and role in ('pre_sales', 'admin')
    )
  );

-- Owner or admin can update
create policy "owner or admin can update"
  on bid_documents for update
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  );

-- Owner or admin can delete
create policy "owner or admin can delete"
  on bid_documents for delete
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  );
```

Same RLS pattern applies to `bid_document_chunks` (read: any org member; write: server function only).

---

## 3. Page Structure

**Route:** `src/routes/_app/docs.tsx` (full rewrite of placeholder)

### Layout

```
TopBar: "Knowledge Hub" · "Bid documents and templates" | [Search…] [+ Upload]
───────────────────────────────────────────────────────────────────────────────
Filter chips: All · Templates · RFP · Proposal · Legal · Reference   [By Bid ▾]
───────────────────────────────────────────────────────────────────────────────
GLOBAL TEMPLATES  (section heading)
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ card │ │ card │ │ card │ │ card │   ← 4 columns
└──────┘ └──────┘ └──────┘ └──────┘

BID DOCUMENTS  (section heading)
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ card │ │ card │ │ card │ │ card │
└──────┘ └──────┘ └──────┘ └──────┘
```

Selecting a card opens the **Preview Modal** (full-screen overlay).

### Doc Card

```
┌──────────────────────┐
│ [PDF]          ✦ AI  │  ← file type icon (colored) + AI badge top-right
│                      │
│ iMocha Security      │  ← name, 2-line clamp
│ Policy v3.pdf        │
│                      │
│ [Template]           │  ← type badge
│ 1.2 MB · Jun 2       │  ← size + date
│ — (global)           │  ← bid name or "global"
└──────────────────────┘
```

### Preview Modal

```
┌─ [PDF] iMocha Security Policy v3.pdf ──────────────────── [✕] ─┐
│  [Template] [Global] [✦ AI-indexed]                             │
│  ┌────────────────── PDF Viewer ──────────────────┐             │
│  │ ◀ 1/6 ▶                                  ⤢    │             │
│  │ [rendered PDF / Office Online embed]           │             │
│  └────────────────────────────────────────────────┘             │
│  1.2 MB · Aryan Pawar · Jun 2, 2026     [@Mention] [⬇] [↑] [✕] │
└─────────────────────────────────────────────────────────────────┘
```

**Actions:**
- `⬇ Download` — server function generates signed URL, triggers download
- `@ Mention in AI` — copies `@iMocha Security Policy v3` to clipboard; shows toast "Copied — paste in AI chat to use this document"
- `↑ Replace` — opens file picker; if filename collision detected → shows replace confirmation dialog
- `✕ Delete` — confirm before delete; also deletes chunks + storage file

### Upload Modal

Triggered by `+ Upload` button:

```
┌─ Upload Documents ──────────────────────────────────────────── ─┐
│  ┌── Dropzone ──────────────┐  ┌── Metadata ───────────────┐    │
│  │  📂                      │  │  Type       [Proposal   ▾]│    │
│  │  Drop files or browse    │  │  Link to Bid [Acme Corp  ▾]│    │
│  │  PDF, DOCX, XLSX · 25MB  │  │  Stage      [RFP        ▾]│    │
│  └──────────────────────────┘  │  [Upload & Index]          │    │
│  Progress:                      └──────────────────────────┘    │
│  [PDF] iMocha Security v4.pdf  ████████████ Uploaded            │
│  [DOC] Acme Proposal Final.docx ██████░░░░░ Indexing…           │
└─────────────────────────────────────────────────────────────────┘
```

Metadata applies to all files in the current batch.

### Replace Confirmation Dialog

Shown when an uploaded file's name matches an existing document:

```
┌─ Replace existing document? ────────────────────────────────────┐
│  ⚠️  "iMocha Security Policy v3.pdf" already exists.            │
│                                                                  │
│  What changes:                                                   │
│  File:     v3.pdf (1.2 MB)  →  v4.pdf (1.4 MB)                 │
│  AI index: Old embeddings   →  Re-indexed                       │
│                                                                  │
│  [Replace & Re-index]          [Keep existing]                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Query Layer

All Supabase queries in `src/lib/doc-queries.ts`:

```ts
useDocuments(filters?)       // all docs, optional { type, bidId, global }
useDocument(id)              // single doc
useUploadDocument()          // mutation: upload + index pipeline
useReplaceDocument()         // mutation: replace file + re-index
useDeleteDocument()          // mutation: delete doc + chunks + storage file
useSearchDocuments(query)    // semantic search via document-level embeddings
```

No direct Supabase calls in route/component files — same convention as `bid-queries.ts`.

---

## 5. AI Indexing Pipeline

Runs inside a TanStack Start server function `uploadDocument` after the file reaches Supabase Storage.

**Steps:**

1. **Extract text**
   - PDF → `pdf-parse`
   - DOCX → `mammoth`
   - XLSX → `xlsx` (sheets → rows → text)

2. **Chunk** — split into ~500-token chunks with 50-token overlap

3. **Embed chunks** — each chunk → `voyage-3` embedding via Anthropic API (`ANTHROPIC_API_KEY` env var)

4. **Store** — insert rows into `bid_document_chunks`; also generate a single document-level summary embedding and store in `bid_documents.embedding`

5. **Status** — client polls `bid_documents.embedding is not null` to show the `✦ AI-indexed` badge

**On replace:** all existing `bid_document_chunks` for the document are deleted; the pipeline re-runs for the new file.

**`@mention` in AI Command Center:** when the user types `@document-name` in the AI chat, the system fetches the top-8 most relevant chunks via cosine similarity and prepends them as context before the user's message.

---

## 6. New Files

| File | Type |
|---|---|
| `src/routes/_app/docs.tsx` | Rewrite (was placeholder) |
| `src/components/docs/DocGrid.tsx` | New |
| `src/components/docs/DocCard.tsx` | New |
| `src/components/docs/DocPreviewModal.tsx` | New |
| `src/components/docs/UploadModal.tsx` | New |
| `src/lib/doc-queries.ts` | New |
| `supabase/migrations/20260605_knowledge_hub.sql` | New migration |

**Env var needed:** `ANTHROPIC_API_KEY` (for voyage-3 embeddings)

---

## 7. Out of Scope (v1)

- Full-text keyword search (semantic search via embeddings is sufficient for v1)
- Per-bid document count badges in the sidebar
- Document sharing / external links
- Bulk delete
- Document reordering / manual sort
- Audit log of document access
