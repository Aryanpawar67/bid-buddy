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
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  LevelFormat,
  ShadingType,
} from "docx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  sessionId: z.string().uuid(),
  messageIndex: z.number().int().min(0),
});

// ── Inline markdown parser → TextRun[] ────────────────────────────────────────

function parseInlineRuns(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun[] {
  const baseSize = opts.size ?? 22;
  const runs: TextRun[] = [];
  // Match **bold**, *italic*, `code`
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: text.slice(last, m.index), size: baseSize, bold: opts.bold }));
    }
    if (m[2] !== undefined) {
      runs.push(new TextRun({ text: m[2], bold: true, size: baseSize }));
    } else if (m[3] !== undefined) {
      runs.push(new TextRun({ text: m[3], italics: true, size: baseSize, bold: opts.bold }));
    } else if (m[4] !== undefined) {
      runs.push(new TextRun({ text: m[4], font: "Courier New", size: baseSize - 2, highlight: "lightGray" }));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), size: baseSize, bold: opts.bold }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text: text || " ", size: baseSize, bold: opts.bold }));
  }
  return runs;
}

// ── Full markdown → docx element array ───────────────────────────────────────

type DocChild = Paragraph | Table;

function parseMarkdownToDocx(markdown: string): DocChild[] {
  const lines = markdown.split("\n");
  const elements: DocChild[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // ── Headings ────────────────────────────────────────────────────────────
    if (/^#{1} /.test(line)) {
      elements.push(new Paragraph({ text: line.slice(2).trim(), heading: HeadingLevel.HEADING_1 }));
      i++; continue;
    }
    if (/^#{2} /.test(line)) {
      elements.push(new Paragraph({ text: line.slice(3).trim(), heading: HeadingLevel.HEADING_2 }));
      i++; continue;
    }
    if (/^#{3} /.test(line)) {
      elements.push(new Paragraph({ text: line.slice(4).trim(), heading: HeadingLevel.HEADING_3 }));
      i++; continue;
    }
    if (/^#{4} /.test(line)) {
      elements.push(new Paragraph({ text: line.slice(5).trim(), heading: HeadingLevel.HEADING_4 }));
      i++; continue;
    }

    // ── Horizontal rule ──────────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: "", size: 8 })],
          border: { bottom: { color: "AAAAAA", size: 6, style: BorderStyle.SINGLE, space: 1 } },
          spacing: { before: 120, after: 120 },
        })
      );
      i++; continue;
    }

    // ── Table — detect by leading pipe ───────────────────────────────────────
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        // skip separator rows like |---|---|
        if (!/^[\s|:=-]+$/.test(lines[i])) {
          tableLines.push(lines[i]);
        }
        i++;
      }
      if (tableLines.length > 0) {
        const parsedRows = tableLines.map((tl) =>
          tl.trim().slice(1, -1).split("|").map((cell) => cell.trim())
        );
        const colCount = Math.max(...parsedRows.map((r) => r.length));
        const colWidth = Math.floor(9360 / colCount); // total usable width in twips ÷ cols

        const tableRows = parsedRows.map((cells, ri) => {
          const isHeader = ri === 0;
          return new TableRow({
            tableHeader: isHeader,
            children: Array.from({ length: colCount }, (_, ci) => {
              const cellText = cells[ci] ?? "";
              return new TableCell({
                width: { size: colWidth, type: WidthType.DXA },
                shading: isHeader
                  ? { type: ShadingType.SOLID, color: "EDE9FD", fill: "EDE9FD" }
                  : undefined,
                children: [
                  new Paragraph({
                    children: parseInlineRuns(cellText, { bold: isHeader, size: 18 }),
                    spacing: { before: 60, after: 60 },
                  }),
                ],
              });
            }),
          });
        });

        elements.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          })
        );
      }
      continue;
    }

    // ── Unordered bullet ────────────────────────────────────────────────────
    if (/^[-*] /.test(line)) {
      elements.push(
        new Paragraph({
          numbering: { reference: "bullet-list", level: 0 },
          children: parseInlineRuns(line.slice(2).trim()),
        })
      );
      i++; continue;
    }

    // ── Numbered list ────────────────────────────────────────────────────────
    if (/^\d+\. /.test(line)) {
      elements.push(
        new Paragraph({
          numbering: { reference: "numbered-list", level: 0 },
          children: parseInlineRuns(line.replace(/^\d+\. /, "").trim()),
        })
      );
      i++; continue;
    }

    // ── Block quote ──────────────────────────────────────────────────────────
    if (/^> /.test(line)) {
      elements.push(
        new Paragraph({
          children: parseInlineRuns(line.slice(2).trim(), { size: 20 }),
          indent: { left: 720 },
          border: { left: { color: "491AEB", size: 12, style: BorderStyle.SINGLE, space: 8 } },
          spacing: { before: 60, after: 60 },
        })
      );
      i++; continue;
    }

    // ── Empty line ───────────────────────────────────────────────────────────
    if (line.trim() === "") {
      elements.push(new Paragraph({ children: [new TextRun({ text: "", size: 10 })], spacing: { before: 60, after: 60 } }));
      i++; continue;
    }

    // ── Normal paragraph ─────────────────────────────────────────────────────
    elements.push(
      new Paragraph({
        children: parseInlineRuns(line),
        spacing: { before: 0, after: 80 },
      })
    );
    i++;
  }

  return elements;
}

