import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { indexDocument } from "@/lib/api/doc-functions";
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
  if (score >= 4)  return "SUPPORTED";
  if (score === 3) return "PARTIAL";
  return "GAP";
}

function paramStatusColour(score: number): string {
  if (score === 0) return C.muted;
  if (score >= 4)  return C.go;
  if (score === 3) return C.warn;
  return C.nogo;
}

// ── Product line label ────────────────────────────────────────────────────────
function productLineLabel(productType: string | null): string {
  if (productType === "TM") return "Talent Management (Skills Intelligence)";
  if (productType === "TA") return "Talent Acquisition (Skills Assessment)";
  if (productType === "BOTH") return "TA + TM — Full Skills Platform";
  return "Skills Platform";
}

// ── Key Requirements by product type ─────────────────────────────────────────
function keyRequirements(productType: string | null, bidType: string | null): string[] {
  const pt = (productType ?? "").toUpperCase();
  if (pt === "TM") return [
    "Skills taxonomy design, ontology setup, and ongoing governance model",
    "HRIS/LMS integration (Workday, SuccessFactors, SAP, Oracle or equivalent)",
    "Skills gap analysis and personalised learning recommendations",
    "Internal mobility, career pathing, and role-to-skill mapping",
    "Workforce planning, succession planning, and talent intelligence dashboards",
    "Manager validation, self-assessment, and continuous assessment campaigns",
    "AI Skills Inference and skills intelligence analytics reporting",
    "Data residency, SSO (SAML/OIDC), SCIM provisioning, and SOC2 / ISO 27001 compliance",
  ];
  if (pt === "TA") return [
    "Pre-hire skills assessment library (3,000+ skills, multi-language support)",
    "ATS integration (Workday Recruiting, SuccessFactors, Oracle, SmartRecruiters, iCIMS, or equivalent)",
    "Conversational AI interviews and async video interview capability",
    "Coding assessments and role-based assessment campaign management",
    "Proctoring, anti-cheating, and candidate experience requirements",
    "AI Skills Match and structured sifting / scoring methodology",
    "Recruiter and hiring manager analytics, compliance reporting",
    "Data residency, SSO (SAML/OIDC), SCIM, and SOC2 / ISO 27001 compliance",
  ];
  if (pt === "BOTH") return [
    "Pre-hire and in-role skills assessment across TA and TM use cases",
    "ATS + HRIS integration (covering both recruiting and talent management systems)",
    "Unified skills ontology bridging talent acquisition and workforce development",
    "AI Skills Match for hiring and AI Skills Inference for internal mobility",
    "Career pathing, internal mobility, and skills gap analysis",
    "Conversational AI interviews, async video, and structured assessment campaigns",
    "Consolidated analytics spanning recruitment, onboarding, and L&D impact",
    "Data residency, SSO (SAML/OIDC), SCIM, and SOC2 / ISO 27001 compliance",
  ];
  // Generic fallback when product type not specified
  const typeLabel = (bidType ?? "RFP").toUpperCase();
  return [
    `Platform capabilities and solution scope for this ${typeLabel}`,
    "HRIS / ATS integration requirements and system-of-record designation",
    "User volumes, assessment frequency, and rollout geography",
    "Analytics, reporting, and stakeholder dashboard expectations",
    "Security, data residency, and compliance certifications required",
    "Implementation timeline, migration scope, and UAT requirements",
    "Commercial, licensing model, and support level expectations",
  ];
}

// ── On-demand rationale generation (Haiku — fast, used when ad.rationales absent) ──
async function ensureRationales(
  scores: Record<string, number>,
  bid: { client_name: string; title: string; type: string; product_type: string | null },
): Promise<Record<string, string>> {
  const scoredCriteria = CRITERIA.filter(c => (scores[c.id] ?? 0) > 0);
  if (scoredCriteria.length === 0) return {};

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteriaBlock = scoredCriteria
    .map(c => `  "${c.id}": { "name": "${c.parameter}", "score": ${scores[c.id]}/5 }`)
    .join(",\n");

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `You are a bid qualification analyst writing internal leadership notes for a ${(bid.product_type ?? "skills platform")} opportunity with ${bid.client_name} (${bid.title}).

For each criterion below, write a single concise sentence (max 20 words) that justifies the score from iMocha's perspective — what specifically makes this score appropriate for this deal.

Criteria and scores:
{
${criteriaBlock}
}

Return ONLY valid JSON, no explanation:
{ "rationales": { "criterion_id": "justification sentence", ... } }`,
    }],
  });

  try {
    const raw = resp.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed.rationales ?? {};
  } catch {
    return {};
  }
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

