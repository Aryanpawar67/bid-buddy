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
