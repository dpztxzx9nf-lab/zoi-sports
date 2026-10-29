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
  CATALOG, MIN_SETTINGS, MIN_TRACKED, PROPERTY_MAP, SNAPSHOT_KEEP, SNAPSHOT_MAX_BYTES,
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
/* A replay row is small - a couple of hundred bytes of numbers - so the cap is
   about how many matches one send can carry, not about bytes. Twenty is a whole
   evening's play; the agent caps its own batch at the same number. */
const REPLAY_MAX = 20;
const REPLAY_TEXT_MAX = 80;
/* A reader that refuses says why in a sentence, and that sentence has to survive
   the trip or the lab shows a generic reason instead of the real one. The
   refusal for a mis-attributed replay is 137 characters. This cap is still a
   cap - a sender cannot write a paragraph into the row - but it fits a sentence
   rather than a tag. */
const REPLAY_REASON_MAX = 240;
/* Two numbers that a wrong reader would produce and a right one cannot: a match
   no longer than six hours, and a per-match damage total that is not a season's. */
const REPLAY_MAX_MS = 6 * 60 * 60 * 1000;
const REPLAY_COUNT_MAX = 10_000_000;
const REPLAY_SHOTS_MAX = 3000;
/* How far a replay's own end may sit from the match the log recorded. The five
   replays on this box land 0.3 to 2.3 seconds from their match, because the log's
   end marker and the replay's start clock are written by different parts of the
   game, so the tolerance has to be wider than that spread. Three seconds leaves
   headroom for that jitter and still cannot reach the wrong match: matches are
   minutes apart, and the statement below takes the nearest one rather than the
   first one inside the window. */
const REPLAY_JOIN_SECONDS = 3.0;
/* The reason a headshot count carries while nothing can count them. The number
   is in the per-cue damage stream, not in either event this reader understands. */
