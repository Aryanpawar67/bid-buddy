# AI Chat UX Overhaul — Implementation Plan & Status
**Date:** 2026-07-09  
**Scope:** AiChatPanel streaming UX, export flow, DOCX/PDF formatting

---

## Four fixes being implemented

### Fix 1 — Thinking steps / search progress
**Problem:** `stream-chat.ts` emits `\x1fSTATUS\x1f{"kind":"search","query":"..."}\n` sentinels when Claude calls `search_knowledge_base`, but `ai-queries.ts` strips them silently. During a 3-10s search phase the user sees only bouncing dots.

**Changes:**
- `src/lib/ai-queries.ts` — Add `streamingStatus: Array<{kind:string;query:string}>` state. Reset on each `send()`. Parse STATUS sentinels from the stream buffer and `setStreamingStatus(prev => [...prev, event])`.  Return `streamingStatus` from the hook.
- `src/routes/_app/ai.tsx` — Destructure and forward `streamingStatus` prop to `AiChatPanel`.
- `src/components/ai/AiChatPanel.tsx` — In `MessageBubble`, when `isStreaming` AND `streamingStatus.length > 0`, render a "Thinking" panel above the content area with each step as a search chip.

### Fix 2 — Explicit input lock during streaming
**Problem:** Input is technically disabled (`disabled={isStreaming}`) but the 50% opacity is the only visual cue. Footer hint still reads "Enter to send · Shift+Enter for new line" during streaming.

**Changes:**
- `src/components/ai/AiChatPanel.tsx` — In input footer, swap hint text to `"Claude is responding — please wait"` during streaming. Add `pointer-events-none` overlay on the textarea wrapper + a pulsing status dot.

### Fix 3 — Export message: compact card instead of full document
**Problem:** When user requests export, Claude outputs the full document content again as a new bubble, with download chips appended. User sees a wall of text they already read, plus chips.

**Changes:**
- `src/components/ai/AiChatPanel.tsx` — In `MessageBubble`, when `message.exportMeta` is set, render a compact "Document ready" card (filename + chips) instead of the full prose. Content stays in `msg.content` for the actual DOCX export to read — just hidden from view.

### Fix 4 — DOCX and PDF markdown formatting
**Problem:** `export-message.ts` does `line → new Paragraph({ children: [new TextRun({ text: line })] })` — no markdown parsing. Raw `# heading`, `- bullet`, `**bold**`, `| table |` appear as literal text in the DOCX. PDF uses `<pre>` block with raw markdown.

**Changes:**
- `src/lib/api/export-message.ts` — Full rewrite with a `parseMarkdownToDocx()` function that maps:
  - `# / ## / ###` → HeadingLevel.HEADING_1/2/3
  - `- item` / `* item` → bullet list (docx `numbering` config)
  - `1. item` → numbered list
  - `**text**` / `*text*` → bold/italic TextRun
  - `` `code` `` → monospace TextRun
  - `| col | col |` → docx Table/TableRow/TableCell
  - `---` → paragraph with bottom border
  - blank lines → spacer paragraphs
- `src/components/ai/AiChatPanel.tsx` — `handleDownloadPdf()`: replace `<pre>` with proper styled HTML (headings, lists, tables, bold) + print CSS.

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/ai-queries.ts` | Add `streamingStatus` state + STATUS sentinel parsing |
| `src/routes/_app/ai.tsx` | Forward `streamingStatus` to AiChatPanel |
| `src/components/ai/AiChatPanel.tsx` | Thinking steps UI, input lock, export card, PDF HTML |
| `src/lib/api/export-message.ts` | Full markdown→docx rewrite |

---

## STATUS sentinel format (server → client)
```
\x1fSTATUS\x1f{"kind":"search","query":"iMocha security certs"}\n
```
Emitted by `stream-chat.ts:399` inside `runAnthropicLoop` / `runAzureLoop` after each `search_knowledge_base` tool call.

## EXPORT sentinel format
```
\x1eEXPORT\x1e{"format":"docx","filename":"Security_Review.docx"}\n
```
Emitted by Claude as the very first line of its response when export is requested (per system prompt instruction).

## docx library imports needed
```ts
import {
  Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat, ShadingType
} from "docx";
```
