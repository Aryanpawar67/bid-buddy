import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/api/ai-functions";

export type Message = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  exportMeta?: { format: string; filename: string };
  attachments?: string[]; // filenames attached to a user message
};

export type AiSession = {
  id: string;
  bid_id: string | null;
  user_id: string;
  model: string;
  messages: Message[];
  pinned_doc_ids: string[];
  created_at: string;
  title: string | null;
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
          pinned_doc_ids: [],
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
      pinnedDocIds?: string[];
    }) => {
      const patch: Record<string, unknown> = { messages: input.messages };
      if (input.pinnedDocIds !== undefined) patch.pinned_doc_ids = input.pinnedDocIds;
      const { error } = await supabase
        .from("ai_sessions")
        .update(patch)
        .eq("id", input.sessionId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["ai-session", vars.sessionId] });
    },
  });
}

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
export type StreamingStatusEvent = { kind: string; query: string };

export function useAiChat(
  sessionId: string | null,
  bidId: string | null,
  model: string
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatusEvent[]>([]);
  // Accumulates all doc IDs ever pinned in this session so every subsequent
  // message re-injects their chunks — making attached docs always in context.
  const [sessionPinnedDocIds, setSessionPinnedDocIds] = useState<string[]>([]);
  const updateSession = useUpdateAiSession();
  const sessionQuery = useAiSession(sessionId);

  // Seed messages + pinned doc IDs from DB when session changes
  useEffect(() => {
    if (sessionQuery.data) {
      setMessages(sessionQuery.data.messages);
      setSessionPinnedDocIds(sessionQuery.data.pinned_doc_ids ?? []);
    } else if (!sessionId) {
      setMessages([]);
      setSessionPinnedDocIds([]);
    }
  }, [sessionId, sessionQuery.data]);

  // Reset input when session changes
  useEffect(() => {
    setInputValue("");
  }, [sessionId]);

  const send = useCallback(
    async (overrideText?: string, mentionedDocIds?: string[], attachmentNames?: string[]) => {
      const text = (overrideText ?? inputValue).trim();
      if (!text || isStreaming || !sessionId) return;

      // Track which docs have been @-mentioned across the session (for UI / future use).
      // Only inject chunks for docs mentioned in THIS message — not accumulated ones.
      // Re-injecting all ever-mentioned docs every turn costs 40K+ tokens per @-mention
      // and exhausts the 200K context window within ~12 turns on large documents.
      // The search tool handles follow-up lookups; the model has already seen the
      // content in the conversation history from the original mention turn.
      // Compute new accumulated pinned IDs locally so the closure used in
      // updateSession.mutateAsync always sees the up-to-date value rather than
      // the stale state captured when `send` was called.
      const newSessionPinnedIds = mentionedDocIds?.length
        ? [...new Set([...sessionPinnedDocIds, ...mentionedDocIds])]
        : sessionPinnedDocIds;
      if (mentionedDocIds?.length) {
        setSessionPinnedDocIds(newSessionPinnedIds);
      }
      const currentTurnPinnedIds = mentionedDocIds ?? [];

      const userMsg: Message = {
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
        ...(attachmentNames?.length ? { attachments: attachmentNames } : {}),
      };
      const updatedWithUser = [...messages, userMsg];
      setMessages(updatedWithUser);
      setInputValue("");
      setStreamingStatus([]);
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
          mentionedDocIds: currentTurnPinnedIds.length ? currentTurnPinnedIds : undefined,
        });

        const reader = stream.getReader();
        let assistantContent = "";
        let exportMeta: { format: string; filename: string } | undefined;

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

          // CLEAR sentinel — server retracts pre-tool narration streamed before a tool_use
          if (lineBuffer.includes("\x1fCLEAR\x1f")) {
            assistantContent = "";
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], content: "" };
              return next;
            });
            setStreamingStatus([]);
          }

          // Capture STATUS sentinels and surface them to the UI
          const statusMatches = [...lineBuffer.matchAll(/\x1fSTATUS\x1f([^\n]*)\n/g)];
          if (statusMatches.length > 0) {
            const newEvents: StreamingStatusEvent[] = [];
            for (const sm of statusMatches) {
              try { newEvents.push(JSON.parse(sm[1])); } catch {}
            }
            if (newEvents.length > 0) {
              setStreamingStatus((prev) => [...prev, ...newEvents]);
            }
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

        const finalMessages: Message[] = [
          ...updatedWithUser,
          {
            role: "assistant",
            content: assistantContent,
            created_at: assistantCreatedAt,
            ...(exportMeta ? { exportMeta } : {}),
          },
        ];
        setMessages(finalMessages);

        await updateSession.mutateAsync({
          sessionId,
          messages: finalMessages,
          pinnedDocIds: newSessionPinnedIds,
        });
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

  return { messages, isStreaming, inputValue, setInputValue, send, streamingStatus };
}

// ── usePreviewProposal ────────────────────────────────────────────────────────
export function usePreviewProposal() {
  return useMutation({
    mutationFn: async (input: { bidId: string; sessionId: string }) => {
      const { previewProposal } = await import("@/lib/api/ai-functions");
      const res = await previewProposal(input);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<import("@/lib/api/generate-proposal").ProposalPreview>;
    },
  });
}

// ── useGenerateProposal ───────────────────────────────────────────────────────
export function useGenerateProposal() {
  return useMutation({
    mutationFn: async (input: {
      bidId: string;
      sessionId: string;
      intake?: import("@/lib/api/generate-proposal").Intake;
      format?: "docx" | "pdf";
    }) => {
      const { generateProposal } = await import("@/lib/api/ai-functions");
      const res = await generateProposal(input);
      if (!res.ok) throw new Error("Proposal generation failed");
      return res;
    },
  });
}
