-- Settings lab: matches and wins, read from the player's own Epic account.
-- Apply once:
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0006_lab_stats.sql
-- (every CREATE is IF NOT EXISTS; the ADD COLUMN is one-time, as in 0004)
--
-- owner is the same key in all three lab tables: the lowercased email from the
-- verified Access token (_lib/lab.js lowercases it), so lab_tests, lab_snapshots,
-- lab_tokens and lab_stats line up on one person. epic_account_id is that same
-- person's Epic id, 32 lowercase hex characters, discovered by the PC agent from
-- its Saved\Cloud\<id>\ folder so nobody types it.

ALTER TABLE lab_tokens ADD COLUMN epic_account_id TEXT;

CREATE TABLE IF NOT EXISTS lab_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,              -- the signed-in person's lowercased email
  epic_account_id TEXT NOT NULL,    -- whose numbers these are
  taken_at TEXT NOT NULL,           -- when the API last changed them, or when they were read
  matches INTEGER,                  -- cumulative for the account, not per session
  wins INTEGER,
  kills INTEGER,
  deaths INTEGER,
  kd REAL,
  win_rate REAL,                    -- 0..1 as the API reports it
  minutes_played INTEGER,
  raw TEXT,                         -- the per-playlist breakdown, canonical JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_stats_owner ON lab_stats(owner, created_at);
