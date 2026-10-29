/* Accepts a snapshot of Fortnite's settings from a player's own PC and turns
   any tracked change into an open lab test.

   Auth is a per-person bearer token, not the Access JWT: a PC cannot sit
   through a Google sign-in. This handler sits at /api/lab-sync, outside the
   Access-protected /api/lab/ tree on purpose: Access has no way to exclude a
   path inside an app it protects, so the one path a PC uses lives beside them
   instead. The bearer token is the only thing protecting it. The token is
   checked here by hashing what the request carried and looking that hash up in
   lab_tokens. An unknown token, a revoked one and a missing one all answer 401
   with the same body, so nothing can be learned by trying. */
import {
  CATALOG, MIN_SETTINGS, PROPERTY_MAP, SNAPSHOT_KEEP, SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_SETTINGS, canonicalJson, json, sameValue, sha256Hex, str, valueText,
} from "../_lib/lab.js";
import { epicIdOf, fetchStats, recordStats, summarize, updateGamesPlayed } from "../_lib/lab-stats.js";

const TAKEN_AT_MAX = 40;
const SOURCE_MAX = 40;

const labels = new Map(CATALOG.map((c) => [c.id, c.label]));

const unauthorized = () => json({ ok: false, error: "Unauthorized." }, 401);
const badRequest = (error) => json({ ok: false, errors: [error] }, 400);

/* The token from the request, however it arrived. */
function tokenFrom(request) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (m) return m[1];
  return (request.headers.get("x-lab-token") || "").trim();
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const token = tokenFrom(request);
  if (!token || token.length > 200) return unauthorized();

  /* A declared length over the cap is refused before reading a body at all. */
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > SNAPSHOT_MAX_BYTES) {
    return json({ ok: false, error: "That snapshot is too large." }, 413);
  }

  let owner = null;
  let tokenId = null;
  let epicOnToken = null;
  try {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT id,owner,epic_account_id FROM lab_tokens WHERE token_hash = ? AND revoked_at IS NULL"
    ).bind(hash).first();
    if (!row || !row.owner) return unauthorized();
    owner = row.owner;
    tokenId = row.id;
    epicOnToken = row.epic_account_id || null;
    await env.DB.prepare(
      "UPDATE lab_tokens SET last_seen_at = datetime('now') WHERE id = ?"
    ).bind(row.id).run();
  } catch (e) {
    console.error("lab sync auth failed", e);
    return json({ ok: false, error: "Couldn't check that token just now." }, 500);
  }

  /* Read the body as text so the real size is what gets measured, not a header
     that could understate it. */
  let text;
  try {
    text = await request.text();
  } catch {
    return badRequest("Send the snapshot as JSON.");
  }
  if (text.length > SNAPSHOT_MAX_BYTES) {
    return json({ ok: false, error: "That snapshot is too large." }, 413);
  }

  let body;
  try { body = JSON.parse(text); } catch { return badRequest("Send the snapshot as JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Send the snapshot as JSON.");

  const takenAt = str(body.takenAt, TAKEN_AT_MAX);
  if (!takenAt) return badRequest("takenAt is required.");

  const settings = body.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return badRequest("settings has to be an object of name to value.");
  }
  const names = Object.keys(settings);
  if (names.length < MIN_SETTINGS) {
    return badRequest(`settings needs at least ${MIN_SETTINGS} entries.`);
  }
  if (names.length > SNAPSHOT_MAX_SETTINGS) {
    return json({ ok: false, error: "That snapshot has too many settings." }, 413);
  }

  /* The PC agent finds the Epic id in its own Saved\Cloud\<id>\ folder and
     sends it, so the id is learned from the machine rather than typed. A
     malformed one is refused instead of stored: a wrong id would 404 on every
     read and look like the API's fault. */
  const sentEpic = body.epicAccountId !== undefined ? body.epicAccountId
    : body.epic_account_id !== undefined ? body.epic_account_id : null;
  let epicAccountId = epicOnToken;
  if (sentEpic !== null && String(sentEpic).trim() !== "") {
    const valid = epicIdOf(sentEpic);
    if (!valid) {
      return json({ ok: false, errors: ["An Epic account id is 32 lowercase hex characters."] }, 422);
    }
    epicAccountId = valid;
  }

  /* What gets stored and hashed: scalars only, keys in a fixed order. */
  const flat = {};
  for (const name of names) {
    const v = settings[name];
    if (typeof v === "number" ? Number.isFinite(v) : (typeof v === "string" || typeof v === "boolean")) {
      flat[name] = v;
    }
  }
  const bindings = (body.bindings && typeof body.bindings === "object" && !Array.isArray(body.bindings))
    ? body.bindings : null;
  const source = str(body.source, SOURCE_MAX);
  /* What is stored and hashed is the settings data, not the clock: two sends of
     the same config are the same snapshot however far apart they are taken.
     taken_at has its own column, so nothing is lost by leaving it out here. */
  const stored = { settings: flat, ...(bindings ? { bindings } : {}), ...(source ? { source } : {}) };
  const payload = canonicalJson(stored);
  const payloadHash = await sha256Hex(payload);

  let created = [];
  const skipped = [];
  let duplicate = false;

  try {
    /* The newest row decides both the duplicate check and the diff baseline.
       Nothing older is ever read, so one owner's history cannot see another's. */
    const previous = await env.DB.prepare(
      "SELECT payload,payload_hash FROM lab_snapshots WHERE owner = ? ORDER BY id DESC LIMIT 1"
    ).bind(owner).first();

    duplicate = Boolean(previous && previous.payload_hash === payloadHash);

    if (!duplicate) {
      await env.DB.prepare(
        "INSERT INTO lab_snapshots (owner,taken_at,payload,payload_hash) VALUES (?,?,?,?)"
      ).bind(owner, takenAt, payload, payloadHash).run();

      /* Keep the newest SNAPSHOT_KEEP and drop the rest. */
      await env.DB.prepare(
        `DELETE FROM lab_snapshots WHERE owner = ? AND id NOT IN (
           SELECT id FROM lab_snapshots WHERE owner = ? ORDER BY id DESC LIMIT ?
         )`
      ).bind(owner, owner, SNAPSHOT_KEEP).run();

      let before = {};
      if (previous && previous.payload) {
        try {
          const parsed = JSON.parse(previous.payload);
          if (parsed && typeof parsed.settings === "object" && parsed.settings) before = parsed.settings;
        } catch { before = {}; }
      }

      /* No baseline means nothing to compare, so the first snapshot of all
         opens no tests: otherwise a fresh install would open one per tracked
         setting. */
      for (const name of Object.keys(flat)) {
        const setting = PROPERTY_MAP[name];
        if (!setting) continue;                          // not tracked by the catalog
        if (!(name in before)) continue;                 // no earlier value to compare
        const fromValue = valueText(before[name]);
        const toValue = valueText(flat[name]);
        if (!fromValue || !toValue || sameValue(fromValue, toValue)) continue;

        /* One open test per setting. A test already ending where this change
           starts is the same test still running, so it is left as it is. */
        const open = await env.DB.prepare(
          `SELECT id,to_value FROM lab_tests WHERE owner = ? AND setting = ? AND status = 'testing'
           ORDER BY id DESC LIMIT 1`
        ).bind(owner, setting).first();

        if (open && sameValue(open.to_value, fromValue)) {
          skipped.push({ setting, reason: "already testing" });
          continue;
        }

        const row = await env.DB.prepare(
          `INSERT INTO lab_tests (setting,label,from_value,to_value,status,games_planned,owner)
           VALUES (?,?,?,?,'testing',NULL,?)`
        ).bind(setting, labels.get(setting) || setting, fromValue, toValue, owner).run();

        created.push({ id: row?.meta?.last_row_id ?? null, setting, from: fromValue, to: toValue });
      }
    }
  } catch (e) {
    console.error("lab sync failed", e);
    return json({ ok: false, error: "Couldn't save that snapshot." }, 500);
  }

  /* Past this point the snapshot is stored, so nothing below may fail the
     request: a stats problem is reported in the reply and nothing else. */
  const stats = await syncStats(env, owner, tokenId, epicAccountId);
  return json({ ok: true, created, skipped, duplicate, stats });
}

