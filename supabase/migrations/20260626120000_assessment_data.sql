-- Add assessment_data column to bids for Deal Qualification subtab
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS assessment_data jsonb NOT NULL DEFAULT '{}'::jsonb;