// ── Server function ────────────────────────────────────────────────────────────

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

    // Parse the markdown content into docx elements
    const bodyElements = parseMarkdownToDocx(msg.content);

    const headerChildren: Paragraph[] = [
      ...(bidHeader
        ? [new Paragraph({ text: bidHeader, heading: HeadingLevel.HEADING_1 })]
        : []),
      new Paragraph({
        children: [new TextRun({ text: `Prepared: ${dateStr}`, italics: true, size: 20, color: "666666" })],
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 },
      }),
      new Paragraph({
        children: [new TextRun({ text: "", size: 10 })],
        border: { bottom: { color: "491AEB", size: 12, style: BorderStyle.SINGLE, space: 1 } },
        spacing: { before: 0, after: 240 },
      }),
    ];

    const doc = new Document({
      numbering: {
        config: [
          {
            reference: "bullet-list",
            levels: [
              {
                level: 0,
                format: LevelFormat.BULLET,
                text: "•",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: 720, hanging: 360 } },
                  run: { size: 22 },
                },
              },
              {
                level: 1,
                format: LevelFormat.BULLET,
                text: "◦",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: 1080, hanging: 360 } },
                  run: { size: 22 },
                },
              },
            ],
          },
          {
            reference: "numbered-list",
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: 720, hanging: 360 } },
                  run: { size: 22 },
                },
              },
            ],
          },
        ],
      },
      styles: {
        default: {
          heading1: {
            run: { size: 32, bold: true, color: "1A1A2E" },
            paragraph: { spacing: { before: 240, after: 120 } },
          },
          heading2: {
            run: { size: 26, bold: true, color: "2D2D4E" },
            paragraph: { spacing: { before: 200, after: 80 } },
          },
          heading3: {
            run: { size: 24, bold: true, color: "3D3D5E" },
            paragraph: { spacing: { before: 160, after: 60 } },
          },
          heading4: {
            run: { size: 22, bold: true, color: "4D4D6E" },
            paragraph: { spacing: { before: 120, after: 60 } },
          },
          document: {
            run: { size: 22, font: "Calibri" },
            paragraph: { spacing: { line: 320 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
            },
          },
          children: [...headerChildren, ...bodyElements],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = bidHeader
      ? `${bidHeader.replace(/[^a-z0-9]/gi, "_")}_export.docx`
      : "ai_response_export.docx";

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
