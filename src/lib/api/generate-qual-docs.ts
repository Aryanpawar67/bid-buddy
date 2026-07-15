import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
  ImageRun,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  HeadingLevel,
  VerticalAlign,
} from "docx";

// ── Brand colours (hex without #) ─────────────────────────────────────────────
const C = {
  purple:      "491AEB",
  navy:        "1A0A4A",
  orange:      "FD5B0E",
  purpleTint:  "F0EEFF",
  go:          "1A7F3C",
  goTint:      "E8F8EE",
  warn:        "B45309",
  warnTint:    "FFF8E8",
  nogo:        "C0392B",
  nogoTint:    "FFF0F0",
  muted:       "7B6FA8",
  ink:         "0D0820",
  border:      "E4DFFF",
  white:       "FFFFFF",
  mutedBg:     "F5F4FA",
} as const;

// ── Assessment criteria (mirrors DealQualificationWorkspace) ──────────────────
const CRITERIA = [
  { id: "strategic_fit",    parameter: "Strategic Opportunity Fit",                weight: 0.15 },
  { id: "business_problem", parameter: "Business Problem Clarity",                 weight: 0.10 },
  { id: "use_case",         parameter: "Use Case Alignment",                       weight: 0.10 },
  { id: "stakeholder",      parameter: "Customer Stakeholder & Decision Readiness", weight: 0.10 },
  { id: "commercial",       parameter: "Commercial Attractiveness",                 weight: 0.10 },
  { id: "competitive",      parameter: "Competitive Position",                      weight: 0.10 },
  { id: "implementation",   parameter: "Implementation Feasibility",                weight: 0.10 },
  { id: "technical",        parameter: "Technical & Security Fit",                  weight: 0.10 },
  { id: "proposal_risk",    parameter: "Proposal Risk Assessment",                  weight: 0.10 },
  { id: "value_realization",parameter: "Value Realization & Expansion Potential",  weight: 0.05 },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function decisionLabel(d: string) {
  if (d === "go") return "GO";
  if (d === "conditional_go") return "CONDITIONAL GO";
  return "NO GO";
}

function decisionColour(d: string) {
  if (d === "go") return C.go;
  if (d === "conditional_go") return C.warn;
  return C.nogo;
}

function decisionTint(d: string) {
  if (d === "go") return C.goTint;
  if (d === "conditional_go") return C.warnTint;
  return C.nogoTint;
}

function bidStrength(score: number) {
  if (score >= 75) return "Strong";
  if (score >= 55) return "Moderate";
  if (score >= 35) return "Weak";
  return "Insufficient Data";
}

function paramStatus(score: number): string {
  if (score === 0) return "—";
  if (score >= 4)  return "Go";
  if (score === 3) return "Review";
  return "Caution";
}

function paramStatusColour(score: number): string {
  if (score === 0) return C.muted;
  if (score >= 4)  return C.go;
  if (score === 3) return C.warn;
  return C.nogo;
}

// No-border spec (used to remove default table borders)
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const hairline  = { style: BorderStyle.SINGLE, size: 1, color: C.border } as const;

// ── Logo loader ───────────────────────────────────────────────────────────────
let logoCache: Buffer | null = null;
async function getLogo(): Promise<Buffer> {
  if (!logoCache) {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    logoCache = readFileSync(join(process.cwd(), "public", "imocha-logo.png"));
  }
  return logoCache;
}

// ── Auth helper ───────────────────────────────────────────────────────────────
async function authUser(req: ReturnType<typeof getRequest>) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── Storage upload + bid_documents insert ─────────────────────────────────────
async function uploadDoc(opts: {
  buffer: Buffer;
  bidId: string;
  userId: string;
  folder: string;
  filename: string;
}) {
  const path = `${opts.bidId}/${opts.folder}/${opts.filename}`;
  await supabaseAdmin.storage
    .from("bid-documents")
    .upload(path, opts.buffer, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

  await supabaseAdmin.from("bid_documents").insert({
    bid_id: opts.bidId,
    name: opts.filename,
    type: "reference",
    stage: "deal_qualification",
    storage_path: path,
    size_bytes: opts.buffer.byteLength,
    uploaded_by: opts.userId,
    source: "generated",
  } as never);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 1 — Bid Qualification Result
// ═══════════════════════════════════════════════════════════════════════════════

export const generateQualResultFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    const user = await authUser(getRequest());
    if (!user) return new Response("Unauthorized", { status: 401 });

    // Fetch bid + team + current user profile in parallel
    const [bidRes, teamRes, profileRes] = await Promise.all([
      supabaseAdmin.from("bids").select("*").eq("id", data.bidId).maybeSingle(),
      supabaseAdmin
        .from("bid_assignments")
        .select("profiles(full_name, email), user_roles(role)")
        .eq("bid_id", data.bidId),
      supabaseAdmin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    ]);

    if (!bidRes.data) return new Response("Bid not found", { status: 404 });

    const bid = bidRes.data as any;
    const team: Array<{ name: string; email: string; role: string }> =
      ((teamRes.data ?? []) as any[]).map((r: any) => ({
        name:  r.profiles?.full_name ?? "—",
        email: r.profiles?.email ?? "—",
        role:  r.user_roles?.role ?? "—",
      }));
    const preparedBy: string = (profileRes.data as any)?.full_name ?? "Bid Compass";
    const ad: any = bid.assessment_data ?? { scores: {}, comments: {}, insights: null };
    const scores: Record<string, number> = ad.scores ?? {};
    const comments: Record<string, string> = ad.comments ?? {};
    const insights = ad.insights ?? null;

    const totalScore = Math.round(
      CRITERIA.reduce((s, c) => s + ((scores[c.id] ?? 0) / 5) * c.weight * 100, 0)
    );
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());

    // ── Shared cell/border helpers ──────────────────────────────────────────
    function hdrCell(text: string, widthPct?: number): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: C.navy },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline },
        width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
        children: [new Paragraph({
          children: [new TextRun({ text, color: C.white, bold: true, size: 18, font: "Calibri" })],
        })],
      });
    }

    function dataCell(text: string, shade?: string, bold?: boolean): TableCell {
      return new TableCell({
        shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined,
        borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
        children: [new Paragraph({
          children: [new TextRun({ text, bold: bold ?? false, size: 19, font: "Calibri", color: C.ink })],
        })],
      });
    }

    // ── Document sections ───────────────────────────────────────────────────

    // 1. Purple header band
    const headerBand = new Paragraph({
      shading: { type: ShadingType.SOLID, color: C.purple },
      spacing: { before: 0, after: 0 },
      children: [
        new ImageRun({ data: logo, transformation: { width: 102, height: 22 }, type: "png" }),
        new TextRun({ text: "  iMocha Bid Compass", color: C.white, bold: true, size: 22, font: "Calibri" }),
        new TextRun({ text: "        CONFIDENTIAL — INTERNAL", color: "CCBBFF", size: 16, font: "Calibri" }),
      ],
    });

    // 2. Title block
    const titleBlock = [
      new Paragraph({
        spacing: { before: 200, after: 40 },
        children: [
          new TextRun({ text: bid.client_name, color: C.purple, bold: true, size: 36, font: "Calibri" }),
          new TextRun({ text: `   ${fmtMoney(bid.value)}`, color: C.orange, bold: true, size: 30, font: "Calibri" }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 200 },
        children: [new TextRun({ text: bid.title, color: C.muted, size: 20, font: "Calibri" })],
      }),
    ];

    // 3. Decision banner
    const bannerColour = decisionColour(dec);
    const decisionBanner = new Paragraph({
      shading: { type: ShadingType.SOLID, color: bannerColour },
      spacing: { before: 0, after: 160 },
      children: [
        new TextRun({ text: `  ${decisionLabel(dec)}`, color: C.white, bold: true, size: 24, font: "Calibri" }),
        new TextRun({ text: `    Score: ${totalScore} / 100`, color: C.white, size: 20, font: "Calibri" }),
        bid.gonogo_completed_at
          ? new TextRun({ text: `    Locked: ${fmtDate(bid.gonogo_completed_at)}`, color: "DDCCFF", size: 18, font: "Calibri" })
          : new TextRun({ text: "" }),
      ],
    });

    // 4. Deal snapshot table
    const kvRows = [
      ["Client",    bid.client_name,                    "Deal Value",   fmtMoney(bid.value)],
      ["Title",     bid.title,                          "Score",        `${totalScore} / 100`],
      ["Type",      (bid.type ?? "").toUpperCase(),     "Decision",     decisionLabel(dec)],
      ["Priority",  (bid.priority ?? "").toUpperCase(), "Bid Strength", bidStrength(totalScore)],
      ["Portal",    bid.procurement_portal ?? "—",      "Deadline",     fmtDate(bid.deadline)],
      ["Prepared",  today,                              "Prepared By",  preparedBy],
    ];
    const snapshotTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [hdrCell("Deal Snapshot", 50), hdrCell("Key Metrics", 50)] }),
        ...kvRows.map((r, i) =>
          new TableRow({
            children: [
              dataCell(`${r[0]}:`, i % 2 === 0 ? C.purpleTint : undefined),
              dataCell(r[1], i % 2 === 0 ? C.purpleTint : undefined),
              dataCell(`${r[2]}:`, i % 2 === 0 ? undefined : C.mutedBg),
              dataCell(r[3], i % 2 === 0 ? undefined : C.mutedBg),
            ],
          })
        ),
      ],
    });

    // 5. Assessment parameter table
    const paramHdrs = ["#", "Parameter", "Weight", "Score /5", "Status", "Weighted", "Notes"];
    const paramWidths = [4, 28, 7, 8, 9, 9, 35];
    const paramTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: paramHdrs.map((h, i) => hdrCell(h, paramWidths[i])) }),
        ...CRITERIA.map((c, i) => {
          const s = scores[c.id] ?? 0;
          const weightedEarned = ((s / 5) * c.weight * 100).toFixed(1);
          const weightedMax = (c.weight * 100).toFixed(0);
          const st = paramStatus(s);
          const stCol = paramStatusColour(s);
          const shade = i % 2 === 0 ? undefined : C.mutedBg;
          return new TableRow({
            children: [
              dataCell(String(i + 1), shade),
              dataCell(c.parameter, shade, true),
              dataCell(`${Math.round(c.weight * 100)}%`, shade),
              dataCell(s > 0 ? `${s} / 5` : "—", shade),
              new TableCell({
                shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined,
                borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: st, color: stCol, bold: true, size: 18, font: "Calibri" })],
                })],
              }),
              dataCell(s > 0 ? `${weightedEarned} / ${weightedMax}` : "—", shade),
              dataCell(comments[c.id] ?? "—", shade),
            ],
          });
        }),
        // Total row
        new TableRow({
          children: [
            new TableCell({
              columnSpan: 6,
              shading: { type: ShadingType.SOLID, color: C.navy },
              borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: "Total Weighted Score", color: C.white, bold: true, size: 18, font: "Calibri" })],
              })],
            }),
            new TableCell({
              shading: { type: ShadingType.SOLID, color: C.navy },
              borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `${totalScore} / 100`, color: C.white, bold: true, size: 22, font: "Calibri" })],
              })],
            }),
          ],
        }),
      ],
    });

    // 6. AI Analysis section
    const aiSection: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
        children: [new TextRun({ text: "✦ AI-Generated Analysis", color: C.purple, bold: true, size: 26, font: "Calibri" })],
      }),
    ];

    if (insights) {
      // Strengths
      aiSection.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [new TextRun({ text: "Key Strengths", color: C.go, bold: true, size: 20, font: "Calibri" })],
        }),
        ...(insights.strengths ?? []).map((s: string) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 60, after: 40 },
            children: [new TextRun({ text: s, size: 19, font: "Calibri", color: C.ink })],
          })
        ),
        // Risks
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [new TextRun({ text: "Key Risks / Watchouts", color: C.warn, bold: true, size: 20, font: "Calibri" })],
        }),
        ...(insights.risks ?? []).map((r: string) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 60, after: 40 },
            children: [new TextRun({ text: r, size: 19, font: "Calibri", color: C.ink })],
          })
        ),
        // Recommendation
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [new TextRun({ text: "Recommendation Summary", color: C.muted, bold: true, size: 20, font: "Calibri" })],
        }),
        new Paragraph({
          shading: { type: ShadingType.SOLID, color: C.purpleTint },
          spacing: { before: 80, after: 80 },
          children: [new TextRun({ text: insights.recommendation ?? "", size: 19, font: "Calibri", color: C.ink })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 0 },
          children: [new TextRun({ text: "Generated by Claude AI based on assessment scores above.", color: C.muted, italics: true, size: 16, font: "Calibri" })],
        }),
      );
    } else {
      aiSection.push(
        new Paragraph({
          children: [new TextRun({ text: "AI insights not yet generated.", color: C.muted, size: 18, font: "Calibri" })],
        })
      );
    }

    // 7. Bid team table
    const teamSection: Paragraph[] = [
      new Paragraph({
        spacing: { before: 280, after: 100 },
        children: [new TextRun({ text: "Bid Team", color: C.navy, bold: true, size: 26, font: "Calibri" })],
      }),
    ];
    const teamTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [hdrCell("Name", 35), hdrCell("Role", 25), hdrCell("Email", 40)] }),
        ...(team.length > 0 ? team : [{ name: "—", role: "—", email: "—" }]).map((m, i) =>
          new TableRow({
            children: [
              dataCell(m.name, i % 2 === 0 ? C.purpleTint : undefined, true),
              dataCell(m.role, i % 2 === 0 ? C.purpleTint : undefined),
              dataCell(m.email, i % 2 === 0 ? C.purpleTint : undefined),
            ],
          })
        ),
      ],
    });

    // ── Assemble document ───────────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                shading: { type: ShadingType.SOLID, color: C.purple },
                children: [
                  new ImageRun({ data: logo, transformation: { width: 75, height: 16 }, type: "png" }),
                  new TextRun({ text: "  iMocha Bid Compass", color: C.white, bold: true, size: 18, font: "Calibri" }),
                  new TextRun({ text: "        CONFIDENTIAL — INTERNAL", color: "CCBBFF", size: 14, font: "Calibri" }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `Prepared by ${preparedBy} via iMocha Bid Compass · ${today} · CONFIDENTIAL  `, color: C.muted, size: 16, font: "Calibri" }),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children: [
          headerBand,
          ...titleBlock,
          decisionBanner,
          new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: "Deal Snapshot", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          snapshotTable,
          new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: "Assessment Results", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          paramTable,
          ...aiSection,
          ...teamSection,
          teamTable,
        ],
      }],
    });

    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const slug = bid.client_name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `iMocha_${slug}_QualResult_${dateStr}.docx`;

    // Upload to Knowledge Hub (non-blocking — don't fail the download if storage errors)
    await uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "qual-result", filename });
    const storagePath = `${data.bidId}/qual-result/${filename}`;
    const { data: signed } = await supabaseAdmin.storage.from("bid-documents").createSignedUrl(storagePath, 300);
    return { url: signed?.signedUrl ?? "", filename };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 2 — C-Suite Deal Brief
