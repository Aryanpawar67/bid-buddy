# Knowledge Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/docs` Knowledge Hub — a document management page where users upload PDFs, DOCX, and XLSX files as global templates or bid-scoped attachments, preview them in-app, and AI-index them for `@mention` in the AI Command Center.

**Architecture:** Browser uploads files directly to Supabase Storage, inserts a `bid_documents` record, then calls an `indexDocument` server function that downloads the file, extracts text, chunks it, embeds via Voyage AI, and stores chunks in `bid_document_chunks`. The `/docs` page renders a grid of document cards grouped by Global Templates / Bid Documents, with a preview modal that renders PDFs via a signed URL `<iframe>` and DOCX/XLSX via a server-generated HTML `<iframe srcdoc>`.

**Tech Stack:** TanStack Query mutations, `createServerFn` from `@tanstack/react-start`, Supabase Storage, `pdf-parse`, `mammoth`, `xlsx` (SheetJS), Voyage AI embeddings API, `sonner` toasts, Radix Dialog.

> **Note on embeddings:** The spec references "Anthropic API" for voyage-3 embeddings — this is incorrect. Voyage AI is a separate product with its own API at `api.voyageai.com` and requires a `VOYAGE_API_KEY` env var (distinct from `ANTHROPIC_API_KEY`). Add `VOYAGE_API_KEY` to your `.env.local`.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/20260605140000_knowledge_hub.sql` | Create |
| `src/lib/doc-queries.ts` | Create |
| `src/lib/api/doc-functions.ts` | Create |
| `src/components/docs/DocCard.tsx` | Create |
| `src/components/docs/DocPreviewModal.tsx` | Create |
| `src/components/docs/UploadModal.tsx` | Create |
| `src/components/docs/DocGrid.tsx` | Create |
| `src/routes/_app/docs.tsx` | Rewrite |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260605140000_knowledge_hub.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Enable pgvector (safe to run even if already enabled)
create extension if not exists vector;

-- ── bid_documents ────────────────────────────────────────────────────────────
create table if not exists public.bid_documents (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid references public.bids(id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('rfp','proposal','legal','template','reference')),
  stage         text,
  storage_path  text not null,
  size_bytes    int not null,
  uploaded_by   uuid references public.profiles(id) not null,
  embedding     vector(1024),
  created_at    timestamptz default now() not null
);

create index if not exists bid_documents_embedding_idx
  on public.bid_documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RLS
alter table public.bid_documents enable row level security;

create policy "org members can read documents"
  on public.bid_documents for select
  using (auth.uid() is not null);

create policy "pre_sales and admin can upload"
  on public.bid_documents for insert
  with check (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
      and role in ('pre_sales', 'admin')
    )
  );

create policy "owner or admin can update"
  on public.bid_documents for update
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

create policy "owner or admin can delete"
  on public.bid_documents for delete
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

-- ── bid_document_chunks ──────────────────────────────────────────────────────
create table if not exists public.bid_document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid references public.bid_documents(id) on delete cascade not null,
  chunk_index   int not null,
  chunk_text    text not null,
  embedding     vector(1024) not null,
  created_at    timestamptz default now() not null
);

create index if not exists bid_document_chunks_embedding_idx
  on public.bid_document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.bid_document_chunks enable row level security;

create policy "org members can read chunks"
  on public.bid_document_chunks for select
  using (auth.uid() is not null);

-- Server function uses service role (bypasses RLS) for insert/delete on chunks.

-- ── Storage bucket ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bid-documents',
  'bid-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create policy "org members can read bid-documents storage"
  on storage.objects for select
  using (bucket_id = 'bid-documents' and auth.uid() is not null);

create policy "pre_sales and admin can upload to bid-documents"
  on storage.objects for insert
  with check (
    bucket_id = 'bid-documents'
    and auth.uid() is not null
    and exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
      and role in ('pre_sales', 'admin')
    )
  );

create policy "owner or admin can delete from bid-documents"
  on storage.objects for delete
  using (
    bucket_id = 'bid-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
    )
  );
```

- [ ] **Step 2: Apply the migration in Supabase SQL Editor**

Open your Supabase project → SQL Editor → paste the full file above and run it.

Verify with:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('bid_documents', 'bid_document_chunks');
```
Expected: 2 rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605140000_knowledge_hub.sql
git commit -m "feat: add knowledge hub migration (bid_documents, bid_document_chunks, storage bucket)"
```

---

## Task 2: Install Packages

**Files:** `package.json` (modified by bun)

- [ ] **Step 1: Install extraction libraries**

```bash
bun add pdf-parse mammoth xlsx
bun add -d @types/pdf-parse @types/mammoth
```

