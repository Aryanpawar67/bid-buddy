# SharePoint → Knowledge Base Sync — Design Spec

*Date: 2026-06-10*

---

## Problem

When a product or KB document changes in SharePoint, someone must manually **delete the old file and re-upload** the new version in Bid Compass to refresh the embeddings. There is no live link between the SharePoint source of truth and the knowledge base.

---

## Goals

1. **Auto-refresh** — admin pastes a SharePoint share link to a file. When that file changes, Bid Compass detects it and re-runs the ingestion pipeline so KB chunks stay current. Eliminates manual delete + reupload.
2. **Reference context** — synced files (e.g. recently validated client responses on security/SLA) surface as **global** reference context in every RFI/RFP AI session.

**Out of scope for v1:** two-way sync, folder-level linking, external-tenant SharePoint, webhook push (polling only).

---

## Constraints & Caveats

> **Honest prerequisite:** A pasted SharePoint share link alone cannot be polled or downloaded by a server — it is a browser redirect. Programmatic access requires:
> - A one-time **Microsoft Entra (Azure AD) app registration** with **`Sites.Read.All` + `Files.Read.All`** *application* permissions (admin-consented).
> - Its **Tenant ID + Client ID + Client Secret** pasted into Bid Compass once (stored in `org_settings`, server-side only — never exposed to the browser).
> - The file must live in the **same tenant** as the registered app. External-tenant SharePoint links will not resolve.
>
> After that one-time setup, the paste-a-link UX works exactly as imagined.

---

## Architecture

### Integration pattern
Mirrors the existing **HubSpot integration** exactly:
- Credentials stored in `org_settings` (key: `sharepoint_creds`), admin-only RLS, read exclusively by server functions via `supabaseAdmin`. Never sent to the browser.
- Server functions use `createServerFn({method:"POST"})` + `requireAdmin` bearer-token check.
- Status/sync metadata stored in `org_settings` (key: `sharepoint_last_synced`).

### Ingestion
Reuses `indexDocument` from `src/lib/api/doc-functions.ts` **unchanged** — the sync logic downloads fresh bytes, overwrites the storage object at the same path, updates the `bid_documents` row, then calls `indexDocument`. That function already deletes stale `bid_document_chunks` and re-embeds. This is precisely what eliminates the manual delete + reupload.

### Scope
Synced documents are inserted with `bid_id = NULL`. This makes them global — they surface in every AI session's `hybrid_search_chunks` call with no retrieval-side changes needed.

### Change detection
1. `GET /shares/{u!...}/driveItem?select=id,name,eTag,size,lastModifiedDateTime,file,@microsoft.graph.downloadUrl` — one call returns metadata + short-lived download URL.
2. Compare stored `external_etag` — if unchanged, skip (cheap).
3. If eTag changed, compare `file.hashes.quickXorHash` — re-index only if hash differs. This avoids re-embedding on rename/move (eTag bumps, hash stays) — saving Voyage + Haiku cost.

### Auth
Client-credentials OAuth2: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with `grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`. Returns `access_token` (~3600s). Cached in-process until expiry − 60s.

### Share link → driveItem token
```
u! + base64url(shareUrl)   // strip trailing =, replace /→_, +→-
```
Endpoint: `GET https://graph.microsoft.com/v1.0/shares/{token}/driveItem`

> **Scope caveat:** `Files.ReadWrite.All` is the documented minimum for the `/shares` resolve call, but `Sites.Read.All` / `Files.Read.All` work in practice for SharePoint-hosted files. If `/shares` returns 403, escalate to `Sites.ReadWrite.All`.

---

## Data Model

### Migration: `supabase/migrations/20260610130000_sharepoint_sync.sql`

```sql
-- extend source CHECK to include 'sharepoint'
alter table public.bid_documents drop constraint if exists bid_documents_source_check;
alter table public.bid_documents
  add constraint bid_documents_source_check
  check (source in ('uploaded', 'generated', 'sharepoint'));

-- provenance + change-detection columns (nullable; only set for sharepoint rows)
alter table public.bid_documents
  add column if not exists external_id    text,        -- Graph driveItem id
  add column if not exists external_etag  text,        -- eTag (primary cheap check)
  add column if not exists external_hash  text,        -- file.hashes.quickXorHash (authoritative)
  add column if not exists external_url   text,        -- original pasted share URL
  add column if not exists last_synced_at timestamptz;

create unique index if not exists bid_documents_external_id_idx
  on public.bid_documents (external_id) where external_id is not null;

-- seed org_settings keys (mirrors hubspot pre-seed pattern; .update() expects existing rows)
insert into public.org_settings (key, value) values
  ('sharepoint_creds',       '{}'::jsonb),
  ('sharepoint_last_synced', '{"at":null,"checked":0,"refreshed":0,"errors":0}'::jsonb)
on conflict (key) do nothing;
```

