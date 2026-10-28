-- Settings lab: the private test log behind /lab. Apply once:
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0003_add_lab.sql
CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting TEXT NOT NULL,          -- canonical setting id, e.g. scoped_multiplier
  label TEXT NOT NULL,            -- human label, e.g. Scope Multiplier
  from_value TEXT NOT NULL,       -- baseline value as a string, e.g. "0.95"
  to_value TEXT NOT NULL,         -- value under test
  watch_for TEXT,                 -- what he's looking for, written before playing
  games_planned INTEGER,
  games_played INTEGER,
  status TEXT NOT NULL DEFAULT 'testing',  -- testing | kept | reverted | inconclusive
  result_note TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_setting ON lab_tests(setting, started_at);
CREATE INDEX IF NOT EXISTS idx_lab_status ON lab_tests(status);
