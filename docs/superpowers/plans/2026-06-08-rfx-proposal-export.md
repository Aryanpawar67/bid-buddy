# RFx Proposal Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three features — session rename/delete (A), on-demand AI response export to DOCX/PDF (B), and branded proposal generation from both TA and SI templates (C).

**Architecture:** Feature A adds title column + hover menu to existing session rows. Feature B introduces a new `\x1eEXPORT\x1e` sentinel in the stream protocol; the client strips it and renders a Download chip. Feature C is a two-phase server function: Haiku authors structured JSON → JSZip clones the correct branded template (TA or SI) and applies substitutions → result saved to Knowledge Hub and returned as download.

**Tech Stack:** TanStack Start server functions, Anthropic SDK (Haiku), `jszip` (new dep), `docx` (existing dep v9), Supabase Storage, React 19, TailwindCSS v4.

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/20260608200000_rfx_proposal.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260608200000_rfx_proposal.sql

-- Feature A: named sessions
alter table public.ai_sessions
  add column if not exists title text;

-- Feature C: track generated vs uploaded documents
alter table public.bid_documents
  add column if not exists source text not null default 'uploaded'
    check (source in ('uploaded', 'generated'));
```

- [ ] **Step 2: Apply it**

```bash
cd /Users/aryan/Desktop/Bid\ Compass/bid-buddy
bunx supabase db push
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260608200000_rfx_proposal.sql
git commit -m "feat: add ai_sessions.title and bid_documents.source columns"
```

---

## Task 2: Type Updates

**Files:**
- Modify: `src/lib/ai-queries.ts` (Message + AiSession types)
- Modify: `src/lib/doc-queries.ts` (BidDocument type)

- [ ] **Step 1: Extend Message type in `src/lib/ai-queries.ts`**

Replace the existing `Message` type (lines 6–10):

```typescript
export type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  exportMeta?: { format: string; filename: string };
};
```

- [ ] **Step 2: Extend AiSession type in `src/lib/ai-queries.ts`**

Replace the existing `AiSession` type (lines 12–19):

```typescript
export type AiSession = {
  id: string;
  bid_id: string | null;
  user_id: string;
  model: string;
  messages: Message[];
  created_at: string;
  title: string | null;
};
```

- [ ] **Step 3: Extend BidDocument type in `src/lib/doc-queries.ts`**

Replace the existing `BidDocument` type (lines 6–18):

```typescript
export type BidDocument = {
  id: string;
  bid_id: string | null;
  name: string;
  type: DocType;
  stage: string | null;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string;
  embedding: number[] | null;
  created_at: string;
  source: "uploaded" | "generated";
};
```

- [ ] **Step 4: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai-queries.ts src/lib/doc-queries.ts
git commit -m "feat: extend Message, AiSession, BidDocument types for export + proposal features"
```

---

## Task 3: Feature A — Session Rename + Delete Hooks

**Files:**
- Modify: `src/lib/ai-queries.ts`

- [ ] **Step 1: Update `sessionLabel` helper to prefer `title`**

In `src/components/ai/AiBidList.tsx`, the `sessionLabel` function currently uses the first user message. Update it to also check `title`. Open `src/components/ai/AiBidList.tsx` and replace the `sessionLabel` function at the bottom of the file:

```typescript
function sessionLabel(s: AiSession): string {
  if (s.title) return s.title;
  const firstUser = (s.messages as { role: string; content: string }[]).find(
    (m) => m.role === "user"
  );
  if (firstUser) {
    const label = firstUser.content.slice(0, 32);
    return label + (firstUser.content.length > 32 ? "…" : "");
  }
  return "New session";
}
```

- [ ] **Step 2: Add `useRenameSession` to `src/lib/ai-queries.ts`**

Append after `useUpdateAiSession` (after line 111):

```typescript
// ── useRenameSession ──────────────────────────────────────────────────────────
export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; title: string; bidId: string | null }) => {
      const { error } = await supabase
        .from("ai_sessions")
        .update({ title: input.title.trim() || null })
        .eq("id", input.sessionId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["ai-sessions", vars.bidId ?? "global"] });
      qc.invalidateQueries({ queryKey: ["ai-session", vars.sessionId] });
    },
  });
}

// ── useDeleteSession ──────────────────────────────────────────────────────────
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; bidId: string | null }) => {
      const { error } = await supabase
        .from("ai_sessions")
        .delete()
        .eq("id", input.sessionId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["ai-sessions", vars.bidId ?? "global"] });
    },
  });
}
```

