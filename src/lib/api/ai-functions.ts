import { streamChatFn } from "@/lib/api/stream-chat";
import { exportMessageFn } from "./export-message";
import { generateProposalFn, previewProposalFn, checkProposalReadinessFn } from "./generate-proposal";
import type { Intake } from "./generate-proposal";

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
  intake?: Intake;
  format?: "docx" | "pdf";
  force?: boolean;
}): Promise<Response> {
  const { data: { session } } = await import("@/integrations/supabase/client").then(
    (m) => m.supabase.auth.getSession()
  );
  return generateProposalFn({
    data: {
      bidId: input.bidId,
      sessionId: input.sessionId,
      intakeJson: input.intake ? JSON.stringify(input.intake) : undefined,
      format: input.format ?? "docx",
      force: input.force,
    },
    headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
  }) as unknown as Response;
}

export async function previewProposal(input: {
  bidId: string;
  sessionId: string;
}): Promise<Response> {
  const { data: { session } } = await import("@/integrations/supabase/client").then(
    (m) => m.supabase.auth.getSession()
  );
  return previewProposalFn({
    data: input,
    headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
  }) as unknown as Response;
}

export async function checkProposalReadiness(input: { bidId: string }): Promise<Response> {
  const { data: { session } } = await import("@/integrations/supabase/client").then(
    (m) => m.supabase.auth.getSession()
  );
  return checkProposalReadinessFn({
    data: input,
    headers: { authorization: `Bearer ${session?.access_token ?? ""}` },
  }) as unknown as Response;
}
