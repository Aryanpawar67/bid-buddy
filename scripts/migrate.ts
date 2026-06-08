/**
 * Migration runner for Railway deployment.
 * Reads all .sql files from supabase/migrations/ in filename order and applies
 * each one inside a transaction. Uses a _migrations tracking table to skip
 * already-applied files — safe to run on every deploy.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun scripts/migrate.ts
 */

import postgres from "postgres";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: "require", max: 1 });

async function run() {
  // Ensure tracking table exists
  await sql`
    create table if not exists public._migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const migrationsDir = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await sql`select filename from public._migrations`.execute();
  const appliedSet = new Set((applied as { filename: string }[]).map((r) => r.filename));

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    await sql.end();
    return;
  }

  for (const file of pending) {
    const sqlText = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}…`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`insert into public._migrations (filename) values (${file})`;
      });
      console.log(`  ✓ ${file}`);
    } catch (err) {
      console.error(`  ✗ ${file}:`, err);
      await sql.end();
      process.exit(1);
    }
  }

  console.log(`Applied ${pending.length} migration(s).`);
  await sql.end();
}

run();
