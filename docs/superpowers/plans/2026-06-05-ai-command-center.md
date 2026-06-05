# AI Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/ai` page — a split-pane AI copilot for bid-scoped or global conversations with Claude, featuring streaming responses, quick-action chips, and persistent sessions stored in Supabase.

**Architecture:** A TanStack Start API route (`/api/stream-chat`) handles streaming Anthropic calls entirely server-side (API key never touches the client bundle). On bid selection, the server builds a context bundle: bid fields + questions/deliverables + top-8 pgvector doc chunks from `bid_document_chunks`. The client-side `useAiChat` hook calls the API route via `fetch`, reads the stream chunk-by-chunk, updates local message state, then persists completed exchanges to `ai_sessions` via a TanStack Query mutation. The 240px left column shows a Bid/Global mode toggle and a per-bid session list; the right column contains the streaming chat, quick-action chips, model selector, and usage badge.

**Tech Stack:** `@anthropic-ai/sdk`, TanStack Query mutations, TanStack Start API routes (`createAPIFileRoute`), Supabase pgvector RPC, Voyage AI embeddings (already configured in env), `sonner` toasts.

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/20260605160000_ai_sessions.sql` | Create — `ai_sessions` table + RLS + `match_bid_document_chunks` RPC |
| `src/routes/api/stream-chat.ts` | Create — streaming HTTP endpoint (Nitro/Node, server-only) |
| `src/lib/api/ai-functions.ts` | Create — `streamChat()` client wrapper calling `/api/stream-chat` |
| `src/lib/ai-queries.ts` | Create — TanStack Query hooks + `useAiChat` streaming hook |
| `src/components/ai/AiBidList.tsx` | Create — 240px left column |
| `src/components/ai/AiChatPanel.tsx` | Create — right panel: context strip, quick actions, streaming messages, input bar |
| `src/routes/_app/ai.tsx` | Rewrite — page that wires the two panels together |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260605160000_ai_sessions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ── ai_sessions ───────────────────────────────────────────────────────────────
create table if not exists public.ai_sessions (
  id          uuid primary key default gen_random_uuid(),
  bid_id      uuid references public.bids(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  model       text not null,
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.ai_sessions enable row level security;

create policy "Users manage own sessions"
  on public.ai_sessions for all
  using (user_id = auth.uid());

-- ── match_bid_document_chunks RPC ─────────────────────────────────────────────
-- Requires pgvector (already enabled from Knowledge Hub migration 20260605140000)
create or replace function public.match_bid_document_chunks(
  query_embedding vector(1024),
  match_bid_id    uuid,
  match_count     int default 8
)
returns table (chunk_text text, similarity float)
language sql stable as $$
  select chunk_text, 1 - (embedding <=> query_embedding) as similarity
  from public.bid_document_chunks
  where document_id in (
    select id from public.bid_documents where bid_id = match_bid_id
  )
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

- [ ] **Step 2: Apply in Supabase SQL Editor**

Open your Supabase project → SQL Editor → paste and run.

Verify:
```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'ai_sessions';
```
Expected: 1 row returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605160000_ai_sessions.sql
git commit -m "feat: add ai_sessions table, RLS policy, match_bid_document_chunks RPC"
```

---

## Task 2: Install `@anthropic-ai/sdk`

**Files:** `package.json` (modified by bun)

- [ ] **Step 1: Install the SDK**

```bash
bun add @anthropic-ai/sdk
```

- [ ] **Step 2: Add `ANTHROPIC_API_KEY` to `.env.local`**

Open `.env.local` and add:
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

Get your key from https://console.anthropic.com/settings/keys. This key is accessed only inside the API route handler — never sent to the browser.

