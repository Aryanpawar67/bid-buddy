-- Extend deliverable_type enum with real-world values missing from the original set.
-- ALTER TYPE ... ADD VALUE is non-transactional in Postgres — each must be a separate statement.
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'presentation';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'meeting';
ALTER TYPE deliverable_type ADD VALUE IF NOT EXISTS 'other';
