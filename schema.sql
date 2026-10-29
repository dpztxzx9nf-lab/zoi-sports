-- The whole D1 schema for zoi-tryouts (binding DB): what a brand-new database
-- needs to be usable, in one file.
--
-- This is the end state of migrations/ 0002 through 0008 applied to the
-- original applications table, not a replay of them. The migrations are the
-- history and stay the record of how the tables got here; this file is what a
-- fresh database should look like when the history is over. Replaying 0002
-- verbatim would fail here, because the base applications table in this file
-- already carries the game column that migration adds.
--
-- wrangler d1 execute zoi-tryouts --remote --file schema.sql

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  epic_name TEXT NOT NULL, discord TEXT NOT NULL, region TEXT NOT NULL, platform TEXT NOT NULL,
  age INTEGER NOT NULL, role TEXT NOT NULL, results_link TEXT, clips_link TEXT,
  why TEXT NOT NULL, email TEXT, ip_hash TEXT, user_agent TEXT, game TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_ip_time ON applications(ip_hash, created_at);

-- The lab: one row per setting trial, per saved config, per Epic stats read, and
-- per match the agent parsed out of the game log. Every one is scoped by owner,
-- the signed-in email, so one person's lab never reads another's.

CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting TEXT NOT NULL,
  label TEXT NOT NULL,
  from_value TEXT NOT NULL,
  to_value TEXT NOT NULL,
  watch_for TEXT,
  games_planned INTEGER,
  games_played INTEGER,
  status TEXT NOT NULL DEFAULT 'testing',
  result_note TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  owner TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_setting ON lab_tests(setting, started_at);
CREATE INDEX IF NOT EXISTS idx_lab_status ON lab_tests(status);
CREATE INDEX IF NOT EXISTS idx_lab_owner ON lab_tests(owner, started_at);

-- Tokens are stored hashed: a copy of this table cannot be turned back into a
-- working token. last_seen_at is what the settings page shows as "last sync".
CREATE TABLE IF NOT EXISTS lab_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at TEXT,
  epic_account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_tokens_owner ON lab_tokens(owner);

CREATE TABLE IF NOT EXISTS lab_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_snapshots_owner ON lab_snapshots(owner, created_at);

CREATE TABLE IF NOT EXISTS lab_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  epic_account_id TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  matches INTEGER,
  wins INTEGER,
  kills INTEGER,
  deaths INTEGER,
  kd REAL,
  win_rate REAL,
  minutes_played INTEGER,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_stats_owner ON lab_stats(owner, created_at);

-- A match is identified by the hash of its own id from the log, unique per
-- owner, so a re-sync of the same log adds nothing rather than a second copy.
CREATE TABLE IF NOT EXISTS lab_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  match_key TEXT NOT NULL,
  playlist TEXT,
  playlist_type TEXT,
  ranked TEXT,
  build_mode TEXT,
  team_size TEXT,
  region TEXT,
  rank_type TEXT,
  rank INTEGER,
  players_left_low INTEGER,
  players_left_first INTEGER,
  players_left_readings INTEGER,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT,
  title TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_matches_owner_key ON lab_matches(owner, match_key);
CREATE INDEX IF NOT EXISTS idx_lab_matches_owner_ended ON lab_matches(owner, ended_at);
