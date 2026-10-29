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
/* A match carries a handful of short strings from the log. Anything longer than
   this is not one of those strings, so it is refused rather than stored. */
const MATCH_MAX = 50;
const MATCH_TEXT_MAX = 80;
const MATCH_ID = /^[0-9a-f]{32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const RANKED = new Set(["Ranked", "Unranked"]);
const BUILDS = new Set(["Zero", "Build"]);
const TEAMS = new Set(["Solo", "Duo", "Trio", "Squad"]);
/* 'br' or 'creative'. Two kinds of match that must never be averaged together:
   a battle royale is a ranked ladder with a build mode and a team size, an island
   has a title and none of those. Anything else is null and stays null. */
const KINDS = new Set(["br", "creative"]);
const TITLE_MAX = 80;

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
  /* A complete read always carries the save's own property names. The agent
     sends them bare, and prefixes the two files it parses separately: "ini." for
     GameUserSettings.ini and "sg." for the scalability block inside it. So a
     payload with settings but not one bare name is the ini on its own - which is
     what a locked ClientSettings.Sav looks like, since the agent logs the failed
     read and sends what it could still get.

     Storing that would be worse than refusing it. It carries 34 of the 91
     settings a real read has, none of the tracked ones, and no bindings; it
     became the diff baseline, so the next complete read compared against a
     half-read and a real move (sensitivity 39 to 55) looked like a setting
     appearing from nowhere instead of changing. A 422 is the one answer the
     agent can act on: it retries, and nothing half-read is ever stored.

     Only the total absence of save properties is refused. A save that genuinely
     holds nothing beyond the ini is not for this check to imagine - the real
     payloads are the evidence, and every one of them has 57 bare names against
     this payload's zero. */
  const bareNames = Object.keys(flat || {}).filter((name) => !name.startsWith("ini.") && !name.startsWith("sg."));
  if (!bareNames.length) {
    return json({
      ok: false,
      errors: ["That snapshot has no settings from ClientSettings.Sav \u2014 was the save locked?"],
    }, 422);
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
  /* Kept in the reply for the agent's sake, but nothing goes in it any more:
     every tracked setting that moves now either opens a test or closes the stale
     one and opens its own. It stays in the shape so an older agent reading this
     response does not see a field vanish under it. */
  const skipped = [];
  const closed = [];
  let duplicate = false;
  let matchResult = { stored: 0, seen: 0, dropped: [] };

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

        /* One open test per setting. */
        const open = await env.DB.prepare(
          `SELECT id,to_value FROM lab_tests WHERE owner = ? AND setting = ? AND status = 'testing'
           ORDER BY id DESC LIMIT 1`
        ).bind(owner, setting).first();

        /* Any open test here is stale, and it used to be possible to leave one
           open for ever. There was a branch above this that read "the open test
           already ends where this change starts, so it is the same test still
           running" and skipped. It could not be reached for that reason: this
           change only gets here when fromValue and toValue differ, so an open
           test whose to_value equals fromValue is a setting moving OFF the value
           under test - a revert, or a change on past it. Skipping meant the test
           stayed open, kept counting games played on a value nobody was running,
           and the revert itself was never recorded.

           It can never finish, either way. Close it with the one honest label
           there is for a test that ended without an answer, and say why in its
           note, rather than guessing better or worse. */
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

  /* Matches are separate from the snapshot in every way that matters. They are
     validated on their own, they are stored on their own, and a bad one is
     dropped with a note rather than failing the send: an agent that has a
     parse bug in its log reader must not lose the settings sync over it. The
     array is optional, so an older agent that sends none behaves exactly as
     before. */
  try {
    matchResult = await storeMatches(env, owner, body.matches);
  } catch (e) {
    console.error("lab sync matches failed", e);
    matchResult = { stored: 0, seen: 0, dropped: ["the matches could not be stored"] };
  }

  /* Past this point the snapshot is stored, so nothing below may fail the
     request: a stats problem is reported in the reply and nothing else. */
  const stats = await syncStats(env, owner, tokenId, epicAccountId);
  return json({ ok: true, created, skipped, closed, duplicate, stats, matches: matchResult });
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

/* ----------------------------------------------------------- the matches ---
   One row per match, keyed by a hash of the owner and the game's own
   GameSessionID. The hash rather than the raw id, because the owner is part of
   the key: two people on the same machine must not collapse onto one row, and the
   unique index has to be a single column pair for ON CONFLICT to work.

   Every field is written as the log said it or as NULL. Nothing here fills a gap
   with a zero, an average or the mode of the match before: a match joined in
   progress has no settings block behind it and is stored with a null mode, which
   is the truth about what is known and reads differently from "unranked".

   The log does not contain kills, damage, accuracy, headshots or placement, so
   none of those are here and none are derived. players_left_* is the presence
   line's own count, which goes both ways during a match; it is carried as a
   low-water mark, and it is not a finishing position. */
function matchRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const matchId = typeof raw.matchId === "string" ? raw.matchId.trim().toLowerCase() : "";
  if (!MATCH_ID.test(matchId)) return null;

  const text = (v, max = MATCH_TEXT_MAX) => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s && s.length <= max ? s : null;
  };
  const when = (v) => (typeof v === "string" && ISO.test(v.trim()) ? v.trim() : null);
  const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

  const endedAt = when(raw.endedAt);
  const kind = KINDS.has(raw.kind) ? raw.kind : null;
  /* No end time means no place on the timeline, which is the only thing a match
     row is used for. It is refused rather than stored with a made-up stamp.

     One exception, and only one: an island match whose end this log never
     states. An island DOES write an end-of-match report - his VK Play matches
     close with the same Bad Match Attribute burst a battle royale does - so a
     null end here is not the usual case. It is what is left when the log simply
     stops: the agent sends a window that ends mid-match, or the game is killed
     before the report lands. The start is certain in those rows and the end is
     unknown, so the null is the truth, and storing it beats discarding a match
     that certainly happened. It stays an island row either way, which is what
     keeps it out of the ladder arithmetic. The exception is refused for anything
     else: a battle royale with no end has no session id to prove it was ever one
     match, and a nameless row cannot show it is an island at all. */
  if (!endedAt && kind !== "creative") return null;

  const ranked = RANKED.has(raw.ranked) ? raw.ranked : null;
  const buildMode = BUILDS.has(raw.buildMode) ? raw.buildMode : null;
  const teamSize = TEAMS.has(raw.teamSize) ? raw.teamSize : null;

  /* A rank is only stored beside the ladder it belongs to. A number alone would
     be read as one rank when the log's two ladders are counted differently. */
  const rankType = text(raw.rankType, 64);
  const rankNum = count(raw.rank);
  const rank = rankType && rankNum !== null ? rankNum : null;

  return {
    matchId,
    /* Which kind of match this was. An island never carries a mode: the log does
       not state one for it, and the title is the only identity it has. */
    kind,
    title: kind === "creative" ? text(raw.title, TITLE_MAX) : null,
    playlist: text(raw.playlist),
    playlistType: text(raw.playlistType, 40),
    ranked: kind === "creative" ? null : ranked,
    buildMode: kind === "creative" ? null : buildMode,
    teamSize: kind === "creative" ? null : teamSize,
    region: kind === "creative" ? null : text(raw.region, 24),
    rankType: rank ? rankType : null,
    rank,
    playersLeftLow: count(raw.playersLeftLow),
    playersLeftFirst: count(raw.playersLeftFirst),
    playersLeftReadings: count(raw.playersLeftReadings),
    startedAt: when(raw.startedAt),
    endedAt,
  };
}

