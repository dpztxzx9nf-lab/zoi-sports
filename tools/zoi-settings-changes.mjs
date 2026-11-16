#!/usr/bin/env node
/* zoi-settings-changes - which game settings moved since the last notice.

   Runs anywhere wrangler can reach the zoi-tryouts D1 database (the box, a
   cloud routine). It never touches the player's PC: the PC agent already sent
   its snapshots to /api/lab-sync, and this only reads what was stored.

   Usage (from the repo root):
     node tools/zoi-settings-changes.mjs                 JSON of pending changes, all games
     node tools/zoi-settings-changes.mjs --text          the same, as plain lines
     node tools/zoi-settings-changes.mjs --game fortnite one game
     node tools/zoi-settings-changes.mjs --mark          after telling: record the newest
                                                          snapshot of each listed game as notified
     --owner <email>   default kneczi@thinkcore.io

   Same diff as GET /api/lab/changes (functions/_lib/lab-changes.js). */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGE_GAMES, COMPLETE_SQL, pendingFor } from "../functions/_lib/lab-changes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = "zoi-tryouts";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sqlText = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function query(sql) {
  const env = { ...process.env };
  if (!env.WRANGLER_CACHE_DIR) env.WRANGLER_CACHE_DIR = "/tmp/wrangler-cache";
  const out = execFileSync("wrangler", ["d1", "execute", DB, "--remote", "--json", "--command", sql], {
    cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed) || !parsed[0] || parsed[0].success === false) throw new Error("D1 query failed");
  return parsed[0].results || [];
}

const owner = arg("--owner", "kneczi@thinkcore.io").toLowerCase();
const only = arg("--game", "");
const games = only ? CHANGE_GAMES.filter((g) => g === only) : CHANGE_GAMES;
if (!games.length) { console.error("Unknown game: " + only); process.exit(2); }

const o = sqlText(owner);
const result = [];
for (const game of games) {
  const g = sqlText(game);
  const latest = query(`SELECT id,taken_at,payload FROM lab_snapshots WHERE owner=${o} AND game=${g} ORDER BY id DESC LIMIT 1`)[0] || null;
  const notice = query(`SELECT snapshot_id,taken_at,payload,notified_at FROM lab_settings_notices WHERE owner=${o} AND game=${g}`)[0] || null;
  const oldest = notice ? null
    : query(`SELECT id,taken_at,payload FROM lab_snapshots WHERE owner=${o} AND game=${g} AND ${COMPLETE_SQL} ORDER BY id ASC LIMIT 1`)[0] || null;
  result.push(pendingFor(game, notice, latest, oldest));
}

if (process.argv.includes("--mark")) {
  for (const r of result) {
    if (!r.latest) continue;
    query(`INSERT INTO lab_settings_notices (owner,game,snapshot_id,taken_at,payload,notified_at,updated_at)
      SELECT owner,game,id,taken_at,payload,datetime('now'),datetime('now') FROM lab_snapshots
       WHERE id=${Number(r.latest.snapshotId)} AND owner=${o} AND game=${sqlText(r.game)}
      ON CONFLICT(owner,game) DO UPDATE SET snapshot_id=excluded.snapshot_id, taken_at=excluded.taken_at,
        payload=excluded.payload, notified_at=excluded.notified_at, updated_at=excluded.updated_at`);
    r.marked = true;
  }
}

if (process.argv.includes("--text")) {
  const names = { fortnite: "Fortnite", cod: "Call of Duty", robrun: "Rob Run" };
  for (const r of result) {
    const head = names[r.game] + ": ";
    if (!r.latest) { console.log(head + "no snapshot stored yet."); continue; }
    if (!r.changes.length) { console.log(head + "nothing changed since snapshot " + (r.since ? r.since.snapshotId : "-") + "."); continue; }
    console.log(head + r.changes.length + " changed (snapshot " + r.since.snapshotId + " -> " + r.latest.snapshotId + ", read " + r.latest.takenAt + ")");
    for (const c of r.changes) console.log("  " + c.label + ": " + (c.from ?? "(none)") + " -> " + (c.to ?? "(none)"));
  }
} else {
  console.log(JSON.stringify({ owner, games: result }, null, 2));
}
