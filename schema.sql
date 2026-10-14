CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  epic_name TEXT NOT NULL, discord TEXT NOT NULL, region TEXT NOT NULL, platform TEXT NOT NULL,
  age INTEGER NOT NULL, role TEXT NOT NULL, results_link TEXT, clips_link TEXT,
  why TEXT NOT NULL, email TEXT, ip_hash TEXT, user_agent TEXT, game TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_ip_time ON applications(ip_hash, created_at);