const HEADSHOTS_REASON = "needs-damage-cue-reader";

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
     agent can act on: the sentence below goes into its log, and it waits for the
     next heartbeat rather than sending the same half-read bytes again, so
     nothing half-read is ever stored.

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

  /* The count above only says the payload is big enough to be a config. This
     says it is this config. Anything the catalog does not read is skipped by
     the diff, so a five-key object of names nobody tracks used to pass every
     check, get stored, and become the baseline: the next real read then
     "changed" nothing it could attribute, and an open test could be closed as
     inconclusive against settings the lab never looked at. Refused before any
     row is written, so nothing is stored and no test moves. */
  const tracked = Object.keys(flat).filter((name) => PROPERTY_MAP[name]).length;
  if (tracked < MIN_TRACKED) {
    return json({
      ok: false,
      errors: [`That snapshot carries ${tracked} of the ${Object.keys(PROPERTY_MAP).length} settings this lab tracks, so it is not a Fortnite settings read.`],
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

  /* Replays are their own half again: their own table, their own validation, and
     their own failure. A replay the reader could not parse must never cost the
     settings send, and a database without the 0009 table must still take the
     settings. */
  let replayResult = { stored: 0, seen: 0, attached: 0, dropped: [] };
  try {
    replayResult = await storeReplayStats(env, owner, body.replayStats);
  } catch (e) {
    console.error("lab sync replay stats failed", e);
    replayResult = { stored: 0, seen: 0, attached: 0, dropped: ["the replay stats could not be stored"] };
  }

  /* Past this point the snapshot is stored, so nothing below may fail the
     request: a stats problem is reported in the reply and nothing else. */
  /* Whether this sync opened a test decides whether the stats read also writes
     a boundary row: a reading exactly on the change, carrying the counters as
     they stand, so the first evening on the new value is not swallowed by the
     straddle rule. Only a test opening warrants one - an ordinary heartbeat that
     did it too would fill lab_stats with rows that mark nothing. */
  const stats = await syncStats(env, owner, tokenId, epicAccountId, created.map((t) => t.id));
  return json({ ok: true, created, skipped, closed, duplicate, stats, matches: matchResult, replayStats: replayResult });
}

/* ------------------------------------------------------------- the stats ---
   Runs after the snapshot is already stored, so every outcome here is a note
   in the reply rather than a failure. A token with no Epic id on it makes no
   call at all: nobody has told the lab whose numbers to read.

   `boundaryTestIds` are the tests this sync opened, empty when it opened none.
   With any, the read also writes one lab_stats row per test stamped at that
   test's own start, so the change has a reading sitting exactly on it. Nothing
   here can fail the sync: every path below returns a note, and the snapshot is
   already stored by this point. */
async function syncStats(env, owner, tokenId, epicAccountId, boundaryTestIds = []) {
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

    /* A no-Epic-id token or a failed read above has already returned, so this
       point is only reached with real counters. A missing boundary row is
       therefore degraded rather than broken: the sync still succeeds and the
       change simply loses its first evening, exactly as it did before. */
    const row = await recordStats(env, owner, id, summary, boundaryTestIds.length ? { testIds: boundaryTestIds } : null);
    const updated = await updateGamesPlayed(env, owner);

    /* The id is learned from the PC, so record it the first time it arrives:
       later reads of the token list can then say which account it reads. */
    if (tokenId) {
      await env.DB.prepare(
        "UPDATE lab_tokens SET epic_account_id = ? WHERE id = ? AND owner = ? AND (epic_account_id IS NULL OR epic_account_id <> ?)"
      ).bind(id, tokenId, owner, id).run();
    }

    return { ok: true, group: summary.group, matches: summary.matches, deduped: row.deduped,
      boundary: row.boundary === true, tests: updated };
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

/* The instant a match ended, as a number, or null when the log never said. It
   is parsed rather than compared as text because the fraction of a second is
   written with one to three digits: "…:00.1Z" is the earlier instant but the
   later string, so a text sort would call them the wrong way round once a
   second. A match with no end time is one still in play, which counts as newer
   than anything already finished. */
function matchEnd(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const at = raw.endedAt;
  if (typeof at !== "string" || !ISO.test(at)) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

async function storeMatches(env, owner, rawMatches) {
  if (rawMatches === undefined || rawMatches === null) return { stored: 0, seen: 0, dropped: [] };
  if (!Array.isArray(rawMatches)) return { stored: 0, seen: 0, dropped: ["matches has to be a list"] };

  const seen = Math.min(rawMatches.length, MATCH_MAX);
  const dropped = [];
  if (rawMatches.length > MATCH_MAX) {
    dropped.push("only the newest " + MATCH_MAX + " matches were read");
  }

  /* The agent sends a full read of its log, oldest first, so the front of the
     list is the oldest evening it still remembers. Taking a prefix of that
     would keep the oldest matches and throw the newest ones away - the exact
     opposite of what the reply promises - so the list is ordered by end time
     and the tail is kept. The sort is on a copy because a caller that reuses
     its array (a suite, or the agent building a second request) should not see
     it rearranged underneath it. Matches with no end time are ones still being
     played, and they sort last so they are kept rather than dropped; the
     comparator falls back to the original position, which keeps the order
     stable for two matches that ended in the same second. */
  const ordered = rawMatches.map((raw, at) => ({ raw, at })).sort((a, b) => {
    const ea = matchEnd(a.raw), eb = matchEnd(b.raw);
    if (ea === eb) return a.at - b.at;
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea < eb ? -1 : 1;
  }).map((x) => x.raw);
  const newest = ordered.slice(Math.max(0, ordered.length - MATCH_MAX));

  /* Newest last in, but the order does not matter: each row stands alone. A row
     that cannot be read is counted and skipped, never guessed at. */
  /* Read once per sync rather than per match: whether 0008 has been applied. */
  const withKind = await hasColumn(env, "lab_matches", "kind");

  let stored = 0;
  let bad = 0;
  for (const raw of newest) {
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

/* -------------------------------------------------------- the replay stats ---
   One row per replay file, joined to the match it recorded. This is the only
   per-match record the lab has: the stats API counts a whole account, so it
   cannot say which side of a settings change a single game fell on, and the log
   does not carry kills, damage, accuracy or placement at all. The replay does.

   Three rules here, all of them from the lab's own history.

   Nothing is invented. A number arrives as a measurement or as null, and the
   row's `recorded` flag says which. A Creative island writes an
   AthenaMatchStats event that is empty and writes no AthenaMatchTeamStats at
   all, so its row carries recorded = 0 with every measurement null and the
   reader's reason beside it - not eight zeros that a page would draw as a bad
   game. A payload that claims measurements for a Creative replay is not
   believed: the flag and the numbers are checked against each other.

   Nothing is dropped for want of a match. A replay whose match the log has not
   reached yet is stored with a null match_id and attached later, by the second
   statement below. The order is usually that one, in fact: the replay lands on
   disk seconds after the match ends, while the log's match record is held until
   its rank line arrives a minute or three later, so the replay very often gets
   here first. Discarding it then would lose the numbers for the ordinary case.

   Nothing here can take the settings down. The caller wraps this in its own
   try/catch, and this function returns a note rather than throwing when the
   table is missing. */
function replayRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const text = (v, max = REPLAY_TEXT_MAX) => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s && s.length <= max ? s : null;
  };
  /* A date this column can be joined on. The shape is not enough: "2026-13-45"
     has the right shape and is not a date, and julianday() answers NULL for it,
     which would leave a row that can never attach for a reason nobody could see
     in the table. So the value has to parse as well as match. */
  const when = (v) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return ISO.test(t) && Number.isFinite(Date.parse(t)) ? t : null;
  };
  /* A whole number the game could have written. A negative one, a fractional one
     and one larger than any match's counter are all refused to null rather than
     rounded into something plausible. */
  const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= REPLAY_COUNT_MAX
    ? Math.round(v) : null);

  /* The end is the join key, and a row with no end has no place on the timeline
     and could never be attached to anything. The module always fills it on a
     file it could read; a row without one is a sender bug, and dropping it is
     how that bug gets noticed in the reply instead of silently filling a table
     with rows nothing can use. */
  const endedAt = when(raw.endedAtUtc);
  if (!endedAt) return null;
  const startedAt = when(raw.startedAtUtc);

  /* The length the file states, which is what makes ended_at checkable against
     started_at. Six hours is far past any match. */
  const lengthMs = count(raw.lengthMs);
  const length = lengthMs !== null && lengthMs > 0 && lengthMs <= REPLAY_MAX_MS ? lengthMs : null;

  const recorded = raw.recorded === true;
  const creative = raw.creative === true && !recorded;

  /* Accuracy is a fraction because that is what the event stores. Anything
     outside none-to-all is a misread, not a very good player. */
  const accuracy = recorded && typeof raw.accuracy === "number" && Number.isFinite(raw.accuracy)
    && raw.accuracy >= 0 && raw.accuracy <= 1 ? raw.accuracy : null;

  /* The recovered pair is only a fact as a pair. One without the other, shots
     smaller than hits, or a shot count past the search window is not a pair. */
  const hits = recorded ? count(raw.accuracyHits) : null;
  const shots = recorded ? count(raw.accuracyShots) : null;
  const pair = hits !== null && shots !== null && shots >= hits && shots <= REPLAY_SHOTS_MAX
    ? { hits, shots } : { hits: null, shots: null };
  /* How many pairs would have produced the stored percentage. Kept beside a
     null pair so the row says "fourteen fractions fit" rather than looking like
     a reader that could not count. Zero when there is no accuracy to explain. */
  const pairs = recorded ? count(raw.accuracyPairs) : null;

  const placement = recorded ? count(raw.placement) : null;
  const totalPlayers = recorded ? count(raw.totalPlayers) : null;
  /* A placement of zero, or a placement past the field, describes no match. */
  const placed = placement !== null && totalPlayers !== null && placement >= 1 && totalPlayers >= placement
    ? { placement, totalPlayers } : { placement: null, totalPlayers: null };

  /* Headshots come from the damage-cue stream, which is a different reader with
     a different cost; today's agent sends null and a reason, and the column is
     here for the reader that will fill it. A number is taken as sent, and its
     reason with it, so that reader needs no migration. */
  const headshots = recorded ? count(raw.headshots) : null;
  /* The one text field on this row that is prose, so it gets the longer cap: a
     refusal reason that is cut down to nothing is a refusal the lab cannot
     explain, and text() answers null rather than a truncated string, which would
     have quietly swapped the real reason for the generic one. */
  const headshotsReason = headshots === null
    ? (text(raw.headshotsReason, REPLAY_REASON_MAX) || HEADSHOTS_REASON)
    : null;

  const weaponDamage = recorded ? count(raw.weaponDamage) : null;
  const otherDamage = recorded ? count(raw.otherDamage) : null;
  /* The sum is exact and the screen shows it as one number, so it is computed
     rather than trusted: a sender that adds it up wrong sends nothing that
     survives. When either half is missing there is no sum. */
  const damageToPlayers = weaponDamage !== null && otherDamage !== null
    ? weaponDamage + otherDamage
    : (recorded ? count(raw.damageToPlayers) : null);

  return {
    endedAt, startedAt, length,
    recorded, creative,
    reason: text(raw.reason, 240) || (recorded ? null : "the reader did not say why"),
    source: text(raw.source),
    accuracy,
    hits: pair.hits, shots: pair.shots, pairs,
    assists: recorded ? count(raw.assists) : null,
    eliminations: recorded ? count(raw.eliminations) : null,
    headshots, headshotsReason,
    weaponDamage, otherDamage, damageToPlayers,
    damageTaken: recorded ? count(raw.damageTaken) : null,
    damageToStructures: recorded ? count(raw.damageToStructures) : null,
    totalTraveled: recorded ? count(raw.totalTraveled) : null,
    placement: placed.placement, totalPlayers: placed.totalPlayers,
  };
}

/* Whether a table is in this database. The probe is the same pragma the column
   check uses - a column cannot exist on a table that does not - so a database
   built before 0009 answers false instead of throwing on every sync. */
async function hasTable(env, table) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?")
      .bind(table, "id").first();
    return Boolean(row && Number(row.n) > 0);
  } catch {
    return false;
  }
}

