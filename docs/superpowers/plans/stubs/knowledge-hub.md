# Knowledge Hub — Stub Plan
_Status: PENDING — requires design session before implementation_
_Created: 2026-06-05_
_Current route: `/docs` (placeholder)_

## Goal
Document management for bid-related files: RFP PDFs, templates, past proposals, legal docs. Users can upload, tag, search, and preview documents associated with specific bids.

## Proposed Features
- Upload documents (PDF, DOCX, XLSX) per bid or as global templates
- Tag documents by type (RFP, Proposal, Legal, Template, Reference)
- Full-text search across documents
- Preview inline (PDF viewer) or download
- Link documents to specific bid stages

## Backend Requirements
- **Supabase Storage:** bucket `bid-documents` with RLS (org-scoped)
- **Supabase Vector (pgvector):** optional, for semantic search / AI context
- **New table:** `bid_documents`

## Proposed New Tables
```sql
bid_documents (
  id uuid pk,
  bid_id uuid fk bids nullable,  -- null = global template
  name text,
  type text,  -- 'rfp' | 'proposal' | 'legal' | 'template' | 'reference'
  stage text nullable,
  storage_path text,
  size_bytes int,
  uploaded_by uuid fk profiles,
  created_at timestamptz
)
```

## Key Questions Before Building
1. Global templates vs bid-scoped only?
2. PDF preview in-app or download-only?
3. AI-readable (vector embeddings for AI Command Center context)?
4. Version history for documents?

## Rough Effort
~4–6 days: storage setup, upload UI, document list, tagging, optional preview.

## Dependencies
- Supabase Storage bucket created and RLS configured
- Optional: pgvector extension enabled for semantic search
