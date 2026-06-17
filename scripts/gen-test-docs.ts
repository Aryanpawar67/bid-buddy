/**
 * Generates sample RFP/requirements documents for AI centre smoke testing.
 * Outputs to scripts/test-docs/ — upload these via the bid Documents panel.
 *
 * Run: bun scripts/gen-test-docs.ts
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  Packer,
} from "docx";
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "fs";

const OUT = "scripts/test-docs";
mkdirSync(OUT, { recursive: true });

// ─── helpers ────────────────────────────────────────────────────────────────

function h1(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { after: 200 } });
}
function h2(text: string) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } });
}
function body(text: string) {
  return new Paragraph({ children: [new TextRun({ text, size: 22 })], spacing: { after: 120 } });
}
function bullet(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}
function bold(text: string) {
  return new TextRun({ text, bold: true, size: 22 });
}
function simpleTable(headers: string[], rows: string[][]): Table {
  const makeCell = (text: string, isHeader = false) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: isHeader, size: 20 })] })],
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left:   { style: BorderStyle.SINGLE, size: 1 },
        right:  { style: BorderStyle.SINGLE, size: 1 },
      },
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h) => makeCell(h, true)), tableHeader: true }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => makeCell(c)) })),
    ],
  });
}

// ─── Doc 1: Acme Corp RFP (DOCX) ────────────────────────────────────────────

async function genAcmeRFP() {
  const doc = new Document({
    sections: [
      {
        children: [
          h1("Request for Proposal — Enterprise Skills Assessment Platform"),
          new Paragraph({
            children: [
              bold("Issuing Organisation: "), new TextRun({ text: "Acme Corp", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("RFP Reference: "), new TextRun({ text: "ACME-2026-RFP-001", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("Response Deadline: "), new TextRun({ text: "30 September 2026", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("Budget Envelope: "), new TextRun({ text: "USD 250,000 (annual licence)", size: 22 }),
            ],
            spacing: { after: 240 },
          }),

          h2("1. Executive Summary"),
          body(
            "Acme Corp is seeking a qualified vendor to supply an Enterprise Skills Assessment Platform " +
            "that supports end-to-end pre-hiring and continuous-learning measurement across our global " +
            "workforce of approximately 8,500 employees in 14 countries. The selected solution must " +
            "integrate natively with our existing Workday HCM and Salesforce CRM environments."
          ),

          h2("2. Background & Business Context"),
          body(
            "Acme Corp's Talent Acquisition and L&D teams currently rely on a combination of manual " +
            "competency interviews and three separate point-solutions for technical screening, soft-skill " +
            "surveys, and compliance certifications. This fragmentation creates data silos, increases " +
            "time-to-hire by an estimated 23%, and prevents meaningful skills-gap analysis at the " +
            "business-unit level."
          ),
          body(
            "The new platform must consolidate these workflows under a single vendor while providing " +
            "a best-in-class candidate and employee experience."
          ),

          h2("3. Scope of Requirements"),

          h2("3.1 Functional Requirements"),
          bullet("Adaptive question engine supporting coding (15+ languages), MCQ, video-response, and case-study formats"),
          bullet("Live proctoring with AI anomaly detection and human-review escalation workflow"),
          bullet("Pre-built question library with a minimum of 50,000 validated items across 120 skill domains"),
          bullet("Custom assessment authoring tool accessible to non-technical HR administrators"),
          bullet("Role-based dashboards for recruiters, hiring managers, and L&D business partners"),
          bullet("Automated scoring with configurable pass/fail thresholds and benchmark comparisons"),
          bullet("360-degree feedback module for continuous performance measurement"),
          bullet("Skills taxonomy management aligned to the European Skills, Competences, Qualifications and Occupations (ESCO) framework"),

          h2("3.2 Integration Requirements"),
          bullet("Workday HCM — bidirectional sync via Workday RaaS and SOAP APIs"),
          bullet("Salesforce CRM — assessment results surfaced as custom objects on Lead and Contact records"),
          bullet("SSO via SAML 2.0 and OAuth 2.0 (Okta IdP)"),
          bullet("REST API with full OpenAPI 3.0 documentation for custom integrations"),
          bullet("Webhook support for real-time assessment completion events"),

          h2("3.3 Non-Functional Requirements"),
          simpleTable(
            ["#", "Category", "Requirement", "Target"],
            [
              ["NFR-01", "Availability", "Platform uptime SLA", "≥ 99.9% monthly"],
              ["NFR-02", "Performance", "Assessment load time (p95)", "< 2 seconds"],
              ["NFR-03", "Scalability", "Concurrent assessment takers", "≥ 5,000"],
              ["NFR-04", "Security", "Data encryption at rest", "AES-256"],
              ["NFR-05", "Security", "Data encryption in transit", "TLS 1.3"],
              ["NFR-06", "Compliance", "Data residency", "EU & US regions"],
              ["NFR-07", "Compliance", "Certifications required", "ISO 27001, SOC 2 Type II"],
              ["NFR-08", "Accessibility", "WCAG conformance level", "WCAG 2.1 AA"],
            ]
          ),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          h2("4. Evaluation Criteria"),
          body("Proposals will be scored on the following weighted criteria:"),
          simpleTable(
            ["Criterion", "Weight"],
            [
              ["Functional fit against requirements", "35%"],
              ["Integration capability & API maturity", "20%"],
              ["Security & compliance posture", "15%"],
              ["Implementation timeline & methodology", "10%"],
              ["Customer references & case studies", "10%"],
              ["Total cost of ownership (3-year)", "10%"],
            ]
          ),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          h2("5. Proposal Submission Instructions"),
          bullet("Proposals must be submitted in PDF format to rfp@acmecorp.com by 17:00 EST on 30 September 2026"),
          bullet("Proposals must not exceed 40 pages excluding appendices"),
          bullet("Vendors must complete the attached Vendor Questionnaire (Appendix A) in full"),
          bullet("Pricing must be itemised: platform licence, implementation services, training, and ongoing support"),
          bullet("References from at least two enterprise customers (>5,000 employees) are required"),

          h2("6. Contract Terms"),
          body(
            "The initial contract term is 3 years with options for two 1-year extensions. " +
            "Acme Corp's standard Master Services Agreement (MSA) will govern the engagement. " +
            "Vendors proposing material deviations from the MSA must submit a redline in their proposal."
          ),

          h2("7. Point of Contact"),
          body("All questions must be submitted in writing to: procurement@acmecorp.com"),
          body("Questions will be accepted until 15 August 2026. Answers will be published to all registered vendors."),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(`${OUT}/acme-corp-rfp.docx`, buf);
  console.log("✓  acme-corp-rfp.docx");
}

// ─── Doc 2: GlobalTech Inc Technical Specification (DOCX) ───────────────────

async function genGlobalTechSpec() {
  const doc = new Document({
    sections: [
      {
        children: [
          h1("Technical Requirements Specification — Talent Intelligence Suite"),
          new Paragraph({
            children: [
              bold("Client: "), new TextRun({ text: "GlobalTech Inc", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("Document Version: "), new TextRun({ text: "2.1 — DRAFT FOR VENDOR REVIEW", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("Estimated Value: "), new TextRun({ text: "USD 500,000 (Year 1, including implementation)", size: 22 }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              bold("RFP Close Date: "), new TextRun({ text: "15 August 2026", size: 22 }),
            ],
            spacing: { after: 240 },
          }),

          h2("1. Purpose & Scope"),
          body(
            "This Technical Requirements Specification (TRS) defines the architecture, data, and " +
            "integration constraints that any Talent Intelligence Suite vendor must satisfy to be " +
            "considered for GlobalTech Inc's enterprise procurement. It supplements the commercial " +
            "RFP issued on 01 June 2026 (ref: GTI-2026-RFP-047)."
          ),
          body(
            "GlobalTech operates a hybrid cloud environment (Azure primary, AWS DR) serving " +
            "22,000 employees across APAC, EMEA, and the Americas. The selected platform will " +
            "replace legacy tools including Taleo ATS (sunset Q1 2027) and a custom-built " +
            "Python skills-matching service."
          ),

          h2("2. Architecture Requirements"),

          h2("2.1 Deployment Model"),
          bullet("SaaS multi-tenant with dedicated tenant isolation (logical or physical) — vendor to specify"),
          bullet("Data must reside in Azure regions: East US 2, West Europe, Southeast Asia (tri-regional)"),
          bullet("Disaster recovery RPO ≤ 1 hour, RTO ≤ 4 hours"),
          bullet("Blue-green deployment model required — zero-downtime upgrades mandatory"),

          h2("2.2 API & Integration Architecture"),
          body("All integrations must be implemented via the vendor's public API. Screen-scraping, iframe injection, and proprietary sync agents are not permitted."),
          simpleTable(
            ["System", "Integration Type", "Direction", "Protocol", "Frequency"],
            [
              ["Azure AD", "Identity provider", "Inbound", "SAML 2.0 / OIDC", "Real-time"],
              ["Workday HCM", "Employee master data", "Bidirectional", "Workday SOAP + REST", "15-min batch"],
              ["ServiceNow ITSM", "Provisioning workflow", "Outbound", "REST webhook", "Event-driven"],
              ["Tableau Cloud", "Analytics export", "Outbound", "REST / CSV push", "Daily 02:00 UTC"],
              ["Microsoft Teams", "Candidate notifications", "Outbound", "Graph API / Bot Framework", "Real-time"],
              ["Custom Data Warehouse (Snowflake)", "Full data export", "Outbound", "JDBC / Snowpipe", "Nightly"],
            ]
          ),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          h2("2.3 Data Model Requirements"),
          bullet("Candidate profiles must conform to the HR Open Standards Consortium (HR-Open) Candidate schema v4.3"),
          bullet("All PII fields must be tagged with GDPR lawful basis and data-subject-rights flags"),
          bullet("Assessment results must be exportable as JSON-LD with schema.org/EducationalOccupationalCredential context"),
          bullet("Vendor must provide a full entity-relationship diagram and data dictionary as part of the proposal"),

          h2("3. Security Requirements"),
          simpleTable(
            ["Control", "Requirement", "Evidence Required"],
            [
              ["Penetration testing", "Annual external pen test by CREST-accredited firm", "Report summary (last 12 months)"],
              ["Vulnerability management", "Critical CVEs patched within 24 hours", "SLA commitment in contract"],
              ["Encryption at rest", "AES-256 for all PII and assessment content", "Architecture diagram"],
              ["Encryption in transit", "TLS 1.3 minimum; TLS 1.2 with approved cipher suites", "TLS scan report"],
              ["Access control", "RBAC with principle of least privilege; MFA enforced for admins", "Config screenshots"],
              ["Audit logging", "Immutable audit log; 2-year retention; SIEM-exportable (CEF/LEEF)", "Log sample"],
              ["GDPR / data subjects", "Right to erasure within 30 days; DPA available for countersigning", "Sample DPA"],
              ["Sub-processors", "List of all sub-processors; prior written consent required for changes", "Sub-processor list"],
            ]
          ),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          h2("4. Performance & Scalability"),
          body("The following benchmarks must be demonstrated in a live proof-of-concept (POC) environment during evaluation:"),
          bullet("10,000 concurrent assessment takers without degradation"),
          bullet("API response time p99 < 500 ms for all read operations"),
          bullet("Assessment result sync to Workday within 5 minutes of completion"),
          bullet("Bulk import of 50,000 candidate records completed within 30 minutes"),

          h2("5. Accessibility & Localisation"),
          bullet("WCAG 2.1 Level AA conformance — third-party audit report required"),
          bullet("Right-to-left (RTL) language support: Arabic, Hebrew"),
          bullet("Localised UI in: English, French, German, Spanish, Mandarin, Japanese, Arabic"),
          bullet("Assessment content delivery in all 7 languages above with automatic locale detection"),

          h2("6. Vendor Evaluation — Technical Scoring"),
          body("Technical scoring (60% of total RFP score) will be assessed across these dimensions:"),
          simpleTable(
            ["Dimension", "Max Points", "Assessment Method"],
            [
              ["API completeness & documentation quality", "20", "Document review + sandbox API testing"],
              ["Security certifications & controls", "15", "Certification review + security questionnaire"],
              ["Integration with Azure AD + Workday", "10", "Live POC demonstration"],
              ["Data model flexibility & export", "8", "Schema review + sample export"],
              ["Performance benchmark results", "7", "POC load test results"],
            ]
          ),
          new Paragraph({ text: "", spacing: { after: 200 } }),

          h2("7. POC Requirements"),
          body("Shortlisted vendors (max 3) will be invited to a 2-week POC. The POC must demonstrate:"),
          bullet("Full SSO login flow via GlobalTech's Azure AD tenant (test environment)"),
          bullet("End-to-end assessment: create → assign → complete → sync result to Workday sandbox"),
          bullet("Load test: 1,000 concurrent users for 30 minutes (vendor to provide test plan)"),
          bullet("Data erasure request: submit GDPR erasure → confirm deletion within the 30-day SLA"),
          bullet("Snowflake export: nightly job delivering all assessment data to GlobalTech's Snowflake sandbox"),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(`${OUT}/globaltech-technical-spec.docx`, buf);
  console.log("✓  globaltech-technical-spec.docx");
}

// ─── Doc 3: GlobalTech Inc Vendor Evaluation Matrix (XLSX) ──────────────────

function genEvaluationMatrix() {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Functional Requirements Checklist
  const funcData = [
    ["REQ ID", "Category", "Requirement", "Priority", "Vendor Response", "Evidence/Notes", "Score (0–5)"],
    ["FR-001", "Assessment Engine", "Supports coding assessments in 15+ programming languages", "Must Have", "", "", ""],
    ["FR-002", "Assessment Engine", "Supports MCQ, free-text, video-response, and case-study formats", "Must Have", "", "", ""],
    ["FR-003", "Assessment Engine", "Adaptive difficulty adjustment based on real-time performance", "Should Have", "", "", ""],
    ["FR-004", "Proctoring", "AI-based anomaly detection during live assessments", "Must Have", "", "", ""],
    ["FR-005", "Proctoring", "Human reviewer escalation workflow for flagged sessions", "Must Have", "", "", ""],
    ["FR-006", "Proctoring", "Browser lockdown / secure browser mode", "Should Have", "", "", ""],
    ["FR-007", "Question Library", "Pre-built library ≥ 50,000 validated items", "Must Have", "", "", ""],
    ["FR-008", "Question Library", "Coverage across ≥ 120 skill domains", "Must Have", "", "", ""],
    ["FR-009", "Question Library", "Quarterly content refresh with version history", "Should Have", "", "", ""],
    ["FR-010", "Authoring", "Self-service assessment builder for non-technical HR users", "Must Have", "", "", ""],
    ["FR-011", "Authoring", "Import questions from CSV / Excel template", "Should Have", "", "", ""],
    ["FR-012", "Authoring", "Question review and approval workflow", "Nice to Have", "", "", ""],
    ["FR-013", "Reporting", "Role-based dashboards (recruiter, HM, L&D BP)", "Must Have", "", "", ""],
    ["FR-014", "Reporting", "Candidate score benchmarking against industry norms", "Must Have", "", "", ""],
    ["FR-015", "Reporting", "Skills-gap heatmap at team and BU level", "Should Have", "", "", ""],
    ["FR-016", "Reporting", "Custom report builder with scheduled email delivery", "Nice to Have", "", "", ""],
    ["FR-017", "Skills Taxonomy", "ESCO framework alignment", "Should Have", "", "", ""],
    ["FR-018", "Skills Taxonomy", "Custom taxonomy import and mapping", "Should Have", "", "", ""],
    ["FR-019", "Integrations", "Workday HCM bidirectional sync", "Must Have", "", "", ""],
    ["FR-020", "Integrations", "Salesforce CRM — results as custom objects", "Must Have", "", "", ""],
    ["FR-021", "Integrations", "SSO via SAML 2.0 and OAuth 2.0", "Must Have", "", "", ""],
    ["FR-022", "Integrations", "REST API with OpenAPI 3.0 documentation", "Must Have", "", "", ""],
    ["FR-023", "Integrations", "Webhooks for real-time events", "Must Have", "", "", ""],
    ["FR-024", "Candidate Experience", "Mobile-responsive assessment UI", "Must Have", "", "", ""],
    ["FR-025", "Candidate Experience", "Assessment available offline (cached) with sync on reconnect", "Nice to Have", "", "", ""],
  ];

  const wsFunc = XLSX.utils.aoa_to_sheet(funcData);
  wsFunc["!cols"] = [
    { wch: 10 }, { wch: 22 }, { wch: 60 }, { wch: 14 },
    { wch: 25 }, { wch: 30 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsFunc, "Functional Requirements");

  // Sheet 2: Technical Scorecard
  const techData = [
    ["DIMENSION", "MAX SCORE", "ACME CORP SCORE", "GLOBALTECH SCORE", "NOTES"],
    ["API completeness & documentation", 20, "", "", ""],
    ["Security certifications (ISO 27001, SOC 2 Type II)", 15, "", "", ""],
    ["Azure AD + Workday integration depth", 10, "", "", ""],
    ["Data model flexibility & export (Snowflake)", 8, "", "", ""],
    ["Performance benchmark (POC load test)", 7, "", "", ""],
    ["WCAG 2.1 AA accessibility audit", 5, "", "", ""],
    ["Localisation coverage (7 languages)", 5, "", "", ""],
    ["Disaster recovery (RPO/RTO evidence)", 5, "", "", ""],
    ["Roadmap alignment with GTI requirements", 5, "", "", ""],
    ["TOTAL", 80, "=SUM(C3:C11)", "=SUM(D3:D11)", ""],
  ];

  const wsTech = XLSX.utils.aoa_to_sheet(techData);
  wsTech["!cols"] = [
    { wch: 45 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTech, "Technical Scorecard");

  // Sheet 3: Commercial Summary
  const commData = [
    ["COMMERCIAL SUMMARY — GTI-2026-RFP-047"],
    [],
    ["Line Item", "Year 1 (USD)", "Year 2 (USD)", "Year 3 (USD)", "3-Year Total (USD)", "Notes"],
    ["Platform licence (per seat × 22,000)", "", "", "", "", "Volume discount expected at this seat count"],
    ["Implementation & onboarding", "", "", "", "N/A", "One-time cost"],
    ["Training (admin + end-user)", "", "", "", "N/A", "Included or itemised?"],
    ["API / integration connectors", "", "", "", "", "Workday, Salesforce, Azure AD, Snowflake"],
    ["Premium support (24×7 SLA)", "", "", "", "", "Required — include in base or add-on"],
    ["Localisation (7 languages)", "", "", "", "", ""],
    ["Data migration from Taleo", "", "", "", "N/A", "One-time migration service"],
    ["Contingency (10%)", "", "", "", "", ""],
    [],
    ["TOTAL (USD)", "=SUM(B4:B13)", "=SUM(C4:C13)", "=SUM(D4:D13)", "=SUM(E4:E13)", ""],
    [],
    ["Payment Terms Required", "Net 60"],
    ["Currency", "USD"],
    ["Price Lock", "3 years — CPI cap 3% p.a."],
    ["Early Termination", "6 months notice; no penalty after Year 1"],
  ];

  const wsComm = XLSX.utils.aoa_to_sheet(commData);
  wsComm["!cols"] = [
    { wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 38 },
  ];
  wsComm["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  XLSX.utils.book_append_sheet(wb, wsComm, "Commercial Summary");

  // Sheet 4: Milestone Plan
  const milestoneData = [
    ["IMPLEMENTATION MILESTONE PLAN"],
    [],
    ["Phase", "Milestone", "Owner", "Target Date", "Status", "Dependencies"],
    ["1 — Kickoff", "Contract signed & project charter issued", "GTI Procurement", "15 Sep 2026", "Not Started", ""],
    ["1 — Kickoff", "Project team introductions & RACI confirmed", "Both", "22 Sep 2026", "Not Started", "Contract signed"],
    ["1 — Kickoff", "Technical kick-off: API credentials, sandbox access", "Vendor", "29 Sep 2026", "Not Started", "Project charter"],
    ["2 — Integration", "Azure AD SSO configured & tested", "Vendor + GTI IT", "20 Oct 2026", "Not Started", "Sandbox access"],
    ["2 — Integration", "Workday HCM sync — Phase 1 (employee master)", "Vendor", "03 Nov 2026", "Not Started", "SSO complete"],
    ["2 — Integration", "Salesforce CRM connector deployed", "Vendor", "17 Nov 2026", "Not Started", ""],
    ["2 — Integration", "Snowflake nightly export validated", "Vendor + GTI Data", "01 Dec 2026", "Not Started", ""],
    ["3 — Data Migration", "Taleo candidate data extracted (GTI IT)", "GTI IT", "15 Oct 2026", "Not Started", ""],
    ["3 — Data Migration", "Candidate data cleansed & mapped to vendor schema", "GTI HR Ops", "05 Nov 2026", "Not Started", "Data extracted"],
    ["3 — Data Migration", "Migration dry-run in staging", "Vendor", "25 Nov 2026", "Not Started", "Mapping complete"],
    ["3 — Data Migration", "Production migration & validation", "Both", "15 Dec 2026", "Not Started", "Dry-run passed"],
    ["4 — UAT", "HR Admin UAT — assessment authoring", "GTI L&D", "10 Jan 2027", "Not Started", ""],
    ["4 — UAT", "Recruiter UAT — end-to-end assessment flow", "GTI TA", "17 Jan 2027", "Not Started", ""],
    ["4 — UAT", "Performance load test (10,000 concurrent users)", "Vendor + GTI IT", "24 Jan 2027", "Not Started", ""],
    ["4 — UAT", "UAT sign-off", "GTI Programme Sponsor", "31 Jan 2027", "Not Started", "All UAT passed"],
    ["5 — Go Live", "Phased rollout — APAC (pilot 500 users)", "Both", "14 Feb 2027", "Not Started", "UAT sign-off"],
    ["5 — Go Live", "Rollout — EMEA", "Both", "07 Mar 2027", "Not Started", "APAC stable"],
    ["5 — Go Live", "Rollout — Americas + full global", "Both", "28 Mar 2027", "Not Started", "EMEA stable"],
    ["5 — Go Live", "Hypercare period ends; BAU support commences", "Vendor", "30 Apr 2027", "Not Started", "Full rollout"],
  ];

  const wsMile = XLSX.utils.aoa_to_sheet(milestoneData);
  wsMile["!cols"] = [
    { wch: 22 }, { wch: 50 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 30 },
  ];
  wsMile["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  XLSX.utils.book_append_sheet(wb, wsMile, "Milestone Plan");

  XLSX.writeFile(wb, `${OUT}/vendor-evaluation-matrix.xlsx`);
  console.log("✓  vendor-evaluation-matrix.xlsx");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

await genAcmeRFP();
await genGlobalTechSpec();
genEvaluationMatrix();

console.log(`\nAll documents written to ./${OUT}/`);
console.log("Upload each file via the bid Documents panel to test AI indexing.");
