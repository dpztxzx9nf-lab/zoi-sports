-- Settings lab: what the replay file says about one match.
-- Apply once:
--   wrangler d1 execute zoi-tryouts --remote --file migrations/0009_add_replay_stats.sql
-- (both statements are CREATE ... IF NOT EXISTS, so running it again is harmless)
--
-- Why a second table rather than columns on lab_matches
-- ----------------------------------------------------
-- lab_matches is built from the log, and the log does not contain kills, damage,
-- accuracy or placement. The replay file does. The two arrive separately: the
-- replay lands on disk seconds after a match ends, while the log's match record
-- is held until its rank line shows up, so either can be stored first and a
-- replay can be stored before there is any match to attach it to. A column on
-- lab_matches would therefore have to be written by two different readers at two
-- different times, and the second writer would be racing the first for the whole
-- row. One row per replay, joined by time, keeps each writer to its own table.
--
-- match_id is the join and it is nullable on purpose. A replay that finds no
-- match within the tolerance is stored with a null match_id - not discarded, and
-- not used to invent a match. It is re-attached later, by the same statement
-- that inserts it, if the match row turns up on a subsequent sync.
--
-- recorded says whether the numbers beside it are measurements. A Creative
-- replay writes an AthenaMatchStats event that is empty and never writes
-- AthenaMatchTeamStats at all, so its row carries recorded = 0, creative = 1,
-- every measurement NULL, and a reason. A zero is never stored in place of a
-- reading that was not there: the lab has already been burned once by that.
--
-- accuracy_pairs is what keeps a null pair honest. The event stores accuracy as
-- a 32-bit float, so 43 of 207 and 86 of 414 are the same number to it; the pair
-- is recovered by finding those fractions again, and on most real matches more
-- than one fits. A row with a null hit count and accuracy_pairs = 14 says "fourteen
-- pairs would produce this percentage", which is a different statement from "this
-- reader did not get the count", and the column is the difference between them.
--
-- headshots is here and is NULL in every row today. The count is not in either
-- of the two events this reader understands; it needs the per-cue damage RPC
-- stream, which is a separate reader with a different cost. The column exists
-- so that reader has somewhere to write, and headshots_reason says in the row
-- why it is empty rather than leaving a null that could be read as "none".
--
-- owner is the same key as in the other lab tables: the lowercased email from
-- the verified Access token.

CREATE TABLE IF NOT EXISTS lab_replay_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,              -- the signed-in person's lowercased email
  replay_key TEXT NOT NULL,         -- SHA-256 hex of owner + the replay's own window
  match_id INTEGER,                 -- lab_matches.id, or NULL when nothing matched in time
  source TEXT,                      -- the replay file's own name, as the agent sent it
  recorded INTEGER NOT NULL DEFAULT 0,  -- 1 only when the numbers are measurements
  creative INTEGER NOT NULL DEFAULT 0,  -- 1 when the file proved it was not a battle royale
  reason TEXT,                      -- why the row has no numbers, in one sentence
  started_at TEXT,                  -- ISO-8601 UTC, the replay header's own start clock
  ended_at TEXT,                    -- ISO-8601 UTC, start + the replay's stated length
  length_ms INTEGER,                -- the length the replay header states
  accuracy REAL,                    -- 0..1, exactly hits/shots as the game stored it
  accuracy_hits INTEGER,            -- recovered hit count, NULL when ambiguous
  accuracy_shots INTEGER,           -- recovered shot count, NULL when ambiguous
  accuracy_pairs INTEGER,           -- how many hit/shot pairs fit accuracy; 1 means the pair above is the only one
  assists INTEGER,
  eliminations INTEGER,
  headshots INTEGER,                -- always NULL today; see headshots_reason
  headshots_reason TEXT,            -- 'needs-damage-cue-reader' while the column is empty
  weapon_damage INTEGER,
  other_damage INTEGER,
  damage_to_players INTEGER,        -- weapon_damage + other_damage, exact
  damage_taken INTEGER,
  damage_to_structures INTEGER,
  total_traveled INTEGER,
  placement INTEGER,
  total_players INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per replay per person. The key is the replay's own start and end, so
-- the same file read twice - an agent restarting and re-reading a window it
-- already sent - collapses onto the row already there instead of doubling it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_replay_stats_owner_key ON lab_replay_stats(owner, replay_key);

-- The join reads a person's matches by end time, and the page's own reads come
-- newest first, so both want the same leading pair.
CREATE INDEX IF NOT EXISTS idx_lab_replay_stats_owner_ended ON lab_replay_stats(owner, ended_at);
