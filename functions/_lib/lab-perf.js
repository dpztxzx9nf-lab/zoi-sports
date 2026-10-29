/* What the readings and the recorded changes add up to, worked out once here so
   the page only has to draw it.

   The numbers are cumulative counters from Epic (matches, wins, kills) read off
   a PC. Two readings in order give the games played between them, so the gap
   between readings is a "session" and its win rate is real arithmetic rather
   than an opinion. A setting change sits somewhere on that timeline; the games
   after it can be compared with the same number of games before it.

   Nothing here invents a number, and nothing here calls a move real just because
   one number is bigger than another. Each side of a change carries an interval,
   and a verdict needs the two intervals to separate. At this player's volume win
   rate almost never separates: eleven percent on a hundred games has a standard
   error around three points, so a two-point move is noise dressed up as a
   finding. Kills per match moves enough to read, so that is the metric a change
   is judged on. Win rate is still carried, as a slow second opinion.

   Pure: takes rows and a clock, returns a payload. No database, no fetch, and no
   imports, so lookups arrive as arguments. */

export const MIN_GAMES = 25;       /* below this on either side, no verdict */
export const CHART_MIN_GAMES = 5;  /* a chart dot under this is marked thin */
export const Z_95 = 1.96;          /* two-sided 95% */
export const MIN_POWER = 0.8;
/* The smallest win-rate move worth acting on, as a fraction. Used only to put a
   price on win rate, never to decide a verdict: at eleven percent a three-point
   move needs about 1,700 games a side, which is the number the page quotes. */
const WIN_RATE_EFFECT = 0.03;      /* 80% power, the usual default */
export const OVERDISPERSION = 2.5; /* see killsInterval */
export const PRIMARY = "kills_per_match";
export const MAX_SEGMENTS = 60;    /* what the chart draws */
export const MAX_READINGS = 400;

/* Why MIN_GAMES is 25 rather than a round 10.
   A verdict needs the two kills-per-match intervals to separate. At this
   player's 4.8 kills a match, a 25-game side has a 95% half-width of about 1.35
   kills a match, so both sides together can only separate a move bigger than
   about 2.7. Ten games a side, the old floor, cannot separate anything smaller
   than about 4.2, which is most of the way to "twice as many kills". Ten was
   never a sample, it was a coin toss with a label on it. 25 is also roughly two
   evenings of play, so it is a floor that can actually be cleared. */

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

/* ---------- the maths a verdict can stand on ---------- */

/* Wilson score interval for a proportion. Unlike the normal approximation it
   does not fall apart at 0 of 5 or 5 of 5, which is exactly where a small
   session lives, so the win-rate range stays honest at the sizes this log sees.
   Returns null when there is nothing to measure. */