- [ ] **Step 3: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai-queries.ts src/components/ai/AiBidList.tsx
git commit -m "feat: add useRenameSession, useDeleteSession hooks; sessionLabel prefers title"
```

---

## Task 4: Feature A — Session Rename/Delete UX in AiBidList

**Files:**
- Modify: `src/components/ai/AiBidList.tsx`

The plan here: each session row renders a `…` button on hover. Clicking opens a two-option inline menu (Rename / Delete). Rename switches the label to an input; blur/Enter saves. Delete shows a confirm popover ("Delete this session?").

- [ ] **Step 1: Add imports at top of `src/components/ai/AiBidList.tsx`**

Replace the existing imports block:

```typescript
import { useState, useRef } from "react";
import { Plus, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Bid } from "@/lib/bid-queries";
import { urgencyClass, stageLabel } from "@/lib/bid-constants";
import type { AiSession } from "@/lib/ai-queries";
import { useRenameSession, useDeleteSession } from "@/lib/ai-queries";
```

- [ ] **Step 2: Replace `GlobalSessionList` component**

Replace the entire `GlobalSessionList` function (lines 90–146):

```typescript
function GlobalSessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isCreating,
}: {
  sessions: AiSession[];
  selectedSessionId: string | null;
  onSelectSession: (sid: string) => void;
  onNewSession: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Global
        </span>
        <button
          onClick={onNewSession}
          disabled={isCreating}
          className="h-5 w-5 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50"
        >
          {isCreating ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Plus className="size-3" />
          )}
        </button>
      </div>
      {sessions.length === 0 && (
        <div className="text-[10px] text-muted-foreground px-1 py-2">No sessions yet</div>
      )}
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          bidId={null}
          isSelected={selectedSessionId === s.id}
          onSelect={() => onSelectSession(s.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace `BidSessionList` inner session rows to use `SessionRow`**

Replace the inner `{bidSessions.map((s) => (...))}` block inside `BidSessionList` (the block starting around line 233):

```typescript
{bidSessions.map((s) => (
  <SessionRow
    key={s.id}
    session={s}
    bidId={bid.id}
    isSelected={selectedSessionId === s.id}
    onSelect={() => onSelectSession(bid.id, s.id)}
  />
))}
```

- [ ] **Step 4: Add the `SessionRow` component before `sessionLabel`**

Insert before the `sessionLabel` function at the bottom of the file:

```typescript
function SessionRow({
  session,
  bidId,
  isSelected,
  onSelect,
}: {
  session: AiSession;
  bidId: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const rename = useRenameSession();
  const del = useDeleteSession();

  function startRename() {
    setMenuOpen(false);
    setRenameValue(sessionLabel(session));
    setRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }

  function commitRename() {
    if (renameValue.trim() !== sessionLabel(session)) {
      rename.mutate({ sessionId: session.id, title: renameValue, bidId });
    }
    setRenaming(false);
  }

  function handleRenameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenaming(false);
  }

  function handleDelete() {
    del.mutate({ sessionId: session.id, bidId });
    setConfirmDelete(false);
  }

  return (
    <div className="relative group">
      {renaming ? (
        <input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleRenameKey}
          className="w-full text-[10px] rounded-md px-2 py-1 bg-background border hairline border-primary/50 text-foreground outline-none"
          autoFocus
        />
      ) : (
        <button
          onClick={onSelect}
          className={[
            "w-full text-left rounded-md px-2 py-1.5 transition-colors pr-7",
            isSelected
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          <div className="text-[10px] truncate">{sessionLabel(session)}</div>
          <div className="text-[9px] opacity-60">
            {new Date(session.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        </button>
      )}

      {/* … menu trigger — hidden until hover */}
      {!renaming && (
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); setConfirmDelete(false); }}
          className="absolute right-1 top-1.5 h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-background transition-opacity"
        >
          <MoreHorizontal className="size-3" />
        </button>
      )}

      {/* Inline menu */}
      {menuOpen && !confirmDelete && (
        <div className="absolute right-0 top-6 z-50 w-28 bg-card border hairline border-border rounded-lg shadow-lg overflow-hidden">
          <button
            onClick={(e) => { e.stopPropagation(); startRename(); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-foreground hover:bg-background"
          >
            <Pencil className="size-3" /> Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-destructive hover:bg-background"
          >
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      )}

      {/* Delete confirm popover */}
      {confirmDelete && (
        <div className="absolute right-0 top-6 z-50 w-44 bg-card border hairline border-border rounded-lg shadow-lg p-2.5 flex flex-col gap-2">
          <div className="text-[10px] text-foreground">Delete this session?</div>
          <div className="flex gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              disabled={del.isPending}
              className="flex-1 text-[10px] py-1 rounded-md bg-destructive text-white disabled:opacity-50"
            >
              {del.isPending ? "…" : "Delete"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              className="flex-1 text-[10px] py-1 rounded-md border hairline border-border text-muted-foreground hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Start dev server and manually test**

```bash
bun start
```

Open http://localhost:3000/ai, create a session, hover the session row — `…` button should appear. Test rename (Enter saves, Escape cancels) and delete confirm popover.

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/AiBidList.tsx
git commit -m "feat: session rename and delete UX with inline input and confirm popover"
```

---

## Task 5: Feature B — Export Sentinel Protocol

**Files:**
- Modify: `src/lib/api/stream-chat.ts` (system prompt instruction)
- Modify: `src/lib/ai-queries.ts` (strip sentinel, capture exportMeta)

### Part 1 — Server: add export sentinel instruction to system prompt

- [ ] **Step 1: Add export sentinel instruction to `buildSystemBlocks` in `src/lib/api/stream-chat.ts`**

Find `buildSystemBlocks`. In the global (non-bid) branch, the `return` statement currently returns a single block. In the bid branch, the last `return` returns one block. In both cases, append the export instruction as an additional non-cached block **before** the final `cache_control` block.

Replace both return statements in `buildSystemBlocks`:

For the no-bid branch (around line 191), replace:
```typescript
    return [{ type: "text", text: persona, cache_control: { type: "ephemeral" } }];
```
with:
```typescript
    return [
      { type: "text", text: persona, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: 'When the user explicitly asks to export, download, or save the current response as a document, prepend your entire response with this exact line (replacing <suggested-name> with a descriptive filename, no spaces, no extension): \x1eEXPORT\x1e{"format":"docx","filename":"<suggested-name>.docx"}\n',
      } as Anthropic.Messages.TextBlockParam,
    ];
```

For the bid branch (around line 256), replace:
```typescript
  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
```
with:
```typescript
  return [
    { type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: 'When the user explicitly asks to export, download, or save the current response as a document, prepend your entire response with this exact line (replacing <suggested-name> with a descriptive filename, no spaces, no extension): \x1eEXPORT\x1e{"format":"docx","filename":"<suggested-name>.docx"}\n',
    } as Anthropic.Messages.TextBlockParam,
  ];
```

### Part 2 — Client: strip sentinel and capture exportMeta

- [ ] **Step 2: Update stream reader in `useAiChat` (`src/lib/ai-queries.ts`)**

In the `send` callback inside `useAiChat`, just below the `let assistantContent = "";` declaration, add:

```typescript
let exportMeta: { format: string; filename: string } | undefined;
```

Then extend the sentinel-stripping block (currently strips `\x1fSTATUS\x1f...\n`) to also strip and capture `\x1eEXPORT\x1e...\n`. Replace the stripping section that currently reads:

```typescript
        let lineBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += value;

          // Strip complete \x1fSTATUS\x1f...\n records (may be split across chunks)
          let processed = lineBuffer;
          const stripped = processed.replace(/\x1f[^\x1f]*\x1f[^\n]*\n/g, "");

          // Hold back an incomplete leading sentinel at the tail of the buffer
          const lastSentinel = processed.lastIndexOf("\x1f");
          if (lastSentinel !== -1) {
            const tail = processed.slice(lastSentinel);
            if (!tail.includes("\n")) {
              lineBuffer = tail;
              processed = processed.slice(0, lastSentinel);
            } else {
              lineBuffer = "";
              processed = stripped;
            }
          } else {
            lineBuffer = "";
            processed = stripped;
          }

          if (processed) {
            assistantContent += processed;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: assistantContent,
              };
              return next;
            });
          }
        }
```

with:

```typescript
        let lineBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += value;

          // Capture \x1eEXPORT\x1e...\n sentinels before stripping
          const exportMatch = lineBuffer.match(/\x1eEXPORT\x1e([^\n]*)\n/);
          if (exportMatch) {
            try { exportMeta = JSON.parse(exportMatch[1]); } catch {}
          }

          // Strip both STATUS (\x1f) and EXPORT (\x1e) sentinels
          let processed = lineBuffer;
          const stripped = processed
            .replace(/\x1f[^\x1f]*\x1f[^\n]*\n/g, "")
            .replace(/\x1eEXPORT\x1e[^\n]*\n/g, "");

          // Hold back an incomplete sentinel at the tail of the buffer
          const lastSentinel = Math.max(
            processed.lastIndexOf("\x1f"),
            processed.lastIndexOf("\x1e")
          );
          if (lastSentinel !== -1) {
            const tail = processed.slice(lastSentinel);
            if (!tail.includes("\n")) {
              lineBuffer = tail;
              processed = processed.slice(0, lastSentinel);
            } else {
              lineBuffer = "";
              processed = stripped;
            }
          } else {
            lineBuffer = "";
            processed = stripped;
          }

          if (processed) {
            assistantContent += processed;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: assistantContent,
              };
              return next;
            });
          }
        }
```

- [ ] **Step 3: Attach `exportMeta` to the final message**

Find the `finalMessages` construction block (currently around line 237):

```typescript
        const finalMessages: Message[] = [
          ...updatedWithUser,
          { role: "assistant", content: assistantContent, created_at: assistantCreatedAt },
        ];
```

Replace with:

```typescript
        const finalMessages: Message[] = [
          ...updatedWithUser,
          {
            role: "assistant",
            content: assistantContent,
            created_at: assistantCreatedAt,
            ...(exportMeta ? { exportMeta } : {}),
          },
        ];
```

- [ ] **Step 4: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/stream-chat.ts src/lib/ai-queries.ts
git commit -m "feat: export sentinel protocol — server instruction + client strip and capture"
```

---

## Task 6: Feature B — exportMessageFn Server Function

**Files:**
- Create: `src/lib/api/export-message.ts`

- [ ] **Step 1: Create the server function**

```typescript
// src/lib/api/export-message.ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
} from "docx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  messageIndex: z.number().int().min(0),
});