- [ ] **Step 3: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add @anthropic-ai/sdk"
```

---

## Task 3: AI Query Layer (`ai-queries.ts`)

**Files:**
- Create: `src/lib/ai-queries.ts`

- [ ] **Step 1: Write the file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/api/ai-functions";

export type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AiSession = {
  id: string;
  bid_id: string | null;
  user_id: string;
  model: string;
  messages: Message[];
  created_at: string;
};

// ── useAiSessions ─────────────────────────────────────────────────────────────
// bidId = string → fetch sessions for that bid
// bidId = null   → fetch global sessions (bid_id IS NULL)
// bidId = undefined → disabled (query does not run)
export function useAiSessions(bidId: string | null | undefined) {
  return useQuery({
    queryKey: ["ai-sessions", bidId === undefined ? "disabled" : (bidId ?? "global")],
    enabled: bidId !== undefined,
    queryFn: async () => {
      let q = supabase
        .from("ai_sessions")
        .select("*")
        .order("created_at", { ascending: false });

      if (bidId) {
        q = q.eq("bid_id", bidId);
      } else {
        q = q.is("bid_id", null);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AiSession[];
    },
  });
}

// ── useAiSession ──────────────────────────────────────────────────────────────
export function useAiSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["ai-session", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_sessions")
        .select("*")
        .eq("id", sessionId!)
        .single();
      if (error) throw error;
      return data as AiSession;
    },
  });
}

// ── useCreateAiSession ────────────────────────────────────────────────────────
export function useCreateAiSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bidId: string | null;
      userId: string;
      model: string;
    }) => {
      const { data, error } = await supabase
        .from("ai_sessions")
        .insert({
          bid_id: input.bidId,
          user_id: input.userId,
          model: input.model,
          messages: [],
        })
        .select()
        .single();
      if (error) throw error;
      return data as AiSession;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["ai-sessions", vars.bidId ?? "global"] });
    },
  });
}

// ── useUpdateAiSession ────────────────────────────────────────────────────────
export function useUpdateAiSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      messages: Message[];
    }) => {
      const { error } = await supabase
        .from("ai_sessions")
        .update({ messages: input.messages })
        .eq("id", input.sessionId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["ai-session", vars.sessionId] });
    },
  });
}

// ── useAiRequestCount ─────────────────────────────────────────────────────────
export function useAiRequestCount(userId: string | undefined) {
  return useQuery({
    queryKey: ["ai-request-count", userId],
    enabled: !!userId,
    queryFn: async () => {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from("ai_sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId!)
        .gte("created_at", todayUtc.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });
}

// ── useAiChat ─────────────────────────────────────────────────────────────────
// Manages streaming message state for a single session.
// sessionId: the active session (null = no session selected, chat is disabled)
// bidId: the bid context (null = global mode, no bid context injected)
// model: the Anthropic model ID to use
export function useAiChat(
  sessionId: string | null,
  bidId: string | null,
  model: string
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const updateSession = useUpdateAiSession();
  const sessionQuery = useAiSession(sessionId);

  // Seed messages from DB when session changes
  useEffect(() => {
    if (sessionQuery.data) {
      setMessages(sessionQuery.data.messages);
    } else if (!sessionId) {
      setMessages([]);
    }
  }, [sessionId, sessionQuery.data]);

  // Reset input when session changes
  useEffect(() => {
    setInputValue("");
  }, [sessionId]);

  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? inputValue).trim();
      if (!text || isStreaming || !sessionId) return;

      const userMsg: Message = {
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      const updatedWithUser = [...messages, userMsg];
      setMessages(updatedWithUser);
      setInputValue("");
      setIsStreaming(true);

      const assistantCreatedAt = new Date().toISOString();
      setMessages([
        ...updatedWithUser,
        { role: "assistant", content: "", created_at: assistantCreatedAt },
      ]);

      try {
        const stream = await streamChat({
          sessionId,
          bidId,
          messages: updatedWithUser,
          model,
        });

        const reader = stream.getReader();
        let assistantContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += value;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              ...next[next.length - 1],
              content: assistantContent,
            };
            return next;
          });
        }

        const finalMessages: Message[] = [
          ...updatedWithUser,
          { role: "assistant", content: assistantContent, created_at: assistantCreatedAt },
        ];
        setMessages(finalMessages);

        await updateSession.mutateAsync({ sessionId, messages: finalMessages });
      } catch (err) {
        console.error("Stream error:", err);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: "Something went wrong. Please try again.",
          };
          return next;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [inputValue, isStreaming, messages, sessionId, bidId, model, updateSession]
  );

  return { messages, isStreaming, inputValue, setInputValue, send };
}
```

