-- Player profiles: the card that shows on the roster, editable from the lab.
--
-- One row per person, keyed by the signed-in email so it is scoped the same way
-- every other lab table is. `slug` is the roster key the public page looks the
-- player up by (/img/roster/<slug>.png, window.ROSTER[slug]) and is set once,
-- from the gamertag as first saved, then never changes: renaming the card must
-- not move the avatar file or orphan the public entry.
--
-- `published` is a deliberate flag rather than "any row with a gamertag". A
-- profile that exists because someone opened the editor and typed half of one
-- must not appear on the public site, so the default is 0 and the page only
-- serves the rows that said yes.
--
-- `socials` is JSON: {"x":"https://...","tiktok":"..."}. Stored as text because
-- the set of networks is a page concern, not a schema one, and a new network
-- should not need a migration. Every value is checked to be an https URL before
-- it is written, and re-checked when the public page reads it.
--
-- Apply once:
--   wrangler d1 execute zoi-tryouts --remote --file migrations/0009_player_profiles.sql

CREATE TABLE IF NOT EXISTS player_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  gamertag TEXT NOT NULL,
  role TEXT,
  region TEXT,
  platform TEXT,
  bio TEXT,
  socials TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_player_profiles_public ON player_profiles(published, slug);
