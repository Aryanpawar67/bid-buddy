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
// DOC 1 — Deal Brief (Leadership Review format)
// Concise: KPI boxes · Opportunity Overview · iMocha Fit Assessment table · Risks · Recommendation
// ═══════════════════════════════════════════════════════════════════════════════

export const generateQualResultFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    const user = await authUser(getRequest());
    if (!user) return new Response("Unauthorized", { status: 401 });

    const [bidRes, teamRes] = await Promise.all([
      supabaseAdmin.from("bids").select("*").eq("id", data.bidId).maybeSingle(),
      supabaseAdmin.from("bid_assignments").select("profiles(full_name, email), user_roles(role)").eq("bid_id", data.bidId),
    ]);
    if (!bidRes.data) return new Response("Bid not found", { status: 404 });

    const bid = bidRes.data as any;
    const team: Array<{ name: string; email: string; role: string }> =
      ((teamRes.data ?? []) as any[]).map((r: any) => ({
        name: r.profiles?.full_name ?? "—",
        email: r.profiles?.email ?? "—",
        role: r.user_roles?.role ?? "—",
      }));
    const teamLead = team[0]?.name ?? "Bid Team";

    const ad: any = bid.assessment_data ?? {};
    const scores: Record<string, number> = ad.scores ?? {};
    const rationales: Record<string, string> = ad.rationales ?? {};
    const insights = ad.insights ?? null;

    const totalScore = Math.round(CRITERIA.reduce((s, c) => s + ((scores[c.id] ?? 0) / 5) * c.weight * 100, 0));
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());
    const deadline = bid.deadline ? fmtDate(bid.deadline) : "TBD";
    const productLine = (bid.product_type ?? "") === "TM"
      ? "Talent Management (Skills Intelligence)"
      : "Talent Acquisition (Skills Assessment)";

    // ── Cell helpers ────────────────────────────────────────────────────────
    function kpiCell(label: string, value: string, valueColour: string, shade: string): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: shade },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: { style: BorderStyle.SINGLE, size: 4, color: C.border } },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: label.toUpperCase(), color: C.muted, size: 14, font: "Calibri", bold: true })] }),
          new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: value, color: valueColour, size: 40, bold: true, font: "Calibri" })] }),
        ],
      });
    }

    function ovCell(text: string, shade: string, bold = false): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: shade },
        borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text, bold, size: 19, font: "Calibri", color: C.ink })] })],
      });
    }

    function fitCell(text: string, shade?: string, colour?: string, bold = false, align: "left" | "center" = "left"): TableCell {
      return new TableCell({
        shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined,
        borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        children: [new Paragraph({
          alignment: align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text, bold, size: 18, font: "Calibri", color: colour ?? C.ink })],
        })],
      });
    }

    function decisionBadge(): Table {
      return new Table({
        width: { size: 22, type: WidthType.PERCENTAGE },
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

    // ── Assemble document ───────────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Prepared by ${teamLead} · iMocha Bid Compass · ${today} · LEADERSHIP USE ONLY  `, color: C.muted, size: 16, font: "Calibri" }),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            })],
          }),
        },
        children: [
          // Cover strip
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
            children: [new TextRun({ text: bid.client_name, color: C.white, bold: true, size: 48, font: "Calibri" })],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.navy },
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({ text: bid.title, color: "AAAACC", size: 22, font: "Calibri" }),
              new TextRun({ text: `   ·   ${productLine}`, color: "7766BB", size: 18, font: "Calibri" }),
            ],
          }),

          // 4-box KPI grid
          new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: "Deal at a Glance", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: [
              kpiCell("Deal Value",   fmtMoney(bid.value),       C.orange,            "FFF8F4"),
              kpiCell("Qual. Score",  `${totalScore}/100`,       decisionColour(dec), decisionTint(dec)),
              kpiCell("Decision",     decisionLabel(dec),         decisionColour(dec), decisionTint(dec)),
              kpiCell("Bid Strength", bidStrength(totalScore),   C.navy,              C.purpleTint),
            ]})],
          }),

          // Opportunity Overview
          new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: "Opportunity Overview", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [ovCell("Client", C.mutedBg, true), ovCell(bid.client_name, "FFFFFF"), ovCell("Product Line", C.mutedBg, true), ovCell(productLine, "FFFFFF")] }),
              new TableRow({ children: [ovCell("Bid Type", C.mutedBg, true), ovCell((bid.type ?? "—").toUpperCase(), "FFFFFF"), ovCell("Priority", C.mutedBg, true), ovCell(bid.priority ? bid.priority.charAt(0).toUpperCase() + bid.priority.slice(1) : "—", "FFFFFF")] }),
              new TableRow({ children: [ovCell("Deal Value", C.mutedBg, true), ovCell(fmtMoney(bid.value), "FFFFFF"), ovCell("Deadline", C.mutedBg, true), ovCell(deadline, "FFFFFF")] }),
              new TableRow({ children: [ovCell("Current Stage", C.mutedBg, true), ovCell("Deal Qualification", "FFFFFF"), ovCell("Bid Team Lead", C.mutedBg, true), ovCell(teamLead, "FFFFFF")] }),
            ],
          }),

          // iMocha Fit Assessment table (with rationales as Leadership Notes)
          new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: "iMocha Fit Assessment", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, width: { size: 30, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: "Criterion", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, width: { size: 9, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Score", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline }, width: { size: 11, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Status", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: "Leadership Notes", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                ],
              }),
              ...CRITERIA.map((c, i) => {
                const s = scores[c.id] ?? 0;
                const st = paramStatus(s);
                const stCol = paramStatusColour(s);
                const stShade = s === 0 ? C.mutedBg : s >= 4 ? C.goTint : s === 3 ? C.warnTint : C.nogoTint;
                const shade = i % 2 === 0 ? undefined : C.mutedBg;
                const note = rationales[c.id] ?? "—";
                return new TableRow({ children: [
                  fitCell(c.parameter, shade, undefined, true),
                  fitCell(s > 0 ? `${s} / 5` : "—", shade, undefined, false, "center"),
                  new TableCell({
                    shading: { type: ShadingType.SOLID, color: stShade },
                    borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline },
                    margins: { top: 80, bottom: 80, left: 80, right: 80 },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: st, color: stCol, bold: true, size: 18, font: "Calibri" })] })],
                  }),
                  fitCell(note, shade),
                ]});
              }),
            ],
          }),

          // Potential Risks
          new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: "Potential Risks / Watchouts", color: C.warn, bold: true, size: 26, font: "Calibri" })] }),
          ...(insights?.risks ?? ["Run AI Assessment to generate risk analysis."]).map((r: string) =>
            new Paragraph({ bullet: { level: 0 }, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: r, size: 20, font: "Calibri", color: C.ink })] })
          ),

          // Recommended Bid Position
          new Paragraph({ spacing: { before: 280, after: 80 }, children: [new TextRun({ text: "Recommended Bid Position", color: C.navy, bold: true, size: 26, font: "Calibri" })] }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purpleTint },
            spacing: { before: 100, after: 100 },
            indent: { left: 160, right: 160 },
            children: [new TextRun({ text: insights?.recommendation ?? "Run AI Assessment to generate the recommendation.", size: 20, font: "Calibri", color: C.ink })],
          }),
          new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }),
          decisionBadge(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 2 — Bid Qualification Result (Executive Briefing — Exe Summary format)
// Comprehensive: numbered sections · Customer Profile · Strategic Fit ·
// Assessment breakdown with AI rationales · Risks · Win Strategy
// ═══════════════════════════════════════════════════════════════════════════════

export const generateDealBriefFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string } }) => {
    const user = await authUser(getRequest());
    if (!user) return new Response("Unauthorized", { status: 401 });

    const [bidRes, teamRes, profileRes] = await Promise.all([
      supabaseAdmin.from("bids").select("*").eq("id", data.bidId).maybeSingle(),
      supabaseAdmin.from("bid_assignments").select("profiles(full_name, email), user_roles(role)").eq("bid_id", data.bidId),
      supabaseAdmin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    ]);
    if (!bidRes.data) return new Response("Bid not found", { status: 404 });

    const bid = bidRes.data as any;
    const team: Array<{ name: string; email: string; role: string }> =
      ((teamRes.data ?? []) as any[]).map((r: any) => ({
        name: r.profiles?.full_name ?? "—",
        email: r.profiles?.email ?? "—",
        role: r.user_roles?.role ?? "—",
      }));
    const preparedBy: string = (profileRes.data as any)?.full_name ?? "Bid Compass";

    const ad: any = bid.assessment_data ?? {};
    const scores: Record<string, number> = ad.scores ?? {};
    const rationales: Record<string, string> = ad.rationales ?? {};
    const insights = ad.insights ?? null;

    const totalScore = Math.round(CRITERIA.reduce((s, c) => s + ((scores[c.id] ?? 0) / 5) * c.weight * 100, 0));
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());
    const deadline = bid.deadline ? fmtDate(bid.deadline) : "TBD";
    const productLine = (bid.product_type ?? "") === "TM"
      ? "Talent Management (Skills Intelligence)"
      : "Talent Acquisition (Skills Assessment)";

    // ── Cell helpers ────────────────────────────────────────────────────────
    function hdrCell(text: string, widthPct?: number): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, color: C.navy },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline },
        width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text, color: C.white, bold: true, size: 18, font: "Calibri" })] })],
      });
    }

    function profileRow(label: string, value: string, i: number): TableRow {
      const shade = i % 2 === 0 ? C.purpleTint : "FFFFFF";
      return new TableRow({ children: [
        new TableCell({ shading: { type: ShadingType.SOLID, color: shade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: "Calibri", color: C.muted })] })] }),
        new TableCell({ shading: { type: ShadingType.SOLID, color: shade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: noBorder }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: "Calibri", color: C.ink })] })] }),
      ]});
    }

    function decisionBadge(): Table {
      return new Table({
        width: { size: 22, type: WidthType.PERCENTAGE },
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

    function sectionHeading(num: string, title: string): Paragraph {
      return new Paragraph({
        spacing: { before: 280, after: 80 },
        children: [
          new TextRun({ text: `${num}. `, color: C.orange, bold: true, size: 26, font: "Calibri" }),
          new TextRun({ text: title, color: C.navy, bold: true, size: 26, font: "Calibri" }),
        ],
      });
    }

    // ── Next steps by decision ──────────────────────────────────────────────
    const nextSteps: Record<string, string[]> = {
      go: [
        `Assign ${bid.title} to the pre-sales lead and schedule the internal kick-off call this week.`,
        `Confirm ${bid.client_name}'s submission timeline and lock in key milestones before ${deadline}.`,
        "Brief the cross-functional team (legal, finance, pre-sales) on deliverables and ownership.",
        `Open the AI Command Center session for ${bid.client_name} and begin drafting the response.`,
      ],
      conditional_go: [
        "Resolve the open qualification conditions identified in the risk section above.",
        `Schedule a stakeholder review call with ${bid.client_name} to clarify decision-maker alignment.`,
        "Confirm final Go/No-Go with leadership after all conditions are addressed.",
        `Reassess competitive position and compliance requirements before advancing past ${deadline}.`,
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
        properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
        headers: {
          default: new Header({
            children: [new Paragraph({
              shading: { type: ShadingType.SOLID, color: C.purple },
              children: [
                new ImageRun({ data: logo, transformation: { width: 75, height: 16 }, type: "png" }),
                new TextRun({ text: "  iMocha Bid Compass", color: C.white, bold: true, size: 18, font: "Calibri" }),
                new TextRun({ text: "        CONFIDENTIAL — INTERNAL", color: "CCBBFF", size: 14, font: "Calibri" }),
              ],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Prepared by ${preparedBy} via iMocha Bid Compass · ${today} · CONFIDENTIAL  `, color: C.muted, size: 16, font: "Calibri" }),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            })],
          }),
        },
        children: [
          // Cover header band
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purple },
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({ data: logo, transformation: { width: 102, height: 22 }, type: "png" }),
              new TextRun({ text: "  iMocha Bid Compass", color: C.white, bold: true, size: 22, font: "Calibri" }),
              new TextRun({ text: "        CONFIDENTIAL — INTERNAL", color: "CCBBFF", size: 16, font: "Calibri" }),
            ],
          }),

          // Title block
          new Paragraph({
            spacing: { before: 200, after: 20 },
            children: [
              new TextRun({ text: `${bid.client_name}`, color: C.purple, bold: true, size: 40, font: "Calibri" }),
              new TextRun({ text: `   ${fmtMoney(bid.value)}`, color: C.orange, bold: true, size: 32, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { before: 0, after: 60 },
            children: [new TextRun({ text: bid.title, color: C.muted, size: 20, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({ text: "Bid Qualification — Executive Briefing", color: C.navy, bold: true, size: 22, font: "Calibri" }),
              new TextRun({ text: "  ·  ", color: C.muted, size: 20, font: "Calibri" }),
              new TextRun({ text: `Audience: CEO, Product Leadership, Solutions Leadership, Sales Leadership`, color: C.muted, italics: true, size: 18, font: "Calibri" }),
            ],
          }),
          // Decision banner
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: decisionColour(dec) },
            spacing: { before: 40, after: 200 },
            children: [
              new TextRun({ text: `  ${decisionLabel(dec)}`, color: C.white, bold: true, size: 24, font: "Calibri" }),
              new TextRun({ text: `    Score: ${totalScore} / 100  ·  Bid Strength: ${bidStrength(totalScore)}`, color: C.white, size: 19, font: "Calibri" }),
              bid.gonogo_completed_at
                ? new TextRun({ text: `    Locked: ${fmtDate(bid.gonogo_completed_at)}`, color: "DDCCFF", size: 17, font: "Calibri" })
                : new TextRun({ text: "" }),
            ],
          }),

          // ── 1. Executive Summary ─────────────────────────────────────────
          sectionHeading("1", "Executive Summary"),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purpleTint },
            spacing: { before: 60, after: 80 },
            indent: { left: 160, right: 160 },
            children: [new TextRun({
              text: insights?.recommendation
                ?? `${bid.client_name} has submitted a ${(bid.type ?? "bid").toUpperCase()} aligned to iMocha's ${productLine} offering. Run the AI Assessment in the Assessment & Result tab to generate the executive summary.`,
              size: 20, font: "Calibri", color: C.ink,
            })],
          }),

          // ── 2. Customer Profile ──────────────────────────────────────────
          sectionHeading("2", "Customer Profile"),
          new Table({
            width: { size: 55, type: WidthType.PERCENTAGE },
            rows: [
              profileRow("Customer",       bid.client_name,                                       0),
              profileRow("Bid Type",        (bid.type ?? "—").toUpperCase(),                      1),
              profileRow("Product Line",    productLine,                                           2),
              profileRow("Deal Value",      fmtMoney(bid.value),                                  3),
              profileRow("Priority",        (bid.priority ?? "—").charAt(0).toUpperCase() + (bid.priority ?? "").slice(1), 4),
              profileRow("Deadline",        deadline,                                              5),
              profileRow("Decision",        decisionLabel(dec),                                    6),
              profileRow("Qual. Score",     `${totalScore} / 100`,                                7),
              profileRow("Prepared By",     preparedBy,                                           8),
              profileRow("Date",            today,                                                 9),
            ],
          }),

          // ── 3. Strategic Fit for iMocha ──────────────────────────────────
          sectionHeading("3", "Strategic Fit for iMocha"),
          ...(insights?.strengths ?? ["Run AI Assessment to generate strategic fit analysis."]).map((s: string) =>
            new Paragraph({ bullet: { level: 0 }, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: s, size: 20, font: "Calibri", color: C.ink })] })
          ),

          // ── 4. Assessment Score Breakdown (with AI rationales) ───────────
          sectionHeading("4", "Assessment Score Breakdown"),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "AI-generated rationale for each criterion is included in the Justification column.", color: C.muted, italics: true, size: 17, font: "Calibri" })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  hdrCell("#",            4),
                  hdrCell("Criterion",    28),
                  hdrCell("Score",        7),
                  hdrCell("Wt.",          6),
                  hdrCell("Status",       9),
                  hdrCell("Justification / AI Rationale", 46),
                ],
              }),
              ...CRITERIA.map((c, i) => {
                const s = scores[c.id] ?? 0;
                const st = paramStatus(s);
                const stCol = paramStatusColour(s);
                const stShade = s === 0 ? C.mutedBg : s >= 4 ? C.goTint : s === 3 ? C.warnTint : C.nogoTint;
                const shade = i % 2 === 0 ? undefined : C.mutedBg;
                const justification = rationales[c.id] ?? (s > 0 ? `Manually scored ${s}/5.` : "Not yet scored.");
                return new TableRow({ children: [
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 40 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(i + 1), size: 17, font: "Calibri", color: C.muted })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: c.parameter, bold: true, size: 17, font: "Calibri", color: C.ink })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s > 0 ? `${s}/5` : "—", bold: true, size: 17, font: "Calibri", color: s > 0 ? stCol : C.muted })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${Math.round(c.weight * 100)}%`, size: 17, font: "Calibri", color: C.muted })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, color: stShade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: st, bold: true, size: 17, font: "Calibri", color: stCol })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, color: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: noBorder }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: justification, size: 16, font: "Calibri", color: C.ink })] })] }),
                ]});
              }),
              // Total row
              new TableRow({ children: [
                new TableCell({ columnSpan: 5, shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Total Weighted Score", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                new TableCell({ shading: { type: ShadingType.SOLID, color: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${totalScore} / 100`, color: C.white, bold: true, size: 22, font: "Calibri" })] })] }),
              ]}),
            ],
          }),

          // ── 5. Potential Risks ───────────────────────────────────────────
          sectionHeading("5", "Potential Risks"),
          ...(insights?.risks ?? ["Run AI Assessment to generate risk analysis."]).map((r: string) =>
            new Paragraph({ bullet: { level: 0 }, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: r, size: 20, font: "Calibri", color: C.ink })] })
          ),

          // ── 6. Recommended Win Strategy ──────────────────────────────────
          sectionHeading("6", "Recommended Win Strategy"),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: C.purpleTint },
            spacing: { before: 60, after: 80 },
            indent: { left: 160, right: 160 },
            children: [new TextRun({
              text: insights?.recommendation ?? "Run AI Assessment to generate the recommendation.",
              size: 20, font: "Calibri", color: C.ink,
            })],
          }),
          new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: "Recommended Next Steps:", color: C.navy, bold: true, size: 20, font: "Calibri" })] }),
          ...steps.map((step, i) =>
            new Paragraph({ spacing: { before: 60, after: 60 }, children: [
              new TextRun({ text: `${i + 1}.  `, color: C.purple, bold: true, size: 20, font: "Calibri" }),
              new TextRun({ text: step, size: 20, font: "Calibri", color: C.ink }),
            ]})
          ),
          new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }),
          decisionBadge(),
        ],
      }],
    });

    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const slug = bid.client_name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `iMocha_${slug}_BidQualResult_${dateStr}.docx`;

    await uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "qual-result", filename });
    const storagePath = `${data.bidId}/qual-result/${filename}`;
    const { data: signed } = await supabaseAdmin.storage.from("bid-documents").createSignedUrl(storagePath, 300);
    return { url: signed?.signedUrl ?? "", filename };
  });