**`uploaded_by NOT NULL`:** keep it — set to the admin's user id (already resolved by `requireAdmin`). The sync server fn runs under `supabaseAdmin` so inserts succeed. A real owner keeps owner-or-admin delete RLS coherent for the Knowledge Hub UI.

---

## Components

### `src/lib/api/sharepoint-sync.ts` (new)

Helpers: `getCreds()`, `getGraphToken()` (cached), `encodeShareUrl()`, `resolveDriveItem(token, shareUrl)`, `downloadBytes(downloadUrl)`.

Server functions:
| Function | Purpose |
|---|---|
| `saveSharePointCredsFn({tenantId, clientId, clientSecret})` | requireAdmin → upsert `org_settings.sharepoint_creds` |
| `testSharePointFn()` | Acquire token; return `{ok}` |
| `addSharePointSourceFn({shareUrl, type})` | requireAdmin → resolve driveItem → reject if not pdf/docx/xlsx → download → upload to bucket at `sharepoint/{id}/{name}` → insert `bid_documents` row (`bid_id:null`, `source:'sharepoint'`, `uploaded_by:admin.id`, `external_*` fields) → `indexDocument` |
| `listSharePointSourcesFn()` | Select all `bid_documents` where `source='sharepoint'` |
| `removeSharePointSourceFn({documentId})` | Delete row (chunks cascade) + remove storage object |
| `syncSharePointFn({documentId?})` | Poll one or all sources; eTag+hash check; re-download + `indexDocument` if content changed; write `sharepoint_last_synced` |

### `src/lib/settings-queries.ts` (additions)
New hooks mirroring the HubSpot set: `useSharePointStatus`, `useSaveSharePointCreds`, `useSharePointSources`, `useAddSharePointSource`, `useRemoveSharePointSource`, `useSyncSharePoint`. Secret never exposed to client — `useSharePointStatus` reads only `clientId`/`tenantId` presence.

### `src/components/settings/IntegrationsTab.tsx` (additions)
New SharePoint section below HubSpot, same card vocabulary:
- **Prerequisite callout** — muted box explaining the one-time Entra registration + same-tenant limit.
- **Connection card** — Tenant ID (text), Client ID (text), Client Secret (password) + Save + Test + connected dot.
- **Add Source card** — share-URL input + type `Select` (default: `reference`) + "Add & Index" button (toast with chunk count).
- **Sources list** — name, last-synced, per-row "Sync Now" + remove (×); header "Sync All" button.
- **Sync stats** — last-checked / refreshed / errors, same pattern as HubSpot last-synced block.

### `src/lib/doc-queries.ts` + `src/integrations/supabase/types.ts`
Extend `Document` type: add `"sharepoint"` to `source` union + new optional external_* columns.

---

## Auto-Refresh Strategy

**No scheduler exists today** — HubSpot sync is manual-only; there is no cron or edge function. Phased approach:

| Phase | Mechanism | Status |
|---|---|---|
| v1 | Manual "Sync Now" (per-source) + "Sync All" button in Settings | Ship first |
| v2 | Secret-gated cron route (`src/routes/api/sharepoint-cron.ts`) — checks `x-cron-secret` env var, runs sync-all logic; called by Railway cron / GitHub Action / cron-job.org | After v1 verified |

UI must show "Last checked" timestamp so users can confirm whether polling is actually running.

---

## File Types Supported

Only **pdf, docx, xlsx** — constrained by the existing `extractText` function in `doc-functions.ts`. The `addSharePointSourceFn` must reject other extensions with a clear error before downloading.

---

## Risks

| Risk | Mitigation |
|---|---|
| `/shares` 403 under read-only scope | Escalate to `Sites.ReadWrite.All`; document in setup guide |
| External-tenant links | Block at add-source with a clear error toast |
| eTag bumps on rename (no content change) | `quickXorHash` secondary check avoids needless re-embed |
| Entra client secret expiry (max 24mo) | Surface Graph 401s as "reconnect required" in Test/Sync toasts |
| Large files / Voyage rate limits | `embedBatch` already retries with exponential backoff |
| No auto-refresh without scheduler | "Last checked" UI timestamp makes it visible |

---

## Verification

1. Register Entra app; grant `Sites.Read.All` + `Files.Read.All` (application); admin-consent; create secret.
2. Settings → Integrations → SharePoint → paste creds → Save → Test → "Connection successful".
3. Upload a `.docx` to SharePoint; copy share link; Add Source (type=reference) → toast shows chunk count > 0.
4. SQL verify: `bid_id IS NULL`, `source='sharepoint'`, chunks > 0.
5. AI Command Center (global session) — ask question only answerable from that file → retrieves correctly.
6. Edit SharePoint file content → Sync Now → `refreshed=1`; chunks reflect new content.
7. Rename file only (no content change) → Sync → `refreshed=0`, etag updated (hash gate worked).
8. Paste external-tenant link → clean error toast, no crash.
9. `bun run build:dev` → zero errors.