export function wilson(wins, n, z = Z_95) {
  const w = Number(wins), m = Number(n), zz = Number(z);
  if (!Number.isFinite(w) || !Number.isFinite(m) || !Number.isFinite(zz)) return null;
  /* A negative or impossible win count is bad input, not a rate to clamp. Saying
     so is better than quietly reporting an interval for a number that cannot
     happen, which would hide a broken counter behind a plausible-looking fig. */
  if (m <= 0 || w < 0 || w > m) return null;
  const p = w / m;
  const denom = 1 + (zz * zz) / m;
  const centre = (p + (zz * zz) / (2 * m)) / denom;
  const half = (zz * Math.sqrt((p * (1 - p)) / m + (zz * zz) / (4 * m * m))) / denom;
  return {
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

/* Interval for kills per match, from a total only.
   A Poisson variance would be mean / matches, but kills per game are not
   Poisson: a lot of games end on zero and a few end on eight, and that spread
   makes the real variance bigger. We do not have the per-game counts, so this
   is an approximation standing in for the variance we cannot see: the Poisson
   base, multiplied by an explicit overdispersion factor of 2.5. The factor is
   deliberately on the generous side, because a range that is a little too wide
   makes the page slower to call a change than the truth would, and a slow wrong
   answer is much cheaper here than a confident one. */
export function killsInterval(kills, matches, z = Z_95) {
  const k = Number(kills), m = Number(matches), zz = Number(z);
  if (!Number.isFinite(k) || !Number.isFinite(m) || !Number.isFinite(zz)) return null;
  if (m <= 0) return null;
  const mean = Math.max(0, k) / m;
  const se = Math.sqrt((mean * OVERDISPERSION) / m);
  const low = Math.max(0, mean - zz * se);
  let high = mean + zz * se;
  /* A blank run gives a mean of zero and so a zero-width range, which would read
     as certainty about a game that has simply not happened. The Poisson upper
     limit for zero events, widened by the same factor, says "none, up to about
     this" instead. */
  if (high <= 0) high = (3.689 * Math.sqrt(OVERDISPERSION)) / m;
  return { mean, low, high };
}

/* Inverse standard normal, so a power other than 80% stays a number rather than
   a table entry. Acklam's rational approximation, good to about a billionth. */
function zFor(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > hi) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* Games per side a move of `effect` needs, at `variance` per game (the same
   units as the effect) and the given power. The textbook two-sample formula:
   the difference of two means has variance 2 * v / n, so
   n = 2 * (z_alpha + z_beta)^2 * v / effect^2.
   Null rather than Infinity or NaN when the question has no answer: a move of
   zero is not a move, and a variance of zero is not a measurement. */
export function gamesNeeded(effect, variance, power = MIN_POWER) {
  const d = Math.abs(Number(effect));
  const v = Number(variance);
  const p = Number(power);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  const n = (2 * (Z_95 + zFor(p)) ** 2 * v) / (d * d);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}

/* The games at which the two intervals would actually stop overlapping, which
   is the rule judge() uses. It is a stricter test than the textbook formula
   above: two 95% intervals that only just touch sit about 2.8 standard errors
   apart, so this lands near twice gamesNeeded. Both are carried and both are
   real; the textbook figure is what "a 3-point move needs 1,700 games" means,
   and this one is what the progress bar measures against, so the bar and the
   verdict agree. Null when there is no move to size. */
export function gamesToSeparate(effect, meanBefore, meanAfter, z = Z_95) {
  const d = Math.abs(Number(effect));
  const b = Number(meanBefore), a = Number(meanAfter);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (!Number.isFinite(b) || !Number.isFinite(a) || b < 0 || a < 0) return null;
  const sd = Math.sqrt(b * OVERDISPERSION), se = Math.sqrt(a * OVERDISPERSION);
  const n = ((z * (sd + se)) / d) ** 2;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}

/* The games a change like this would need, given the player's own kill rate.
   A move of one kill a match at 4.8 kills a match lands near 190 games a side;
   a three-point win-rate move lands near 1,700. Nothing here decides anything,
   it just puts a price on the evidence. */
export function gamesForEffect(effect, killsPerMatch) {
  const mean = Number(killsPerMatch);
  if (!Number.isFinite(mean) || mean <= 0) return null;
  return gamesNeeded(effect, mean * OVERDISPERSION, MIN_POWER);
}

/* ---------- counters ---------- */

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
    kills_per_match: matches > 0 && hasKills ? kills / matches : null,
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

/* Better, worse, or not yet, decided by whether the ranges separate.
   Both sides need MIN_GAMES, and both sides need a kill count: with no kills
   there is no primary metric and the change cannot be judged on win rate
   alone, because win rate is the thing that cannot settle at this volume.
   There is no threshold here, and so no epsilon to guard: two intervals that
   touch are not separate, and that is the honest reading of a tie. */
export function judge(before, after) {
  const blank = (reason) => ({ verdict: "too-soon", delta: null, kills_delta: null, reason, before_interval: null, after_interval: null });
  if (!before || !after || !(after.matches > 0)) return blank("after-thin");
  if (after.kills === null || after.kills === undefined) return blank("kills-missing");
  if (before.kills === null || before.kills === undefined) return blank("kills-missing");
  if (before.matches < MIN_GAMES || after.matches < MIN_GAMES) {
    return blank(before.matches < MIN_GAMES ? "before-thin" : "after-thin");
  }

  const b = killsInterval(before.kills, before.matches);
  const a = killsInterval(after.kills, after.matches);
  if (!a || !b) return blank("kills-missing");

  const delta = before.win_rate !== null && after.win_rate !== null ? after.win_rate - before.win_rate : null;
  const killsDelta = a.mean - b.mean;
  const out = { delta, kills_delta: killsDelta, reason: null, before_interval: b, after_interval: a };
  if (a.low > b.high) return { ...out, verdict: "better" };
  if (a.high < b.low) return { ...out, verdict: "worse" };
  return { ...out, verdict: "even" };
}

/* Rolling recent form, so the page has something that moves in weeks when no
   setting changed. Null, never zero, where the readings do not reach. */
function formOf(segments) {
  if (!segments.length) return null;
  const t = totalsOf(segments);
  if (!(t.matches > 0)) return null;
  return { matches: t.matches, kills_per_match: t.kills_per_match, win_rate: t.win_rate, kd: t.kd };
}

function recentOf(segments) {
  const lastSessions = segments.slice(-10);
  /* The last 100 games, walked back over whole segments like every other
     sample here, so it can land a few games over 100 rather than guess. */
  return {
    sessions: formOf(lastSessions),
    games: formOf(sampleBefore(segments, Infinity, 100)),
  };
}

/* ---------- the whole payload ---------- */

/* watchFor is the lookup the caller threads in: a Map or a plain object keyed
   by setting id. It is an argument rather than an import so this file stays
   free of lab.js and of the database. */
function watcherFor(watch) {
  /* Trimmed here rather than trusted from the caller: this is the last place
     the text passes through, and a stray newline would show up as a gap in the
     card. A blank note is null, never an empty string. */
  const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (!watch) return () => null;
  if (typeof watch.get === "function") return (id) => clean(watch.get(id));
  return (id) => (Object.prototype.hasOwnProperty.call(watch, id) ? clean(watch[id]) : null);
}

export function performance({ rows, tests, now = Date.now(), maxSegments = MAX_SEGMENTS, watch = null }) {
  const segments = segmentsOf((rows || []).slice(-MAX_READINGS));
  const watchFor = watcherFor(watch);
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
    const j = judge(before, after);

    const winBefore = before.wins !== null && before.matches > 0 ? wilson(before.wins, before.matches) : null;
    const winAfter = after.wins !== null && after.matches > 0 ? wilson(after.wins, after.matches) : null;

    /* Sized from the move actually seen, so an open test has a target. Null when
       there is no move to size: a target built on zero would be Infinity. */
    const effect = j.before_interval && j.after_interval ? Math.abs(j.after_interval.mean - j.before_interval.mean) : null;
    const meanKills = j.before_interval && j.after_interval ? (j.before_interval.mean + j.after_interval.mean) / 2 : null;
    const games_needed = effect !== null && meanKills !== null ? gamesForEffect(effect, meanKills) : null;
    const games_to_settle = effect !== null && j.before_interval && j.after_interval
      ? gamesToSeparate(effect, j.before_interval.mean, j.after_interval.mean)
      : null;

    /* The number a test in progress is played against: the games a move of one
       kill a match would need at this player's kill rate. games_needed above is
       the move actually seen so far, and early in a test that figure is close to
       zero because both windows are mostly the same games, which squares into a
       target in the tens of thousands. That is not a plan, it is an artefact of
       having nothing to measure yet, so progress is measured against a target
       set from the smallest move worth caring about instead. Null only when
       there is no kill rate to size it from. */
    const designEffect = 1;
    const games_target = meanKills !== null && Number.isFinite(meanKills) && meanKills > 0
      ? gamesForEffect(designEffect, meanKills)
      : null;

    /* The same question asked of win rate, so the page can put a price on it
       next to the kills figure. Sized from the pooled win rate, which is the
       least flattering (largest-variance) choice for a rate near eleven
       percent, and null whenever there is no move to size. */
    const pooled = before.matches > 0 && after.matches > 0 && before.wins !== null && after.wins !== null
      ? (before.wins + after.wins) / (before.matches + after.matches)
      : null;
    const win_games_needed = pooled !== null && j.delta !== null && Math.abs(j.delta) > 0
      ? gamesNeeded(Math.abs(j.delta), pooled * (1 - pooled), MIN_POWER)
      : null;

    /* The same question asked of a move worth having rather than the move that
       happened to show up. Sizing the observed win-rate move is a trap: half a
       point of noise squares into hundreds of thousands of games, which is a
       true number that says nothing useful. Three points is the smallest
       win-rate move worth acting on, so that is the figure the page quotes,
       alongside the move actually seen for contrast. */
    const win_games_target = pooled !== null && pooled > 0 && pooled < 1
      ? gamesNeeded(WIN_RATE_EFFECT, pooled * (1 - pooled), MIN_POWER)
      : null;

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
      watch: watchFor(t.setting) || (typeof t.watch_for === "string" && t.watch_for.trim() ? t.watch_for : null),
      before: {
        matches: before.matches, wins: before.wins, kills: before.kills,
        win_rate: before.win_rate, kd: before.kd, kills_per_match: before.kills_per_match,
      },
      after: {
        matches: after.matches, wins: after.wins, kills: after.kills,
        win_rate: after.win_rate, kd: after.kd, kills_per_match: after.kills_per_match,
      },
      kills_interval: { before: j.before_interval, after: j.after_interval },
      win_rate_interval: { before: winBefore, after: winAfter },
      verdict: j.verdict,
      reason: j.reason,
      delta: j.delta,                            // win rate, the slow signal
      kills_delta: j.verdict === "too-soon" ? null : j.kills_delta,
      kd_delta: j.verdict === "too-soon" || kdDelta === null ? null : kdDelta,
      games_needed,
      games_to_settle,
      games_target,
      design_effect: designEffect,
      win_games_needed,
      win_games_target,
      win_rate_effect: WIN_RATE_EFFECT,
      primary: PRIMARY,
    });
  }

  /* Which setting has actually helped, over every change recorded for it.
     Ordered by kills a match, because that is the number that can move. A
     setting only appears once one of its changes has a real verdict. */
  const bySetting = new Map();
  for (const c of changes) {
    if (c.verdict === "too-soon") continue;
    const g = bySetting.get(c.setting) || {
      setting: c.setting, label: c.label, changes: 0, better: 0, worse: 0,
      matches: 0, killsSum: 0, killsN: 0, deltaSum: 0, deltaN: 0,
    };
    g.changes += 1;
    g.matches += c.after.matches;
    if (typeof c.kills_delta === "number" && Number.isFinite(c.kills_delta)) { g.killsSum += c.kills_delta; g.killsN += 1; }
    if (typeof c.delta === "number" && Number.isFinite(c.delta)) { g.deltaSum += c.delta; g.deltaN += 1; }
    if (c.verdict === "better") g.better += 1;
    if (c.verdict === "worse") g.worse += 1;
    bySetting.set(c.setting, g);
  }
  const ranked = [...bySetting.values()]
    .map((g) => ({
      setting: g.setting,
      label: g.label,
      changes: g.changes,
      better: g.better,
      worse: g.worse,
      matches: g.matches,
      kills_delta: g.killsN ? g.killsSum / g.killsN : null,
      delta: g.deltaN ? g.deltaSum / g.deltaN : null,
    }))
    .sort((a, b) => {
      const x = a.kills_delta, y = b.kills_delta;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });

  const lifetime = lifetimeOf(rows || []);
  const chart = segments.slice(-maxSegments).map((s) => {
    const t = totalsOf([s]);
    return {
      from: s.from, to: s.to, matches: s.matches,
      kills: s.kills === undefined ? null : s.kills,
      kills_per_match: t.kills_per_match,
      win_rate: t.win_rate, kd: t.kd,
      /* A session of one or two games drawn as a confident dot at 0% is a lie
         the eye believes. Below the floor the point is marked, and the page
         draws it as a hollow mark rather than on the line. */
      thin: s.matches < CHART_MIN_GAMES,
      change: ordered.some((x) => x.startedMs >= s.fromMs && x.startedMs < s.toMs),
    };
  });

  return {
    lifetime,
    chart,
    recent: recentOf(segments),
    sessions: segments.length,
    changes: changes.reverse(),                 // newest first, for the cards
    ranked,
    primary: PRIMARY,
    min_games: MIN_GAMES,
    chart_min_games: CHART_MIN_GAMES,
    now,
  };
}
