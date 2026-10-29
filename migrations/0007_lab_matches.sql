-- Settings lab: one row per match, so a stretch of play has a mode.
-- Apply once:
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0007_lab_matches.sql
-- (every statement is IF NOT EXISTS, so running it again is harmless)
--
-- owner is the same key as in the other lab tables: the lowercased email from
-- the verified Access token (_lib/lab.js lowercases it).
--
-- match_key is a hash of owner + the game's own GameSessionID, and it carries
-- the UNIQUE index. The game writes one GameSessionID per match, so the same
-- match sent twice - the agent re-reads a tail it already read after a restart -
-- collapses onto the row already there instead of counting twice. The UNIQUE
-- index is what makes that true under concurrency, not just on the happy path.
--
-- Everything here is nullable except the key, because the log only says what it
-- says. A match joined in progress has no settings block behind it, so its mode
-- columns stay NULL; a match with no rank update line has no rank. NULL means
-- "the log did not say", and it is never written as 0 or as a guess.
--
-- What is deliberately NOT here: kills, damage, accuracy, headshots, placement.
-- The log does not contain them. See tools/zoi-lab-mode.mjs for the check that
-- established this.

CREATE TABLE IF NOT EXISTS lab_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,              -- the signed-in person's lowercased email
  match_key TEXT NOT NULL,          -- SHA-256 hex of owner + GameSessionID
  playlist TEXT,                    -- PlaylistName verbatim, e.g. Playlist_NoBuildBR_Habanero_Solo
  playlist_type TEXT,               -- PlaylistType from the same block, e.g. 'ZeroBuild'; used to check a rank ladder belongs
  ranked TEXT,                      -- 'Ranked' | 'Unranked', or NULL when no settings block proved it
  build_mode TEXT,                  -- 'Zero' | 'Build', or NULL
  team_size TEXT,                   -- 'Solo' | 'Duo' | 'Trio' | 'Squad', or NULL
  region TEXT,                      -- 'NA' etc, as the log wrote it, or NULL
  rank_type TEXT,                   -- e.g. 'ranked-br-combined' or 'ranked-blastberry-combined'
  rank INTEGER,                     -- the rank the game reported after the match; NULL when no such line
  players_left_low INTEGER,         -- lowest 'N Left' seen during the match; NOT a placement
  players_left_first INTEGER,       -- 'N Left' at kickoff, only when the first reading was within two minutes of it
  players_left_readings INTEGER,    -- how many distinct 'N Left' readings the low was taken from
  started_at TEXT,                  -- ISO-8601 UTC, the moment the match was assigned
  ended_at TEXT,                    -- ISO-8601 UTC, the match-end marker's timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per match per person. Also the index every read uses, since the
-- newest matches for one owner are what the page and the session labelling want.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_matches_owner_key ON lab_matches(owner, match_key);
CREATE INDEX IF NOT EXISTS idx_lab_matches_owner_ended ON lab_matches(owner, ended_at);