- [ ] **Step 2: Verify the build still passes**

```bash
bun run build:dev
```
Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add pdf-parse, mammoth, xlsx for document text extraction"
```

---

## Task 3: Query Layer (`doc-queries.ts`)

**Files:**
- Create: `src/lib/doc-queries.ts`

- [ ] **Step 1: Write the file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { indexDocument } from "@/lib/api/doc-functions";

export type DocType = "rfp" | "proposal" | "legal" | "template" | "reference";

export type BidDocument = {
  id: string;
  bid_id: string | null;
  name: string;
  type: DocType;
  stage: string | null;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string;
  embedding: number[] | null;
  created_at: string;
};

export type DocFilters = {
  type?: DocType;
  bidId?: string;
  globalOnly?: boolean;
};

// ── useDocuments ─────────────────────────────────────────────────────────────
export function useDocuments(filters?: DocFilters) {
  return useQuery({
    queryKey: ["documents", filters],
    queryFn: async () => {
      let q = supabase
        .from("bid_documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.type) q = q.eq("type", filters.type);
      if (filters?.bidId) q = q.eq("bid_id", filters.bidId);
      if (filters?.globalOnly) q = q.is("bid_id", null);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BidDocument[];
    },
  });
}

// ── useUploadDocument ─────────────────────────────────────────────────────────
export function useUploadDocument() {
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

      // 1. Upload to Supabase Storage
      const { error: storageErr } = await supabase.storage
        .from("bid-documents")
        .upload(path, input.file, { upsert: false });
      if (storageErr) throw storageErr;

      // 2. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 3. Insert bid_documents record
      const { data: doc, error: insertErr } = await supabase
        .from("bid_documents")
        .insert({
          id: docId,
          name: input.file.name,
          type: input.type,
          bid_id: input.bidId,
          stage: input.stage,
          storage_path: path,
          size_bytes: input.file.size,
          uploaded_by: user.id,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // 4. Trigger server-side indexing (async — badge appears when embedding populates)
      indexDocument({ data: { documentId: doc.id } }).catch(console.error);

      return doc as BidDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ── useReplaceDocument ────────────────────────────────────────────────────────
export function useReplaceDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      documentId: string;
      file: File;
      storagePath: string;
    }) => {
      // 1. Re-upload to the same storage path
      const { error: storageErr } = await supabase.storage
        .from("bid-documents")
        .upload(input.storagePath, input.file, { upsert: true });
      if (storageErr) throw storageErr;

      // 2. Update size, clear stale embedding so badge shows "indexing"
      const { error: updateErr } = await supabase
        .from("bid_documents")
        .update({ size_bytes: input.file.size, embedding: null })
        .eq("id", input.documentId);
      if (updateErr) throw updateErr;

      // 3. Re-index
      indexDocument({ data: { documentId: input.documentId } }).catch(console.error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

// ── useDeleteDocument ─────────────────────────────────────────────────────────
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; storagePath: string }) => {
      // Delete storage object first (chunks + record deleted via DB cascade)
      await supabase.storage.from("bid-documents").remove([input.storagePath]);
      const { error } = await supabase
        .from("bid_documents")
        .delete()
        .eq("id", input.documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
```

- [ ] **Step 2: Skip build check — do it after Task 4**

`doc-queries.ts` imports `indexDocument` from `doc-functions.ts` which doesn't exist yet. The build check will fail until Task 4 is complete. Come back and run `bun run build:dev` after Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/lib/doc-queries.ts
git commit -m "feat: add doc-queries (useDocuments, useUploadDocument, useReplaceDocument, useDeleteDocument)"
```

---

## Task 4: Server Functions (`doc-functions.ts`)

**Files:**
- Create: `src/lib/api/doc-functions.ts`

These run server-side only (inside `.handler()`). They use `supabaseAdmin` (service role, bypasses RLS) so the indexing pipeline can write chunks without user auth context.

- [ ] **Step 1: Add `VOYAGE_API_KEY` to `.env.local`**

```
VOYAGE_API_KEY=your_voyage_api_key_here
```

Get your key at https://dash.voyageai.com — Voyage AI is free for moderate usage.

- [ ] **Step 2: Write the server functions file**

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── helpers ───────────────────────────────────────────────────────────────────

function chunkText(text: string, chunkSize = 1800, overlap = 180): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: texts }),
  });
  if (!resp.ok) throw new Error(`Voyage API error: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === "pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.map((name) =>
      XLSX.utils.sheet_to_csv(workbook.Sheets[name])
    ).join("\n");
  }
  return "";
}