/* ------------------------------------------------------------- the stats ---
   Runs after the snapshot is already stored, so every outcome here is a note
   in the reply rather than a failure. A token with no Epic id on it makes no
   call at all: nobody has told the lab whose numbers to read. */
async function syncStats(env, owner, tokenId, epicAccountId) {
  const id = epicIdOf(epicAccountId);
  if (!id) return { skipped: "no epic account id" };

  let stats;
  try {
    stats = await fetchStats(env, id);
  } catch (e) {
    /* fetchStats promises not to throw, and this is here so a future change to
       that promise still cannot take the sync down. */
    console.error("lab stats read failed", e);
    return { ok: false, reason: "error" };
  }
  if (!stats.ok) return { ok: false, reason: stats.reason };

  try {
    const summary = summarize(stats);
    if (!summary) return { ok: false, reason: "shape" };

    const row = await recordStats(env, owner, id, summary);
    const updated = await updateGamesPlayed(env, owner);

    /* The id is learned from the PC, so record it the first time it arrives:
       later reads of the token list can then say which account it reads. */
    if (tokenId) {
      await env.DB.prepare(
        "UPDATE lab_tokens SET epic_account_id = ? WHERE id = ? AND owner = ? AND (epic_account_id IS NULL OR epic_account_id <> ?)"
      ).bind(id, tokenId, owner, id).run();
    }

    return { ok: true, group: summary.group, matches: summary.matches, deduped: row.deduped, tests: updated };
  } catch (e) {
    console.error("lab stats store failed", e);
    return { ok: false, reason: "store" };
  }
}
