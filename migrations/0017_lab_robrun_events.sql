-- ROB RUN events from the game's own log files (Sentry breadcrumbs and
-- Player.log), read passively by the PC helper. One row per event.
CREATE TABLE IF NOT EXISTS lab_robrun_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'log',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, at, kind, detail)
);
CREATE INDEX IF NOT EXISTS idx_lab_robrun_events_owner ON lab_robrun_events(owner, at);
