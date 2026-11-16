/* What moved in a person's game settings since they were last told.

   Server-side only: it reads lab_snapshots (written by /api/lab-sync whenever a
   value changed) and lab_settings_notices (the last snapshot reported per game),
   so a daily check never needs the PC to be on. Pure diffing lives in
   diffSettings so the box CLI (tools/zoi-settings-changes.mjs) and the endpoint
   (/api/lab/changes) say exactly the same thing. */
import { CATALOG, PROPERTY_MAP } from "./lab.js";
import { COD_CATALOG } from "./lab-cod.js";
import { ROBRUN_CATALOG, withRobRunDefaults } from "./lab-robrun.js";

export const CHANGE_GAMES = ["fortnite", "cod", "robrun"];

/* A Fortnite read with no bindings is a half-read (a locked save) and is never
   a baseline. Same rule as the seed in migrations/0018. */
export const COMPLETE_SQL = "(game <> 'fortnite' OR instr(payload, '\"bindings\"') > 0)";

const FORTNITE_LABELS = (() => {
  const byId = new Map(CATALOG.map((c) => [c.id, c.label]));
  const out = {};
  for (const [prop, id] of Object.entries(PROPERTY_MAP)) if (byId.has(id)) out[prop] = byId.get(id);
  return out;
})();
const COD_LABELS = Object.fromEntries(COD_CATALOG.map((c) => [c.id, c.label]));
const ROBRUN_LABELS = Object.fromEntries(ROBRUN_CATALOG.map((c) => [c.id, c.label]));

export function labelFor(game, kind, key) {
  if (kind === "binding") return "Binding: " + key;
  const map = game === "cod" ? COD_LABELS : game === "robrun" ? ROBRUN_LABELS : FORTNITE_LABELS;
  return map[key] || key;
}

/* A tracked setting is one the lab's own catalog names (the ones that open
   tests). Everything else in the file still counts as a change. */
export function isTracked(game, kind, key) {
  if (kind === "binding") return false;
  const map = game === "cod" ? COD_LABELS : game === "robrun" ? ROBRUN_LABELS : FORTNITE_LABELS;
  return Object.prototype.hasOwnProperty.call(map, key);
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    const p = JSON.parse(payload);
    return p && typeof p === "object" ? p : {};
  } catch { return {}; }
}

const text = (v) => (v === undefined || v === null ? null
  : Array.isArray(v) ? v.map(String).join(" + ") : String(v));

/* Old -> new for every key whose value differs. A key on one side only shows
   with null on the other. Rob Run leaves some off-values out of its file, so
   both sides get the game's own defaults first, the way the lab page reads them. */
export function diffSettings(game, beforePayload, afterPayload) {
  const before = parsePayload(beforePayload);
  const after = parsePayload(afterPayload);
  const fix = (s) => (game === "robrun" ? withRobRunDefaults(s || {}) : (s || {}));
  const out = [];
  const groups = [["setting", fix(before.settings), fix(after.settings)]];
  if (game === "fortnite") groups.push(["binding", before.bindings || {}, after.bindings || {}]);
  for (const [kind, a, b] of groups) {
    const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
    for (const key of keys) {
      const from = text(a[key]);
      const to = text(b[key]);
      if (from === to) continue;
      out.push({ kind, key, label: labelFor(game, kind, key), tracked: isTracked(game, kind, key), from, to });
    }
  }
  /* Tracked settings first, then the rest, then bindings. */
  const rank = (c) => (c.kind === "binding" ? 2 : c.tracked ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || x.key.localeCompare(y.key));
}

/* Given the notice row (or null) and the newest snapshot row (or null) for one
   game, and the oldest snapshot as a fallback baseline, say what is pending. */
export function pendingFor(game, notice, latest, oldest) {
  if (!latest) return { game, latest: null, since: null, changes: [] };
  const base = notice || (oldest ? { snapshot_id: oldest.id, taken_at: oldest.taken_at, payload: oldest.payload, notified_at: null } : null);
  const since = base ? { snapshotId: base.snapshot_id, takenAt: base.taken_at || null, notifiedAt: base.notified_at || null } : null;
  const changes = base && Number(base.snapshot_id) !== Number(latest.id) ? diffSettings(game, base.payload, latest.payload) : [];
  return { game, since, latest: { snapshotId: latest.id, takenAt: latest.taken_at }, changes };
}

export async function pendingChanges(db, owner, games = CHANGE_GAMES) {
  const out = [];
  for (const game of games) {
    const latest = await db.prepare(
      "SELECT id,taken_at,payload FROM lab_snapshots WHERE owner = ? AND game = ? ORDER BY id DESC LIMIT 1"
    ).bind(owner, game).first();
    const notice = await db.prepare(
      "SELECT snapshot_id,taken_at,payload,notified_at FROM lab_settings_notices WHERE owner = ? AND game = ?"
    ).bind(owner, game).first();
    const oldest = notice ? null : await db.prepare(
      "SELECT id,taken_at,payload FROM lab_snapshots WHERE owner = ? AND game = ? AND " + COMPLETE_SQL + " ORDER BY id ASC LIMIT 1"
    ).bind(owner, game).first();
    out.push(pendingFor(game, notice, latest, oldest));
  }
  return out;
}

/* Record a snapshot as told. Only a snapshot that is this person's and this
   game's can be recorded, and its payload is copied so pruning cannot lose it. */
export async function markNotified(db, owner, game, snapshotId) {
  const snap = await db.prepare(
    "SELECT id,taken_at,payload FROM lab_snapshots WHERE id = ? AND owner = ? AND game = ?"
  ).bind(snapshotId, owner, game).first();
  if (!snap) return false;
  await db.prepare(
    `INSERT INTO lab_settings_notices (owner,game,snapshot_id,taken_at,payload,notified_at,updated_at)
     VALUES (?,?,?,?,?,datetime('now'),datetime('now'))
     ON CONFLICT(owner,game) DO UPDATE SET snapshot_id=excluded.snapshot_id, taken_at=excluded.taken_at,
       payload=excluded.payload, notified_at=excluded.notified_at, updated_at=excluded.updated_at`
  ).bind(owner, game, snap.id, snap.taken_at, snap.payload).run();
  return true;
}
