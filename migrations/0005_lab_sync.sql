-- Settings lab: snapshots sent from a player's PC, and the tokens that let one
-- PC send them. Apply once:
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0005_lab_sync.sql
-- (safe to run again: every statement is IF NOT EXISTS)
--
-- owner is the same key in all three lab tables: the lowercased email from the
-- verified Access token (_lib/lab.js lowercases it), so lab_tests, lab_snapshots
-- and lab_tokens line up on one person. Rows written before 0004 have a NULL
-- owner and belong to nobody.

CREATE TABLE IF NOT EXISTS lab_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,          -- the signed-in person's lowercased email
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex of the token; the token itself is never stored
  label TEXT,                   -- what the person calls that PC
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,            -- last accepted sync from this PC
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_tokens_owner ON lab_tokens(owner);

CREATE TABLE IF NOT EXISTS lab_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  taken_at TEXT NOT NULL,       -- when the PC read its config, as the agent reported it
  payload TEXT NOT NULL,        -- the accepted sync body, canonical JSON
  payload_hash TEXT NOT NULL,   -- SHA-256 hex of payload, for spotting a repeat
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_snapshots_owner ON lab_snapshots(owner, created_at);