/* The join, in one statement. A replay is attached to the nearest match this
   person has whose end lies within REPLAY_JOIN_SECONDS of the replay's own end,
   and to nothing when none does. Nearest rather than first: matches are minutes
   apart and the window is seconds, so in practice at most one qualifies, but a
   replayed evening can hold a match the log dated twice and picking the closest
   is the only choice that does not depend on row order.

   Every row that has no match is re-offered this statement on every sync, which
   is the ordinary path rather than a repair: the replay file lands on disk
   seconds after the match ends while the log's match record is held until its
   rank line arrives a minute or three later, so a first sync of an evening
   usually stores replays whose matches do not exist yet. Without it those rows
   would stay unattached for ever, and the per-match numbers would never reach
   the game they belong to. The WHERE is bounded to unattached rows, so on a
   quiet sync it reads nothing and changes nothing.

   A match is only ever read here. Nothing in this statement can create a
   lab_matches row: a replay with no match is stored unattached and stays that
   way until a real match arrives.

   Why a window function rather than a scalar subquery: the obvious form of this
   statement - a correlated subquery in the SET with ORDER BY on the replay's own
   column - does not run. SQLite refuses an outer reference inside a subquery's
   ORDER BY ("no such column"), so the nearest match cannot be chosen there. The
   CTE ranks the candidates in a place where both tables are in scope, which
   also makes "nearest" explicit rather than a side effect of ordering. */
