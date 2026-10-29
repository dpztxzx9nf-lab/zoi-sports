/* A player's own match numbers, read from fortnite-api.com and turned into the
   two things the lab needs: a row of history, and how many matches each open
   test has actually seen.

   The key is the Pages secret FORTNITE_API_KEY, read as env.FORTNITE_API_KEY.
   This API wants it as the bare Authorization value (no "Bearer" prefix). It is
   never logged, never stored in the database and never sent to a browser.

   Every field in the reply is treated as optional: the shape is theirs, it
   changes without notice, and one missing group must not take the settings
   sync down with it. */
import { canonicalJson, str } from "./lab.js";

export const STATS_URL = "https://fortnite-api.com/v2/stats/br/v2/";
export const STATS_TIMEOUT_MS = 8000;
export const STATS_STALE_MS = 6 * 60 * 60 * 1000;

/* An Epic account id as it appears in Saved\Cloud\<id>\: 32 lowercase hex
   characters. Anything else is refused rather than stored, because a wrong id
   would quietly 404 forever. */
export const EPIC_ID_RE = /^[0-9a-f]{32}$/;

export function epicIdOf(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return EPIC_ID_RE.test(s) ? s : "";
}

const GROUPS = ["all", "keyboardMouse", "gamepad", "touch"];
const PLAYLISTS = ["overall", "solo", "duo", "squad", "ltm"];
const FIELDS = ["matches", "wins", "kills", "deaths", "kd", "winRate", "minutesPlayed", "score", "playersOutlived"];

/* What the row's own columns hold, in the order they are compared for dedupe. */
const COUNTERS = ["matches", "wins", "kills", "deaths", "kd", "win_rate", "minutes_played"];

const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* The reply, cut down to the numbers, with every field optional. Returns null
   when there is nothing usable in it at all. */
export function statsFrom(payload) {
  const data = payload && typeof payload === "object" ? payload.data : null;
  const stats = data && typeof data === "object" ? data.stats : null;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;

  const groups = {};
  let any = false;
  for (const g of GROUPS) {
    const group = stats[g];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const kept = {};
    for (const p of PLAYLISTS) {
      const row = group[p];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const cell = {};
      let filled = false;
      for (const f of FIELDS) {
        const n = numOrNull(row[f]);
        if (n !== null) { cell[f] = n; filled = true; }
      }
      if (filled) { kept[p] = cell; any = true; }
    }
    if (Object.keys(kept).length) groups[g] = kept;
  }
  if (!any) return null;

  const acct = data.account && typeof data.account === "object" ? data.account : {};
  return {
    account: { id: str(acct.id, 64) || "", name: str(acct.name, 64) || "" },
    groups,
  };
}

/* Which set of numbers is "his". He plays on a controller, so gamepad wins
   whenever the account has played on one; all is the fallback. */
export function pickGroup(groups) {
  const has = (g) => Boolean(groups && groups[g] && groups[g].overall);
  for (const g of ["gamepad", "all", "keyboardMouse", "touch"]) if (has(g)) return g;
  const first = groups ? Object.keys(groups).find((g) => groups[g] && groups[g].overall) : null;
  return first || null;
}

/* winRate arrives as a percentage (11.43) but is documented nowhere, so a value
   above 1 is divided by 100 and a value at or below 1 is taken as a fraction.
   Stored as a fraction either way; a real rate is never above 100%. */