/* Whether lab_matches has a column. The table gains `kind` and `title` in
   0008, and a database that has not had that migration applied - or a fake one
   in a suite built from the older files - must still store matches. Asking the
   table rather than assuming is cheaper than a failed insert, and it is the only
   way the same code serves both.
   The statement is spelled exactly as the lab spells every other introspection
   so the fake D1's guard recognises it. */
async function hasColumn(env, table, column) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?")
      .bind(table, column).first();
    return Boolean(row && Number(row.n) > 0);
  } catch {
    return false;
  }
}

async function storeMatches(env, owner, rawMatches) {
  if (rawMatches === undefined || rawMatches === null) return { stored: 0, seen: 0, dropped: [] };
  if (!Array.isArray(rawMatches)) return { stored: 0, seen: 0, dropped: ["matches has to be a list"] };

  const seen = rawMatches.slice(0, MATCH_MAX).length;
  const dropped = [];
  if (rawMatches.length > MATCH_MAX) {
    dropped.push("only the newest " + MATCH_MAX + " matches were read");
  }

  /* Newest last in, but the order does not matter: each row stands alone. A row
     that cannot be read is counted and skipped, never guessed at. */
  /* Read once per sync rather than per match: whether 0008 has been applied. */
  const withKind = await hasColumn(env, "lab_matches", "kind");

  let stored = 0;
  let bad = 0;
  for (const raw of rawMatches.slice(0, MATCH_MAX)) {
    const m = matchRecord(raw);
    if (!m) { bad++; continue; }

    const key = await sha256Hex(owner + "\n" + m.matchId);
    const row = withKind
      ? await env.DB.prepare(
        `INSERT INTO lab_matches
           (owner,match_key,playlist,playlist_type,ranked,build_mode,team_size,region,rank_type,rank,
            players_left_low,players_left_first,players_left_readings,started_at,ended_at,kind,title)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (owner,match_key) DO NOTHING`
      ).bind(
        owner, key, m.playlist, m.playlistType, m.ranked, m.buildMode, m.teamSize, m.region,
        m.rankType, m.rank, m.playersLeftLow, m.playersLeftFirst, m.playersLeftReadings,
        m.startedAt, m.endedAt, m.kind, m.title
      ).run()
      : await env.DB.prepare(
        `INSERT INTO lab_matches
           (owner,match_key,playlist,playlist_type,ranked,build_mode,team_size,region,rank_type,rank,
            players_left_low,players_left_first,players_left_readings,started_at,ended_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (owner,match_key) DO NOTHING`
      ).bind(
        owner, key, m.playlist, m.playlistType, m.ranked, m.buildMode, m.teamSize, m.region,
        m.rankType, m.rank, m.playersLeftLow, m.playersLeftFirst, m.playersLeftReadings,
        m.startedAt, m.endedAt
      ).run();
    if (row?.meta?.changes) stored += 1;
  }
  if (bad) dropped.push(bad + (bad === 1 ? " match could not be read" : " matches could not be read"));
  return { stored, seen, dropped };
}
