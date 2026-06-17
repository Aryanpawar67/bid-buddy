import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── helpers ───────────────────────────────────────────────────────────────────

// Sentence-aware chunker — never splits mid-sentence
function chunkText(text: string, targetSize = 1800, overlap = 180): string[] {
  const paragraphs = text.split(/\n\n+/);
  const sentences: string[] = [];
  for (const para of paragraphs) {
    const parts = para.split(/(?<=[.!?])\s+/);
    sentences.push(...parts.filter((s) => s.trim()));
  }

  const chunks: string[] = [];
  let current = "";
  let overlapBuffer = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > targetSize && current) {
      chunks.push(current.trim());
      overlapBuffer = current.slice(-overlap);
      current = overlapBuffer + " " + sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Contextual Retrieval: prepend a 50-100 token situating blurb per chunk
// using Haiku with the full document cached as a system block.
async function contextualiseChunks(
  chunks: string[],
  fullDocText: string
): Promise<string[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextualise = async (chunk: string): Promise<string> => {
    try {
      const resp = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: [
          {
            type: "text",
            text: fullDocText,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              "Here is a chunk from the document:\n\n" +
              chunk +
              "\n\nGive a 1-2 sentence context situating this chunk within the overall document for search retrieval. Answer only with the context.",
          },
        ],
      });
      const context =
        resp.content.find((b) => b.type === "text")?.text?.trim() ?? "";
      return context ? `${context}\n\n${chunk}` : chunk;
    } catch {
      return chunk;
    }
  };

  // Parallelise with a concurrency cap of 8 to avoid rate-limit spikes
  const CONCURRENCY = 8;
  const results: string[] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map(contextualise));
    settled.forEach((r, j) => { results[i + j] = r; });
  }
  return results;
}

async function embedBatch(texts: string[], attempt = 0): Promise<number[][]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: texts }),
  });
  if (resp.status === 429 && attempt < 4) {
    // Respect Retry-After if present, otherwise exponential backoff (20s, 40s, 80s, 160s)
    const retryAfter = Number(resp.headers.get("Retry-After") ?? 0);
    const delay = retryAfter > 0 ? retryAfter * 1000 : 20_000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
    return embedBatch(texts, attempt + 1);
  }
  if (!resp.ok) throw new Error(`Voyage API error: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === "pdf") {
    // pdf-parse v2 uses a class API: new PDFParse({ data: buffer }).getText()
    const { PDFParse } = await import("pdf-parse") as any;
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text as string;
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

    // 4. Chunk (sentence-aware) then contextualise via Haiku (best-effort)
    const rawChunks = chunkText(text);
    const chunks = await contextualiseChunks(rawChunks, text);

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

// ── reindexAll ────────────────────────────────────────────────────────────────
export const reindexAll = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: docs, error } = await (supabaseAdmin as any)
      .from("bid_documents")
      .select("id");
    if (error) throw error;

    let indexed = 0;
    for (const doc of docs ?? []) {
      try {
        await indexDocument({ data: { documentId: doc.id } });
        indexed++;
      } catch (err) {
        console.error(`reindexAll: failed for ${doc.id}`, err);
      }
    }
    return { indexed, total: docs?.length ?? 0 };
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
