# RFx Generator — Proposal Generation, Export & Chat Management

*Date: 2026-06-08*

---

## Scope

Three features shipped as one plan:

| # | Feature | Route/Component |
|---|---------|----------------|
| A | Chat session delete + rename | `AiBidList` sidebar |
| B | On-demand AI response export (DOCX / PDF) | `AiChatPanel` message area |
| C | Branded proposal generation from bid context | `AiChatPanel` quick action + new server fn |

---

## Feature A — Chat Delete + Rename

### DB Change
One migration adds `title text` to `ai_sessions`:
```sql
alter table public.ai_sessions add column if not exists title text;
```
No RLS change — existing policies cover the new column.

### UX
- Session row in `AiBidList` gains a `…` icon on hover
- **Rename** → inline input replaces the label; Enter/blur saves; Escape cancels
- **Delete** → confirm popover ("Delete this session?"); on confirm, deletes row + invalidates cache
- `sessionLabel(s)` updated: prefer `s.title` if set, else existing auto-label logic

### New hooks (`ai-queries.ts`)
- `useRenameSession()` — `UPDATE ai_sessions SET title = $title WHERE id = $id`
- `useDeleteSession()` — `DELETE FROM ai_sessions WHERE id = $id`

---

## Feature B — On-Demand Export

### Trigger
Export is **intent-detected** — not a permanent button. When the AI's response contains an export signal (the model is instructed to wrap exportable content in a sentinel), a **Download** chip appears below that message only.

### Sentinel Protocol
Mirrors the existing `\x1f` status sentinel pattern. Server emits:
```
\x1eEXPORT\x1e{"format":"docx","filename":"<suggested-name>"}\n
```
`\x1e` (ASCII Record Separator) — never appears in prose. Client strips the sentinel record and shows the Download chip on that message bubble.

The model is instructed via a new system block line:
> "When the user explicitly asks to export, download, or save content as a document, wrap your response with the export sentinel before the content block."

### Download formats
- **DOCX** — server function `exportMessageFn`: takes `{ sessionId, messageIndex, bidId? }`, formats the assistant message + bid header into a clean DOCX via the `docx` npm package, returns as binary response
- **PDF** — client-side: opens a `<iframe>` with styled HTML of the message content, calls `contentWindow.print()`

### Server function (`src/lib/api/export-message.ts`)
```
exportMessageFn({ sessionId, messageIndex }) → Response (DOCX blob)
```
- Fetches session messages from `ai_sessions`
- Formats: bid name (if bid session), date, message content (markdown → paragraphs)
- Returns `Content-Disposition: attachment; filename=<name>.docx`
- No new DB tables

---

## Feature C — Branded Proposal Generation

### Overview
A **"Generate Proposal"** quick-action chip (bid mode only, alongside existing chips) triggers a two-phase server function that: authors variable content via Claude → assembles into the branded iMocha DOCX template → saves to Knowledge Hub + returns download.

### Master Template Storage
- File: `src/assets/imocha-proposal-template.docx` (user provides; committed to repo)
- Server reads it once; module-level `Buffer` cache so subsequent calls skip disk I/O
- Template XML is never sent to the client

### Phase 1 — Author (Claude)
Server function `generateProposalFn` calls Claude with:
- **Cached system block** — reuses `buildSystemBlocks(bidId)` output (prompt-cached per existing pattern). No extra KH doc reads.
- **Prompt** — structured instruction to output a valid `intake.json` matching `substitution_map.json` schema: product (TA/TM inferred from bid type + doc content), rfp_name, customer_display_name, exec summary (3 paragraphs), scope_intro, 8–12 deliverables
- **Model** — `claude-haiku-4-5-20251001` for cost (structured JSON output, not prose chat). Prompt-cached system blocks mean only the short intake prompt is billed uncached.
- **Token optimization**: system blocks are shared with the existing RAG cache. Author prompt is ~400 tokens. Total: ~2–4k tokens per generation at Haiku rates.
- Output validated against required schema keys; missing keys get `[TO PROVIDE: …]` placeholders

