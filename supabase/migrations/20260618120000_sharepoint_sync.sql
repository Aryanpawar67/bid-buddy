-- SharePoint KB Sync: extend bid_documents + seed org_settings keys

-- extend source CHECK to include 'sharepoint'
alter table public.bid_documents drop constraint if exists bid_documents_source_check;
alter table public.bid_documents
  add constraint bid_documents_source_check
  check (source in ('uploaded', 'generated', 'sharepoint'));

-- provenance + change-detection columns (nullable; only set for sharepoint rows)
alter table public.bid_documents
  add column if not exists external_id    text,
  add column if not exists external_etag  text,
  add column if not exists external_hash  text,
  add column if not exists external_url   text,
  add column if not exists last_synced_at timestamptz;

create unique index if not exists bid_documents_external_id_idx
  on public.bid_documents (external_id) where external_id is not null;

-- seed org_settings keys
insert into public.org_settings (key, value) values
  ('sharepoint_creds',       '{}'::jsonb),
  ('sharepoint_last_synced', '{"at":null,"checked":0,"refreshed":0,"errors":0}'::jsonb)
on conflict (key) do nothing;
