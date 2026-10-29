/* What the readings and the recorded changes add up to, worked out once here so
   the page only has to draw it.

   The numbers are cumulative counters from Epic (matches, wins, kills) read off
   a PC. Two readings in order give the games played between them, so the gap
   between readings is a "session" and its win rate is real arithmetic rather
   than an opinion. A setting change sits somewhere on that timeline; the games
   after it can be compared with the same number of games before it.

   Nothing here invents a number. A comparison with too few games on either side
   is labelled as too early to call, not given a verdict.

   Pure: takes rows and a clock, returns a payload. No database, no fetch. */

export const MIN_GAMES = 10;      // below this on either side, no verdict
export const MIN_DELTA = 0.02;    // 2 points of win rate is the smallest real move
export const MAX_SEGMENTS = 60;   // what the chart draws
export const MAX_READINGS = 400;

/* D1 writes "2026-10-28 22:24:00", which is UTC with no marker on it. */
export function timeOf(value) {
  const s = String(value || "").trim();
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(" ", "T") + "Z" : s;
  return Date.parse(iso);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/* Counters for a set of segments, or for one. win_rate is wins/matches; kd is
   kills/deaths, and null when no death was recorded rather than Infinity. */
export function totalsOf(segments) {
  let matches = 0, wins = 0, kills = 0, deaths = 0;
  let hasWins = false, hasKills = false, hasDeaths = false;
  for (const s of segments || []) {
    matches += Number(s.matches) || 0;
    if (num(s.wins) !== null) { wins += s.wins; hasWins = true; }
    if (num(s.kills) !== null) { kills += s.kills; hasKills = true; }
    if (num(s.deaths) !== null) { deaths += s.deaths; hasDeaths = true; }
  }
  return {
    matches,
    wins: hasWins ? wins : null,
    kills: hasKills ? kills : null,
    deaths: hasDeaths ? deaths : null,
    win_rate: matches > 0 && hasWins ? wins / matches : null,
    kd: hasKills && hasDeaths && deaths > 0 ? kills / deaths : null,
  };
}

/* One segment per pair of readings where the counters actually moved.
   A reading that changed nothing is a heartbeat, not a session, so it is
   skipped: taken_at is bumped on a repeat and created_at is not. */
export function segmentsOf(rows) {
  const pts = (rows || [])
    .map((r) => ({
      at: r.created_at,
      atMs: timeOf(r.created_at),
      matches: int(r.matches),
      wins: int(r.wins),
      kills: int(r.kills),
      deaths: int(r.deaths),
    }))
    .filter((p) => Number.isFinite(p.atMs) && p.matches !== null)
    .sort((a, b) => a.atMs - b.atMs || a.matches - b.matches);

  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const matches = b.matches - a.matches;
    if (!(matches > 0)) continue;                    // reset, or the same count twice
    const seg = { from: a.at, to: b.at, fromMs: a.atMs, toMs: b.atMs, matches };
    if (a.wins !== null && b.wins !== null) seg.wins = Math.max(0, b.wins - a.wins);
    if (a.kills !== null && b.kills !== null) seg.kills = Math.max(0, b.kills - a.kills);
    if (a.deaths !== null && b.deaths !== null) seg.deaths = Math.max(0, b.deaths - a.deaths);
    out.push(seg);
  }
  return out;
}

/* The latest reading, as the header's lifetime numbers. */
export function lifetimeOf(rows) {
  let newest = null;
  for (const r of rows || []) {
    const ms = timeOf(r.taken_at) || timeOf(r.created_at);
    if (!Number.isFinite(ms)) continue;
    if (!newest || ms >= newest.ms) newest = { ms, row: r };
  }
  if (!newest) return null;
  const r = newest.row;
  const matches = int(r.matches);
  return {
    matches,
    wins: int(r.wins),
    kills: int(r.kills),
    deaths: int(r.deaths),
    kd: num(r.kd),
    win_rate: num(r.win_rate),
    taken_at: r.taken_at,
  };
}

/* The last N games before a moment, walked backwards over whole segments.
   Whole segments only: splitting one would mean guessing how the games inside
   it were spread, and a guess is what this whole file exists to avoid. */
function sampleBefore(segments, beforeMs, want) {
  const taken = [];
  let have = 0;
  for (let i = segments.length - 1; i >= 0 && have < want; i--) {
    const s = segments[i];
    if (!(s.toMs <= beforeMs)) continue;             // wholly after the change
    taken.push(s);
    have += s.matches;
  }
  return taken.reverse();
}