// ── indexDocument ─────────────────────────────────────────────────────────────
export const indexDocument = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    // 1. Fetch the document record
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("bid_documents")
      .select("id, name, storage_path")
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    // 2. Download from storage
    const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .download(doc.storage_path);
    if (dlErr || !fileBlob) throw new Error("Failed to download file from storage");

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";

    // 3. Extract text
    const text = await extractText(buffer, ext);
    if (!text.trim()) return { chunksIndexed: 0 };

    // 4. Chunk the text
    const chunks = chunkText(text);

    // 5. Embed in batches of 128 (Voyage API limit)
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 128) {
      const batch = chunks.slice(i, i + 128);
      const embeddings = await embedBatch(batch);
      allEmbeddings.push(...embeddings);
    }

    // 6. Delete stale chunks
    await supabaseAdmin
      .from("bid_document_chunks")
      .delete()
      .eq("document_id", data.documentId);

    // 7. Insert new chunks (pgvector accepts JSON array string)
    const chunkRows = chunks.map((chunk, i) => ({
      document_id: data.documentId,
      chunk_index: i,
      chunk_text: chunk,
      embedding: JSON.stringify(allEmbeddings[i]),
    }));
    const { error: insertErr } = await supabaseAdmin
      .from("bid_document_chunks")
      .insert(chunkRows);
    if (insertErr) throw insertErr;

    // 8. Store doc-level embedding (first chunk as proxy for similarity search)
    const { error: updateErr } = await supabaseAdmin
      .from("bid_documents")
      .update({ embedding: JSON.stringify(allEmbeddings[0]) })
      .eq("id", data.documentId);
    if (updateErr) throw updateErr;

    return { chunksIndexed: chunks.length };
  });

// ── getDocPreview ─────────────────────────────────────────────────────────────
export const getDocPreview = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("bid_documents")
      .select("name, storage_path")
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";

    if (ext === "pdf") {
      const { data: urlData, error: urlErr } = await supabaseAdmin.storage
        .from("bid-documents")
        .createSignedUrl(doc.storage_path, 3600);
      if (urlErr) throw urlErr;
      return { type: "url" as const, value: urlData.signedUrl };
    }

    // DOCX / XLSX: convert to HTML server-side
    const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .download(doc.storage_path);
    if (dlErr || !fileBlob) throw new Error("Failed to download file");

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer });
      return { type: "html" as const, value: result.value };
    }

    if (ext === "xlsx") {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer);
      const html = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `<h3 style="font-family:sans-serif;font-size:13px;margin:12px 0 6px">${name}</h3>${XLSX.utils.sheet_to_html(sheet)}`;
      }).join('<hr style="margin:12px 0"/>');
      return { type: "html" as const, value: html };
    }

    throw new Error(`Unsupported file type: ${ext}`);
  });
```

- [ ] **Step 3: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/doc-functions.ts
git commit -m "feat: add indexDocument and getDocPreview server functions"
```

---

## Task 5: DocCard Component

