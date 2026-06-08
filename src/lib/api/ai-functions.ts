import { streamChatFn } from "@/lib/api/stream-chat";
import { exportMessageFn } from "./export-message";
import { generateProposalFn } from "./generate-proposal";

export type StreamChatInput = {
  sessionId: string;
  bidId: string | null;
  messages: { role: "user" | "assistant"; content: string; created_at: string }[];
  model: string;
  mentionedDocIds?: string[];
};

// streamChatFn returns a raw Response (TanStack Start forwards Response instances
// via x-tss-raw: true, bypassing JSON serialisation). Cast accordingly.
export async function streamChat(input: StreamChatInput): Promise<ReadableStream<string>> {
  const response = (await streamChatFn({ data: input })) as unknown as Response;
  if (!response.ok) {
    throw new Error(`Stream error: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("No response body from streamChatFn");
  }
  return response.body.pipeThrough(new TextDecoderStream());
}

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
  }) as unknown as Response;
}

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
  }) as unknown as Response;
}