function rateFraction(v) {
  const n = numOrNull(v);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

/* The row the lab stores: the chosen group's overall numbers, plus every group
   kept whole in raw so nothing is lost by the choice. */
export function summarize(parsed) {
  const group = pickGroup(parsed.groups);
  if (!group) return null;
  const overall = parsed.groups[group].overall || {};
  return {
    account: parsed.account,
    group,
    groups: parsed.groups,
    matches: numOrNull(overall.matches),
    wins: numOrNull(overall.wins),
    kills: numOrNull(overall.kills),
    deaths: numOrNull(overall.deaths),
    kd: numOrNull(overall.kd),
    win_rate: rateFraction(overall.winRate),
    minutes_played: numOrNull(overall.minutesPlayed),
  };
}

/* Per-playlist numbers for the page: the chosen group when it has them, the
   all group for anything it does not. */
export function playlistsOf(groups, group) {
  const out = {};
  for (const p of ["solo", "duo", "squad"]) {
    const row = (groups && groups[group] && groups[group][p]) || (groups && groups.all && groups.all[p]) || null;
    if (!row) continue;
    out[p] = {
      matches: numOrNull(row.matches),
      wins: numOrNull(row.wins),
      kd: numOrNull(row.kd),
      win_rate: rateFraction(row.winRate),
    };
  }
  return out;
}

/* ---------------------------------------------------------------- the call */

/* GET the account's lifetime numbers. Resolves to {ok:true, ...parsed} or
   {ok:false, reason} and never throws: the caller is a settings sync that has
   already succeeded, and it must stay that way. */
export async function fetchStats(env, epicId, deps = {}) {
  const key = env && typeof env.FORTNITE_API_KEY === "string" ? env.FORTNITE_API_KEY.trim() : "";
  if (!key) {
    console.log("lab stats: FORTNITE_API_KEY is not set; skipping the stats read");
    return { ok: false, reason: "no-key" };
  }
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, reason: "no-fetch" };

  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : STATS_TIMEOUT_MS;
  const url = STATS_URL + encodeURIComponent(epicId) + "?timeWindow=lifetime";
  const control = typeof AbortController === "function" ? new AbortController() : null;
  const timer = control ? setTimeout(() => control.abort(), timeoutMs) : null;

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: key, accept: "application/json" },
      /* Nothing between here and the API should ever serve an old body: the
         whole point of the row is that it is the numbers right now. */
      cache: "no-store",
      ...(control ? { signal: control.signal } : {}),
    });
    if (!res || !res.ok) {
      const status = res && typeof res.status === "number" ? res.status : 0;
      console.log("lab stats: the API answered " + status + " for " + epicId);
      return { ok: false, reason: status === 401 ? "key" : status === 404 ? "not-found" : "status", status };
    }
    let body;
    try { body = await res.json(); } catch { return { ok: false, reason: "json" }; }
    const parsed = statsFrom(body);
    if (!parsed) return { ok: false, reason: "shape" };
    return { ok: true, ...parsed };
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || e.name === "TimeoutError");
    console.log("lab stats: the read failed (" + (aborted ? "timed out" : "no reply") + ")");
    return { ok: false, reason: aborted ? "timeout" : "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ the history */

const sameCounter = (a, b) => {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
};

/* One row per set of counters. A read that changes nothing does not add a row;
   it moves that row's taken_at forward, so taken_at means "when these numbers
   were last read" and the page can say how long ago the lab last refreshed.
   created_at stays where it was, because it is the baseline that games_played
   is measured from: a test that started before the bump must still compare
   against the count as it stood then, not against a row that has drifted
   forward in time.

   `boundary` is `{ testIds }` - the tests this sync just opened - or null for an
   ordinary read. One row is written per test, because a single snapshot can
   move several settings and the test rows are inserted one at a time: the
   inserts can land either side of a second tick, so "the change instant" is not
   one instant, and a single row could only sit on one of them. Each row is
   stamped from its own test's started_at inside the INSERT, so the two are
   identical by construction rather than by hoping the clock has not moved.

   A boundary row is written even when the counters are identical to the last
   row, because that duplicate is the whole point: it puts a reading exactly on
   the change, so the reading before it is wholly before and the one after it is
   wholly after, and no segment straddles the change any more.

   Without it he loses the first evening after every change. A read whose
   counters did not move only bumps taken_at, so nothing lands at the moment he
   opens the menu; the first session on the new value is one segment spanning the
   change, and _lib/lab-perf.js refuses to split a segment it cannot place, which
   is right. The ingest was what fed it an unsplittable one.

   Its created_at is the change instant, copied from the test row itself rather
   than read from the clock here. The tests are inserted before the stats are
   fetched, and the fetch is a network round trip, so datetime('now') at this
   point lands a second or more after the change - and a reading a second late is
   still past the change, so the segment before it still straddles and the games
   are unplaced again. Copying the test's own started_at makes the two instants
   identical by construction. taken_at is still this read's own clock, because
   that is when these numbers were seen.

   What it cannot know: if a match ended between the change and this read, its
   games are in the freshly-read count and land on the before side. The window is
   one agent poll and he is in the menu rather than in a match, so it is a game
   at most, and guessing a split by time is the thing this file exists to avoid.
   The fix for that is per-match stats, the same one the straddle comment names. */
export async function recordStats(env, owner, epicId, summary, boundary = null) {
  const db = env.DB;
  const raw = canonicalJson({ account: summary.account, group: summary.group, groups: summary.groups });
  const last = await db.prepare(
    `SELECT id,epic_account_id,matches,wins,kills,deaths,kd,win_rate,minutes_played
     FROM lab_stats WHERE owner = ? ORDER BY id DESC LIMIT 1`
  ).bind(owner).first();

  const fresh = { matches: summary.matches, wins: summary.wins, kills: summary.kills, deaths: summary.deaths,
    kd: summary.kd, win_rate: summary.win_rate, minutes_played: summary.minutes_played };

  /* A boundary row skips the dedupe branch deliberately: two rows carrying the
     same numbers is what marks the instant. */
  if (!boundary && last && last.epic_account_id === epicId && COUNTERS.every((k) => sameCounter(last[k], fresh[k]))) {
    await db.prepare("UPDATE lab_stats SET taken_at = datetime('now') WHERE id = ?").bind(last.id).run();
    return { id: last.id, deduped: true, boundary: false };
  }

  if (boundary) {
    const ids = (boundary.testIds || []).filter((id) => id !== null && id !== undefined);
    let written = 0;
    let lastId = null;
    for (const testId of ids) {
      const res = await db.prepare(
        `INSERT INTO lab_stats (owner,epic_account_id,taken_at,matches,wins,kills,deaths,kd,win_rate,minutes_played,raw,created_at)
         VALUES (?,?,datetime('now'),?,?,?,?,?,?,?,?,COALESCE((SELECT started_at FROM lab_tests WHERE id = ? AND owner = ?),datetime('now')))`
      ).bind(owner, epicId, fresh.matches, fresh.wins, fresh.kills, fresh.deaths, fresh.kd, fresh.win_rate,
        fresh.minutes_played, raw, testId, owner).run();
      lastId = res?.meta?.last_row_id ?? lastId;
      written += 1;
    }
    /* No usable test id means no row, and that is the degraded case, not a
       failure: the sync still succeeds. The change simply keeps no reading on
       its own instant, so the first evening on the new value stays unplaceable,
       exactly as it did before any of this existed. */
    return { id: lastId, deduped: false, boundary: written > 0, rows: written };
  }

  const res = await db.prepare(
    `INSERT INTO lab_stats (owner,epic_account_id,taken_at,matches,wins,kills,deaths,kd,win_rate,minutes_played,raw)
     VALUES (?,?,datetime('now'),?,?,?,?,?,?,?,?)`
  ).bind(owner, epicId, fresh.matches, fresh.wins, fresh.kills, fresh.deaths, fresh.kd, fresh.win_rate,
    fresh.minutes_played, raw).run();
  return { id: res?.meta?.last_row_id ?? null, deduped: false, boundary: false };
}

/* How many matches each open test has seen: the newest cumulative count minus
   the cumulative count as it stood when the test started. A test with no stats
   row at or before its start is left alone rather than guessed at.
   The baseline uses created_at, the moment a count was first read, so the
   taken_at bump that dedupe does cannot drag a row across a test's start. */
export async function updateGamesPlayed(env, owner) {
  const db = env.DB;
  const newest = await db.prepare(
    "SELECT matches FROM lab_stats WHERE owner = ? ORDER BY datetime(taken_at) DESC, id DESC LIMIT 1"
  ).bind(owner).first();
  if (!newest || !Number.isInteger(newest.matches)) return 0;

  const { results } = await db.prepare(
    "SELECT id,started_at FROM lab_tests WHERE owner = ? AND status = 'testing'"
  ).bind(owner).all();

  let touched = 0;
  for (const test of results || []) {
    const base = await db.prepare(
      `SELECT matches FROM lab_stats WHERE owner = ? AND datetime(created_at) <= datetime(?)
       ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`
    ).bind(owner, test.started_at).first();
    if (!base || !Number.isInteger(base.matches)) continue;
    const games = Math.max(0, newest.matches - base.matches);
    await db.prepare(
      "UPDATE lab_tests SET games_played = ? WHERE id = ? AND owner = ? AND status = 'testing'"
    ).bind(games, test.id, owner).run();
    touched += 1;
  }
  return touched;
}

/* The newest row for one person, with the playlist split pulled back out of
   raw. Null when they have never had a reading. */
export async function latestStats(env, owner) {
  const row = await env.DB.prepare(
    `SELECT id,epic_account_id,taken_at,matches,wins,kills,deaths,kd,win_rate,minutes_played,raw
     FROM lab_stats WHERE owner = ? ORDER BY datetime(taken_at) DESC, id DESC LIMIT 1`
  ).bind(owner).first();
  if (!row) return null;

  let groups = null;
  let group = null;
  let name = "";
  if (row.raw) {
    try {
      const parsed = JSON.parse(row.raw);
      groups = parsed && parsed.groups ? parsed.groups : null;
      group = parsed && typeof parsed.group === "string" ? parsed.group : null;
      name = parsed && parsed.account && parsed.account.name ? parsed.account.name : "";
    } catch { /* raw is a convenience, not a requirement */ }
  }
  if (!group) group = pickGroup(groups);

  /* taken_at is D1's UTC clock with no marker on it. */
  const when = Date.parse(String(row.taken_at).replace(" ", "T") + "Z");
  const stale = !Number.isFinite(when) || Date.now() - when > STATS_STALE_MS;

  return {
    taken_at: row.taken_at,
    epic_account_id: row.epic_account_id,
    account_name: name,
    group,
    matches: row.matches,
    wins: row.wins,
    kills: row.kills,
    deaths: row.deaths,
    kd: row.kd,
    win_rate: row.win_rate,
    minutes_played: row.minutes_played,
    playlists: playlistsOf(groups, group),
    stale,
  };
}
