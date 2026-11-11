-- After-action report captures: store score, placement, OCR metadata,
-- a soft-delete stamp, and allow kills to be empty when a capture could
-- not be read yet. Existing manual rows stay as source = 'manual'.
--
-- wrangler d1 execute zoi-tryouts --remote --file migrations/0014_lab_cod_aar.sql

CREATE TABLE lab_cod_matches_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  played_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  kills INTEGER,
  extracted INTEGER,
  won INTEGER,
  deaths INTEGER,
  score INTEGER,
  placement INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  needs_review INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  aar_key TEXT,
  fingerprint TEXT,
  ocr_json TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO lab_cod_matches_new (
  id, owner, played_at, mode, kills, extracted, won, deaths,
  source, needs_review, created_at
)
SELECT
  id, owner, played_at, mode, kills, extracted, won, deaths,
  'manual', 0, created_at
FROM lab_cod_matches;

DROP TABLE lab_cod_matches;
ALTER TABLE lab_cod_matches_new RENAME TO lab_cod_matches;

CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_owner ON lab_cod_matches(owner, played_at);
CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_owner_mode ON lab_cod_matches(owner, mode, played_at);
CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_owner_live ON lab_cod_matches(owner, deleted_at, played_at);

CREATE INDEX IF NOT EXISTS idx_lab_cod_matches_fp ON lab_cod_matches(owner, fingerprint, played_at);