// ── Conflict check helper ─────────────────────────────────────────────────────
async function checkExistingAll(bidId: string, folder: string): Promise<Array<{ id: string; name: string; storage_path: string }>> {
  const { data } = await (supabaseAdmin.from("bid_documents") as any)
    .select("id, name, storage_path")
    .eq("bid_id", bidId)
    .ilike("storage_path", `%/${folder}/%`);
  return data ?? [];
}

async function deleteDoc(doc: { id: string; storage_path: string }) {
  await supabaseAdmin.storage.from("bid-documents").remove([doc.storage_path]);
  await (supabaseAdmin.from("bid_documents") as any).delete().eq("id", doc.id);
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

  const { data: inserted } = await (supabaseAdmin.from("bid_documents") as any).insert({
    bid_id: opts.bidId,
    name: opts.filename,
    type: "reference",
    stage: "deal_qualification",
    storage_path: path,
    size_bytes: opts.buffer.byteLength,
    uploaded_by: opts.userId,
    source: "generated",
  }).select("id").single();

  if (inserted?.id) {
    indexDocument({ data: { documentId: inserted.id } }).catch((err) =>
      console.error("[generate-qual-docs] indexDocument failed:", err)
    );
  }
}

// ── Deal Brief content helpers ────────────────────────────────────────────────

function productShortLabel(pt: string | null): string {
  if (pt === "TM") return "Talent Management";
  if (pt === "TA") return "Talent Acquisition";
  if (pt === "BOTH") return "TA + TM";
  return "Skills Platform";
}

function procurementTypeLabel(bidType: string | null): string {
  const t = (bidType ?? "rfp").toLowerCase();
  if (t === "rfp") return "Competitive RFP";
  if (t === "rfi") return "RFI";
  if (t === "rfq") return "Competitive RFQ";
  if (t === "direct") return "Direct Engagement";
  return t.toUpperCase();
}

function briefObjective(pt: string | null, bidType: string | null): string {
  if (pt === "TM") return "Select an enterprise-wide Skills Management solution to improve skills visibility, competency management, employee development, and workforce decision-making.";
  if (pt === "TA") return "Select an AI-powered Skills Assessment platform to standardize pre-hire screening, improve quality of hire, and integrate with the existing ATS and HR technology stack.";
  if (pt === "BOTH") return "Evaluate and select an end-to-end Skills Platform spanning talent acquisition and talent management to support a unified, skills-first workforce strategy.";
  return `Evaluate and select a best-in-class enterprise platform for this ${(bidType ?? "RFP").toUpperCase()}.`;
}

