import { streamChatFn } from "@/lib/api/stream-chat";

export type StreamChatInput = {
  sessionId: string;
  bidId: string | null;
  messages: { role: "user" | "assistant"; content: string; created_at: string }[];
  model: string;
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