### Phase 2 — Assemble (DOCX)
Node port of `generate_proposal.py` using `jszip`:
1. Load template buffer from module cache
2. `JSZip.loadAsync(templateBuffer)`
3. Read `word/document.xml` — apply substitutions in safe order (composite tokens before individual, per `substitution_map.json` ordering note)
4. Inject deliverables as `<w:p>` bullet elements under Section 2.1 heading — discover bullet `numId` from first real bullet in the template
5. Apply customer name substitution to `word/header*.xml` / `word/footer*.xml` only
6. Validate: image count, theme presence, header/footer count unchanged vs. original
7. `zip.generateAsync({ type: "nodebuffer" })` → DOCX buffer

### Knowledge Hub Upload
After assembly:
- Upload DOCX buffer to Supabase Storage bucket `bid-documents` under path `{bidId}/proposals/{filename}`
- Insert `bid_documents` row: `bid_id = bidId`, `doc_type = "proposal"`, `source = "generated"` (new column — see DB changes)
- Existing `DocType` already includes `"proposal"` — no type change needed

### New DB Column
```sql
alter table public.bid_documents add column if not exists source text not null default 'uploaded'
  check (source in ('uploaded', 'generated'));
```
- Docs UI filters: existing upload modal and doc list mark `source = 'uploaded'` implicitly via default
- Generated proposals show a **Generated** badge in the Knowledge Hub list

### UX Flow
1. User opens bid AI session → clicks **"Generate Proposal"** chip
2. Chat shows a status message: "Analysing bid requirements…" (using existing status sentinel)
3. On completion: assistant message "Proposal generated — [Open Items list]" + **Download DOCX** chip
4. DOCX also appears in bid Documents tab with `Generated` badge

### TA vs TM Detection
Inferred from: bid `type` field (`rfp`/`rfi`/`rfq`) + first-pass doc scan for TA/TM keywords. If ambiguous after inference, AI asks one question before generating.

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260608200000_rfx_proposal.sql` | New — `ai_sessions.title`, `bid_documents.source` |
| `src/lib/ai-queries.ts` | Add `useRenameSession`, `useDeleteSession` |
| `src/components/ai/AiBidList.tsx` | Rename/delete UX on session rows |
| `src/lib/api/stream-chat.ts` | Add export sentinel instruction to system prompt |
| `src/lib/ai-queries.ts` | Client: strip `\x1eEXPORT\x1e` sentinel, expose export metadata per message |
| `src/lib/api/export-message.ts` | New — `exportMessageFn` (DOCX export) |
| `src/components/ai/AiChatPanel.tsx` | Render Download chip on export-flagged messages; PDF print handler |
| `src/lib/api/generate-proposal.ts` | New — `generateProposalFn` (author + assemble) |
| `src/lib/ai-queries.ts` | Add `useGenerateProposal` mutation |
| `src/components/ai/AiChatPanel.tsx` | Add "Generate Proposal" quick-action chip |
| `src/lib/doc-queries.ts` | Show `source` badge in doc list; filter in upload modal |
| `src/assets/imocha-proposal-template.docx` | New — master template (user provides) |

---

## Token Optimization Summary

| Operation | Model | Cached | Est. tokens |
|-----------|-------|--------|-------------|
| Proposal author phase | Haiku | System blocks cached (bid context + KH docs) | ~400 uncached prompt + ~800 output |
| Export sentinel detection | Sonnet/Opus (existing chat model) | System blocks cached | ~50 extra tokens in system prompt |
| Rename/delete | — | No AI calls | 0 |

The author phase deliberately uses Haiku (not Sonnet/Opus) since the task is structured JSON output — not creative prose. The voice guide and substitution schema are injected as a system block and cached across calls for the same bid.

---

## Dependencies

- `jszip` — DOCX assembly (ZIP manipulation). Already likely transitive; add explicitly if not.
- `docx` — Feature B DOCX export (already referenced in proposal-export-gap note)
- No new AI providers or env vars

---

## Out of Scope

- TM-specific master template (uses TA master as design carrier per skill.md instructions until dedicated TM master exists)
- Scheduled / auto-generation (manual trigger only)
- Proposal editing within the app (DOCX is for external editing)
- Export of full session history (single message only for Feature B)
