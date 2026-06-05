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