export const exportMessageFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("ai_sessions")
      .select("messages, bid_id, model")
      .eq("id", data.sessionId)
      .eq("user_id", user.id)
      .single();
    if (sessionErr || !session) return new Response("Not found", { status: 404 });

    const messages = session.messages as { role: string; content: string }[];
    const msg = messages[data.messageIndex];
    if (!msg || msg.role !== "assistant") return new Response("Invalid message", { status: 400 });

    // Optional bid header
    let bidHeader = "";
    if (session.bid_id) {
      const { data: bid } = await supabaseAdmin
        .from("bids")
        .select("client_name, title")
        .eq("id", session.bid_id)
        .single();
      if (bid) bidHeader = `${bid.client_name} — ${bid.title}`;
    }

    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Convert markdown-ish content to paragraphs (split on newlines)
    const contentLines = msg.content
      .split("\n")
      .map((line) => line.trim());

    const children: Paragraph[] = [
      ...(bidHeader
        ? [
            new Paragraph({
              text: bidHeader,
              heading: HeadingLevel.HEADING_1,
            }),
          ]
        : []),
      new Paragraph({
        children: [
          new TextRun({ text: `Prepared: ${dateStr}`, italics: true, size: 20 }),
        ],
        alignment: AlignmentType.LEFT,
      }),
      new Paragraph({ text: "" }),
      ...contentLines.map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
          })
      ),
    ];

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = bidHeader
      ? `${bidHeader.replace(/[^a-z0-9]/gi, "_")}_export.docx`
      : "ai_response_export.docx";

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
```

- [ ] **Step 2: Create a client wrapper in `src/lib/api/ai-functions.ts`**

Open `src/lib/api/ai-functions.ts` and append:

```typescript
import { exportMessageFn } from "./export-message";

