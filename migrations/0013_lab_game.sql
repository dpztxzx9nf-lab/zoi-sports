-- Scope lab tests and snapshots by game, and add a manual COD match log.
-- Existing Fortnite rows are tagged so they keep working without a code change
-- on every insert: the column defaults to 'fortnite'.
--
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0013_lab_game.sql

ALTER TABLE lab_tests ADD COLUMN game TEXT NOT NULL DEFAULT 'fortnite';
ALTER TABLE lab_snapshots ADD COLUMN game TEXT NOT NULL DEFAULT 'fortnite';

CREATE INDEX IF NOT EXISTS idx_lab_tests_owner_game ON lab_tests(owner, game, started_at);
CREATE INDEX IF NOT EXISTS idx_lab_snapshots_owner_game ON lab_snapshots(owner, game, id);

-- One row per match the player logs by hand. COD writes no replay file we can
-- parse, so this is the outcome source. `mode` is a catalog id (dmz, tdm, ...).
-- extracted is 1 or 0 for DMZ and null otherwise; won is 1 or 0 for
-- multiplayer and Warzone, and null for DMZ. The two are never mixed.
CREATE TABLE IF NOT EXISTS lab_cod_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  played_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  kills INTEGER NOT NULL,
  extracted INTEGER,
  won INTEGER,
  deaths INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_owner ON lab_cod_matches(owner, played_at);
CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_owner_mode ON lab_cod_matches(owner, mode, played_at);
