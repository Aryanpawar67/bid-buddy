# Note: Proposal Export Gap

**Date:** 2026-06-06
**Status:** Needs brainstorm session before implementation

## The Gap

The AI Command Center generates proposal content as chat text — users must manually copy it into Word/Google Docs. There is no one-click "export as DOCX/PDF" from an AI-generated response.

This was flagged during the Agentic RAG reliability review. At the scale of 10–15 global knowledge docs + per-bid customer RFPs, the AI will produce high-quality draft proposal sections — but the last step (formatting and delivering a structured document) remains manual.

## Where It Surfaces

1. **RFP stage** — pre-sales asks the AI to draft sections (executive summary, technical approach, win themes, scope of work). Output is chat text; they copy-paste into a proposal template.
2. **BAFO stage** — revised pricing/scope responses drafted in chat but not exportable.
3. **Legal/Finance review** — teams reviewing a deal cannot pull a clean structured document from the AI session; they work from whatever the pre-sales team sent them separately.

## What the Fix Would Look Like

- A "Download" or "Copy as document" button on assistant messages (or a "Generate proposal" quick action).
- Server-side assembly: parse the response + bid metadata into a structured template (sections: cover, executive summary, technical approach, commercials, team, appendix).
- Output: DOCX via `docx` npm package, or PDF via headless rendering.
- The resulting file could be auto-uploaded to the bid's Knowledge Hub (`bid_documents`) so it appears in the docs list and is searchable in future sessions.

## Open Questions

1. Should export produce a DOCX (editable), PDF (presentable), or both?
2. Do we have a proposal template (branding, section order) to code against, or is it free-form?
3. Is export scoped to a single message, a full session, or a curated set of messages?
4. Does the exported file go into the Knowledge Hub automatically, or is it just a browser download?
5. Should legal/finance be able to trigger their own export, or only pre-sales/admin?
6. Is this a Phase 2.7 or part of a later "Proposal Builder" milestone?

## Related

- Feature 2.5 — AI Command Center (chat engine)
- Feature 2.6 — Agentic RAG (retrieval quality)
- Feature 2.3 — Knowledge Hub (document storage — likely the target for auto-upload)