- [ ] **Step 2: Skip build check — `ai-functions.ts` doesn't exist yet**

The import of `streamChat` from `@/lib/api/ai-functions` will fail until Task 5. Come back and run `bun run build:dev` after Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai-queries.ts
git commit -m "feat: add ai-queries hooks (sessions, request count, useAiChat streaming hook)"
```

---

## Task 4: Streaming API Route

**Files:**
- Create: `src/routes/api/stream-chat.ts`

This file runs entirely server-side (Nitro). It validates the JWT, builds the context bundle (bid fields + questions + pgvector doc chunks), then pipes the Anthropic streaming response to the client. `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are only accessed here, never in client code.

- [ ] **Step 1: Write the route file**

```ts
import { createAPIFileRoute } from "@tanstack/react-start/api";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
] as const;

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  bidId: z.string().uuid().nullable(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      created_at: z.string(),
    })
  ),
  model: z.enum(ALLOWED_MODELS),
});

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "voyage-3", input: [text] }),
  });
  if (!resp.ok) throw new Error(`Voyage error: ${resp.status}`);
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function buildSystemPrompt(bidId: string, lastUserMessage: string): Promise<string> {
  const parts: string[] = [
    "You are an expert bid strategy assistant for iMocha's pre-sales team.",
    "Help analyse RFPs, generate win themes, identify risks, and draft executive summaries.",
    "Be concise, strategic, and specific to the bid context provided.",
    "",
  ];

  const { data: bid } = await supabaseAdmin
    .from("bids")
    .select("client_name, title, type, value, status, stage, deadline, procurement_portal")
    .eq("id", bidId)
    .single();

  if (bid) {
    parts.push("## Active Bid Context");
    parts.push(`Client: ${bid.client_name}`);
    parts.push(`Title: ${bid.title}`);
    parts.push(`Type: ${bid.type?.toUpperCase()}`);
    parts.push(`Value: $${((bid.value ?? 0) / 1_000_000).toFixed(1)}M`);
    parts.push(`Stage: ${bid.stage}`);
    parts.push(`Deadline: ${bid.deadline}`);
    if (bid.procurement_portal) parts.push(`Portal: ${bid.procurement_portal}`);
    parts.push("");
  }

  const { data: questions } = await supabaseAdmin
    .from("bid_questions")
    .select("text, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (questions && questions.length > 0) {
    parts.push("## Bid Questions");
    for (const q of questions) {
      parts.push(`- [${q.stage}] ${q.text}`);
    }
    parts.push("");
  }

  const { data: deliverables } = await supabaseAdmin
    .from("bid_deliverables")
    .select("title, stage")
    .eq("bid_id", bidId)
    .order("created_at", { ascending: true });

  if (deliverables && deliverables.length > 0) {
    parts.push("## Bid Deliverables");
    for (const d of deliverables) {
      parts.push(`- [${d.stage}] ${d.title}`);
    }
    parts.push("");
  }

  // Doc chunks via pgvector — skipped gracefully if VOYAGE_API_KEY is absent or no chunks exist
  try {
    const embedding = await embedText(lastUserMessage);
    const { data: chunks } = await supabaseAdmin.rpc("match_bid_document_chunks", {
      query_embedding: JSON.stringify(embedding),
      match_bid_id: bidId,
      match_count: 8,
    });

    if (chunks && chunks.length > 0) {
      parts.push("## Relevant Document Excerpts");
      for (const chunk of chunks as { chunk_text: string; similarity: number }[]) {
        parts.push(chunk.chunk_text);
        parts.push("---");
      }
      parts.push("");
    }
  } catch {
    // Voyage API failure or no indexed documents — continue without doc chunks
  }

  return parts.join("\n");
}

export const APIRoute = createAPIFileRoute("/api/stream-chat")({
  POST: async ({ request }) => {
    // 1. Verify JWT
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401 });

    // 2. Parse + validate
    let input: z.infer<typeof InputSchema>;
    try {
      const body = await request.json();
      input = InputSchema.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // 3. Build system prompt
    const lastUserMsg = [...input.messages].reverse().find((m) => m.role === "user");
    const systemPrompt =
      input.bidId && lastUserMsg
        ? await buildSystemPrompt(input.bidId, lastUserMsg.content)
        : "You are an expert bid strategy assistant for iMocha's pre-sales team. Help with RFP analysis, win themes, risk identification, and executive summaries.";

    // 4. Strip created_at from messages (Anthropic API only accepts role + content)
    const anthropicMessages = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 5. Pipe Anthropic stream to a ReadableStream returned to the client
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = anthropic.messages.stream({
            model: input.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: anthropicMessages,
          });

          for await (const chunk of anthropicStream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
});
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/stream-chat.ts
git commit -m "feat: add /api/stream-chat streaming endpoint (Anthropic + pgvector context assembly)"
```

