# Bid Upload Modal + @ Mention in AI Chat

## Upload modal from bid context (prefilledBidId)

When `UploadModal` is opened from a bid's Documents panel (`prefilledBidId` is set), hide both **Document Type** and **Stage (Optional)** selectors — user shouldn't need to tag either when uploading directly to a bid. Default `docType` to `"rfp"` in that context.

Fields hidden when `prefilledBidId` is set:
- Document Type selector
- Stage (Optional) selector

## @ mention in AI chat (bid mode)

When user is in a bid AI session and types `@`, show a dropdown of documents scoped to that bid. Selecting a doc (click or Enter) inserts `@filename` into the message. On send, the mentioned doc IDs are resolved and their indexed chunks are force-injected into the system prompt as a "Pinned Documents" block — so the AI has full access to them without needing a RAG search round.

### Implementation notes
- Parse `@filename` tokens from the message before sending → match against `useDocuments({ bidId })`
- Pass `mentionedDocIds: string[]` through `streamChat` → `streamChatFn` (InputSchema)
- Server fetches chunks via `bid_document_chunks` joined with `bid_documents` for matched docIds
- Inject as a non-cached system block appended after `buildSystemBlocks(bidId)` result
- Dropdown floats above the input, filters by text typed after `@`, closes on Escape or click-outside
- Global mode: no `@` mention (no bid-scoped docs available)