export async function exportMessage(input: {
  sessionId: string;
  messageIndex: number;
}): Promise<Response> {
  const { data: { session } } = await import("@/integrations/supabase/client").then(
    (m) => m.supabase.auth.getSession()
  );
  return exportMessageFn({
    data: input,
    headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}
```

- [ ] **Step 3: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/export-message.ts src/lib/api/ai-functions.ts
git commit -m "feat: exportMessageFn server function — DOCX export of single AI message"
```

---

## Task 7: Feature B — Download Chip + PDF Handler in AiChatPanel

**Files:**
- Modify: `src/components/ai/AiChatPanel.tsx`

- [ ] **Step 1: Add `Download` icon import**

In `src/components/ai/AiChatPanel.tsx`, update the lucide import line:

```typescript
import { Send, Loader2, Copy, Check, Download, FileText } from "lucide-react";
```

- [ ] **Step 2: Add `onExport` prop to `MessageBubble`**

The `MessageBubble` component needs access to `exportMessage`. Update its prop type and add the download chip. Replace the entire `MessageBubble` function:

```typescript
function MessageBubble({
  message,
  isStreaming,
  messageIndex,
  sessionId,
}: {
  message: Message;
  isStreaming: boolean;
  messageIndex: number;
  sessionId: string;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDownloadDocx() {
    setExporting(true);
    try {
      const { exportMessage } = await import("@/lib/api/ai-functions");
      const res = await exportMessage({ sessionId, messageIndex });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = message.exportMeta?.filename ?? "export.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  function handleDownloadPdf() {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:800px;height:1100px";
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;max-width:750px;margin:40px auto;padding:0 20px;color:#111}pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto}code{background:#f5f5f5;padding:1px 4px;border-radius:2px}</style></head><body><pre style="white-space:pre-wrap">${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    };
  }

  return (
    <div className={["flex gap-3", isUser ? "flex-row-reverse" : "flex-row"].join(" ")}>
      <div
        className={[
          "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5",
          isUser ? "bg-primary text-white" : "bg-[#ede9fd] text-primary",
        ].join(" ")}
      >
        {isUser ? "You" : "AI"}
      </div>

      <div className="max-w-[75%] flex flex-col gap-1">
        <div
          className={[
            "rounded-xl px-3 py-2.5 text-[12px] leading-relaxed",
            isUser
              ? "bg-primary text-white rounded-tr-sm"
              : "bg-card border hairline border-border text-foreground rounded-tl-sm",
          ].join(" ")}
        >
          {message.content ? (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:text-[11px] prose-th:py-1 prose-td:py-1 prose-hr:my-2 prose-pre:bg-muted prose-pre:text-[11px] prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:rounded dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          ) : isStreaming ? (
            <TypingIndicator />
          ) : null}
        </div>

        {/* Assistant action row — copy + export chips */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-green-500" />
                  <span className="text-green-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Download chip — shown when exportMeta is set OR as always-available action */}
            {message.exportMeta && (
              <>
                <button
                  onClick={handleDownloadDocx}
                  disabled={exporting}
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors px-2 py-0.5 rounded-full border hairline border-primary/30 bg-primary/5 disabled:opacity-50"
                >
                  {exporting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Download className="size-3" />
                  )}
                  <span>Download DOCX</span>
                </button>
                <button
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-full border hairline border-border"
                >
                  <FileText className="size-3" />
                  <span>Save as PDF</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update message rendering to pass `messageIndex` and `sessionId`**

In the `{messages.map((msg, i) => (` block in `AiChatPanel`, update the `MessageBubble` call:

```typescript
{messages.map((msg, i) => (
  <MessageBubble
    key={i}
    message={msg}
    messageIndex={i}
    sessionId={sessionId!}
    isStreaming={
      isStreaming && i === messages.length - 1 && msg.role === "assistant"
    }
  />
))}
```

- [ ] **Step 4: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Manual test**

Start the server, open a bid session, ask "Please export this summary as a document." Verify:
- Download DOCX chip appears below the assistant response
- Clicking it downloads a `.docx` file
- Save as PDF opens print dialog

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/AiChatPanel.tsx
git commit -m "feat: Download DOCX and PDF chips on export-flagged assistant messages"
```

---

## Task 8: Add jszip Dependency

**Files:**
- Modify: `package.json` (via bun add)

- [ ] **Step 1: Install jszip**

```bash
bun add jszip
bun add -d @types/jszip
```

Expected: `jszip` appears in `package.json` dependencies, `@types/jszip` in devDependencies.

- [ ] **Step 2: Verify it resolves**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat: add jszip for DOCX template manipulation"
```

---

## Task 9: Feature C — generateProposalFn Server Function

**Files:**
- Create: `src/lib/api/generate-proposal.ts`

This function: (1) loads bid context + builds system blocks, (2) calls Haiku to author intake JSON, (3) loads the correct template buffer, (4) applies substitutions via JSZip, (5) injects deliverables as bullets, (6) uploads to Supabase Storage + inserts `bid_documents` row, (7) returns DOCX binary.

- [ ] **Step 1: Create `src/lib/api/generate-proposal.ts`**

```typescript
// src/lib/api/generate-proposal.ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  bidId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

// ── Template cache ─────────────────────────────────────────────────────────────
const templateCache: Record<string, Buffer> = {};

function getTemplateBuffer(filename: string): Buffer {
  if (!templateCache[filename]) {
    const p = join(process.cwd(), "src", "assets", filename);
    templateCache[filename] = readFileSync(p);
  }
  return templateCache[filename];
}

const TA_TEMPLATE = "TA_Proposal_template.docx";
const TM_TEMPLATE = "TM_Proposal_template.docx";

// ── Intake schema ──────────────────────────────────────────────────────────────
type Intake = {
  product: "TA" | "TM";
  rfp_name: string;
  customer_display_name: string;
  prepared_for: string;
  spoc_name: string;
  spoc_email: string;
  exec_summary: { pleased: string; aligned: string; confident: string };
  scope_intro: string;
  deliverables: string[];
};

// ── Substitution helpers ───────────────────────────────────────────────────────
// Applies substitutions in safe order: composite tokens BEFORE their components.
// Token comparison is against raw XML (angle brackets are XML-escaped).
function applySubstitutions(xml: string, intake: Intake): string {
  const subs: [string, string][] = [
    // Composite FIRST (contains both "Customer Name" and "CUSTOMER NAME")
    ["Customer Name (CUSTOMER NAME)", intake.customer_display_name],
    // Standard tokens
    ["&lt;RFP Name&gt;", intake.rfp_name],
    ["&lt;Customer Name&gt;", intake.customer_display_name],
    ["CUSTOMER NAME", intake.customer_display_name],
    ["&lt;Sales spoc name&gt;", intake.spoc_name],
    ["Sales email id", intake.spoc_email],
    [
      "&lt;How we are pleased to provide the solution&gt;",
      intake.exec_summary.pleased,
    ],
    [
      "&lt;How we are aligned with customer goals and their requirement&gt;",
      intake.exec_summary.aligned,
    ],
    [
      "&lt;How confident we are to deliver value&gt;",
      intake.exec_summary.confident,
    ],
    [
      "&lt;How scope is aligned to what iMocha can deliver&gt;",
      intake.scope_intro,
    ],
  ];

  let result = xml;
  for (const [token, value] of subs) {
    result = result.split(token).join(value);
  }
  return result;
}

// Discover the numId for the first real bullet paragraph in document.xml.
// Returns null if none found.
function discoverBulletNumId(xml: string): string | null {
  const numIdMatch = xml.match(/<w:numId w:val="(\d+)"\/>/);
  return numIdMatch ? numIdMatch[1] : null;
}

// Build OOXML bullet paragraphs for the deliverables list.
function buildBulletParagraphs(deliverables: string[], numId: string | null): string {
  const nId = numId ?? "1";
  return deliverables
    .map(
      (text) =>
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${nId}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`
    )
    .join("\n");
}

// Inject bullets after the "2.1 In scope Key Deliverables" heading.
function injectDeliverables(xml: string, deliverables: string[]): string {
  const numId = discoverBulletNumId(xml);
  const bullets = buildBulletParagraphs(deliverables, numId);

  // Find the paragraph containing "2.1 In scope Key Deliverables" heading text
  const headingMarker = "2.1 In scope Key Deliverables";
  const headingIdx = xml.indexOf(headingMarker);
  if (headingIdx === -1) {
    // Heading not found — append at end of body as fallback
    return xml.replace("</w:body>", `${bullets}</w:body>`);
  }

  // Find the closing </w:p> of the heading paragraph
  const headingParaEnd = xml.indexOf("</w:p>", headingIdx) + "</w:p>".length;
  return xml.slice(0, headingParaEnd) + "\n" + bullets + xml.slice(headingParaEnd);
}

// Apply customer name substitution to header/footer XML only.
function applyHeaderFooterSubstitutions(xml: string, intake: Intake): string {
  return xml
    .split("&lt;Customer Name&gt;").join(intake.customer_display_name)
    .split("&lt;RFP Name&gt;").join(intake.rfp_name)
    .split("CUSTOMER NAME").join(intake.customer_display_name);
}

// ── System blocks for proposal authoring ──────────────────────────────────────
async function buildProposalSystemBlocks(
  bidId: string
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, stage, deadline")
    .eq("id", bidId)
    .single();

  const { data: questions } = await supabaseAdmin
    .from("bid_questions")
    .select("question_text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("label, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  const parts: string[] = [
    "You are the iMocha proposal author assistant.",
    "Author variable content for an iMocha branded proposal based on the bid context below.",
    "Every claim must come from the provided context — do not invent capabilities, statistics, or certifications.",
    "",
  ];

  if (bid) {
    parts.push("## Bid Context");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase() ?? "RFP"}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    parts.push("");
  }

  if (questions?.length) {
    parts.push("## Bid Questions (requirements)");
    for (const q of questions) parts.push(`- ${q.question_text}`);
    parts.push("");
  }

  if (deliverables?.length) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) parts.push(`- ${d.label}`);
    parts.push("");
  }

  return [{ type: "text", text: parts.join("\n"), cache_control: { type: "ephemeral" } }];
}

// ── Main server function ───────────────────────────────────────────────────────
export const generateProposalFn = createServerFn({ method: "POST" })
  .inputValidator(InputSchema)
  .handler(async ({ data }) => {
    const authHeader = getRequest().headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    // ── Phase 1: Author via Haiku ─────────────────────────────────────────────
    const systemBlocks = await buildProposalSystemBlocks(data.bidId);

    const intakePrompt = `Based on the bid context in your system blocks, author the variable content for an iMocha proposal.

Output a single valid JSON object with this exact schema (no markdown, no code blocks, no extra text):
{
  "product": "TA or SI — TA for hiring/recruitment/assessment, SI for skills/competency/workforce",
  "rfp_name": "bid title + iMocha Proposal",
  "customer_display_name": "client name as it should appear throughout",
  "prepared_for": "[TO PROVIDE: contact name & title]",
  "spoc_name": "[TO PROVIDE: Sales SPOC name]",
  "spoc_email": "[TO PROVIDE: Sales SPOC email]",
  "exec_summary": {
    "pleased": "Paragraph 1: introduce iMocha TA or SI as recommended platform for this client",
    "aligned": "Paragraph 2: restate client requirements from context; note any exclusions",
    "confident": "Paragraph 3: proof points — Azure SaaS, ISO 27001, SOC 2 Type II, 99.9% SLA, named integrations, commercial model"
  },
  "scope_intro": "One paragraph: in-scope work + closing sentence with explicit exclusions",
  "deliverables": ["8 to 12 bullets mapping bid requirements to iMocha capabilities"]
}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const authorResp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemBlocks,
      messages: [{ role: "user", content: intakePrompt }],
    });

    const rawText = authorResp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.Messages.TextBlock).text)
      .join("");

    let intake: Intake;
    try {
      // Strip any accidental markdown fences
      const cleaned = rawText.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
      intake = JSON.parse(cleaned) as Intake;
    } catch {
      return new Response("Proposal author failed: invalid JSON from Haiku", { status: 500 });
    }

    // Validate required keys
    const required: (keyof Intake)[] = [
      "product", "rfp_name", "customer_display_name", "exec_summary", "scope_intro", "deliverables",
    ];
    for (const k of required) {
      if (!intake[k]) intake[k as "rfp_name"] = `[TO PROVIDE: ${k}]`;
    }
    if (!Array.isArray(intake.deliverables) || intake.deliverables.length === 0) {
      intake.deliverables = ["[TO PROVIDE: deliverables]"];
    }

    // ── Phase 2: Assemble DOCX ────────────────────────────────────────────────
    const templateFilename = intake.product === "TM" ? TM_TEMPLATE : TA_TEMPLATE;
    const templateBuffer = getTemplateBuffer(templateFilename);

    const zip = await JSZip.loadAsync(templateBuffer);

    // Edit word/document.xml
    const docXml = await zip.file("word/document.xml")!.async("string");
    let editedDocXml = applySubstitutions(docXml, intake);
    editedDocXml = injectDeliverables(editedDocXml, intake.deliverables);
    zip.file("word/document.xml", editedDocXml);

    // Edit headers and footers (customer name only)
    for (const filename of Object.keys(zip.files)) {
      if (
        (filename.startsWith("word/header") || filename.startsWith("word/footer")) &&
        filename.endsWith(".xml")
      ) {
        const hfXml = await zip.file(filename)!.async("string");
        zip.file(filename, applyHeaderFooterSubstitutions(hfXml, intake));
      }
    }

    const docxBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // ── Phase 3: Upload to Knowledge Hub ─────────────────────────────────────
    const safeClient = intake.customer_display_name.replace(/[^a-z0-9]/gi, "_");
    const filename = `iMocha_${safeClient}_${intake.product}_Proposal_DRAFT.docx`;
    const storagePath = `${data.bidId}/proposals/${filename}`;

    const { error: storageErr } = await supabaseAdmin.storage
      .from("bid-documents")
      .upload(storagePath, docxBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (storageErr) console.error("[generate-proposal] storage upload error:", storageErr);

    // Insert bid_documents row
    await (supabaseAdmin.from("bid_documents") as any).insert({
      bid_id: data.bidId,
      name: filename,
      type: "proposal",
      stage: null,
      storage_path: storagePath,
      size_bytes: docxBuffer.length,
      uploaded_by: user.id,
      source: "generated",
    });

    // Return DOCX
    return new Response(docxBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Open-Items": JSON.stringify([
          "prepared_for — contact name & title not set (fill in DOCX cover page)",
          "spoc_name — sales SPOC name not set (fill in DOCX cover page)",
          "spoc_email — sales SPOC email not set (fill in DOCX cover page)",
          `Template used: ${templateFilename}`,
        ]),
      },
    });
  });
