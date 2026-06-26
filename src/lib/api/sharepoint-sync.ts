import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexDocument } from "@/lib/api/doc-functions";

// ── Auth helpers ───────────────────────────────────────────────────────────────

type Creds = { tenantId: string; clientId: string; clientSecret: string };

async function getCreds(): Promise<Creds> {
  const { data } = await (supabaseAdmin as any)
    .from("org_settings")
    .select("value")
    .eq("key", "sharepoint_creds")
    .maybeSingle();
  const v = data?.value ?? {};
  if (!v.tenantId || !v.clientId || !v.clientSecret)
    throw new Error("SharePoint credentials not configured");
  return v as Creds;
}

// In-process token cache
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphToken(creds?: Creds): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;
  const c = creds ?? (await getCreds());
  const res = await fetch(
    `https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) throw new Error(`Graph token error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  _tokenCache = {
    token: json.access_token as string,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return _tokenCache.token;
}

function encodeShareUrl(shareUrl: string): string {
  const b64 = Buffer.from(shareUrl).toString("base64");
  return "u!" + b64.replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
}

type DriveItem = {
  id: string;
  name: string;
  eTag: string;
  size: number;
  lastModifiedDateTime: string;
  file?: { hashes?: { quickXorHash?: string } };
  folder?: { childCount: number };
  parentReference?: { driveId: string };
  "@microsoft.graph.downloadUrl"?: string;
};

const GRAPH_SELECT = "id,name,eTag,size,lastModifiedDateTime,file,folder,parentReference,@microsoft.graph.downloadUrl";
const SUPPORTED_EXTS = ["pdf", "docx", "xlsx"];

// Accepts either a SharePoint share URL or a direct Graph API item URL (stored for folder children)
async function resolveDriveItem(shareUrlOrGraphUrl: string, token: string): Promise<DriveItem> {
  const fetchUrl = shareUrlOrGraphUrl.startsWith("https://graph.microsoft.com/")
    ? `${shareUrlOrGraphUrl}?select=${GRAPH_SELECT}`
    : `https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(shareUrlOrGraphUrl)}/driveItem?select=${GRAPH_SELECT}`;
  const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph driveItem error: ${res.status} ${await res.text()}`);
  return res.json();
}

// Lists top-level files in a shared folder (paginated, non-recursive)
async function listFolderChildren(shareUrl: string, token: string): Promise<DriveItem[]> {
  const encoded = encodeShareUrl(shareUrl);
  const all: DriveItem[] = [];
  let url: string | null =
    `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem/children` +
    `?select=${GRAPH_SELECT}&$top=100`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph children error: ${res.status} ${await res.text()}`);
    const json = await res.json();
    all.push(...((json.value ?? []) as DriveItem[]));
    url = json["@odata.nextLink"] ?? null;
  }
  return all;
}

async function downloadBytes(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Download error: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function contentTypeFor(ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

// Upload to storage, upsert bid_documents row, and index a single file driveItem
async function upsertAndIndex(
  item: DriveItem,
  type: string,
  adminId: string,
  externalUrl: string,
): Promise<{ documentId: string; chunksIndexed: number }> {
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  const downloadUrl = item["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) throw new Error(`No download URL for ${item.name}`);

  const bytes = await downloadBytes(downloadUrl);
  const storagePath = `sharepoint/${item.id}/${item.name}`;

  const { error: storageErr } = await supabaseAdmin.storage
    .from("bid-documents")
    .upload(storagePath, bytes, { contentType: contentTypeFor(ext), upsert: true });
  if (storageErr) throw new Error(`Storage upload failed: ${storageErr.message}`);

  const { data: existing } = await (supabaseAdmin as any)
    .from("bid_documents")
    .select("id")
    .eq("external_id", item.id)
    .maybeSingle();

  let documentId: string;
  if (existing) {
    await (supabaseAdmin as any)
      .from("bid_documents")
      .update({
        name: item.name,
        size_bytes: item.size,
        external_etag: item.eTag,
        external_hash: item.file?.hashes?.quickXorHash ?? null,
        external_url: externalUrl,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    documentId = existing.id;
  } else {
    const { data: row, error: insertErr } = await (supabaseAdmin as any)
      .from("bid_documents")
      .insert({
        bid_id: null,
        name: item.name,
        type,
        stage: null,
        storage_path: storagePath,
        size_bytes: item.size,
        uploaded_by: adminId,
        source: "sharepoint",
        external_id: item.id,
        external_etag: item.eTag,
        external_hash: item.file?.hashes?.quickXorHash ?? null,
        external_url: externalUrl,
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertErr) throw new Error(`DB insert failed: ${insertErr.message}`);
    documentId = row.id;
  }

  const { chunksIndexed } = await indexDocument({ data: { documentId } });
  return { documentId, chunksIndexed };
}

// ── requireAdmin ───────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<string> {
  const token = getRequest().headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) throw new Error("Forbidden — admin only");
  return user.id;
}

// ── Server functions ───────────────────────────────────────────────────────────

export const saveSharePointCredsFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ tenantId: z.string(), clientId: z.string(), clientSecret: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    _tokenCache = null;
    await (supabaseAdmin as any)
      .from("org_settings")
      .update({ value: { tenantId: data.tenantId, clientId: data.clientId, clientSecret: data.clientSecret } })
      .eq("key", "sharepoint_creds");
    return { ok: true };
  });

export const testSharePointFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAdmin();
    await getGraphToken();
    return { ok: true };
  });

