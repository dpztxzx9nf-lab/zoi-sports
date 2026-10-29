-- A player's in-game Fortnite settings, editable from their own account menu.
--
-- One row per person, keyed by the signed-in email the way every other lab table
-- is, so nobody can write anyone else's values. This is deliberately a separate
-- table from player_profiles rather than more columns on it: the profile is the
-- card the roster draws and only exists once someone fills one in, while these
-- are the numbers /settings prints and can be saved before a card is. One row
-- per person here also means "has this player ever touched their settings" is a
-- question the database can answer without a mostly-null profile row.
--
-- `slug` is the public key the page looks a player up by, the same key the
-- roster uses (/settings?p=<slug>). It is written on every save from the
-- player's profile slug when they have a card, so the two agree, and from their
-- name when they do not yet - a player can set their numbers before they write a
-- bio. Nothing renames a row: like the profile slug, it is a public address.
--
-- `settings` is JSON: {"look-horizontal-speed":42,"vsync":false,...}. Stored as
-- text because the field list is a page concern, not a schema one - adding a
-- row to functions/_lib/settings.js must not need a migration, and an older row
-- that predates a field reads back with that field's default rather than a null.
-- Every value is checked against the field's own type and range before it is
-- written, and re-checked when the public page reads it.
--
-- Apply once:
--   wrangler d1 execute zoi-tryouts --remote --file migrations/0011_player_settings.sql

CREATE TABLE IF NOT EXISTS player_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL UNIQUE,
  slug TEXT,
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_player_settings_slug ON player_settings(slug);