```

- [ ] **Step 2: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/generate-proposal.ts
git commit -m "feat: generateProposalFn — Haiku author + JSZip template assembly + KH upload"
```

---

## Task 10: Feature C — useGenerateProposal Hook + Chip in AiChatPanel

**Files:**
- Modify: `src/lib/ai-queries.ts`
- Modify: `src/lib/api/ai-functions.ts`
- Modify: `src/components/ai/AiChatPanel.tsx`

- [ ] **Step 1: Add client wrapper to `src/lib/api/ai-functions.ts`**

Append to `src/lib/api/ai-functions.ts`:

```typescript
import { generateProposalFn } from "./generate-proposal";

export async function generateProposal(input: {
  bidId: string;
  sessionId: string;
}): Promise<Response> {
  const { data: { session } } = await import("@/integrations/supabase/client").then(
    (m) => m.supabase.auth.getSession()
  );
  return generateProposalFn({
    data: input,
    headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
  });
}
```

- [ ] **Step 2: Add `useGenerateProposal` hook to `src/lib/ai-queries.ts`**

Append to `src/lib/ai-queries.ts`:

```typescript
// ── useGenerateProposal ───────────────────────────────────────────────────────
export function useGenerateProposal() {
  return useMutation({
    mutationFn: async (input: { bidId: string; sessionId: string }) => {
      const { generateProposal } = await import("@/lib/api/ai-functions");
      const res = await generateProposal(input);
      if (!res.ok) throw new Error("Proposal generation failed");
      return res;
    },
  });
}
```