---

## Task 5: `ai-functions.ts` Client Wrapper

**Files:**
- Create: `src/lib/api/ai-functions.ts`

This file is imported by the client (`ai-queries.ts`). It reads the Supabase session token from the browser and makes a `fetch` call to `/api/stream-chat`. No server secrets here.

- [ ] **Step 1: Write the file**

```ts
import { supabase } from "@/integrations/supabase/client";

export type StreamChatInput = {
  sessionId: string;
  bidId: string | null;
  messages: { role: "user" | "assistant"; content: string; created_at: string }[];
  model: string;
};

export async function streamChat(input: StreamChatInput): Promise<ReadableStream<string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const resp = await fetch("/api/stream-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  if (!resp.ok) {
    throw new Error(`Stream error: ${resp.status} ${resp.statusText}`);
  }
  if (!resp.body) {
    throw new Error("No response body from /api/stream-chat");
  }

  return resp.body.pipeThrough(new TextDecoderStream());
}
```

- [ ] **Step 2: Build check (covers Tasks 3–5)**

```bash
bun run build:dev
```
Expected: exits 0. `ai-queries.ts` can now resolve its import of `streamChat`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/ai-functions.ts
git commit -m "feat: add streamChat client wrapper (fetch /api/stream-chat, attach JWT)"
```

---

## Task 6: `AiBidList` Component

**Files:**
- Create: `src/components/ai/AiBidList.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import type { Bid } from "@/lib/bid-queries";
import { urgencyClass, stageLabel } from "@/lib/bid-constants";
import type { AiSession } from "@/lib/ai-queries";

export type AiMode = "bid" | "global";

type Props = {
  bids: Bid[];
  // sessions for the currently-selected bid only (keyed by bidId)
  sessions: Record<string, AiSession[]>;
  globalSessions: AiSession[];
  mode: AiMode;
  onModeChange: (mode: AiMode) => void;
  selectedBidId: string | null;
  selectedSessionId: string | null;
  // Called when user selects a specific session in the list
  onSelectSession: (bidId: string | null, sessionId: string) => void;
  // Called when user expands a bid row (triggers session loading in parent)
  onBidSelect: (bidId: string) => void;
  onNewSession: (bidId: string | null) => void;
  creatingBidId: string | null;
};

