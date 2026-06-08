---
name: iMocha Proposal Generator
description: Generate a branded iMocha .docx proposal by cloning the master template (preserving design, fonts, colors, logos) and applying client-specific content. Use for any iMocha TA or TM proposal or RFP response.
---

# iMocha Proposal Generator

Produce a client-ready .docx proposal for iMocha's Talent Acquisition (TA) or Talent Management / Skills Intelligence (TM) products. This skill clones the iMocha master template and edits only its body content — all branding (cover page, fonts, theme, colors, logos, headers, footers, embedded images) is preserved automatically.

## When to use
Trigger when the user asks for:
- "Generate an iMocha proposal for <customer>"
- "Create a TA / TM / Skills-First proposal"
- "Respond to this RFP" in an iMocha context
- Anything that produces a branded iMocha business proposal as a Word document

## The two rules
1. **Clone, never rebuild.** The output .docx is produced by cloning the master template and editing only `word/document.xml` (plus name-only edits to `word/header*.xml` / `word/footer*.xml`). NEVER use `docx-js` or any "build from scratch" approach. The script enforces this and validates after.
2. **Truth via template.** Every iMocha capability claim, statistic, certification, integration, or feature description must come from the master template verbatim or from user-provided input. Never invent numbers, customers, certifications, or capabilities.

## Prerequisites
- Code execution must be enabled (it is, since this skill runs scripts).
- The iMocha master template (.docx) must be present at `/mnt/user-data/uploads/`. If the user hasn't attached it, ask them to attach it before continuing. Do not proceed without it.

## Workflow

### 1. Locate the master template
Look in `/mnt/user-data/uploads/` for a file matching `*Proposal*Template*.docx` or `Skills-First*.docx`. If none found, STOP and ask the user to attach the master. Do not proceed; do not rebuild.

Quickly verify the file is the real branded master: `unzip -l <file> | grep -c word/media/` should be > 0 and `word/theme/` should be present. If `media/` is empty or `theme/` is missing, warn the user that the file looks like a previous output rather than the brand master, and ask them to attach the original.

### 2. Identify the product
- TA = hiring, recruitment, candidate assessment, screening, proctoring.
- TM = skills intelligence, competency, gaps, upskilling, internal mobility, skill inference.
If unclear from the user's brief, ask once: "Is this for Talent Acquisition (TA) or Talent Management / Skills Intelligence (TM)?"

### 3. Gather intake
Collect ALL of the inputs below in ONE consolidated request. If the user already provided a requirement summary or RFP excerpt, extract first; only ask for what is genuinely missing. Do not invent values.

Cover and Exec Summary fields:
- RFP / Opportunity name (if not given, draft a plausible one like "<Customer> <Product> Platform RFP" and flag for confirmation in Open Items)
- Customer display name
- Prepared For — contact name & title (use `[TO PROVIDE: ...]` if unknown)
- Sales SPOC name & email (use `[TO PROVIDE: ...]` if unknown)

Content fields:
- Customer goals and key requirements (drives the Executive Summary)
- Out-of-scope exclusions — capabilities explicitly NOT in scope (must be surfaced in Exec Summary and Scope intro)
- Target roles / job families (TA) or competency domains / workforce use cases (TM)
- Integration systems in the customer's stack (HRMS/HCM, ATS, LMS/LXP, SSO, BI)
- Implementation timeline / go-live constraints
- Pricing / commercial model (if to be included)

### 4. Author variable content
Write the prose for the proposal in iMocha's enterprise B2B voice. See `reference/voice_guide.md` for tone, structure, and what to avoid. Author:

- **Executive Summary** — three paragraphs: *pleased* (introducing the product) / *aligned* (restating customer requirements + surfacing out-of-scope exclusions) / *confident* (proof points + commercial framing).
- **Scope of Work intro** — one paragraph stating in-scope work; closes with an explicit out-of-scope statement.
- **Section 2.1 In-scope Key Deliverables** — 8–12 bullets mapping the customer's stated requirements to template-supported iMocha capabilities. End with a final bullet restating exclusions if any.

### 5. Build the intake JSON
Assemble all collected and authored content into a JSON file matching the schema in `reference/substitution_map.json`. Save to `/tmp/intake.json`.

### 6. Run the generator script
```
python scripts/generate_proposal.py \
    --master /mnt/user-data/uploads/<master_filename>.docx \
    --intake /tmp/intake.json \
    --output /mnt/user-data/outputs/iMocha_Proposal_<CustomerDisplayName>_<TA|TM>_DRAFT.docx
```

The script:
- Clones and unpacks the master
- Discovers the template's existing bullet pattern (numId, font, size) from a real bulleted paragraph
- Applies substitutions in safe order (composite tokens like `Customer Name (CUSTOMER NAME)` BEFORE the individual tokens they contain)
- Injects the deliverables as bullets under section 2.1 using the discovered pattern
- Substitutes the customer/RFP name in header/footer XML (only)
- Verifies that ONLY `document.xml` and the modified header/footer differ from the original
- Confirms image count, theme, header/footer count survived
- Repacks and validates

If the script raises an error (e.g., "Heading not found"), inspect the master with `extract-text` to understand the actual headings, then adapt the heading text in the inject call. NEVER silently fall back to a rebuild.

### 7. Present and report back
- Present the file from `/mnt/user-data/outputs/` to the user.
- List **Open Items** in chat:
  - Every `[TO PROVIDE: ...]` placeholder left in the doc (cover names, etc.)
  - Any drafted defaults the user should confirm (e.g., the RFP name if you drafted one)
  - Any judgment calls you made (display name format, exclusions framing)
  - Any sections you trimmed via selective inclusion
- Keep the doc body itself client-ready — no meta-commentary inside it.

## TM handling (until a dedicated TM master exists)
If product = TM and no TM-specific master is in uploads, clone the TA master as the design carrier. The Section 3 "iMocha Solution" content in the TA master is TA-specific (assessments, proctoring) and must be replaced with TM Solution content (skills inference engine, taxonomy, confidence/proficiency, competency framework, skill-gap & internal-mobility, Skill Inventory dashboards). When injecting TM Solution paragraphs, every new paragraph must reference an existing template `<w:pStyle>` ID — NEVER inline font/color/size on runs. Where TM solution detail is missing from intake, insert `[TO PROVIDE: TM detail — <topic>]` rather than fabricating.

## Resources
- `scripts/generate_proposal.py` — main deterministic generator (clone, edit, validate, pack)
- `reference/substitution_map.json` — intake schema + TA placeholder catalog
- `reference/voice_guide.md` — proposal voice and structure guidance