- [ ] **Step 3: Add "Generate Proposal" chip to `AiChatPanel.tsx`**

Import `useGenerateProposal` at the top of `AiChatPanel.tsx`:

```typescript
import { useGenerateProposal } from "@/lib/ai-queries";
```

Then add a new quick-action chip for proposal generation. In the `AiChatPanel` component body, after the existing quick-action chips block:

```typescript
  const isRfiRfpStage = activeBid?.stage === "rfi" || activeBid?.stage === "rfp";
  const quickActions = isRfiRfpStage ? QUICK_ACTIONS_RFI_RFP : QUICK_ACTIONS_GENERIC;
  const generateProposal = useGenerateProposal();
  const [proposalError, setProposalError] = useState<string | null>(null);

  async function handleGenerateProposal() {
    if (!activeBid || !sessionId) return;
    setProposalError(null);
    onSend(
      "Generating branded proposal — analysing bid requirements…",
      undefined
    );
    try {
      const res = await generateProposal.mutateAsync({
        bidId: activeBid.id,
        sessionId,
      });
      // Trigger download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const contentDisposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "proposal.docx";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // Parse open items from header
      const openItemsRaw = res.headers.get("X-Open-Items");
      const openItems: string[] = openItemsRaw ? JSON.parse(openItemsRaw) : [];
      const openItemsText = openItems.length
        ? `\n\n**Open items to complete in the DOCX:**\n${openItems.map((i) => `- ${i}`).join("\n")}`
        : "";

      onSend(
        `Proposal generated and saved to Knowledge Hub. Download started.${openItemsText}`,
        undefined
      );
    } catch {
      setProposalError("Proposal generation failed — please try again.");
    }
  }
```