const ATTACH_REPLAYS = `WITH candidate AS (
    SELECT r.id AS rid, m.id AS mid,
           ROW_NUMBER() OVER (PARTITION BY r.id
                              ORDER BY ABS(julianday(m.ended_at) - julianday(r.ended_at)) ASC, m.id DESC) AS pick
      FROM lab_replay_stats r
      JOIN lab_matches m ON m.owner = r.owner AND m.ended_at IS NOT NULL
     WHERE r.owner = ? AND r.match_id IS NULL AND r.ended_at IS NOT NULL
       AND ABS((julianday(m.ended_at) - julianday(r.ended_at)) * 86400.0) <= ?
  )
  UPDATE lab_replay_stats
     SET match_id = (SELECT mid FROM candidate WHERE candidate.rid = lab_replay_stats.id AND candidate.pick = 1)
   WHERE id IN (SELECT rid FROM candidate WHERE pick = 1)`;

/* The attach pass on its own, for a sync that carried no replays. A replay is
   usually stored at least one sync before its match exists, so the sync that
   finally brings the match is the one that has to go looking for it - and that
   sync has nothing in `replayStats` at all. Without this, those rows would only
   ever attach on the next evening's first send, or never. */
async function attachStoredReplays(env, owner) {
  if (!(await hasTable(env, "lab_replay_stats"))) return 0;
  try {
    const late = await env.DB.prepare(ATTACH_REPLAYS).bind(owner, REPLAY_JOIN_SECONDS).run();
    return late?.meta?.changes ? Number(late.meta.changes) : 0;
  } catch (e) {
    /* A row that could not be attached is still stored, and the next sync tries
       again. Nothing about this is worth failing over. */
    console.error("lab sync replay attach failed", e);
    return 0;
  }
}

