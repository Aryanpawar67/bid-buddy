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

// ── entity extraction (Graph RAG) ─────────────────────────────────────────────

interface ExtractedEntity { name: string; type: string; description?: string }
interface ExtractedRelationship { source: string; target: string; type: string; description?: string }

async function extractAndIndexEntities(
  fullDocText: string,
  documentId: string,
  rawChunks: string[]
): Promise<void> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let entities: ExtractedEntity[] = [];
  let relationships: ExtractedRelationship[] = [];

  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: [{ type: "text", text: fullDocText, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Extract key entities and relationships from this document for a knowledge graph.

Return raw JSON only (no markdown fences):
{
  "entities": [{"name":"<exact name>","type":"<TYPE>","description":"<1 sentence>"}],
  "relationships": [{"source":"<entity name>","target":"<entity name>","type":"<TYPE>","description":"<1 sentence>"}]
}

Entity types: STANDARD, FEATURE, INTEGRATION, CONCEPT, PRODUCT, POLICY, METRIC, ORG
Relationship types: REQUIRES, SUPPORTS, PART_OF, INTEGRATES_WITH, USES, COMPLIES_WITH, MEASURES

Rules:
- Extract 10–25 important entities; quality over quantity
- Use the exact name as it appears in the document
- Only list relationships between entities you extracted
- Focus on facts that enable cross-document multi-hop reasoning`,
      }],
    });

    const raw = resp.content.find((b) => b.type === "text")?.text?.trim() ?? "{}";
    // Strip markdown fences if Haiku wraps the JSON
    const jsonStr = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);
    entities = Array.isArray(parsed.entities) ? parsed.entities : [];
    relationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];
  } catch {
    return; // non-fatal: skip entity extraction on parse/API error
  }

  if (!entities.length) return;

  // Embed entity names + descriptions
  const entityTexts = entities.map((e) => `${e.name}: ${e.description ?? e.type}`);
  let embeddings: number[][];
  try {
    embeddings = await embedBatch(entityTexts);
  } catch {
    embeddings = entities.map(() => new Array(1024).fill(0));
  }

  // Delete stale kg data for this document (cascade handles relationships + chunk links)
  await (supabaseAdmin as any).from("kg_entities").delete().eq("document_id", documentId);

  // Insert entities
  const entityRows = entities.map((e, i) => ({
    document_id: documentId,
    name: e.name,
    type: e.type,
    description: e.description ?? null,
    embedding: JSON.stringify(embeddings[i]),
  }));
  const { data: inserted, error: entityErr } = await (supabaseAdmin as any)
    .from("kg_entities")
    .insert(entityRows)
    .select("id, name");
  if (entityErr || !inserted?.length) return;

  const entityIdMap = new Map<string, string>(
    (inserted as { id: string; name: string }[]).map((e) => [e.name.toLowerCase(), e.id])
  );

  // Insert relationships (map names → IDs)
  const relRows = relationships
    .map((r) => ({
      source_entity_id: entityIdMap.get(r.source.toLowerCase()),
      target_entity_id: entityIdMap.get(r.target.toLowerCase()),
      relationship_type: r.type,
      description: r.description ?? null,
      document_id: documentId,
    }))
    .filter((r) => r.source_entity_id && r.target_entity_id);

  if (relRows.length) {
    await (supabaseAdmin as any).from("kg_relationships").insert(relRows);
  }

  // Link entities to chunks via substring match
  const chunkEntityRows: { document_id: string; chunk_index: number; entity_id: string }[] = [];
  for (const e of inserted as { id: string; name: string }[]) {
    const needle = e.name.toLowerCase();
    for (let i = 0; i < rawChunks.length; i++) {
      if (rawChunks[i].toLowerCase().includes(needle)) {
        chunkEntityRows.push({ document_id: documentId, chunk_index: i, entity_id: e.id });
      }
    }
  }
  if (chunkEntityRows.length) {
    await (supabaseAdmin as any)
      .from("kg_chunk_entities")
      .upsert(chunkEntityRows, { onConflict: "document_id,chunk_index,entity_id" });
  }
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

    // 9. Extract entities + relationships for Graph RAG (best-effort, non-blocking)
    extractAndIndexEntities(text, data.documentId, rawChunks).catch((err) =>
      console.error("[indexDocument] entity extraction failed:", err)
    );

    return { chunksIndexed: chunks.length };
  });

// ── reindexAll ────────────────────────────────────────────────────────────────
export const reindexAll = createServerFn({ method: "POST" })
  .inputValidator(z.object({}))
  .handler(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allDocs, error } = await (supabaseAdmin as any)
      .from("bid_documents")
      .select("id, name, bid_id, storage_path, size_bytes")
      .order("size_bytes", { ascending: false });
    if (error) throw error;

    // Deduplicate: group by (bid_id + name). Keep the largest; delete the rest.
    const seen = new Map<string, string>(); // key → kept id
    const toDelete: { id: string; storage_path: string }[] = [];

    for (const doc of allDocs ?? []) {
      const key = `${doc.bid_id ?? "global"}::${doc.name}`;
      if (seen.has(key)) {
        toDelete.push({ id: doc.id, storage_path: doc.storage_path });
      } else {
        seen.set(key, doc.id);
      }
    }

    // Delete duplicate storage files + DB rows
    let deleted = 0;
    for (const dup of toDelete) {
      try {
        await supabaseAdmin.storage.from("bid-documents").remove([dup.storage_path]);
        await (supabaseAdmin as any).from("bid_documents").delete().eq("id", dup.id);
        deleted++;
      } catch (err) {
        console.error(`reindexAll: delete duplicate ${dup.id} failed`, err);
      }
    }

    // Reindex survivors
    const survivors = (allDocs ?? []).filter((d: any) => !toDelete.some((x) => x.id === d.id));
    let indexed = 0;
    for (const doc of survivors) {
      try {
        await indexDocument({ data: { documentId: doc.id } });
        indexed++;
      } catch (err) {
        console.error(`reindexAll: failed for ${doc.id}`, err);
      }
    }
    return { indexed, deleted, total: survivors.length };
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

    // Download the file for all types so we avoid cross-origin embedding issues
    const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .download(doc.storage_path);
    if (dlErr || !fileBlob) return null;

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    if (ext === "pdf") {
      // Return as base64 data URI — embeds inline, no CORS/CSP issues
      const b64 = buffer.toString("base64");
      return { type: "url" as const, value: `data:application/pdf;base64,${b64}` };
    }

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