export const addSharePointSourceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    shareUrl: z.string().url(),
    type: z.enum(["template", "rfp", "proposal", "legal", "reference"]).default("reference"),
  }))
  .handler(async ({ data }) => {
    const adminId = await requireAdmin();
    const token = await getGraphToken();
    const item = await resolveDriveItem(data.shareUrl, token);

    // ── Folder ────────────────────────────────────────────────────────────────
    if (item.folder) {
      const children = await listFolderChildren(data.shareUrl, token);
      const files = children.filter(child => {
        const ext = child.name.split(".").pop()?.toLowerCase();
        return child.file && ext && SUPPORTED_EXTS.includes(ext);
      });
      if (files.length === 0)
        throw new Error("Folder contains no supported files (PDF, DOCX, XLSX).");

      let filesIndexed = 0, chunksIndexed = 0;
      for (const child of files) {
        try {
          // Store a stable Graph API URL so sync can re-resolve the file directly
          const driveId = child.parentReference?.driveId;
          const externalUrl = driveId
            ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${child.id}`
            : data.shareUrl;
          const result = await upsertAndIndex(child, data.type, adminId, externalUrl);
          filesIndexed++;
          chunksIndexed += result.chunksIndexed;
        } catch (err) {
          console.error(`[sharepoint-sync] failed indexing ${child.name}:`, err);
        }
      }
      return { ok: true, filesIndexed, chunksIndexed };
    }

    // ── File ──────────────────────────────────────────────────────────────────
    const ext = item.name.split(".").pop()?.toLowerCase();
    if (!ext || !SUPPORTED_EXTS.includes(ext))
      throw new Error(`Unsupported file type: ${ext}. Only PDF, DOCX, XLSX allowed.`);

    const { documentId, chunksIndexed } = await upsertAndIndex(item, data.type, adminId, data.shareUrl);
    return { ok: true, documentId, chunksIndexed };
  });

export const listSharePointSourcesFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAdmin();
    const { data } = await (supabaseAdmin as any)
      .from("bid_documents")
      .select("id, name, type, size_bytes, external_url, external_etag, last_synced_at, created_at")
      .eq("source", "sharepoint")
      .order("created_at", { ascending: false });
    return (data ?? []) as SharePointSource[];
  });

export type SharePointSource = {
  id: string;
  name: string;
  type: string;
  size_bytes: number;
  external_url: string | null;
  external_etag: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export const removeSharePointSourceFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { data: doc } = await (supabaseAdmin as any)
      .from("bid_documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .maybeSingle();
    if (doc?.storage_path) {
      await supabaseAdmin.storage.from("bid-documents").remove([doc.storage_path]);
    }
    await (supabaseAdmin as any).from("bid_documents").delete().eq("id", data.documentId);
    return { ok: true };
  });

export const syncSharePointFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ documentId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const token = await getGraphToken();

    const q = (supabaseAdmin as any)
      .from("bid_documents")
      .select("id, name, storage_path, external_id, external_etag, external_hash, external_url");

    const { data: sources } = data.documentId
      ? await q.eq("id", data.documentId).eq("source", "sharepoint")
      : await q.eq("source", "sharepoint");

    const rows = (sources ?? []) as Array<{
      id: string; name: string; storage_path: string;
      external_id: string; external_etag: string; external_hash: string | null; external_url: string;
    }>;

    let checked = 0, refreshed = 0, errors = 0;

    for (const row of rows) {
      checked++;
      try {
        const item = await resolveDriveItem(row.external_url, token);
        const newEtag = item.eTag;
        const newHash = item.file?.hashes?.quickXorHash ?? null;

        // Skip if eTag unchanged
        if (newEtag === row.external_etag) continue;

        // Hash unchanged → rename/move only, no content re-index needed
        if (newHash && newHash === row.external_hash) {
          await (supabaseAdmin as any)
            .from("bid_documents")
            .update({ name: item.name, external_etag: newEtag, last_synced_at: new Date().toISOString() })
            .eq("id", row.id);
          continue;
        }

        // Content changed — re-download and re-index
        const downloadUrl = item["@microsoft.graph.downloadUrl"];
        if (!downloadUrl) throw new Error("No download URL");
        const bytes = await downloadBytes(downloadUrl);

        const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
        await supabaseAdmin.storage
          .from("bid-documents")
          .upload(row.storage_path, bytes, { contentType: contentTypeFor(ext), upsert: true });

        await (supabaseAdmin as any)
          .from("bid_documents")
          .update({
            name: item.name,
            size_bytes: item.size,
            external_etag: newEtag,
            external_hash: newHash,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        await indexDocument({ data: { documentId: row.id } });
        refreshed++;
      } catch (err) {
        console.error(`[sharepoint-sync] error syncing ${row.id}:`, err);
        errors++;
      }
    }

    await (supabaseAdmin as any)
      .from("org_settings")
      .update({ value: { at: new Date().toISOString(), checked, refreshed, errors } })
      .eq("key", "sharepoint_last_synced");

    return { checked, refreshed, errors };
  });
