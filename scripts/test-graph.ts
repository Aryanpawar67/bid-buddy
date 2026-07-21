#!/usr/bin/env bun
/**
 * Test Graph RAG — runs a query through graph traversal + hybrid vector search
 * and shows what each arm contributes to the final rerank pool.
 *
 * Usage: bun --env-file=.env scripts/test-graph.ts "your query here"
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const query = process.argv[2] ?? "What encryption standards does iMocha use for ISO 27001 compliance?";
console.log(`\nQuery: "${query}"\n`);

// ── embed ──────────────────────────────────────────────────────────────────────
async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  const json = await resp.json() as any;
  return json.data[0].embedding;
}

async function rerank(query: string, docs: string[]): Promise<{ index: number; score: number }[]> {
  if (docs.length <= 1) return docs.map((_, i) => ({ index: i, score: 1 }));
  const resp = await fetch("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "rerank-2.5", query, documents: docs, top_k: 8 }),
  });
  const json = await resp.json() as any;
  return json.data;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── graph search ───────────────────────────────────────────────────────────────
console.log("── GRAPH ARM ──────────────────────────────────────────────────────");

const queryEmb = await embedText(query);
const { data: allEntities } = await (sb as any)
  .from("kg_entities")
  .select("id, name, type, description, embedding");

const scored = (allEntities ?? [])
  .map((e: any) => {
    const emb = typeof e.embedding === "string" ? JSON.parse(e.embedding) : e.embedding;
    return { ...e, score: cosine(queryEmb, emb) };
  })
  .sort((a: any, b: any) => b.score - a.score)
  .slice(0, 10)
  .filter((e: any) => e.score > 0.4);

const matchedEntities = scored;
console.log(`\nMatched entities (${matchedEntities.length}, by embedding similarity):`);
for (const e of matchedEntities) {
  console.log(`  [${e.type}] ${e.name} (${e.score.toFixed(3)}) — ${e.description ?? ""}`);
}

const seedIds: string[] = matchedEntities.map((e: any) => e.id);
let graphChunks: { doc_name: string; chunk_text: string }[] = [];

if (seedIds.length) {
  const { data: rels } = await (sb as any)
    .from("kg_relationships")
    .select("source_entity_id, target_entity_id, relationship_type, description")
    .or(`source_entity_id.in.(${seedIds.join(",")}),target_entity_id.in.(${seedIds.join(",")})`)
    .limit(30);

  console.log(`\n1-hop relationships (${rels?.length ?? 0}):`);
  for (const r of (rels ?? []).slice(0, 8)) {
    console.log(`  ${r.relationship_type}: ${r.description ?? ""}`);
  }

  const allEntityIds = new Set<string>(seedIds);
  for (const r of rels ?? []) {
    allEntityIds.add(r.source_entity_id);
    allEntityIds.add(r.target_entity_id);
  }

  const { data: chunkLinks } = await (sb as any)
    .from("kg_chunk_entities")
    .select("document_id, chunk_index")
    .in("entity_id", [...allEntityIds]);

  const byDoc = new Map<string, number[]>();
  for (const link of chunkLinks ?? []) {
    if (!byDoc.has(link.document_id)) byDoc.set(link.document_id, []);
    byDoc.get(link.document_id)!.push(link.chunk_index);
  }

  for (const [docId, indices] of byDoc) {
    const { data: rows } = await (sb as any)
      .from("bid_document_chunks")
      .select("chunk_text, bid_documents(name, bid_id)")
      .eq("document_id", docId)
      .in("chunk_index", indices);
    for (const row of rows ?? []) {
      if (row.bid_documents?.bid_id !== null) continue;
      graphChunks.push({ doc_name: row.bid_documents?.name ?? "?", chunk_text: row.chunk_text });
    }
  }

  console.log(`\nGraph chunks retrieved: ${graphChunks.length}`);
  for (const c of graphChunks.slice(0, 3)) {
    console.log(`  [${c.doc_name}] ${c.chunk_text.slice(0, 120).replace(/\n/g, " ")}…`);
  }
}

// ── vector search ──────────────────────────────────────────────────────────────
console.log("\n── VECTOR ARM ─────────────────────────────────────────────────────");
const embedding = queryEmb; // reuse from graph arm
const { data: vectorRows } = await (sb.rpc as any)("hybrid_search_chunks", {
  query_text: query,
  query_embedding: JSON.stringify(embedding),
  match_bid_id: null,
  match_count: 50,
  min_similarity: 0.4,
});
const vectorChunks: { doc_name: string; chunk_text: string }[] = vectorRows ?? [];
console.log(`\nVector chunks (top-50 RRF): ${vectorChunks.length}`);
for (const c of vectorChunks.slice(0, 3)) {
  console.log(`  [${c.doc_name}] ${c.chunk_text.slice(0, 120).replace(/\n/g, " ")}…`);
}

// ── merge + rerank ─────────────────────────────────────────────────────────────
console.log("\n── MERGED + RERANKED (top 8) ──────────────────────────────────────");
const seen = new Set(vectorChunks.map((c) => c.chunk_text.slice(0, 120)));
const graphOnly = graphChunks.filter((c) => !seen.has(c.chunk_text.slice(0, 120)));
const merged = [...vectorChunks, ...graphOnly];
console.log(`\nMerged pool: ${vectorChunks.length} vector + ${graphOnly.length} graph-only = ${merged.length} total`);

const ranked = await rerank(query, merged.map((c) => c.chunk_text));
console.log("\nFinal top-8:");
for (const r of ranked) {
  const c = merged[r.index];
  const source = r.index < vectorChunks.length ? "vector" : "GRAPH ";
  console.log(`  [${source}] [${c.doc_name}] score=${r.score?.toFixed(3) ?? "?"} — ${c.chunk_text.slice(0, 100).replace(/\n/g, " ")}…`);
}