/* The games since a moment, up to the next change. `nextMs` null means "now". */
function sampleAfter(segments, afterMs, nextMs) {
  return segments.filter((s) => s.toMs > afterMs && (nextMs === null || s.fromMs < nextMs));
}

/* Better, worse, or not yet. Two points of win rate is the bar, and both sides
   need MIN_GAMES: a 3-game sample swings 30 points on one fight. */
export function judge(before, after) {
  if (!(after.matches > 0)) return { verdict: "too-soon", delta: null };
  if (after.matches < MIN_GAMES || before.matches < MIN_GAMES) return { verdict: "too-soon", delta: null };
  if (after.win_rate === null || before.win_rate === null) return { verdict: "too-soon", delta: null };
  const delta = after.win_rate - before.win_rate;
  /* Subtraction on fractions lands a hair under the bar: 0.12 - 0.10 is
     0.019999999999999997, which must still read as a two-point move. */
  if (Math.abs(delta) < MIN_DELTA - 1e-9) return { verdict: "even", delta };
  return { verdict: delta > 0 ? "better" : "worse", delta };
}

/* The whole payload the page draws. */
export function performance({ rows, tests, now = Date.now(), maxSegments = MAX_SEGMENTS }) {
  const segments = segmentsOf((rows || []).slice(-MAX_READINGS));
  const changes = [];

  const ordered = (tests || [])
    .map((t) => ({ ...t, startedMs: timeOf(t.started_at) }))
    .filter((t) => Number.isFinite(t.startedMs))
    .sort((a, b) => a.startedMs - b.startedMs || Number(a.id) - Number(b.id));

  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i];
    const nextMs = i + 1 < ordered.length ? ordered[i + 1].startedMs : null;
    const afterSegs = sampleAfter(segments, t.startedMs, nextMs);
    const after = totalsOf(afterSegs);
    /* Matched sample: the same number of games before the change as after it,
       so a long run before and a short run after are not compared as if equal. */
    const beforeSegs = after.matches > 0 ? sampleBefore(segments, t.startedMs, after.matches) : [];
    const before = totalsOf(beforeSegs);
    const { verdict, delta } = judge(before, after);
    const kdDelta = before.kd !== null && after.kd !== null ? after.kd - before.kd : null;

    changes.push({
      id: t.id,
      setting: t.setting,
      label: t.label,
      from_value: t.from_value,
      to_value: t.to_value,
      status: t.status,
      started_at: t.started_at,
      decided_at: t.decided_at || null,
      before: { matches: before.matches, wins: before.wins, win_rate: before.win_rate, kd: before.kd },
      after: { matches: after.matches, wins: after.wins, win_rate: after.win_rate, kd: after.kd },
      verdict,
      delta,
      kd_delta: verdict === "too-soon" || kdDelta === null ? null : kdDelta,
    });
  }

  /* Which setting has actually helped, over every change recorded for it.
     A setting only appears once one of its changes has a real verdict. */
  const bySetting = new Map();
  for (const c of changes) {
    if (c.verdict === "too-soon" || c.delta === null) continue;
    const g = bySetting.get(c.setting) || { setting: c.setting, label: c.label, changes: 0, better: 0, worse: 0, matches: 0, deltaSum: 0 };
    g.changes += 1;
    g.matches += c.after.matches;
    g.deltaSum += c.delta;
    if (c.verdict === "better") g.better += 1;
    if (c.verdict === "worse") g.worse += 1;
    bySetting.set(c.setting, g);
  }
  const ranked = [...bySetting.values()]
    .map((g) => ({ setting: g.setting, label: g.label, changes: g.changes, better: g.better, worse: g.worse, matches: g.matches, delta: g.deltaSum / g.changes }))
    .sort((a, b) => b.delta - a.delta);

  const lifetime = lifetimeOf(rows || []);
  const chart = segments.slice(-maxSegments).map((s) => {
    const t = totalsOf([s]);
    return {
      from: s.from, to: s.to, matches: s.matches,
      win_rate: t.win_rate, kd: t.kd,
      change: ordered.some((x) => x.startedMs >= s.fromMs && x.startedMs < s.toMs),
    };
  });

  return {
    lifetime,
    chart,
    sessions: segments.length,
    changes: changes.reverse(),                 // newest first, for the cards
    ranked,
    min_games: MIN_GAMES,
    now,
  };
}