const BRIEF_STATIC: Record<string, {
  customerObjectives: string[];
  businessDrivers: string[];
  keyFunctionalRequirements: string[];
  integrationLandscape: string[];
  imochaStrengths: string[];
  defaultRisks: string[];
}> = {
  TM: {
    customerObjectives: [
      "Establish a centralized enterprise skills repository.",
      "Enable employees to maintain and validate their skills profiles.",
      "Support managers with competency assessments and team skills visibility.",
      "Identify skill gaps and development opportunities.",
      "Improve internal mobility and career development.",
      "Deliver enterprise analytics and reporting.",
      "Integrate with the existing HR ecosystem.",
      "Minimize customization through configurable standard functionality.",
      "Provide a secure, scalable, enterprise-ready SaaS platform.",
    ],
    businessDrivers: [
      "Improve workforce skills visibility.",
      "Standardize competency management.",
      "Support employee growth and career development.",
      "Strengthen workforce planning and succession readiness.",
      "Increase manager visibility into team capabilities.",
      "Establish consistent skills governance.",
      "Reduce manual processes and fragmented skills data.",
    ],
    keyFunctionalRequirements: [
      "Skills Management: Skills inventory, competency framework, job architecture, skills taxonomy, proficiency levels, self-assessments, manager validation, skills gap analysis, assessment campaigns.",
      "Talent Development: Career pathing, learning recommendations, internal mobility, development planning.",
      "Analytics: Executive dashboards, HR reporting, manager reporting, skills analytics, export capabilities.",
      "Administration: Skills governance, user administration, role-based access, workflow configuration.",
    ],
    integrationLandscape: [
      "HRIS and HCM integrations (e.g. Workday, SuccessFactors, SAP, Oracle) for employee data sync.",
      "LMS integrations for learning recommendation delivery.",
      "REST APIs and SCIM for user provisioning and custom integrations.",
      "Power BI / analytics tool integrations for enterprise reporting.",
      "Future HR technology integrations may be required based on roadmap.",
    ],
    imochaStrengths: [
      "Enterprise Skills Inventory",
      "AI-powered Skills Intelligence",
      "Skills Taxonomy",
      "Role-to-skill mapping",
      "Self-assessments",
      "Manager validation",
      "Skills Gap Analysis",
      "Internal Mobility",
      "Learning recommendations",
      "REST APIs",
      "SSO",
      "Power BI integration",
      "Cornerstone integration",
      "Enterprise analytics",
      "Configurable competency framework",
      "ISO 27001:2022",
      "SOC 2 Type II",
      "GDPR support",
    ],
    defaultRisks: [
      "Existing skills framework and governance model.",
      "Employee population and rollout phases.",
      "Integration scope beyond stated HRIS systems.",
      "Future HR technology roadmap and planned migrations.",
      "Configuration versus customization expectations.",
      "Assessment strategy (campaign-based vs. continuous).",
      "Reporting and analytics expectations by stakeholder.",
      "AI-assisted capability expectations.",
      "Success criteria and implementation timeline.",
      "Organization-specific metadata, business rules, analytics, or reporting requirements.",
    ],
  },
  TA: {
    customerObjectives: [
      "Standardize the pre-hire assessment process across all business units.",
      "Improve quality of hire through structured, skills-based screening.",
      "Reduce time-to-hire and screening overhead for recruiting teams.",
      "Ensure candidate experience is consistent, professional, and unbiased.",
      "Enable hiring managers with actionable data and structured sifting.",
      "Integrate seamlessly with the existing ATS and HR technology stack.",
      "Support multi-language and global assessment requirements.",
      "Maintain compliance with data privacy and security standards.",
      "Provide analytics and reporting for TA leadership and stakeholders.",
    ],
    businessDrivers: [
      "Improve quality of hire through objective skills measurement.",
      "Reduce recruiter screening time and manual effort.",
      "Eliminate bias through structured, validated assessments.",
      "Scale hiring capacity without proportionally scaling headcount.",
      "Gain visibility into candidate skills pipeline and sourcing quality.",
      "Standardize evaluation criteria across roles and geographies.",
      "Strengthen employer brand through a modern candidate experience.",
    ],
    keyFunctionalRequirements: [
      "Skills Assessment: Pre-hire assessment library (3,000+ skills), role-based campaign management, multi-language support, customizable assessments, proficiency-level testing.",
      "Screening & AI: Conversational AI interviews, async video interviews, AI Skills Match, structured scoring and sifting methodology.",
      "Proctoring & Integrity: Anti-cheating controls, live proctoring, screen recording, candidate trust score.",
      "Analytics & ATS: Recruiter and hiring manager dashboards, compliance reporting, ATS integration (Workday, SuccessFactors, iCIMS, SmartRecruiters).",
    ],
    integrationLandscape: [
      "ATS integrations (e.g. Workday Recruiting, SuccessFactors, iCIMS, SmartRecruiters) for assessment campaign management.",
      "Video interview and async interview platform integrations.",
      "HRMS integrations for candidate data and onboarding workflows.",
      "REST APIs and SSO for custom ATS and career portal integrations.",
      "Future recruiting technology integrations may be required based on roadmap.",
    ],
    imochaStrengths: [
      "3,000+ Skills Assessment Library",
      "AI-powered Conversational AI Interviews",
      "Async Video Interview capability",
      "Role-based Assessment Campaigns",
      "AI Skills Match for candidate ranking",
      "Structured Sifting and Scoring",
      "Anti-cheating and Proctoring suite",
      "Multi-language support",
      "ATS Integrations (Workday, SuccessFactors, iCIMS)",
      "Coding Assessments",
      "Candidate Experience tools",
      "Recruiter Analytics dashboards",
      "REST APIs and SSO",
      "ISO 27001:2022",
      "SOC 2 Type II",
      "GDPR support",
    ],
    defaultRisks: [
      "ATS integration scope and data flow requirements.",
      "Assessment volume and peak hiring periods.",
      "Multi-language and geolocation support requirements.",
      "Proctoring and security requirements for sensitive roles.",
      "Candidate experience and accessibility standards.",
      "Configuration versus customization expectations.",
      "Compliance reporting requirements by region.",
      "AI interview and async video capability expectations.",
      "Success criteria and time-to-hire improvement targets.",
      "Organization-specific assessment design, scoring, or integration requirements.",
    ],
  },
  BOTH: {
    customerObjectives: [
      "Implement a unified, end-to-end Skills Platform spanning hiring and workforce development.",
      "Standardize pre-hire assessment and in-role skills validation across the organization.",
      "Enable a skills-first approach to talent acquisition, internal mobility, and career development.",
      "Deliver a single skills ontology connecting talent acquisition and talent management.",
      "Improve quality of hire and reduce time-to-hire through AI-powered candidate screening.",
      "Support manager-led competency assessments, skills gap analysis, and development planning.",
      "Integrate with existing ATS, HRIS, and LMS systems across the enterprise.",
      "Provide consolidated analytics spanning recruitment, onboarding, and L&D impact.",
      "Ensure enterprise-grade security, compliance, and scalability.",
    ],
    businessDrivers: [
      "Implement a skills-first strategy across the full talent lifecycle.",
      "Improve hiring quality through data-driven candidate assessment.",
      "Enable workforce skills visibility and gap identification at scale.",
      "Connect talent acquisition decisions with workforce development planning.",
      "Reduce fragmentation across recruiting and HR technology systems.",
      "Support career development, internal mobility, and succession planning.",
      "Deliver consistent skills governance from hire to retire.",
    ],
    keyFunctionalRequirements: [
      "Skills Assessment: Pre-hire and in-role skills assessment across 3,000+ skills, role-based campaigns, multi-language support.",
      "Skills Intelligence: Skills taxonomy, competency framework, skills gap analysis, self-assessments, manager validation, AI skills inference.",
      "Talent Development & Mobility: Career pathing, learning recommendations, internal mobility, development planning.",
      "Screening & AI: Conversational AI interviews, async video, AI Skills Match, structured sifting and scoring.",
      "Analytics: Unified dashboards spanning TA and TM, HR/TA leadership reporting, export capabilities.",
      "Integrations: ATS + HRIS integration, SSO, SCIM, REST APIs.",
    ],
    integrationLandscape: [
      "ATS + HRIS integrations covering both recruiting and talent management workflows.",
      "LMS integration for learning recommendations linked to skills gap data.",
      "REST APIs, SSO (SAML/OIDC), and SCIM for provisioning and custom integrations.",
      "Power BI / analytics tool integrations for enterprise reporting.",
      "Future technology integrations may be required based on organizational roadmap.",
    ],
    imochaStrengths: [
      "3,000+ Skills Assessment Library (TA)",
      "Enterprise Skills Inventory (TM)",
      "AI-powered Skills Intelligence and Skills Inference",
      "AI Conversational Interviews",
      "AI Skills Match for candidate ranking",
      "Skills Taxonomy and Competency Framework",
      "Role-to-skill mapping and career pathing",
      "Internal Mobility and Learning Recommendations",
      "Skills Gap Analysis",
      "ATS + HRIS Integrations",
      "REST APIs, SSO, SCIM",
      "Enterprise analytics and dashboards",
      "ISO 27001:2022",
      "SOC 2 Type II",
      "GDPR support",
    ],
    defaultRisks: [
      "Scoping and prioritization across TA and TM use cases.",
      "ATS and HRIS integration complexity and data ownership.",
      "Employee vs. candidate data governance and privacy.",
      "Configuration versus customization expectations across product lines.",
      "Assessment strategy and campaign management approach.",
      "Implementation phasing and rollout sequencing.",
      "Analytics and reporting requirements by stakeholder group.",
      "AI capability expectations across TA and TM features.",
      "Success criteria, timelines, and change management approach.",
      "Organization-specific rules, metadata, and integration requirements.",
    ],
  },
};