// ═══════════════════════════════════════════════════════════════════════════════

export const generateDealBriefFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    const user = await authUser(getRequest());
    if (!user) return new Response("Unauthorized", { status: 401 });

    const [bidRes, teamRes] = await Promise.all([
      supabaseAdmin.from("bids").select("*").eq("id", data.bidId).maybeSingle(),
      supabaseAdmin
        .from("bid_assignments")
        .select("profiles(full_name, email), user_roles(role)")
        .eq("bid_id", data.bidId),
    ]);

    if (!bidRes.data) return new Response("Bid not found", { status: 404 });

    const bid = bidRes.data as any;
    const team: Array<{ name: string; email: string; role: string }> =
      ((teamRes.data ?? []) as any[]).map((r: any) => ({
        name:  r.profiles?.full_name ?? "—",
        email: r.profiles?.email ?? "—",
        role:  r.user_roles?.role ?? "—",
      }));
    const teamLead = team[0]?.name ?? "Bid Team";

    const ad: any = bid.assessment_data ?? {};
    const scores: Record<string, number> = ad.scores ?? {};
    const insights = ad.insights ?? null;

    const totalScore = Math.round(
      CRITERIA.reduce((s, c) => s + ((scores[c.id] ?? 0) / 5) * c.weight * 100, 0)
    );
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());
    const deadline = bid.deadline ? fmtDate(bid.deadline) : "TBD";
    const productLine = (bid.type ?? "").toUpperCase() === "TM" ? "Talent Management (Skills Intelligence)" : "Talent Acquisition (Skills Assessment)";

    // ── KPI box helper ──────────────────────────────────────────────────────
    function kpiCell(label: string, value: string, valueColour: string, shade: string): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: shade },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: { style: BorderStyle.SINGLE, size: 4, color: C.border } },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label.toUpperCase(), color: C.muted, size: 14, font: "Calibri", bold: true })],
          }),
          new Paragraph({
            spacing: { before: 40 },
            children: [new TextRun({ text: value, color: valueColour, size: 44, bold: true, font: "Calibri" })],
          }),
        ],
      });
    }

    // ── Overview table row helper ───────────────────────────────────────────
    function ovCell(text: string, shade: string, bold = false): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: shade },
        borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text, bold, size: 19, font: "Calibri", color: C.ink })],
        })],
      });
    }

    // ── Score breakdown row helper ──────────────────────────────────────────
    function scoreRow(criterion: string, score: number, weight: number): TableRow {
      const status = paramStatus(score);
      const colour = paramStatusColour(score);
      const dots = score > 0 ? "●".repeat(score) + "○".repeat(5 - score) : "○○○○○";
      return new TableRow({
        children: [
          new TableCell({
            borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
            margins: { top: 60, bottom: 60, left: 120, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: criterion, size: 18, font: "Calibri", color: C.ink })] })],
          }),
          new TableCell({
            borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: score > 0 ? `${score}/5` : "—", size: 18, font: "Calibri", color: C.ink, bold: true })] })],
          }),
          new TableCell({
            borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: dots, size: 14, font: "Calibri", color: colour })] })],
          }),
          new TableCell({
            borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${Math.round(weight * 100)}%`, size: 18, font: "Calibri", color: C.muted })] })],
          }),
          new TableCell({
            shading: { type: ShadingType.SOLID, color: score === 0 ? C.mutedBg : score >= 4 ? C.goTint : score === 3 ? C.warnTint : C.nogoTint },
            borders: { top: hairline, bottom: hairline, left: noBorder, right: noBorder },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: status, size: 18, font: "Calibri", color: colour, bold: true })] })],
          }),
        ],
      });
    }

    // ── Decision badge (table cell — renders reliably) ──────────────────────
    function decisionBadge(): Table {
      return new Table({
        width: { size: 20, type: WidthType.PERCENTAGE },
        rows: [new TableRow({
          children: [new TableCell({
            shading: { type: ShadingType.SOLID, color: decisionColour(dec) },
            borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: decisionLabel(dec), color: C.white, bold: true, size: 32, font: "Calibri" })],
            })],
          })],
        })],
      });
    }

    // ── Next steps by decision (bid-specific) ──────────────────────────────
    const nextSteps: Record<string, string[]> = {
      go: [
        `Assign ${bid.title} to the pre-sales lead and schedule the internal kick-off call this week.`,
        `Confirm ${bid.client_name}'s submission timeline and lock in key milestones before ${deadline}.`,
        "Brief the cross-functional team (legal, finance, pre-sales) on deliverables and ownership.",
        `Open the AI Command Center session for ${bid.client_name} and begin drafting the RFI response.`,
      ],
      conditional_go: [
        "Resolve the open qualification conditions identified in the risk section above.",
        `Schedule a stakeholder review call with ${bid.client_name} to clarify decision-maker alignment.`,
        "Confirm final Go/No-Go with leadership after all conditions are addressed.",
        `Reassess competitive position and security/compliance requirements before advancing past ${deadline}.`,
      ],
      no_go: [
        `Notify ${bid.client_name} of iMocha's withdrawal in a professional and timely manner.`,
        "Capture lessons learned and update the team's qualification playbook accordingly.",
        "Archive all bid assets in the Knowledge Hub for future reference.",
        "Redirect pre-sales capacity to higher-scoring opportunities in the pipeline.",
      ],
    };
    const steps = nextSteps[dec] ?? nextSteps["no_go"];

    // ── Assemble document ───────────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `Prepared by ${teamLead} · iMocha Bid Compass · ${today} · LEADERSHIP USE ONLY  `, color: C.muted, size: 16, font: "Calibri" }),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children: [
          // 1. Cover strip (navy bg)
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.navy },
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({ data: logo, transformation: { width: 93, height: 20 }, type: "png" }),
              new TextRun({ text: "  DEAL BRIEF — LEADERSHIP REVIEW", color: C.white, bold: true, size: 20, font: "Calibri" }),
              new TextRun({ text: `        ${today}`, color: "AAAACC", size: 16, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.navy },
            spacing: { before: 60, after: 40 },
            children: [
              new TextRun({ text: bid.client_name, color: C.white, bold: true, size: 48, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.navy },
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({ text: bid.title, color: "AAAACC", size: 22, font: "Calibri" }),
              new TextRun({ text: `   ·   ${productLine}`, color: "7766BB", size: 18, font: "Calibri" }),
            ],
          }),

          // 2. 4-box KPI grid
          new Paragraph({
            spacing: { before: 160, after: 80 },
            children: [new TextRun({ text: "Deal at a Glance", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  kpiCell("Deal Value",    fmtMoney(bid.value),            C.orange,            "FFF8F4"),
                  kpiCell("Qual. Score",   `${totalScore}/100`,            decisionColour(dec), decisionTint(dec)),
                  kpiCell("Decision",      decisionLabel(dec),             decisionColour(dec), decisionTint(dec)),
                  kpiCell("Bid Strength",  bidStrength(totalScore),        C.navy,              C.purpleTint),
                ],
              }),
            ],
          }),

          // 3. Opportunity Overview
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Opportunity Overview", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [
                ovCell("Client",      C.mutedBg, true),  ovCell(bid.client_name,  "FFFFFF"),
                ovCell("Product Line", C.mutedBg, true), ovCell(productLine,       "FFFFFF"),
              ]}),
              new TableRow({ children: [
                ovCell("Bid Type",    C.mutedBg, true),  ovCell((bid.type ?? "—").toUpperCase(), "FFFFFF"),
                ovCell("Priority",    C.mutedBg, true),  ovCell(bid.priority ? bid.priority.charAt(0).toUpperCase() + bid.priority.slice(1) : "—", "FFFFFF"),
              ]}),
              new TableRow({ children: [
                ovCell("Deal Value",  C.mutedBg, true),  ovCell(fmtMoney(bid.value), "FFFFFF"),
                ovCell("Deadline",    C.mutedBg, true),  ovCell(deadline,             "FFFFFF"),
              ]}),
              new TableRow({ children: [
                ovCell("Current Stage", C.mutedBg, true), ovCell("Deal Qualification", "FFFFFF"),
                ovCell("Bid Team Lead",  C.mutedBg, true), ovCell(teamLead,              "FFFFFF"),
              ]}),
            ],
          }),

          // 4. Strategic Rationale
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Strategic Rationale", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Why we should pursue this opportunity:", color: C.muted, size: 18, font: "Calibri" })],
          }),
          ...(insights?.strengths ?? ["Run AI Assessment on the Assessment & Result tab to generate insights."]).map((s: string) =>
            new Paragraph({
              bullet: { level: 0 },
              spacing: { before: 60, after: 60 },
              children: [new TextRun({ text: s, size: 20, font: "Calibri", color: C.ink })],
            })
          ),

          // 5. Key Risks
          new Paragraph({
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: "Key Risks to Manage", color: C.warn, bold: true, size: 26, font: "Calibri" })],
          }),
          ...(insights?.risks ?? ["Insights not yet generated."]).map((r: string) =>
            new Paragraph({
              bullet: { level: 0 },
              spacing: { before: 60, after: 60 },
              children: [new TextRun({ text: r, size: 20, font: "Calibri", color: C.ink })],
            })
          ),

          // 6. Score Breakdown
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Assessment Score Breakdown", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              // Header
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: "Criterion", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Score", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Rating", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Weight", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Status", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                ],
              }),
              ...CRITERIA.map(c => scoreRow(c.parameter, scores[c.id] ?? 0, c.weight)),
            ],
          }),

          // 7. Recommendation
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Leadership Recommendation", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purpleTint },
            spacing: { before: 100, after: 100 },
            indent: { left: 160, right: 160 },
            children: [new TextRun({
              text: insights?.recommendation ?? "Run AI Assessment on the Assessment & Result tab first to generate the recommendation.",
              size: 20, font: "Calibri", color: C.ink,
            })],
          }),
          new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }),
          decisionBadge(),

          // 8. Recommended Next Steps
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Recommended Next Steps", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          ...steps.map((step, i) =>
            new Paragraph({
              spacing: { before: 60, after: 60 },
              children: [
                new TextRun({ text: `${i + 1}.  `, color: C.purple, bold: true, size: 20, font: "Calibri" }),
                new TextRun({ text: step, size: 20, font: "Calibri", color: C.ink }),
              ],
            })
          ),
        ],
      }],
    });

    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const slug = bid.client_name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `iMocha_${slug}_DealBrief_${dateStr}.docx`;

    await uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "deal-brief", filename });
    const storagePath = `${data.bidId}/deal-brief/${filename}`;
    const { data: signed } = await supabaseAdmin.storage.from("bid-documents").createSignedUrl(storagePath, 300);
    return { url: signed?.signedUrl ?? "", filename };
  });
