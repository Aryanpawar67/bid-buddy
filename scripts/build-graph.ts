#!/usr/bin/env bun
/**
 * Build the knowledge graph for all indexed KB documents.
 * Runs entity extraction (Haiku) on every document and populates
 * kg_entities, kg_relationships, kg_chunk_entities.
 *
 * Usage: bun scripts/build-graph.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

// ── env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY || !VOYAGE_KEY) {
  console.error("Missing env vars. Run: bun --env-file=.env scripts/build-graph.ts");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── helpers ───────────────────────────────────────────────────────────────────

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse") as any;
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text as string;
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === "xlsx") {
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.map((name) =>
      XLSX.utils.sheet_to_csv(workbook.Sheets[name])
    ).join("\n");
  }
  return "";
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: texts }),
  });
  if (!resp.ok) throw new Error(`Voyage ${resp.status}: ${await resp.text()}`);
  const json = await resp.json() as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

interface ExtractedEntity { name: string; type: string; description?: string }
interface ExtractedRelationship { source: string; target: string; type: string; description?: string }

async function extractEntities(
  fullDocText: string
): Promise<{ entities: ExtractedEntity[]; relationships: ExtractedRelationship[] }> {
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
  const jsonStr = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  const parsed = JSON.parse(jsonStr);
  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
  };
}

async function processDocument(doc: { id: string; name: string; storage_path: string }) {
  console.log(`  → ${doc.name}`);

  // Download
  const { data: blob, error: dlErr } = await supabase.storage
    .from("bid-documents")
    .download(doc.storage_path);
  if (dlErr || !blob) { console.log(`    ✗ download failed: ${dlErr?.message}`); return; }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
  const text = await extractText(buffer, ext);
  if (!text.trim()) { console.log("    ✗ no text extracted"); return; }

  // Fetch existing chunks for chunk-entity linking
  const { data: chunkRows } = await (supabase as any)
    .from("bid_document_chunks")
    .select("chunk_index, chunk_text")
    .eq("document_id", doc.id)
    .order("chunk_index", { ascending: true });

  const rawChunks: string[] = (chunkRows ?? []).map((r: any) => r.chunk_text as string);
  console.log(`    chunks: ${rawChunks.length}`);

  // Extract entities
  let entities: ExtractedEntity[] = [];
  let relationships: ExtractedRelationship[] = [];
  try {
    ({ entities, relationships } = await extractEntities(text));
    console.log(`    entities: ${entities.length}, relationships: ${relationships.length}`);
  } catch (err) {
    console.log(`    ✗ extraction failed: ${err}`);
    return;
  }

  if (!entities.length) { console.log("    ✗ no entities"); return; }

  // Embed
  const entityTexts = entities.map((e) => `${e.name}: ${e.description ?? e.type}`);
  let embeddings: number[][];
  try {
    embeddings = await embedBatch(entityTexts);
  } catch {
    embeddings = entities.map(() => new Array(1024).fill(0));
  }

  // Delete stale kg data for this doc
  await (supabase as any).from("kg_entities").delete().eq("document_id", doc.id);

  // Insert entities
  const entityRows = entities.map((e, i) => ({
    document_id: doc.id,
    name: e.name,
    type: e.type,
    description: e.description ?? null,
    embedding: JSON.stringify(embeddings[i]),
  }));

  const { data: inserted, error: insertErr } = await (supabase as any)
    .from("kg_entities")
    .insert(entityRows)
    .select("id, name");

  if (insertErr || !inserted?.length) {
    console.log(`    ✗ entity insert failed: ${insertErr?.message}`);
    return;
  }

  const entityIdMap = new Map<string, string>(
    (inserted as { id: string; name: string }[]).map((e) => [e.name.toLowerCase(), e.id])
  );

  // Insert relationships
  const relRows = relationships
    .map((r) => ({
      source_entity_id: entityIdMap.get(r.source.toLowerCase()),
      target_entity_id: entityIdMap.get(r.target.toLowerCase()),
      relationship_type: r.type,
      description: r.description ?? null,
      document_id: doc.id,
    }))
    .filter((r) => r.source_entity_id && r.target_entity_id);

  if (relRows.length) {
    const { error: relErr } = await (supabase as any).from("kg_relationships").insert(relRows);
    if (relErr) console.log(`    ⚠ relationship insert: ${relErr.message}`);
  }

  // Link entities to chunks via substring match
  const chunkEntityRows: { document_id: string; chunk_index: number; entity_id: string }[] = [];
  for (const e of inserted as { id: string; name: string }[]) {
    const needle = e.name.toLowerCase();
    for (let i = 0; i < rawChunks.length; i++) {
      if (rawChunks[i].toLowerCase().includes(needle)) {
        chunkEntityRows.push({ document_id: doc.id, chunk_index: i, entity_id: e.id });
      }
    }
  }

  if (chunkEntityRows.length) {
    const { error: linkErr } = await (supabase as any)
      .from("kg_chunk_entities")
      .upsert(chunkEntityRows, { onConflict: "document_id,chunk_index,entity_id" });
    if (linkErr) console.log(`    ⚠ chunk-entity link: ${linkErr.message}`);
    else console.log(`    ✓ linked ${chunkEntityRows.length} chunk-entity pairs`);
  } else {
    console.log("    ⚠ no chunk-entity links (entity names not found in chunk text)");
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

// Only bid-scoped uploaded (client-sent) docs — skip generated outputs
const { data: docs, error } = await (supabase as any)
  .from("bid_documents")
  .select("id, name, storage_path")
  .not("bid_id", "is", null)
  .eq("source", "uploaded")
  .order("created_at", { ascending: true });

if (error) { console.error("Failed to fetch documents:", error); process.exit(1); }
if (!docs?.length) { console.log("No documents found."); process.exit(0); }

console.log(`\nBuilding knowledge graph for ${docs.length} document(s)...\n`);

let ok = 0, fail = 0;
for (const doc of docs) {
  try {
    await processDocument(doc);
    ok++;
  } catch (err) {
    console.log(`    ✗ unexpected error: ${err}`);
    fail++;
  }
}

console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);

// Summary
const { count } = await (supabase as any)
  .from("kg_entities")
  .select("id", { count: "exact", head: true });
console.log(`kg_entities total: ${count}`);