- [ ] **Step 4: Render the Generate Proposal chip in the quick-actions bar**

In the quick-actions section of the JSX (the `{showQuickActions && (...)}`  block), after the existing `{quickActions.map(...)}` buttons and before the closing `</div>`, add:

```typescript
          {isRfiRfpStage && (
            <>
              <button
                onClick={handleGenerateProposal}
                disabled={isStreaming || generateProposal.isPending}
                className="text-[10px] px-3 py-1.5 rounded-full border hairline border-orange-400/60 text-orange-600 bg-orange-50/50 hover:bg-orange-500 hover:text-white hover:border-orange-500 disabled:opacity-40 transition-colors dark:text-orange-400 dark:bg-orange-950/20"
              >
                {generateProposal.isPending ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin inline" /> Generating…
                  </span>
                ) : (
                  "Generate Proposal"
                )}
              </button>
              {proposalError && (
                <span className="text-[10px] text-destructive">{proposalError}</span>
              )}
            </>
          )}
```

- [ ] **Step 5: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 6: Manual test**

Start dev server. Open a bid at RFI or RFP stage. Create a new AI session. Verify:
- "Generate Proposal" chip appears alongside other quick-action chips
- Clicking triggers the generation loading state
- DOCX downloads
- Document appears in the bid's Knowledge Hub (Documents tab)

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai-queries.ts src/lib/api/ai-functions.ts src/components/ai/AiChatPanel.tsx
git commit -m "feat: Generate Proposal chip — Haiku-authored branded DOCX with KH save"
```

---

## Task 11: Feature C — "Generated" Badge in Knowledge Hub

**Files:**
- Modify: `src/routes/_app/docs.tsx` (or wherever the document list renders)

First, find where `BidDocument` rows are rendered.

- [ ] **Step 1: Locate the docs route**

```bash
grep -n "BidDocument\|useDocuments\|doc_type\|storage_path" "/Users/aryan/Desktop/Bid Compass/bid-buddy/src/routes/_app/docs.tsx" | head -20
```

- [ ] **Step 2: Add `source` badge to document list rows**

In the document list, wherever a document row renders its name/type, add a "Generated" badge when `doc.source === "generated"`. Find the JSX for a document row item (typically contains `doc.name` and `doc.type`) and insert:

```typescript
{doc.source === "generated" && (
  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#fff7ed] text-orange-600 font-semibold border hairline border-orange-200">
    Generated
  </span>
)}
```

Place this badge immediately after the `doc.name` span or the doc type label — consistent with existing badge patterns in the file.

- [ ] **Step 3: Also mark `source: "uploaded"` explicitly in `useUploadDocument` mutation**

In `src/lib/doc-queries.ts`, update the `insert` call in `useUploadDocument` to include `source: "uploaded"` explicitly (so existing uploads are consistent even though the DB default covers them):

```typescript
      const { data: doc, error: insertErr } = await supabase
        .from("bid_documents")
        .insert({
          id: docId,
          name: input.file.name,
          type: input.type,
          bid_id: input.bidId,
          stage: input.stage,
          storage_path: path,
          size_bytes: input.file.size,
          uploaded_by: user.id,
          source: "uploaded",
        })
        .select()
        .single();
