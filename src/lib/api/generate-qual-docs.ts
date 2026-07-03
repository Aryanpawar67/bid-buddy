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
    logoCache = readFileSync(join(process.cwd(), "public", "imocha-symbol.png"));
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
        new ImageRun({ data: logo, transformation: { width: 22, height: 22 }, type: "png" }),
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
                  new ImageRun({ data: logo, transformation: { width: 16, height: 16 }, type: "png" }),
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
                  new TextRun({ children: [new PageNumber()] }),
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
    uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "qual-result", filename }).catch(() => {});

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
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
    const insights = ad.insights ?? null;

    const totalScore = Math.round(
      CRITERIA.reduce((s, c) => s + (((ad.scores ?? {})[c.id] ?? 0) / 5) * c.weight * 100, 0)
    );
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());

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

    // ── Next steps by decision ──────────────────────────────────────────────
    const nextSteps: Record<string, string[]> = {
      go: [
        "Advance bid to RFI stage and brief team on deliverables.",
        "Confirm client engagement timeline and kickoff date.",
        "Assign RFI lead and schedule internal kick-off call.",
      ],
      conditional_go: [
        "Resolve open conditions identified in the assessment.",
        "Schedule stakeholder review before advancing to RFI.",
        "Confirm final go/no-go with leadership after resolution.",
      ],
      no_go: [
        "Notify client of withdrawal in a timely and professional manner.",
        "Capture lessons learned for future pipeline improvement.",
        "Archive all bid assets in the Knowledge Hub.",
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
                  new TextRun({ children: [new PageNumber()] }),
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
              new ImageRun({ data: logo, transformation: { width: 20, height: 20 }, type: "png" }),
              new TextRun({ text: "  DEAL BRIEF — LEADERSHIP REVIEW", color: C.white, bold: true, size: 20, font: "Calibri" }),
              new TextRun({ text: `        ${today}`, color: "AAAACC", size: 16, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.navy },
            spacing: { before: 60, after: 200 },
            children: [
              new TextRun({ text: bid.client_name, color: C.white, bold: true, size: 48, font: "Calibri" }),
              new TextRun({ text: `   ${bid.title}`, color: "AAAACC", size: 22, font: "Calibri" }),
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
                  kpiCell("Deal Value",    fmtMoney(bid.value),            C.orange,               "FFF8F4"),
                  kpiCell("Qual. Score",   `${totalScore}/100`,             decisionColour(dec),     decisionTint(dec)),
                  kpiCell("Decision",      decisionLabel(dec),              decisionColour(dec),     decisionTint(dec)),
                  kpiCell("Bid Strength",  bidStrength(totalScore),         C.navy,                 C.purpleTint),
                ],
              }),
            ],
          }),

          // 3. Strategic Rationale
          new Paragraph({
            spacing: { before: 280, after: 80 },
            children: [new TextRun({ text: "Strategic Rationale", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Why we should pursue this opportunity:", color: C.muted, size: 18, font: "Calibri" })],
          }),
          ...(insights?.strengths?.slice(0, 3) ?? ["Insights not yet generated."]).map((s: string) =>
            new Paragraph({
              bullet: { level: 0 },
              spacing: { before: 60, after: 60 },
              children: [new TextRun({ text: s, size: 20, font: "Calibri", color: C.ink })],
            })
          ),

          // 4. Key Risks
          new Paragraph({
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: "Key Risks to Manage", color: C.warn, bold: true, size: 26, font: "Calibri" })],
          }),
          ...(insights?.risks?.slice(0, 3) ?? ["Insights not yet generated."]).map((r: string) =>
            new Paragraph({
              bullet: { level: 0 },
              spacing: { before: 60, after: 60 },
              children: [new TextRun({ text: r, size: 20, font: "Calibri", color: C.ink })],
            })
          ),

          // 5. Recommendation box
          new Paragraph({
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: "Recommendation", color: C.navy, bold: true, size: 26, font: "Calibri" })],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purpleTint },
            spacing: { before: 80, after: 80 },
            children: [new TextRun({
              text: insights?.recommendation ?? "Please generate AI insights in the Qualification Result tab first.",
              size: 20, font: "Calibri", color: C.ink,
            })],
          }),
          new Paragraph({
            spacing: { before: 120, after: 0 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: `  ${decisionLabel(dec)}  `,
              color: C.white,
              bold: true,
              size: 32,
              font: "Calibri",
              shading: { type: ShadingType.SOLID, fill: decisionColour(dec) },
            })],
          }),

          // 6. Next steps
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

    uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "deal-brief", filename }).catch(() => {});

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