const BRIEF_GENERIC = {
  customerObjectives: [
    "Define and evaluate solution capabilities aligned to organizational requirements.",
    "Ensure seamless integration with the existing HR and talent technology stack.",
    "Deliver measurable business outcomes with a clear implementation roadmap.",
    "Provide enterprise-grade security, compliance, and SaaS scalability.",
    "Enable data-driven talent decisions through robust analytics and reporting.",
  ],
  businessDrivers: [
    "Improve talent decision-making through objective data.",
    "Standardize processes and reduce manual effort.",
    "Enable scalable, enterprise-ready talent operations.",
    "Strengthen workforce capability and organizational resilience.",
    "Drive measurable ROI from talent technology investments.",
  ],
  keyFunctionalRequirements: [
    "Platform Capabilities: Core feature set aligned to the stated use case and bid requirements.",
    "Integrations: HRIS, ATS, LMS integration scope, SSO, REST APIs, and SCIM provisioning.",
    "Analytics & Reporting: Role-based dashboards, export capabilities, compliance reporting.",
    "Administration: User management, role-based access, workflow configuration, skills governance.",
  ],
  integrationLandscape: [
    "HRIS / ATS integrations required for core data sync and workflow continuity.",
    "SSO, SCIM, and REST APIs for enterprise-grade provisioning and custom integration.",
    "Analytics tool integrations (e.g. Power BI) for reporting and dashboards.",
    "Future technology integrations may be required based on organizational roadmap.",
  ],
  imochaStrengths: [
    "AI-powered Skills Intelligence platform",
    "3,000+ Skills Assessment Library",
    "Configurable competency framework and skills taxonomy",
    "Enterprise-grade integrations (HRIS, ATS, SSO, APIs)",
    "ISO 27001:2022 and SOC 2 Type II certified",
    "GDPR-ready data privacy controls",
    "Executive and operational analytics dashboards",
  ],
  defaultRisks: [
    "Scope ambiguity or missing requirements in the submission.",
    "Integration complexity with existing technology ecosystem.",
    "Unrealistic implementation timeline or resource constraints.",
    "Compliance, data residency, and security requirements.",
    "Configuration versus customization expectations.",
    "Stakeholder alignment and decision-making timeline.",
    "Success criteria and measurable business outcomes.",
    "Organization-specific rules, processes, or integration requirements.",
  ],
};

