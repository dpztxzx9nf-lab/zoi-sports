-- ROB RUN city-shift log, filled automatically from the HUD.
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0016_lab_robrun_shifts.sql

CREATE TABLE IF NOT EXISTS lab_robrun_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  role TEXT,
  notoriety INTEGER,
  party TEXT,
  player_name TEXT,
  outcome TEXT,
  duration_s INTEGER,
  deaths INTEGER,
  arrests INTEGER,
  source TEXT NOT NULL DEFAULT 'ocr',
  confidence REAL,
  aar_key TEXT,
  fingerprint TEXT,
  ocr_json TEXT,
  stats TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_robrun_shifts_owner ON lab_robrun_shifts(owner, started_at);
CREATE INDEX IF NOT EXISTS idx_lab_robrun_shifts_open ON lab_robrun_shifts(owner, ended_at);
