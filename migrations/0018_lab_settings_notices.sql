-- Which settings snapshot each person was last told about, per game.
--
-- The PC agent sends a snapshot whenever a game starts or stops and whenever a
-- config file changes, and lab-sync only stores one when a value actually moved.
-- A daily cloud check compares the newest stored snapshot with the one recorded
-- here, says what moved (old -> new), and then records the newest as notified.
-- That needs nothing from the PC at check time.
--
-- The payload is copied rather than referenced, because lab_snapshots keeps
-- only the newest 200 rows per person and the baseline must survive pruning.
-- notified_at is NULL for a baseline that was seeded, not reported.
--
-- Apply once:
--   wrangler d1 execute zoi-tryouts --remote --file migrations/0018_lab_settings_notices.sql
-- (safe to run again: IF NOT EXISTS and INSERT OR IGNORE)

CREATE TABLE IF NOT EXISTS lab_settings_notices (
  owner TEXT NOT NULL,
  game TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL,
  taken_at TEXT,
  payload TEXT NOT NULL,
  notified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner, game)
);

-- Baseline: each person's oldest complete snapshot per game. For Fortnite that
-- is the first full read after the last weekly check (2026-10-28), so nothing
-- that moved since then is skipped. A Fortnite read with no bindings is the
-- half-read lab-sync now refuses (a locked save), so it is never the baseline.
INSERT OR IGNORE INTO lab_settings_notices (owner, game, snapshot_id, taken_at, payload, notified_at)
SELECT s.owner, s.game, s.id, s.taken_at, s.payload, NULL
  FROM lab_snapshots s
 WHERE s.id = (SELECT MIN(id) FROM lab_snapshots t WHERE t.owner = s.owner AND t.game = s.game
                 AND (t.game <> 'fortnite' OR instr(t.payload, '"bindings"') > 0));