```

- [ ] **Step 4: Verify build**

```bash
bun run build:dev 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5: Manual test**

After generating a proposal, open the bid's Documents tab. Verify the new proposal entry shows the orange "Generated" badge, while manually uploaded docs show no badge.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app/docs.tsx src/lib/doc-queries.ts
git commit -m "feat: Generated badge on AI-authored proposals in Knowledge Hub"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| `ai_sessions.title` migration | Task 1 |
| `bid_documents.source` migration | Task 1 |
| `useRenameSession` + `useDeleteSession` hooks | Task 3 |
| `sessionLabel` prefers `title` | Task 3 |
| Session `…` hover menu, inline rename, delete confirm | Task 4 |
| Export sentinel in system prompt | Task 5 |
| Client strips `\x1eEXPORT\x1e` + captures `exportMeta` | Task 5 |
| `exportMessageFn` DOCX via `docx` package | Task 6 |
| Download DOCX chip on export-flagged messages | Task 7 |
| PDF print via iframe | Task 7 |
| `jszip` dependency | Task 8 |
| `generateProposalFn`: Haiku author phase | Task 9 |
| TA template (`TA_Proposal_template.docx`) | Task 9 |
| TM template (`TM_Proposal_template.docx`) | Task 9 |
| Substitutions in safe order (composite first) | Task 9 |
| Deliverables injected as bullets under §2.1 | Task 9 |
| Header/footer customer name substitution | Task 9 |
| Upload to `bid-documents` storage + insert `bid_documents` row | Task 9 |
| `source = "generated"` on generated docs | Task 9 |
| `useGenerateProposal` hook | Task 10 |
| "Generate Proposal" chip (bid mode, RFI/RFP stage only) | Task 10 |
| Status message + open-items list in chat | Task 10 |
| "Generated" badge in Knowledge Hub | Task 11 |
| `source: "uploaded"` explicit in `useUploadDocument` | Task 11 |

All spec requirements are covered.
