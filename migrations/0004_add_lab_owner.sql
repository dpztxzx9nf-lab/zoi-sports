-- Settings lab: each test belongs to the person who started it. Apply once:
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0004_add_lab_owner.sql
-- (already applied to the remote database; kept here so the schema is reproducible)
ALTER TABLE lab_tests ADD COLUMN owner TEXT;
CREATE INDEX IF NOT EXISTS idx_lab_owner ON lab_tests(owner, started_at);