async function storeReplayStats(env, owner, rawReplays) {
  /* No replays in this batch is not "nothing to do": earlier replays may be
     waiting for the match this very sync is carrying. */
  if (rawReplays === undefined || rawReplays === null) {
    return { stored: 0, seen: 0, attached: await attachStoredReplays(env, owner), dropped: [] };
  }
  if (!Array.isArray(rawReplays)) return { stored: 0, seen: 0, attached: 0, dropped: ["replayStats has to be a list"] };

  const dropped = [];
  if (rawReplays.length > REPLAY_MAX) {
    /* Newest last is what the agent sends, but position is not what decides
       which rows are kept: the newest are taken by end time, because a reader
       that trusted position would keep the oldest twenty and lose the games just
       played while telling the agent the opposite. */
    dropped.push("only the newest " + REPLAY_MAX + " replays were read");
  }
  const kept = rawReplays.slice().sort((a, b) => {
    const at = a && typeof a.endedAtUtc === "string" ? a.endedAtUtc : "";
    const bt = b && typeof b.endedAtUtc === "string" ? b.endedAtUtc : "";
    return at === bt ? 0 : at < bt ? -1 : 1;
  }).slice(-REPLAY_MAX);
  const seen = kept.length;

  if (!(await hasTable(env, "lab_replay_stats"))) {
    return { stored: 0, seen, attached: 0, dropped: dropped.concat(["lab_replay_stats is not in this database yet"]) };
  }

  let stored = 0;
  let bad = 0;
  for (const raw of kept) {
    const r = replayRecord(raw);
    if (!r) { bad++; continue; }

    /* The key is the replay's own window: one replay file describes one match,
       so its start and end identify it. The owner is part of the hash for the
       same reason the match key includes it - two people sharing a PC must not
       collapse onto one row - and the unique index is what makes that true under
       concurrency, not just on the happy path. */
    const key = await sha256Hex([owner, r.startedAt || "", r.endedAt, String(r.length || "")].join("\n"));

    /* match_id is written NULL and filled by ATTACH_REPLAYS below. One statement
       decides the join, so a row cannot be attached by one tolerance on the way
       in and a different one on the way back. */
    const row = await env.DB.prepare(
      `INSERT INTO lab_replay_stats
         (owner,replay_key,match_id,source,recorded,creative,reason,started_at,ended_at,length_ms,
          accuracy,accuracy_hits,accuracy_shots,accuracy_pairs,assists,eliminations,headshots,headshots_reason,
          weapon_damage,other_damage,damage_to_players,damage_taken,damage_to_structures,
          total_traveled,placement,total_players)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (owner,replay_key) DO NOTHING`
    ).bind(
      owner, key, null,
      r.source, r.recorded ? 1 : 0, r.creative ? 1 : 0, r.reason, r.startedAt, r.endedAt, r.length,
      r.accuracy, r.hits, r.shots, r.pairs, r.assists, r.eliminations, r.headshots, r.headshotsReason,
      r.weaponDamage, r.otherDamage, r.damageToPlayers, r.damageTaken, r.damageToStructures,
      r.totalTraveled, r.placement, r.totalPlayers
    ).run();
    if (row?.meta?.changes) stored += 1;
  }
  if (bad) dropped.push(bad + (bad === 1 ? " replay could not be read" : " replays could not be read"));

  const attached = await attachStoredReplays(env, owner);
  return { stored, seen, attached, dropped };
}