export function AiBidList({
  bids,
  sessions,
  globalSessions,
  mode,
  onModeChange,
  selectedBidId,
  selectedSessionId,
  onSelectSession,
  onBidSelect,
  onNewSession,
  creatingBidId,
}: Props) {
  return (
    <div className="w-60 shrink-0 border-r hairline border-border bg-card flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex gap-0 p-2 border-b hairline border-border shrink-0">
        <button
          onClick={() => onModeChange("bid")}
          className={[
            "flex-1 text-[11px] font-semibold py-1.5 rounded-l-md border-y border-l hairline border-border transition-colors",
            mode === "bid"
              ? "bg-primary text-white border-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          Bid
        </button>
        <button
          onClick={() => onModeChange("global")}
          className={[
            "flex-1 text-[11px] font-semibold py-1.5 rounded-r-md border-y border-r border-l hairline border-border transition-colors",
            mode === "global"
              ? "bg-primary text-white border-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          Global
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mode === "global" ? (
          <GlobalSessionList
            sessions={globalSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={(sid) => onSelectSession(null, sid)}
            onNewSession={() => onNewSession(null)}
            isCreating={creatingBidId === "__global"}
          />
        ) : (
          <BidSessionList
            bids={bids}
            sessions={sessions}
            selectedBidId={selectedBidId}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onBidSelect={onBidSelect}
            onNewSession={onNewSession}
            creatingBidId={creatingBidId}
          />
        )}
      </div>
    </div>
  );
}

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
        <button
          key={s.id}
          onClick={() => onSelectSession(s.id)}
          className={[
            "w-full text-left rounded-md px-2 py-1.5 transition-colors",
            selectedSessionId === s.id
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-background",
          ].join(" ")}
        >
          <div className="text-[11px] font-medium truncate">{sessionLabel(s)}</div>
          <div className="text-[9px] opacity-60 mt-0.5">
            {new Date(s.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

function BidSessionList({
  bids,
  sessions,
  selectedBidId,
  selectedSessionId,
  onSelectSession,
  onBidSelect,
  onNewSession,
  creatingBidId,
}: {
  bids: Bid[];
  sessions: Record<string, AiSession[]>;
  selectedBidId: string | null;
  selectedSessionId: string | null;
  onSelectSession: (bidId: string, sessionId: string) => void;
  onBidSelect: (bidId: string) => void;
  onNewSession: (bidId: string) => void;
  creatingBidId: string | null;
}) {
  const [expandedBidId, setExpandedBidId] = useState<string | null>(selectedBidId);
  const activeBids = bids.filter((b) => b.status === "active");

  if (activeBids.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground px-3 py-3">No active bids</div>
    );
  }

  return (
    <div className="p-2 flex flex-col gap-1">
      {activeBids.map((bid) => {
        const bidSessions = sessions[bid.id] ?? [];
        const isExpanded = expandedBidId === bid.id;
        const urgency = urgencyClass(bid.deadline);

        return (
          <div key={bid.id}>
            <button
              onClick={() => {
                const nowExpanded = !isExpanded;
                setExpandedBidId(nowExpanded ? bid.id : null);
                if (nowExpanded) onBidSelect(bid.id);
              }}
              className={[
                "w-full text-left rounded-md px-2 py-2 transition-colors",
                selectedBidId === bid.id ? "bg-primary/10" : "hover:bg-background",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate text-foreground">
                    {bid.client_name}
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate mt-0.5">
                    {stageLabel(bid.stage)}
                  </div>
                </div>
                <span className={`text-[9px] shrink-0 ${urgency.className}`}>
                  {urgency.label}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="ml-3 flex flex-col gap-0.5 mb-1">
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className="text-[9px] text-muted-foreground">Sessions</span>
                  <button
                    onClick={() => onNewSession(bid.id)}
                    disabled={creatingBidId === bid.id}
                    className="h-4 w-4 flex items-center justify-center rounded border hairline border-border text-muted-foreground hover:bg-background disabled:opacity-50"
                  >
                    {creatingBidId === bid.id ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : (
                      <Plus className="size-2.5" />
                    )}
                  </button>
                </div>
                {bidSessions.length === 0 && (
                  <div className="text-[9px] text-muted-foreground px-1">
                    No sessions yet
                  </div>
                )}
                {bidSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSession(bid.id, s.id)}
                    className={[
                      "w-full text-left rounded-md px-2 py-1 transition-colors",
                      selectedSessionId === s.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-background",
                    ].join(" ")}
                  >
                    <div className="text-[10px] truncate">{sessionLabel(s)}</div>
                    <div className="text-[9px] opacity-60">
                      {new Date(s.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function sessionLabel(s: AiSession): string {
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

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiBidList.tsx
git commit -m "feat: add AiBidList — mode toggle, bid list with sessions, new session button"
```

---

## Task 7: `AiChatPanel` Component

**Files:**
- Create: `src/components/ai/AiChatPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import type { Message } from "@/lib/ai-queries";
import type { Bid } from "@/lib/bid-queries";
import { stageLabel } from "@/lib/bid-constants";

const MODELS = [
  { id: "claude-opus-4-8",           label: "Claude Opus" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku" },
] as const;

const QUICK_ACTIONS = [
  {
    label: "Summarise RFP",
    prompt:
      "Please provide a concise executive summary of this RFP, highlighting the key requirements, evaluation criteria, and submission details.",
  },
  {
    label: "Win themes",
    prompt:
      "Based on this bid's context and requirements, identify 3-5 compelling win themes that differentiate iMocha and resonate with this client's priorities.",
  },
  {
    label: "Identify risks",
    prompt:
      "Analyse this bid and identify the top risks — commercial, technical, timeline, and compliance. For each risk, suggest a mitigation approach.",
  },
  {
    label: "Draft exec summary",
    prompt:
      "Draft a compelling executive summary for our proposal response to this RFP. Focus on our understanding of their needs, our solution approach, and key differentiators.",
  },
] as const;

type Props = {
  activeBid: Bid | null;
  isGlobal: boolean;
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (text?: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  requestCount: number;
};

export function AiChatPanel({
  activeBid,
  isGlobal,
  sessionId,
  messages,
  isStreaming,
  inputValue,
  onInputChange,
  onSend,
  model,
  onModelChange,
  requestCount,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = !isStreaming && !!sessionId && inputValue.trim().length > 0;
  const showQuickActions = !isGlobal && !!activeBid && messages.length === 0 && !!sessionId;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Context strip */}
      <div className="flex items-center gap-3 px-4 py-2 border-b hairline border-border bg-card shrink-0">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {isGlobal ? (
            <span className="text-[11px] font-medium text-muted-foreground">
              Global — no bid context
            </span>
          ) : activeBid ? (
            <>
              <span className="text-[11px] font-semibold truncate">
                {activeBid.client_name}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ede9fd] text-primary font-semibold">
                {stageLabel(activeBid.stage)}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Select a bid to start
            </span>
          )}
        </div>

        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="text-[10px] bg-background border hairline border-border rounded-md px-2 py-1 text-foreground"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {requestCount} requests today
        </span>
      </div>

      {/* Quick action chips — bid mode only, empty session only */}
      {showQuickActions && (
        <div className="flex gap-2 px-4 py-2.5 border-b hairline border-border bg-card shrink-0 flex-wrap">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => onSend(action.prompt)}
              disabled={isStreaming}
              className="text-[10px] px-3 py-1.5 rounded-full border hairline border-border text-foreground hover:bg-primary hover:text-white hover:border-primary disabled:opacity-40 transition-colors"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* No session selected */}
      {!sessionId && (
        <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
          {isGlobal
            ? "Click + to start a global session"
            : "Select a bid, then create or open a session"}
        </div>
      )}

      {/* Message thread */}
      {sessionId && (
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex-1 flex items-center justify-center text-[12px] text-muted-foreground">
              {isGlobal
                ? "Ask anything about your bids…"
                : `Ask anything about ${activeBid?.client_name ?? "this bid"}…`}
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              isStreaming={
                isStreaming && i === messages.length - 1 && msg.role === "assistant"
              }
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input bar */}
      {sessionId && (
        <div className="shrink-0 px-4 py-3 border-t hairline border-border bg-card">
          <div className="flex gap-2 items-end">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isGlobal
                  ? "Ask anything…"
                  : `Ask about ${activeBid?.client_name ?? "this bid"}…`
              }
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none text-[12px] bg-background border hairline border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: "36px" }}
            />
            <button
              onClick={() => onSend()}
              disabled={!canSend}
              className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1.5 text-right">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

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

      <div
        className={[
          "max-w-[75%] rounded-xl px-3 py-2.5 text-[12px] leading-relaxed",
          isUser
            ? "bg-primary text-white rounded-tr-sm"
            : "bg-card border hairline border-border text-foreground rounded-tl-sm",
        ].join(" ")}
      >
        {message.content ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : isStreaming ? (
          <TypingIndicator />
        ) : null}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center h-4">
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AiChatPanel.tsx
git commit -m "feat: add AiChatPanel — context strip, quick actions, streaming messages, input bar"
```

---

## Task 8: `/ai` Route Rewrite

**Files:**
- Rewrite: `src/routes/_app/ai.tsx`

- [ ] **Step 1: Rewrite the route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useBids } from "@/lib/bid-queries";
import { useCurrentUser } from "@/lib/auth";
import {
  useAiSessions,
  useCreateAiSession,
  useAiRequestCount,
  useAiChat,
  type AiSession,
} from "@/lib/ai-queries";
import { AiBidList, type AiMode } from "@/components/ai/AiBidList";
import { AiChatPanel } from "@/components/ai/AiChatPanel";

const MODEL_STORAGE_KEY = "bid-compass:ai-model";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export const Route = createFileRoute("/_app/ai")({
  component: AiPage,
});

function AiPage() {
  const { user } = useCurrentUser();
  const { data: bids = [] } = useBids();

  const [mode, setMode] = useState<AiMode>("bid");
  const [selectedBidId, setSelectedBidId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // "__global" sentinel distinguishes global-mode creation from bid-mode (string bidId)
  const [creatingBidId, setCreatingBidId] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });

  const createSession = useCreateAiSession();
  const { data: requestCount = 0 } = useAiRequestCount(user?.id);

  // Bid sessions — only load when a bid is selected in bid mode
  const bidSessionsQuery = useAiSessions(
    mode === "bid" && selectedBidId ? selectedBidId : undefined
  );
  // Global sessions — always load
  const globalSessionsQuery = useAiSessions(null);

  // Pass sessions for the selected bid only; other bids show empty until selected
  const sessionsMap: Record<string, AiSession[]> = selectedBidId
    ? { [selectedBidId]: bidSessionsQuery.data ?? [] }
    : {};

  const activeBid = bids.find((b) => b.id === selectedBidId) ?? null;

  const { messages, isStreaming, inputValue, setInputValue, send } = useAiChat(
    selectedSessionId,
    mode === "global" ? null : selectedBidId,
    model
  );

  // Auto-select most recent session when bid sessions load
  useEffect(() => {
    if (
      mode === "bid" &&
      selectedBidId &&
      !selectedSessionId &&
      bidSessionsQuery.data?.length
    ) {
      setSelectedSessionId(bidSessionsQuery.data[0].id);
    }
  }, [selectedBidId, bidSessionsQuery.data, selectedSessionId, mode]);

  // Auto-select most recent global session on global mode switch
  useEffect(() => {
    if (mode === "global" && !selectedSessionId && globalSessionsQuery.data?.length) {
      setSelectedSessionId(globalSessionsQuery.data[0].id);
    }
  }, [mode, globalSessionsQuery.data, selectedSessionId]);

  function handleModelChange(newModel: string) {
    setModel(newModel);
    if (typeof window !== "undefined") {
      localStorage.setItem(MODEL_STORAGE_KEY, newModel);
    }
  }

  function handleModeChange(newMode: AiMode) {
    setMode(newMode);
    setSelectedBidId(null);
    setSelectedSessionId(null);
  }

  function handleSelectSession(bidId: string | null, sessionId: string) {
    setSelectedBidId(bidId);
    setSelectedSessionId(sessionId);
  }

  // Called when a bid row is expanded — triggers bidSessionsQuery and auto-select effect
  function handleBidSelect(bidId: string) {
    setSelectedBidId(bidId);
    setSelectedSessionId(null); // cleared so auto-select effect fires when sessions load
  }

  async function handleNewSession(bidId: string | null) {
    if (!user) return;
    const key = bidId ?? "__global";
    setCreatingBidId(key);
    try {
      const session = await createSession.mutateAsync({
        bidId,
        userId: user.id,
        model,
      });
      setSelectedBidId(bidId);
      setSelectedSessionId(session.id);
    } finally {
      setCreatingBidId(null);
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      <AiBidList
        bids={bids}
        sessions={sessionsMap}
        globalSessions={globalSessionsQuery.data ?? []}
        mode={mode}
        onModeChange={handleModeChange}
        selectedBidId={selectedBidId}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onBidSelect={handleBidSelect}
        onNewSession={handleNewSession}
        creatingBidId={creatingBidId}
      />

      <AiChatPanel
        activeBid={activeBid}
        isGlobal={mode === "global"}
        sessionId={selectedSessionId}
        messages={messages}
        isStreaming={isStreaming}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={send}
        model={model}
        onModelChange={handleModelChange}
        requestCount={requestCount}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
bun run build:dev
```
Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/_app/ai.tsx
git commit -m "feat: rewrite /ai route — split-pane AI Command Center wiring"
```

---

## Task 9: Smoke-Check in Browser

No test runner — verify manually.

- [ ] **Step 1: Start the dev server**

```bash
bun dev
```

- [ ] **Step 2: Verify the page loads**

Navigate to `/ai`. Expected: 240px left column (Bid | Global toggle + active bids list), right column shows "Select a bid to start". No console errors.

- [ ] **Step 3: Test global session creation**

1. Click the **Global** toggle.
2. Click the **+** button next to "Global" header.
3. Expected: a new session appears selected in the list. Right panel shows "Ask anything about your bids…".
4. Type `Hello, who are you?` and press Enter.
5. Expected: user message appears, typing indicator (three bouncing dots) shows, then assistant starts streaming tokens. Send button shows spinner during stream. Input is disabled while streaming.

- [ ] **Step 4: Test bid mode session**

1. Click the **Bid** toggle.
2. Click any active bid row — it expands.
3. Expected: sessions panel appears. If the bid has been chatted before, sessions are listed; otherwise "No sessions yet".
4. Click **+** next to "Sessions". Expected: new session created and selected. Context strip shows bid name + stage badge. Quick-action chips appear.

- [ ] **Step 5: Test a quick action**

With a bid session selected and empty message history, click **Summarise RFP**. Expected: the chip's pre-defined prompt is sent immediately (without typing), streaming begins.

- [ ] **Step 6: Test session persistence after navigation**

After a response streams in, navigate to `/dashboard` and back to `/ai`. Expected: the session shows in the bid's session list with the first message as its label. Clicking it restores the full conversation.

- [ ] **Step 7: Test model selector persistence**

Change the model dropdown to "Claude Haiku". Refresh the page. Expected: model selector still shows "Claude Haiku" (persisted via localStorage key `bid-compass:ai-model`).

- [ ] **Step 8: Final build check**

```bash
bun run build:dev
```
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: AI Command Center complete — streaming chat, bid/global modes, quick actions, session persistence"
```

---

## Update EXECUTION-ORDER.md

After completing all tasks, update `docs/superpowers/EXECUTION-ORDER.md`.

Replace the `2.5 — AI Command Center` stub section with:

```markdown
### 2.5 — AI Command Center
_Route: `/ai`_

| Spec | Plan | Status |
|---|---|---|
| [spec](specs/2026-06-05-ai-command-center-design.md) | [plan](plans/2026-06-05-ai-command-center.md) | ✅ Implemented |

**Key decisions:** Streaming via TanStack Start API route (`/api/stream-chat`) · Bid + Global modes · pgvector doc chunk retrieval via Voyage AI (top 8 chunks) · `claude-sonnet-4-6` default · Model persisted in `localStorage` · `ai_sessions` table with RLS

**New table:** `ai_sessions (id, bid_id, user_id, model, messages jsonb, created_at)` · **New RPC:** `match_bid_document_chunks` · **Env vars needed:** `ANTHROPIC_API_KEY` (`VOYAGE_API_KEY` already set from 2.3)
```