**Files:**
- Create: `src/components/docs/DocCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { BidDocument, DocType } from "@/lib/doc-queries";

const EXT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pdf:  { bg: "#fff1f1", color: "#e53e3e", label: "PDF" },
  docx: { bg: "#ebf5ff", color: "#2563eb", label: "DOC" },
  xlsx: { bg: "#edfaf4", color: "#16a34a", label: "XLS" },
};

const TYPE_STYLES: Record<DocType, string> = {
  rfp:       "bg-[#fff1f1] text-[#e53e3e]",
  proposal:  "bg-[#fff0e8] text-[#fd5b0e]",
  legal:     "bg-[#edfaf4] text-[#16a34a]",
  template:  "bg-[#ede9fd] text-[#491aeb]",
  reference: "bg-[#f5f4fa] text-muted-foreground",
};

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Props = {
  doc: BidDocument;
  bidName?: string;
  onPreview: (doc: BidDocument) => void;
};

export function DocCard({ doc, bidName, onPreview }: Props) {
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const extStyle = EXT_COLORS[ext] ?? EXT_COLORS.pdf;
  const isIndexed = doc.embedding !== null;

  return (
    <button
      onClick={() => onPreview(doc)}
      className="relative bg-card hairline border border-border rounded-lg p-3 text-left hover:border-primary/40 transition-colors w-full flex flex-col gap-2"
    >
      {/* AI badge */}
      {isIndexed && (
        <span className="absolute top-2 right-2 text-[9px] bg-[#ede9fd] text-primary px-1.5 py-0.5 rounded font-semibold">
          ✦ AI
        </span>
      )}

      {/* File type icon */}
      <div
        className="w-10 h-12 rounded flex items-center justify-center text-[11px] font-black shrink-0"
        style={{ background: extStyle.bg, color: extStyle.color }}
      >
        {extStyle.label}
      </div>

      {/* Name */}
      <div
        className="text-[11px] font-medium leading-[1.35] overflow-hidden"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
      >
        {doc.name}
      </div>

      {/* Badges + meta */}
      <div className="flex flex-col gap-1 mt-auto">
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded self-start ${TYPE_STYLES[doc.type]}`}>
          {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
        </span>
        <div className="text-[9px] text-muted-foreground">
          {fmtBytes(doc.size_bytes)} · {fmtDate(doc.created_at)}
        </div>
        {bidName && (
          <div className="text-[9px] text-muted-foreground truncate">{bidName}</div>
        )}
        {!bidName && !doc.bid_id && (
          <div className="text-[9px] text-muted-foreground">Global template</div>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/docs/DocCard.tsx
git commit -m "feat: add DocCard component"
```

---

## Task 6: DocPreviewModal Component

**Files:**
- Create: `src/components/docs/DocPreviewModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Download, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { BidDocument, DocType } from "@/lib/doc-queries";
import { getDocPreview } from "@/lib/api/doc-functions";
import { useReplaceDocument, useDeleteDocument } from "@/lib/doc-queries";

const TYPE_STYLES: Record<DocType, string> = {
  rfp:       "bg-[#fff1f1] text-[#e53e3e]",
  proposal:  "bg-[#fff0e8] text-[#fd5b0e]",
  legal:     "bg-[#edfaf4] text-[#16a34a]",
  template:  "bg-[#ede9fd] text-[#491aeb]",
  reference: "bg-[#f5f4fa] text-muted-foreground",
};

type ReplaceState =
  | { step: "idle" }
  | { step: "confirm"; file: File }
  | { step: "replacing" };

type Props = {
  doc: BidDocument | null;
  allDocs: BidDocument[];
  onClose: () => void;
};

export function DocPreviewModal({ doc, allDocs, onClose }: Props) {
  const [preview, setPreview] = useState<{ type: "url" | "html"; value: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [replaceState, setReplaceState] = useState<ReplaceState>({ step: "idle" });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const replace = useReplaceDocument();
  const del = useDeleteDocument();

  useEffect(() => {
    if (!doc) { setPreview(null); return; }
    setPreviewLoading(true);
    getDocPreview({ data: { documentId: doc.id } })
      .then(setPreview)
      .catch(() => toast.error("Failed to load preview"))
      .finally(() => setPreviewLoading(false));
  }, [doc?.id]);

  if (!doc) return null;

  function handleCopyMention() {
    const slug = doc!.name.replace(/\.[^.]+$/, "");
    navigator.clipboard.writeText(`@${slug}`);
    toast.success("Copied — paste in AI chat to use this document");
  }

  function handleDownload() {
    if (!preview) return;
    if (preview.type === "url") {
      window.open(preview.value, "_blank");
    } else {
      toast.info("Download not available for converted previews — use Replace to update the file.");
    }
  }

  function handleReplaceSelect() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.xlsx";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      // Check if this is a rename (different name) — still allow but confirm
      setReplaceState({ step: "confirm", file });
    };
    input.click();
  }

  function handleReplaceConfirm() {
    if (replaceState.step !== "confirm") return;
    const { file } = replaceState;
    setReplaceState({ step: "replacing" });
    replace.mutate(
      { documentId: doc!.id, file, storagePath: doc!.storage_path },
      {
        onSuccess: () => {
          toast.success("Document replaced and re-indexing…");
          setReplaceState({ step: "idle" });
          onClose();
        },
        onError: () => {
          toast.error("Replace failed");
          setReplaceState({ step: "idle" });
        },
      }
    );
  }

  function handleDelete() {
    del.mutate(
      { documentId: doc!.id, storagePath: doc!.storage_path },
      {
        onSuccess: () => {
          toast.success("Document deleted");
          setDeleteConfirm(false);
          onClose();
        },
        onError: () => toast.error("Delete failed"),
      }
    );
  }

  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";

  return (
    <Dialog.Root open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed inset-4 md:inset-[5%] z-50 bg-card rounded-xl border hairline border-border shadow-2xl flex flex-col overflow-hidden focus:outline-none">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b hairline border-border shrink-0">
            <div
              className="w-8 h-10 rounded flex items-center justify-center text-[10px] font-black shrink-0"
              style={{
                background: ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4",
                color: ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a",
              }}
            >
              {ext.toUpperCase().slice(0, 3)}
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold truncate">{doc.name}</Dialog.Title>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TYPE_STYLES[doc.type]}`}>
                  {doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-background text-muted-foreground">
                  {doc.bid_id ? "Bid document" : "Global template"}
                </span>
                {doc.embedding && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ede9fd] text-primary font-semibold">
                    ✦ AI-indexed
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2 items-center shrink-0">
              <button
                onClick={handleCopyMention}
                className="text-[10px] px-2.5 py-1.5 rounded bg-[#ede9fd] text-primary font-semibold hover:bg-[#ddd5fd] transition-colors"
              >
                @ Mention
              </button>
              <button
                onClick={handleDownload}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors"
                title="Download"
              >
                <Download className="size-3.5" />
              </button>
              <button
                onClick={handleReplaceSelect}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors"
                title="Replace"
              >
                <RefreshCw className="size-3.5" />
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-red-500 hover:bg-red-50 transition-colors"
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
              <Dialog.Close asChild>
                <button className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background transition-colors">
                  <X className="size-3.5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Preview body */}
          <div className="flex-1 min-h-0 bg-[#f5f4fa]">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                Loading preview…
              </div>
            ) : preview ? (
              preview.type === "url" ? (
                <iframe
                  src={preview.value}
                  className="w-full h-full border-0"
                  title={doc.name}
                />
              ) : (
                <iframe
                  srcDoc={`<style>body{font-family:sans-serif;font-size:13px;padding:20px;line-height:1.6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e8e6f0;padding:4px 8px;font-size:11px}</style>${preview.value}`}
                  sandbox="allow-same-origin"
                  className="w-full h-full border-0 bg-white"
                  title={doc.name}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                Preview unavailable
              </div>
            )}
          </div>

          {/* Replace confirmation overlay */}
          {(replaceState.step === "confirm" || replaceState.step === "replacing") && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
              <div className="bg-card rounded-xl border hairline border-border shadow-xl w-80 overflow-hidden">
                <div className="px-4 py-3 border-b hairline border-border">
                  <div className="text-[13px] font-semibold">Replace existing document?</div>
                </div>
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-lg bg-[#fff0e8] flex items-center justify-center text-lg shrink-0">⚠️</div>
                    <p className="text-[12px] text-foreground/70 leading-relaxed">
                      Replacing <strong className="text-foreground">{doc.name}</strong> will overwrite the file and re-index its AI embeddings.
                    </p>
                  </div>
                  {replaceState.step === "confirm" && (
                    <div className="bg-background rounded-lg p-2.5 text-[10px] text-muted-foreground flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0">File</span>
                        <span className="line-through">{doc.name}</span>
                        <span className="text-primary font-semibold">→</span>
                        <span className="font-medium text-foreground">{replaceState.file.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0">AI index</span>
                        <span className="line-through">Old embeddings</span>
                        <span className="text-primary font-semibold">→</span>
                        <span className="font-medium text-foreground">Re-indexed</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 px-4 py-3 border-t hairline border-border">
                  <button
                    onClick={handleReplaceConfirm}
                    disabled={replaceState.step === "replacing"}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md bg-[#fd5b0e] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {replaceState.step === "replacing" ? "Replacing…" : "Replace & Re-index"}
                  </button>
                  <button
                    onClick={() => setReplaceState({ step: "idle" })}
                    disabled={replaceState.step === "replacing"}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50 transition-colors"
                  >
                    Keep existing
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete confirmation overlay */}
          {deleteConfirm && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
              <div className="bg-card rounded-xl border hairline border-border shadow-xl w-72 overflow-hidden">
                <div className="px-4 py-3 border-b hairline border-border">
                  <div className="text-[13px] font-semibold">Delete document?</div>
                </div>
                <div className="p-4">
                  <p className="text-[12px] text-foreground/70 leading-relaxed">
                    <strong className="text-foreground">{doc.name}</strong> and all its AI embeddings will be permanently deleted.
                  </p>
                </div>
                <div className="flex gap-2 px-4 py-3 border-t hairline border-border">
                  <button
                    onClick={handleDelete}
                    disabled={del.isPending}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {del.isPending ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="flex-1 text-[11px] font-semibold py-1.5 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/docs/DocPreviewModal.tsx
git commit -m "feat: add DocPreviewModal with inline preview, @mention copy, replace + delete"
```

---

## Task 7: UploadModal Component

**Files:**
- Create: `src/components/docs/UploadModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Upload } from "lucide-react";
import { toast } from "sonner";
import { useUploadDocument, useDocuments, type DocType } from "@/lib/doc-queries";
import type { Bid } from "@/lib/bid-queries";

type FileStatus = "pending" | "uploading" | "indexing" | "done" | "error";

type FileEntry = {
  file: File;
  status: FileStatus;
  error?: string;
};

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "template",  label: "Template" },
  { value: "rfp",       label: "RFP" },
  { value: "proposal",  label: "Proposal" },
  { value: "legal",     label: "Legal" },
  { value: "reference", label: "Reference" },
];

const STAGE_OPTIONS = [
  { value: "",                label: "Any stage" },
  { value: "deal_qualification", label: "Deal Qualification" },
  { value: "rfi",             label: "RFI" },
  { value: "rfp",             label: "RFP" },
  { value: "orals",           label: "Orals" },
  { value: "due_diligence",   label: "Due Diligence" },
  { value: "bafo",            label: "BAFO" },
  { value: "contract_closure", label: "Contract & Closure" },
  { value: "post_closure",    label: "Post Closure" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  bids: Bid[];
};

export function UploadModal({ open, onClose, bids }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [docType, setDocType] = useState<DocType>("template");
  const [bidId, setBidId] = useState<string>("");
  const [stage, setStage] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useUploadDocument();
  const { data: existingDocs = [] } = useDocuments();

  const isUploading = files.some((f) => f.status === "uploading" || f.status === "indexing");
  const allDone = files.length > 0 && files.every((f) => f.status === "done" || f.status === "error");

  function addFiles(incoming: File[]) {
    const valid = incoming.filter(
      (f) => f.size <= 26_214_400 && /\.(pdf|docx|xlsx)$/i.test(f.name)
    );
    if (valid.length < incoming.length) {
      toast.warning("Some files were skipped (must be PDF/DOCX/XLSX, max 25 MB)");
    }
    setFiles((prev) => [
      ...prev,
      ...valid.map((file) => ({ file, status: "pending" as FileStatus })),
    ]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function handleSubmit() {
    // Check for existing name collisions and warn
    const collisions = files
      .filter((f) => existingDocs.some((d) => d.name === f.file.name))
      .map((f) => f.file.name);
    if (collisions.length > 0) {
      toast.warning(
        `${collisions.join(", ")} already exist. Use the Replace button in the document card to update them.`
      );
      return;
    }

    for (const entry of files) {
      if (entry.status !== "pending") continue;

      setFiles((prev) =>
        prev.map((f) => (f.file === entry.file ? { ...f, status: "uploading" } : f))
      );

      try {
        await upload.mutateAsync({
          file: entry.file,
          type: docType,
          bidId: bidId || null,
          stage: stage || null,
        });
        setFiles((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "indexing" } : f))
        );
        // Indexing is async server-side; mark as done after the call resolves
        setFiles((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "done" } : f))
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === entry.file
              ? { ...f, status: "error", error: (err as Error).message }
              : f
          )
        );
      }
    }
  }

  function handleClose() {
    setFiles([]);
    setDocType("template");
    setBidId("");
    setStage("");
    onClose();
  }

  const STATUS_LABEL: Record<FileStatus, string> = {
    pending:   "Ready",
    uploading: "Uploading…",
    indexing:  "Indexing…",
    done:      "Done",
    error:     "Failed",
  };

  const STATUS_COLOR: Record<FileStatus, string> = {
    pending:   "text-muted-foreground",
    uploading: "text-primary",
    indexing:  "text-primary",
    done:      "text-green-600",
    error:     "text-red-500",
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 z-50 bg-card rounded-xl border hairline border-border shadow-2xl w-[640px] max-h-[80vh] overflow-hidden flex flex-col focus:outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b hairline border-border shrink-0">
            <Dialog.Title className="text-[14px] font-semibold">Upload Documents</Dialog.Title>
            <Dialog.Close asChild>
              <button className="h-7 w-7 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background">
                <X className="size-3.5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: dropzone + file list */}
            <div className="flex-1 flex flex-col gap-3 p-4 min-w-0 overflow-y-auto">
              {/* Dropzone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={[
                  "border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-background",
                ].join(" ")}
              >
                <Upload className="size-6 text-muted-foreground" />
                <div className="text-[13px] font-semibold text-primary">Drop files or click to browse</div>
                <div className="text-[11px] text-muted-foreground">PDF, DOCX, XLSX · max 25 MB</div>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.docx,.xlsx"
                  onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                />
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {files.map((entry, i) => {
                    const ext = entry.file.name.split(".").pop()?.toLowerCase() ?? "";
                    const extLabel = ext === "pdf" ? "PDF" : ext === "docx" ? "DOC" : "XLS";
                    const extBg = ext === "pdf" ? "#fff1f1" : ext === "docx" ? "#ebf5ff" : "#edfaf4";
                    const extColor = ext === "pdf" ? "#e53e3e" : ext === "docx" ? "#2563eb" : "#16a34a";
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 bg-background rounded-lg px-3 py-2 border hairline border-border"
                      >
                        <div
                          className="w-7 h-8 rounded flex items-center justify-center text-[9px] font-black shrink-0"
                          style={{ background: extBg, color: extColor }}
                        >
                          {extLabel}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium truncate">{entry.file.name}</div>
                          <div className="h-1 bg-border rounded-full mt-1.5 overflow-hidden">
                            <div
                              className={[
                                "h-full rounded-full transition-all duration-500",
                                entry.status === "done" ? "bg-green-500 w-full" :
                                entry.status === "indexing" ? "bg-primary w-4/5" :
                                entry.status === "uploading" ? "bg-primary w-2/5" :
                                entry.status === "error" ? "bg-red-500 w-full" :
                                "bg-border w-0",
                              ].join(" ")}
                            />
                          </div>
                        </div>
                        <span className={`text-[10px] font-semibold shrink-0 ${STATUS_COLOR[entry.status]}`}>
                          {STATUS_LABEL[entry.status]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: metadata form */}
            <div className="w-52 shrink-0 border-l hairline border-border flex flex-col gap-4 p-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Document Type
                </div>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType)}
                  className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

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

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Stage (optional)
                </div>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full text-[11px] bg-background border hairline border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="mt-auto flex flex-col gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={files.length === 0 || isUploading || allDone}
                  className="w-full text-[11px] font-semibold py-2 rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {isUploading ? "Uploading…" : "Upload & Index"}
                </button>
                {allDone && (
                  <button
                    onClick={handleClose}
                    className="w-full text-[11px] font-semibold py-2 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/docs/UploadModal.tsx
git commit -m "feat: add UploadModal with drag-drop, metadata form, per-file progress"
```

---

## Task 8: DocGrid Component

**Files:**
- Create: `src/components/docs/DocGrid.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { DocCard } from "./DocCard";
import type { BidDocument, DocType } from "@/lib/doc-queries";
import type { Bid } from "@/lib/bid-queries";

type FilterKey = "all" | DocType;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "template",  label: "Templates" },
  { key: "rfp",       label: "RFP" },
  { key: "proposal",  label: "Proposal" },
  { key: "legal",     label: "Legal" },
  { key: "reference", label: "Reference" },
];

type Props = {
  docs: BidDocument[];
  bids: Bid[];
  isLoading: boolean;
  onPreview: (doc: BidDocument) => void;
};

export function DocGrid({ docs, bids, isLoading, onPreview }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [bidFilter, setBidFilter] = useState<string>("");

  const bidMap = Object.fromEntries(bids.map((b) => [b.id, b.client_name]));

  const filtered = docs.filter((d) => {
    if (filter !== "all" && d.type !== filter) return false;
    if (bidFilter === "__global") return d.bid_id === null;
    if (bidFilter && d.bid_id !== bidFilter) return false;
    return true;
  });

  const globalDocs = filtered.filter((d) => d.bid_id === null);
  const bidDocs    = filtered.filter((d) => d.bid_id !== null);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "text-[10px] px-3 py-[4px] rounded-full border transition-colors",
                filter === f.key
                  ? "bg-primary text-white border-primary"
                  : "border-border-strong text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {/* By Bid filter */}
        <select
          value={bidFilter}
          onChange={(e) => setBidFilter(e.target.value)}
          className="text-[10px] bg-background border hairline border-border rounded-md px-2 py-1 text-foreground"
        >
          <option value="">By Bid: All</option>
          <option value="__global">Global only</option>
          {bids.map((b) => (
            <option key={b.id} value={b.id}>{b.client_name}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">{filtered.length} doc{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Grid content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground py-16">
            <div className="text-3xl opacity-20">📁</div>
            <div className="text-[13px]">No documents yet</div>
            <div className="text-[11px]">Upload your first document using the button above</div>
          </div>
        ) : (
          <>
            {globalDocs.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Global Templates
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {globalDocs.map((doc) => (
                    <DocCard key={doc.id} doc={doc} onPreview={onPreview} />
                  ))}
                </div>
              </section>
            )}

            {bidDocs.length > 0 && (
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Bid Documents
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {bidDocs.map((doc) => (
                    <DocCard
                      key={doc.id}
                      doc={doc}
                      bidName={doc.bid_id ? bidMap[doc.bid_id] : undefined}
                      onPreview={onPreview}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/docs/DocGrid.tsx
git commit -m "feat: add DocGrid with type filter chips and by-bid dropdown"
```

---

## Task 9: Docs Route Rewrite

**Files:**
- Rewrite: `src/routes/_app/docs.tsx`

- [ ] **Step 1: Rewrite the route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDocuments, type BidDocument } from "@/lib/doc-queries";
import { useBids } from "@/lib/bid-queries";
import { DocGrid } from "@/components/docs/DocGrid";
import { DocPreviewModal } from "@/components/docs/DocPreviewModal";
import { UploadModal } from "@/components/docs/UploadModal";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/_app/docs")({
  component: DocsPage,
});

function DocsPage() {
  const { data: docs = [], isLoading } = useDocuments();
  const { data: bids = [] } = useBids();
  const { primaryRole } = useCurrentUser();
  const [previewDoc, setPreviewDoc] = useState<BidDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const canUpload = primaryRole === "pre_sales" || primaryRole === "admin";

  return (
    <div className="h-full flex flex-col">
      {/* TopBar actions row */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card shrink-0">
        <input
          className="flex-1 max-w-[280px] text-[11px] bg-background border hairline border-border rounded-md px-3 py-1.5 text-foreground placeholder:text-muted-foreground"
          placeholder="Search documents…"
          // Search UI only — semantic search wired in AI Command Center (feature 2.5)
          readOnly
        />
        <div className="flex-1" />
        {canUpload && (
          <button
            onClick={() => setUploadOpen(true)}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-[12px] font-medium inline-flex items-center gap-1.5 hover:opacity-90"
          >
            + Upload
          </button>
        )}
      </div>

      {/* Grid */}
      <DocGrid
        docs={docs}
        bids={bids}
        isLoading={isLoading}
        onPreview={setPreviewDoc}
      />

      {/* Modals */}
      <DocPreviewModal
        doc={previewDoc}
        allDocs={docs}
        onClose={() => setPreviewDoc(null)}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        bids={bids}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0 with no TypeScript errors. The route tree is regenerated automatically.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_app/docs.tsx
git commit -m "feat: rewrite /docs route — Knowledge Hub with grid view, preview modal, upload"
```

---

## Task 10: Smoke-Check in Browser

No test runner — verify manually.

- [ ] **Step 1: Start the dev server**

```bash
bun dev
```

- [ ] **Step 2: Verify the page loads**

Navigate to `/docs`. Expected: filter bar renders, empty state "No documents yet" shows, `+ Upload` button visible for pre_sales/admin.

- [ ] **Step 3: Upload a test PDF**

Click `+ Upload`. Select a small PDF. Choose type = "Template". Click "Upload & Index". Expected: progress bar fills → status changes to "Done". Modal closes. Card appears in Global Templates section with no `✦ AI` badge yet (indexing is async).

- [ ] **Step 4: Verify AI badge appears**

Refresh the page after ~10 seconds. Expected: card now shows `✦ AI` badge (embedding populated). If `VOYAGE_API_KEY` is not set the badge won't appear — check server logs for `Voyage API error`.

- [ ] **Step 5: Open preview**

Click the card. Expected: preview modal opens. PDF renders in the iframe. `@ Mention` button visible.

- [ ] **Step 6: Test @mention copy**

Click `@ Mention`. Expected: toast "Copied — paste in AI chat to use this document". Paste confirms `@filename` in clipboard.

- [ ] **Step 7: Test replace flow**

Click the replace icon (↻). Select a different PDF. Expected: replace confirmation dialog shows with file diff and "Replace & Re-index" / "Keep existing" buttons. Click "Replace & Re-index". Expected: toast "Document replaced and re-indexing…", modal closes, `✦ AI` badge temporarily disappears from card until re-indexing completes.

- [ ] **Step 8: Test delete flow**

Open a document preview. Click the trash icon. Expected: delete confirmation overlay. Click "Delete". Expected: toast "Document deleted", modal closes, card removed from grid.

- [ ] **Step 9: Final build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: knowledge hub complete — grid view, preview, upload, AI indexing, @mention"
```

---

## Update EXECUTION-ORDER.md

After completing all tasks, update `docs/superpowers/EXECUTION-ORDER.md`:

In the 2.3 table row, change the Status cell from `🔶 Stub` to `✅ Implemented` and add the spec/plan links:

```
| 2.3 | Knowledge Hub (Documents) | [spec](specs/2026-06-05-knowledge-hub-design.md) | [plan](plans/2026-06-05-knowledge-hub.md) | ✅ Implemented |
```

In the 2.5 AI Command Center stub, update the **Blocked by** line from:
> **Blocked by:** Knowledge Hub (2.3) recommended first — AI context is richer with documents. Can be built without it (structured bid fields only) if needed sooner.

To:
> **Blocked by:** Nothing — Knowledge Hub (2.3) ✅ is complete. Documents are AI-indexed and `@mention` copies are ready for the AI chat to consume.
