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
