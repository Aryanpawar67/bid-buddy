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