const TECHNICAL_REQUIREMENTS = [
  "SaaS deployment and enterprise scalability.",
  "HRIS integration, SSO, REST APIs and secure authentication.",
  "Data migration and enterprise reporting.",
];
const SECURITY_COMPLIANCE = [
  "Enterprise security",
  "Identity management",
  "Encryption",
  "Auditability",
  "Compliance readiness",
  "Data privacy",
  "Secure integrations",
];
const IMPLEMENTATION_EXPECTATIONS = [
  "Implementation methodology",
  "Data migration",
  "Integration approach",
  "Testing strategy",
  "Security readiness",
  "Rollout approach",
  "Governance model",
];
const PROPOSAL_THEMES = [
  "Clearly distinguish standard capabilities, configurable functionality, custom development, third-party components and out-of-scope items.",
  "Transparency is a key evaluation criterion.",
];

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 1 — Deal Brief (Structured Opportunity Analysis)
// 11-section format: Overview · Objectives · Drivers · Requirements · Strengths · Risks
// ═══════════════════════════════════════════════════════════════════════════════

export const generateQualResultFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string; force?: boolean } }) => {
    console.log("[generateQualResultFn] START — bidId:", data.bidId, "force:", data.force);
    const user = await authUser(getRequest());
    if (!user) { console.error("[generateQualResultFn] UNAUTHORIZED"); return new Response("Unauthorized", { status: 401 }); }
    console.log("[generateQualResultFn] authed as:", user.id);

    const existingAll = await checkExistingAll(data.bidId, "deal-brief");
    console.log("[generateQualResultFn] existing docs:", existingAll.length, "force:", data.force);
    if (existingAll.length > 0 && !data.force) {
      return { conflict: true as const, existingName: existingAll[0].name, existingId: existingAll[0].id };
    }
    if (existingAll.length > 0) {
      await Promise.all(existingAll.map(deleteDoc));
    }

    const bidRes = await supabaseAdmin.from("bids").select("*").eq("id", data.bidId).maybeSingle();
    if (!bidRes.data) return new Response("Bid not found", { status: 404 });

    const bid = bidRes.data as any;
    const ad: any = bid.assessment_data ?? {};
    const insights = ad.insights ?? null;

    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());
    const productLine = productLineLabel(bid.product_type);
    const productShort = productShortLabel(bid.product_type);
    const procType = procurementTypeLabel(bid.type);
    const objective = briefObjective(bid.product_type, bid.type);
    const dealValue = bid.value && bid.value > 0 ? fmtMoney(bid.value) : "TBD";
    const deadline = bid.deadline ? fmtDate(bid.deadline) : "TBD";
    const pt = (bid.product_type ?? "").toUpperCase();
    const content = BRIEF_STATIC[pt] ?? BRIEF_GENERIC;
    const keyRisksList = (insights?.risks && (insights.risks as string[]).length > 0)
      ? (insights.risks as string[])
      : content.defaultRisks;

    // ── Per-document helpers ────────────────────────────────────────────────
    function bSectionHeading(num: number, title: string): Paragraph {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 100 },
        children: [
          new TextRun({ text: `${num}. ${title}`, color: C.navy, bold: true, size: 26, font: "Calibri" }),
        ],
      });
    }

    function bBullet(text: string): Paragraph {
      return new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text, size: 19, font: "Calibri", color: C.ink })],
      });
    }

    function ovLabelCell(text: string): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, fill: C.mutedBg },
        borders: { top: hairline, bottom: hairline, left: hairline, right: hairline },
        width: { size: 28, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 140, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 19, font: "Calibri", color: C.muted })] })],
      });
    }

    function ovValueCell(text: string, shade?: string): TableCell {
      return new TableCell({
        shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined,
        borders: { top: hairline, bottom: hairline, left: hairline, right: hairline },
        width: { size: 72, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 140, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text, size: 19, font: "Calibri", color: C.ink })] })],
      });
    }

    // ── Assemble document ───────────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, bottom: 900, left: 900, right: 900 } } },
        headers: {
          default: new Header({
            children: [new Paragraph({
              children: [
                new ImageRun({ data: logo, transformation: { width: 90, height: 19 }, type: "png" }),
                new TextRun({ text: "        Deal Brief  |  Confidential", color: C.muted, size: 16, font: "Calibri", italics: true }),
              ],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Prepared by iMocha Bid Compass · ${today} · CONFIDENTIAL  `, color: C.muted, size: 16, font: "Calibri" }),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            })],
          }),
        },
        children: [
          // ── Logo above title ───────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 120, after: 140 },
            children: [new ImageRun({ data: logo, transformation: { width: 120, height: 25 }, type: "png" })],
          }),
          // ── Title block ────────────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [new TextRun({ text: `Deal Brief – ${bid.client_name} (${productShort})`, color: C.navy, bold: true, size: 44, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 30 },
            children: [new TextRun({ text: `${bid.client_name} – ${bid.title}`, color: C.muted, size: 24, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 200 },
            children: [new TextRun({ text: "Executive Opportunity Analysis", color: C.muted, size: 20, font: "Calibri", italics: true })],
          }),

          // ── 1. Opportunity Overview ────────────────────────────────────────
          bSectionHeading(1, "Opportunity Overview"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  new TableCell({
                    shading: { type: ShadingType.SOLID, fill: C.navy },
                    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
                    width: { size: 28, type: WidthType.PERCENTAGE },
                    margins: { top: 80, bottom: 80, left: 140, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Item", color: C.white, bold: true, size: 19, font: "Calibri" })] })],
                  }),
                  new TableCell({
                    shading: { type: ShadingType.SOLID, fill: C.navy },
                    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
                    width: { size: 72, type: WidthType.PERCENTAGE },
                    margins: { top: 80, bottom: 80, left: 140, right: 80 },
                    children: [new Paragraph({ children: [new TextRun({ text: "Details", color: C.white, bold: true, size: 19, font: "Calibri" })] })],
                  }),
                ],
              }),
              new TableRow({ children: [ovLabelCell("Customer"), ovValueCell(bid.client_name)] }),
              new TableRow({ children: [ovLabelCell("Opportunity"), ovValueCell(bid.title, C.purpleTint)] }),
              new TableRow({ children: [ovLabelCell("Solution Area"), ovValueCell(productLine)] }),
              new TableRow({ children: [ovLabelCell("Procurement Type"), ovValueCell(procType, C.purpleTint)] }),
              new TableRow({ children: [ovLabelCell("Deal Value"), ovValueCell(dealValue)] }),
              new TableRow({ children: [ovLabelCell("Deadline"), ovValueCell(deadline, C.purpleTint)] }),
              new TableRow({ children: [ovLabelCell("Objective"), ovValueCell(objective)] }),
            ],
          }),

          // ── 2. Customer Objectives ─────────────────────────────────────────
          bSectionHeading(2, "Customer Objectives"),
          ...content.customerObjectives.map(bBullet),

          // ── 3. Business Drivers ────────────────────────────────────────────
          bSectionHeading(3, "Business Drivers"),
          ...content.businessDrivers.map(bBullet),

          // ── 4. Key Functional Requirements ────────────────────────────────
          bSectionHeading(4, "Key Functional Requirements"),
          ...content.keyFunctionalRequirements.map(bBullet),

          // ── 5. Technical Requirements ──────────────────────────────────────
          bSectionHeading(5, "Technical Requirements"),
          ...TECHNICAL_REQUIREMENTS.map(bBullet),

          // ── 6. Security & Compliance Expectations ─────────────────────────
          bSectionHeading(6, "Security & Compliance Expectations"),
          ...SECURITY_COMPLIANCE.map(bBullet),

          // ── 7. Integration Landscape ───────────────────────────────────────
          bSectionHeading(7, "Integration Landscape"),
          ...content.integrationLandscape.map(bBullet),

          // ── 8. Implementation Expectations ────────────────────────────────
          bSectionHeading(8, "Implementation Expectations"),
          ...IMPLEMENTATION_EXPECTATIONS.map(bBullet),

          // ── 9. Key Proposal Themes ─────────────────────────────────────────
          bSectionHeading(9, "Key Proposal Themes"),
          ...PROPOSAL_THEMES.map(bBullet),

        ],
      }],
    });

    console.log("[generateQualResultFn] building DOCX buffer...");
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const slug = bid.client_name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `iMocha_${slug}_DealBrief_${dateStr}.docx`;
    console.log("[generateQualResultFn] buffer size:", buffer.byteLength, "filename:", filename);

    await uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "deal-brief", filename });
    const storagePath = `${data.bidId}/deal-brief/${filename}`;
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from("bid-documents").createSignedUrl(storagePath, 300);
    console.log("[generateQualResultFn] signed URL:", signed?.signedUrl ?? "NONE", "signErr:", signErr);
    return { url: signed?.signedUrl ?? "", filename };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// DOC 2 — Bid Qualification Result (Executive Briefing — Exe Summary format)
// Comprehensive: numbered sections · Customer Profile · Strategic Fit ·
// Assessment breakdown with AI rationales · Risks · Win Strategy
// ═══════════════════════════════════════════════════════════════════════════════

export const generateDealBriefFn = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { bidId: string; force?: boolean } }) => {
    console.log("[generateDealBriefFn] START — bidId:", data.bidId, "force:", data.force);
    const user = await authUser(getRequest());
    if (!user) { console.error("[generateDealBriefFn] UNAUTHORIZED"); return new Response("Unauthorized", { status: 401 }); }
    console.log("[generateDealBriefFn] authed as:", user.id);

    const existingAll = await checkExistingAll(data.bidId, "qual-result");
    console.log("[generateDealBriefFn] existing docs:", existingAll.length, "force:", data.force);
    if (existingAll.length > 0 && !data.force) {
      return { conflict: true as const, existingName: existingAll[0].name, existingId: existingAll[0].id };
    }
    if (existingAll.length > 0) {
      await Promise.all(existingAll.map(deleteDoc));
    }

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
    const insights = ad.insights ?? null;
    const rationales: Record<string, string> =
      Object.keys(ad.rationales ?? {}).length > 0
        ? (ad.rationales as Record<string, string>)
        : await ensureRationales(scores, bid);

    const totalScore = Math.round(CRITERIA.reduce((s, c) => s + ((scores[c.id] ?? 0) / 5) * c.weight * 100, 0));
    const dec: string = bid.gonogo_decision ?? (totalScore >= 65 ? "go" : totalScore >= 45 ? "conditional_go" : "no_go");
    const logo = await getLogo();
    const today = fmtDate(new Date().toISOString());
    const deadline = bid.deadline ? fmtDate(bid.deadline) : "TBD";
    const productLine = productLineLabel(bid.product_type);
    const dealValue = bid.value && bid.value > 0 ? fmtMoney(bid.value) : "TBD";

    // ── Cell helpers ────────────────────────────────────────────────────────
    function hdrCell(text: string, widthPct?: number): TableCell {
      return new TableCell({
        shading: { type: ShadingType.SOLID, fill: C.navy },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: hairline },
        width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text, color: C.white, bold: true, size: 18, font: "Calibri" })] })],
      });
    }

    function profileRow(label: string, value: string, i: number): TableRow {
      const shade = i % 2 === 0 ? C.purpleTint : "FFFFFF";
      return new TableRow({ children: [
        new TableCell({ shading: { type: ShadingType.SOLID, fill: shade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: "Calibri", color: C.muted })] })] }),
        new TableCell({ shading: { type: ShadingType.SOLID, fill: shade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: noBorder }, margins: { top: 80, bottom: 80, left: 120, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: "Calibri", color: C.ink })] })] }),
      ]});
    }

    function decisionBadge(): Table {
      return new Table({
        width: { size: 22, type: WidthType.PERCENTAGE },
        rows: [new TableRow({
          children: [new TableCell({
            shading: { type: ShadingType.SOLID, fill: decisionColour(dec) },
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
          new TextRun({ text: `${num}. `, color: C.ink, bold: true, size: 26, font: "Calibri" }),
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
              children: [
                new ImageRun({ data: logo, transformation: { width: 90, height: 19 }, type: "png" }),
                new TextRun({ text: "        Confidential — Internal", color: C.muted, size: 16, font: "Calibri", italics: true }),
              ],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Prepared by ${preparedBy} · ${today} · Confidential  `, color: C.muted, size: 16, font: "Calibri" }),
                new TextRun({ children: [PageNumber.CURRENT] }),
              ],
            })],
          }),
        },
        children: [
          // Logo above title
          new Paragraph({
            spacing: { before: 80, after: 120 },
            children: [
              new ImageRun({ data: logo, transformation: { width: 110, height: 23 }, type: "png" }),
            ],
          }),

          // Title block
          new Paragraph({
            spacing: { before: 200, after: 20 },
            children: [
              new TextRun({ text: `${bid.client_name}`, color: C.purple, bold: true, size: 40, font: "Calibri" }),
              new TextRun({ text: `   ${dealValue}`, color: C.orange, bold: true, size: 32, font: "Calibri" }),
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
            shading: { type: ShadingType.SOLID, fill: decisionColour(dec) },
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
            spacing: { before: 60, after: 80 },
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
              profileRow("Deal Value",      dealValue,                                            3),
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
          new Paragraph({ pageBreakBefore: true, children: [] }),
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
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 40 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(i + 1), size: 17, font: "Calibri", color: C.muted })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: c.parameter, bold: true, size: 17, font: "Calibri", color: C.ink })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s > 0 ? `${s}/5` : "—", bold: true, size: 17, font: "Calibri", color: s > 0 ? stCol : C.muted })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${Math.round(c.weight * 100)}%`, size: 17, font: "Calibri", color: C.muted })] })] }),
                  new TableCell({ shading: { type: ShadingType.SOLID, fill: stShade }, borders: { top: hairline, bottom: hairline, left: noBorder, right: hairline }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: st, bold: true, size: 17, font: "Calibri", color: stCol })] })] }),
                  new TableCell({ shading: shade ? { type: ShadingType.SOLID, fill: shade } : undefined, borders: { top: hairline, bottom: hairline, left: noBorder, right: noBorder }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: justification, size: 16, font: "Calibri", color: C.ink })] })] }),
                ]});
              }),
              // Total row
              new TableRow({ children: [
                new TableCell({ columnSpan: 5, shading: { type: ShadingType.SOLID, fill: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Total Weighted Score", color: C.white, bold: true, size: 18, font: "Calibri" })] })] }),
                new TableCell({ shading: { type: ShadingType.SOLID, fill: C.navy }, borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${totalScore} / 100`, color: C.white, bold: true, size: 22, font: "Calibri" })] })] }),
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
            spacing: { before: 60, after: 80 },
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

    console.log("[generateDealBriefFn] building DOCX buffer...");
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const slug = bid.client_name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `iMocha_${slug}_BidQualResult_${dateStr}.docx`;
    console.log("[generateDealBriefFn] buffer size:", buffer.byteLength, "filename:", filename);

    await uploadDoc({ buffer, bidId: data.bidId, userId: user.id, folder: "qual-result", filename });
    const storagePath = `${data.bidId}/qual-result/${filename}`;
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from("bid-documents").createSignedUrl(storagePath, 300);
    console.log("[generateDealBriefFn] signed URL:", signed?.signedUrl ?? "NONE", "signErr:", signErr);
    return { url: signed?.signedUrl ?? "", filename };
  });
