/* Store a ROB RUN settings snapshot and open tests when a tracked value moves.
   Same rules as the COD half of lab-sync, scoped to game = 'robrun'. */
import { SNAPSHOT_KEEP, canonicalJson, sameValue, sha256Hex, str, valueText } from "./lab.js";
import { hasColumn } from "./lab-cod.js";
import { ROBRUN_CATALOG, ROBRUN_GAME, ROBRUN_MIN_TRACKED, withRobRunDefaults } from "./lab-robrun.js";

const labels = new Map(ROBRUN_CATALOG.map((c) => [c.id, c.label]));
const trackedIds = new Set(ROBRUN_CATALOG.map((c) => c.id));
const SOURCE_MAX = 80;
const TAKEN_AT_MAX = 40;

export function flattenIncomingRobRun(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const flat = {};
  for (const id of trackedIds) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const v = raw[id];
    if (typeof v === "number" ? Number.isFinite(v) : (typeof v === "string" || typeof v === "boolean")) {
      const text = valueText(v);
      if (text) flat[id] = text;
    }
  }
  return flat;
}

export async function syncRobRunSnapshot(env, owner, body, fallbackTakenAt) {
  const empty = { created: [], closed: [], duplicate: false, skipped: true };
  if (!body || typeof body !== "object" || !body.robrun || typeof body.robrun !== "object" || Array.isArray(body.robrun)) {
    return empty;
  }
  if (!(await hasColumn(env, "lab_snapshots", "game"))) return empty;

  const takenAt = str(body.robrun.takenAt, TAKEN_AT_MAX) || str(fallbackTakenAt, TAKEN_AT_MAX);
  if (!takenAt) return empty;

  const sent = flattenIncomingRobRun(body.robrun.settings);
  if (!sent || Object.keys(sent).length < ROBRUN_MIN_TRACKED) {
    return { ...empty, skipped: true, error: "That ROB RUN snapshot does not carry enough tracked settings." };
  }
  const flat = withRobRunDefaults(sent);

  const source = str(body.robrun.source, SOURCE_MAX);
  const stored = { settings: flat, ...(source ? { source } : {}) };
  const payload = canonicalJson(stored);
  const payloadHash = await sha256Hex(payload);

  const created = [];
  const closed = [];
  let duplicate = false;

  const previous = await env.DB.prepare(
    "SELECT payload,payload_hash FROM lab_snapshots WHERE owner = ? AND game = ? ORDER BY id DESC LIMIT 1"
  ).bind(owner, ROBRUN_GAME).first();

  duplicate = Boolean(previous && previous.payload_hash === payloadHash);

  if (!duplicate) {
    await env.DB.prepare(
      "INSERT INTO lab_snapshots (owner,taken_at,payload,payload_hash,game) VALUES (?,?,?,?,?)"
    ).bind(owner, takenAt, payload, payloadHash, ROBRUN_GAME).run();

    await env.DB.prepare(
      `DELETE FROM lab_snapshots WHERE owner = ? AND game = ? AND id NOT IN (
         SELECT id FROM lab_snapshots WHERE owner = ? AND game = ? ORDER BY id DESC LIMIT ?
       )`
    ).bind(owner, ROBRUN_GAME, owner, ROBRUN_GAME, SNAPSHOT_KEEP).run();

    let before = {};
    if (previous && previous.payload) {
      try {
        const parsed = JSON.parse(previous.payload);
        if (parsed && typeof parsed.settings === "object" && parsed.settings) before = withRobRunDefaults(parsed.settings);
      } catch { before = {}; }
    }

    if (await hasColumn(env, "lab_tests", "game")) {
      for (const setting of Object.keys(flat)) {
        if (!trackedIds.has(setting)) continue;
        if (!(setting in before)) continue;
        const fromValue = valueText(before[setting]);
        const toValue = valueText(flat[setting]);
        if (!fromValue || !toValue || sameValue(fromValue, toValue)) continue;

        const open = await env.DB.prepare(
          `SELECT id,to_value FROM lab_tests
            WHERE owner = ? AND game = ? AND setting = ? AND status = 'testing'
            ORDER BY id DESC LIMIT 1`
        ).bind(owner, ROBRUN_GAME, setting).first();

        if (open) {
          const done = await env.DB.prepare(
            `UPDATE lab_tests
                SET status = 'inconclusive',
                    decided_at = datetime('now'),
                    result_note = 'Closed when this setting changed again before enough games were played.'
              WHERE id = ? AND owner = ? AND status = 'testing'`
          ).bind(open.id, owner).run();
          if (done?.meta?.changes) closed.push({ id: open.id, setting, to: open.to_value });
        }

        const row = await env.DB.prepare(
          `INSERT INTO lab_tests (setting,label,from_value,to_value,status,games_planned,owner,game)
           VALUES (?,?,?,?,'testing',NULL,?,?)`
        ).bind(setting, labels.get(setting) || setting, fromValue, toValue, owner, ROBRUN_GAME).run();
        created.push({ id: row?.meta?.last_row_id ?? null, setting, from: fromValue, to: toValue });
      }
    }
  }

  return { created, closed, duplicate, skipped: false };
}
