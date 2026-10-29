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

   What a session was played in
   ---------------------------
   A session is a gap between two cumulative readings, and the counters in it are
   one pile for every mode played. The log says which mode each match was in, so
   each session carries a label: the one mode if every match inside it was that
   mode, "mixed" if more than one was played, "unknown" if nothing in the window
   proves a mode at all. A change's before/after comparison then prefers sessions
   of the same mode as the games after it, because that is the comparison the
   person actually asked for - did this setting help at the mode I play. When
   there are not enough same-mode games on both sides it falls back to the
   blended comparison and says so, rather than quietly comparing a ranked evening
   with an unranked one.

   Nothing here splits a session between modes, and nothing attributes a session
   to a mode it cannot prove: a window that mixed two modes is excluded from a
   mode-split comparison, not divided in half. That is why a mode-split verdict
   is built on fewer sessions and takes longer to arrive - which is the honest
   cost of the only claim the log can support.

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
export const MAX_MATCHES = 400;    /* matches read for labelling; a window never needs more */

/* The three labels a session can carry besides a real mode. Spelled out rather
   than inlined so a caller can test against them without copying the strings. */
export const MODE_MIXED = "mixed";
export const MODE_UNKNOWN = "unknown";
/* The prefix a Creative island's mode key carries. An island is its own kind of
   game: no ladder, no build mode, no team size, and a title instead. Its key can
   therefore never be mistaken for a battle-royale one, which is what stops an
   island's games being pooled with the ladder's. */
export const CREATIVE_KEY = "creative";

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

/* "The log did not say" is not zero.
   A NULL column (D1 hands one back for a counter the API never returned) used to
   reach Number(), which turns null and the empty string into 0, so a missing
   count became a real zero in every segment and every total. The schema comment
   in 0007 promises the opposite in as many words, so the absence is carried as
   null and each caller decides what it can still say without it. Only genuine
   finite input - a number, or a string of one - is rounded. */
const int = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
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

/* The smallest move two windows of `gamesPerSide` games could tell apart, in
   kills a match. This is gamesToSeparate asked backwards, and it is the honest
   answer to "how many games is enough": a window is not useful or useless in the
   abstract, it can only see a move at least this big. At this player's rate ten
   games a side sees nothing smaller than about 2.8 kills a match, so ten games
   can confirm a doubling and cannot see a nudge.

   Null rather than 0 when there is no rate to size it from, because "can see any
   move at all" is not a claim this can make. */
export function moveDetectable(meanKills, gamesPerSide, z = Z_95) {
  const mean = Number(meanKills), n = Number(gamesPerSide);
  if (!Number.isFinite(mean) || mean <= 0) return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = (z * Math.sqrt(2 * mean * OVERDISPERSION)) / Math.sqrt(n);
  return Number.isFinite(d) && d > 0 ? d : null;
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

/* Counters for a set of segments, or for one.

   A counter can be missing from some segments - the stats API returns sparse
   cells, and segmentsOf refuses to invent a delta across a row that had none.
   Those games still happened, so they stay in `matches`; they do not belong in
   the denominator of a rate they contributed nothing to. Each rate is therefore
   divided by the games that actually carried its counter (`kills_matches`,
   `wins_matches`), and `kills_partial` / `wins_partial` say out loud when that
   is fewer games than the sample holds, so the page can qualify the figure
   instead of quoting it as if it covered everything.

   K/D is a ratio of two totals, so it needs both counter sets to cover the same
   games; when they do not, there is no single spread it describes and it is
   null rather than a figure assembled from two different denominators. */
export function totalsOf(segments) {
  let matches = 0, wins = 0, kills = 0, deaths = 0;
  let winsGames = 0, killsGames = 0, deathsGames = 0;
  for (const s of segments || []) {
    const games = Number(s.matches) || 0;
    matches += games;
    if (num(s.wins) !== null) { wins += s.wins; winsGames += games; }
    if (num(s.kills) !== null) { kills += s.kills; killsGames += games; }
    if (num(s.deaths) !== null) { deaths += s.deaths; deathsGames += games; }
  }
  const hasWins = winsGames > 0, hasKills = killsGames > 0, hasDeaths = deathsGames > 0;
  return {
    matches,
    wins: hasWins ? wins : null,
    kills: hasKills ? kills : null,
    deaths: hasDeaths ? deaths : null,
    /* The games behind each total. Equal to `matches` when nothing was missing,
       which is the ordinary case, so a caller reading only `matches` is right
       whenever it was right before. */
    wins_matches: winsGames,
    kills_matches: killsGames,
    deaths_matches: deathsGames,
    kills_partial: hasKills && killsGames < matches,
    wins_partial: hasWins && winsGames < matches,
    win_rate: hasWins ? wins / winsGames : null,
    kd: hasKills && hasDeaths && deaths > 0 && killsGames === deathsGames ? kills / deaths : null,
    kills_per_match: hasKills ? kills / killsGames : null,
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
   it were spread, and a guess is what this whole file exists to avoid.

   `prevMs` is when the previous change to this same setting started, or
   -Infinity when this is the first one. A reading only lands when the counters
   move, so a segment routinely covers hours and can cover an earlier change as
   well. Without this floor the walk reaches back past that change and offers
   games played on an older value as the baseline for this one - a baseline the
   card cannot name, because the value it belonged to is no longer on screen.
   prevChangeOf is the same-setting search that supplies it. */
function sampleBefore(segments, beforeMs, want, prevMs) {
  const floor = prevMs === undefined || prevMs === null ? -Infinity : prevMs;
  const taken = [];
  let have = 0;
  for (let i = segments.length - 1; i >= 0 && have < want; i--) {
    const s = segments[i];
    if (!(s.toMs <= beforeMs)) continue;             // not wholly before the change
    if (!(s.fromMs >= floor)) continue;              // reaches back past the previous change
    taken.push(s);
    have += s.matches;
  }
  return taken.reverse();
}

/* The games since a moment, up to the next change. `nextMs` null means "now".
   Returns the segments it took and how many games it could not place.

   Whole segments only, on this side too. A segment that straddles either end of
   the window holds games from both values, and there is no honest way to say how
   many belong to each. It is left out of both sides rather than credited to the
   new value, which is what used to happen: the entire evening's games went to
   "after" while "before" refused to look at them, so a change that made things
   worse could be reported as an improvement.

   Leaving those games out is only honest if the card admits it. They happened,
   they are in the database, and a card that compares 25 games to 25 while another
   300 sit unmentioned in the middle is telling a true story that reads as a
   complete one. `unplaced` counts the games in readings that overlap this window
   without sitting inside it, so the page can say they are in neither figure. */
function sampleAfterDetailed(segments, afterMs, nextMs) {
  const taken = [];
  let unplaced = 0;
  for (const s of segments) {
    if (s.fromMs >= afterMs && (nextMs === null || s.toMs <= nextMs)) { taken.push(s); continue; }
    /* It overlaps the window, or it would not be in this list at all: a segment
       wholly before the change ends at or before it, and one wholly after the
       next change starts at or after it. */
    if (s.toMs > afterMs && (nextMs === null || s.fromMs < nextMs)) {
      unplaced += Number(s.matches) || 0;
    }
  }
  return { taken, unplaced };
}

/* Better, worse, or not yet, decided by whether the ranges separate.
   Both sides need MIN_GAMES, and both sides need a kill count: with no kills
   there is no primary metric and the change cannot be judged on win rate
   alone, because win rate is the thing that cannot settle at this volume.
   There is no threshold here, and so no epsilon to guard: two intervals that
   touch are not separate, and that is the honest reading of a tie. */

/* The games a side actually has a kill count for. totalsOf reports it; a caller
   that hands over a plain {matches, kills} side is saying all of them. */
const killsGamesOf = (side) => {
  const n = Number(side.kills_matches);
  return Number.isFinite(n) && n >= 0 ? n : Number(side.matches);
};

/* The same question for wins. totalsOf divides win_rate by the games that
   carried a win count, so anything that puts a range around that rate, or pools
   it with the other side, has to divide by the same number. Dividing by every
   game instead brackets a rate that was measured on fewer of them: with 3 wins
   over 10 covered games the interval was built from 20 games and came out about
   two thirds the width of the one that actually holds. A win rate never decides
   a verdict - judge() reads kills only - so this is the figure the card draws
   being untrue about its own coverage, not the scoring. */
const winsGamesOf = (side) => {
  const n = Number(side.wins_matches);
  return Number.isFinite(n) && n >= 0 ? n : Number(side.matches);
};

export function judge(before, after) {
  const blank = (reason) => ({ verdict: "too-soon", delta: null, kills_delta: null, reason, before_interval: null, after_interval: null });
  if (!before || !after || !(after.matches > 0)) return blank("after-thin");
  if (after.kills === null || after.kills === undefined) return blank("kills-missing");
  if (before.kills === null || before.kills === undefined) return blank("kills-missing");

  /* Measured against the games that carry a kill count, not against all of
     them: 40 games with kills on only 20 of them is a 20-game sample however
     many were played, and the interval has to widen for that. */
  const beforeGames = killsGamesOf(before);
  const afterGames = killsGamesOf(after);
  if (beforeGames < MIN_GAMES || afterGames < MIN_GAMES) {
    return blank(beforeGames < MIN_GAMES ? "before-thin" : "after-thin");
  }

  const b = killsInterval(before.kills, beforeGames);
  const a = killsInterval(after.kills, afterGames);
  if (!a || !b) return blank("kills-missing");

  const delta = before.win_rate !== null && after.win_rate !== null ? after.win_rate - before.win_rate : null;
  const killsDelta = a.mean - b.mean;
  const out = { delta, kills_delta: killsDelta, reason: null, before_interval: b, after_interval: a };
  if (a.low > b.high) return { ...out, verdict: "better" };
  if (a.high < b.low) return { ...out, verdict: "worse" };
  return { ...out, verdict: "even" };
}

/* ---------- per-match, from the replays ----------

   Everything above reads the stats API, which counts a whole account. That
   forces every comparison through segments: a change made at 23:40 with one
   reading at 23:30 and the next at 00:10 puts all eight games in one segment
   that straddles the change, and the honest answer there is "these games are in
   neither figure". With four evenings of history the card can therefore compare
   25 games to 25 and leave 300 unmentioned.

   The replay files remove the whole problem, because each one carries its own
   match's end time to the millisecond and its own kills, damage and placement.
   A game that ended at 23:52 is before a change at 23:40 or after it; there is
   no straddle to resolve and nothing to guess. This builds a second, independent
   reading of the same question from those rows.

   Independence is the point, not a side effect. The two sources can disagree,
   and where they do the page should say so rather than blend them: the account
   counters count every game played anywhere, while a replay only exists for a
   match this machine recorded. A replay sample smaller than the counter sample
   is normal, and a disagreement is information, not a bug to smooth over.

   Nothing here is filled in. A match row that is not `recorded` - a Creative
   island, or a file the reader could not read - is not a zero, it is absent. A
   side with fewer than MIN_GAMES recorded matches gets no verdict, the same
   floor the counter path uses. */

/* One match, as the only thing a comparison needs: when it ended, and what
   happened in it. Rows arrive from D1 with snake_case columns; the reader's own
   objects are camelCase, so both spellings are accepted. */
function replayMatchOf(row) {
  if (!row || typeof row !== "object") return null;
  /* recorded is the gate. A row stored with recorded = 0 says, in its own words,
     that it carries no measurements, and reading its nulls as zero kills would
     turn every Creative island into a terrible game that never happened. */
  if (Number(row.recorded) !== 1 && row.recorded !== true) return null;
  const ended = row.ended_at !== undefined ? row.ended_at : row.endedAtUtc;
  const endedMs = timeOf(ended);
  if (!Number.isFinite(endedMs)) return null;
  const kills = int(row.eliminations);
  /* A recorded row with no kill count cannot sit in a kill comparison. It is
     dropped rather than counted as zero, and `killsMissing` below counts it so
     the payload can admit it. */
  /* Headshots are measured by a different reader from everything else on this
     row, so they have their own gate: a row can carry real kills and no headshot
     count, and that absence is never read as zero. int() maps NULL to null, and
     a stored 0 stays 0 - which is a real match where he hit nobody in the head,
     not a reader that failed. */
  const headshots = int(row.headshots);
  const headshotsReason = headshots === null && typeof row.headshots_reason === "string"
    ? row.headshots_reason
    : (headshots === null && typeof row.headshotsReason === "string" ? row.headshotsReason : null);
  return {
    endedMs, kills,
    placement: int(row.placement),
    totalPlayers: int(row.total_players !== undefined ? row.total_players : row.totalPlayers),
    headshots, headshotsReason,
  };
}

/* Headshots across one side of a change.
   `total` is the sum and `games` is how many matches carried a number; `perMatch`
   exists only when at least one did, so it is null rather than 0 when nobody
   counted - the same rule the rest of this file follows, applied to an average.
   `missing` counts the matches on both sides that had kills but no headshot
   count, which is what makes a partial average readable as partial. */
function headshotFigures(before, after) {
  const side = (list) => {
    let total = 0;
    let games = 0;
    for (const m of list) {
      if (!Number.isFinite(m.headshots)) continue;
      total += m.headshots;
      games++;
    }
    return { total: games ? total : null, games, perMatch: games ? total / games : null };
  };
  const b = side(before);
  const a = side(after);
  const missing = (before.length - b.games) + (after.length - a.games);
  return { before: b, after: a, missing };
}

/* The two sides of one change, from individual matches. `floorMs` is the
   previous change to the same setting, for the same reason sampleBefore has one:
   a baseline that reaches back past an earlier change would be measuring games
   played on a value the card cannot name. */
function perMatchSplit(matches, atMs, nextMs, floorMs) {
  const before = [];
  const after = [];
  let killsMissing = 0;
  for (const m of matches) {
    if (m.kills === null) { killsMissing++; continue; }
    if (m.endedMs < atMs) {
      if (m.endedMs >= floorMs) before.push(m);
    } else if (nextMs === null || m.endedMs < nextMs) {
      after.push(m);
    }
  }
  return { before, after, killsMissing };
}

/* Kills per match over an exact set of games.

   This is where the replay path earns its keep. killsInterval above has to
   pretend it does not know how the kills were spread - it only ever sees a
   total - so it multiplies by a made-up overdispersion factor to stop the range
   being too narrow. With the individual counts in hand the spread can be
   measured instead of assumed, so this is a plain standard error over the real
   sample. A run of 0, 0, 9 is wide for a reason; a run of 4, 4, 4 is not, and the
   assumed factor cannot tell them apart. */
export function matchInterval(matches) {
  const games = (matches || []).filter((m) => m && Number.isFinite(m.kills));
  const n = games.length;
  if (n < 2) {
    /* One game has no spread to measure. Its interval is not zero-width - that
       would read as certainty - it is simply not computable, so it is null. */
    return null;
  }
  let sum = 0;
  for (const m of games) sum += m.kills;
  const mean = sum / n;
  let sq = 0;
  for (const m of games) sq += (m.kills - mean) ** 2;
  /* Sample variance, n-1. A variance of exactly zero - four identical games - is
     a real answer, not a division by zero: the range is then the mean itself,
     which is what "every game was the same" means. It is widened by one game's
     worth of Poisson noise anyway, because four identical outcomes is a sample
     of four, not a law. */
  const variance = sq / (n - 1);
  const se = Math.sqrt((variance + mean) / n);
  return { mean, low: Math.max(0, mean - Z_95 * se), high: mean + Z_95 * se, games: n, variance };
}

/* The verdict for one change, from matches instead of counters. Deliberately
   the same rule judge() applies - two 95% intervals that separate - so the two
   readings can be laid side by side without one looking stricter than the other
   for reasons a reader cannot see. */
function judgeMatches(before, after) {
  const blank = (reason) => ({ verdict: "too-soon", reason, kills_delta: null, before_interval: null, after_interval: null });
  if (after.length === 0) return blank("after-thin");
  if (before.length < MIN_GAMES || after.length < MIN_GAMES) {
    return blank(before.length < MIN_GAMES ? "before-thin" : "after-thin");
  }
  const b = matchInterval(before);
  const a = matchInterval(after);
  if (!b || !a) return blank("kills-missing");
  const out = { reason: null, kills_delta: a.mean - b.mean, before_interval: b, after_interval: a };
  if (a.low > b.high) return { ...out, verdict: "better" };
  if (a.high < b.low) return { ...out, verdict: "worse" };
  return { ...out, verdict: "even" };
}

/* ---------- what a session was played in ---------- */

/* The mode a match was played in, as one short key, or null when the log never
   said. Deliberately the same rule as modeKeyOf in tools/zoi-lab-mode.mjs, and
   deliberately not imported from it: this file takes its lookups as arguments
   and imports nothing, and a Pages function should not reach outside its own
   tree. Two matches with the same key were played in the same mode; that is the
   only claim it makes. Accepts a row D1 hands back and a record the agent sends,
   hence both spellings. */
export function modeKeyOf(match) {
  if (!match || typeof match !== "object") return null;
  /* An island is keyed by its title and by nothing else. It has no rank, build or
     team size - the log never states them for one - so keying it on those would
     make every island the same empty key, and then two unrelated islands would
     be "one mode" and their games pooled. */
  if (match.kind === "creative") {
    const title = typeof match.title === "string" ? match.title.trim() : "";
    if (!title) return CREATIVE_KEY + "|";
    return CREATIVE_KEY + "|" + title;
  }
  const ranked = match.ranked;
  const build = match.buildMode !== undefined ? match.buildMode : match.build_mode;
  const team = match.teamSize !== undefined ? match.teamSize : match.team_size;
  const parts = [ranked, build, team].filter((v) => typeof v === "string" && v);
  return parts.length ? parts.join("|") : null;
}

/* The three values scope may take, and nothing else. A mode that is neither
   provably ranked nor provably unranked is not given one of these two words: it
   is compared blended, because the alternative is filing games under a ranked
   heading the log never put them under. */
function scopeOfMode(key) {
  if (typeof key !== "string") return null;
  if (key.startsWith("Ranked|")) return "ranked";
  if (key.startsWith("Unranked|")) return "unranked";
  /* An island is its own scope. It is not ranked and not unranked, so filing it
     under either would be a claim the log never made; and it is not a battle
     royale, so letting it into a blended sample with one is the averaging this
     whole distinction exists to prevent. */
  if (key === CREATIVE_KEY + "|" || key.startsWith(CREATIVE_KEY + "|")) return "creative";
  return null;
}

/* Which mode each session was played in.

   A match belongs to the session whose window it ended inside. The reading at the
   end of a window counts every match finished by then and the reading at its
   start counts none of them, so end time is the one honest placement - no
   interpolation, and no dividing a session between modes.

   The label is a mode only when every match in the window has a mode and they are
   all the same one. Anything else is MODE_MIXED, which here means "not provably
   one mode" and covers both a window that genuinely held two modes and a window
   holding a match the log could not attribute - the second case is why a
   conservative label is the only safe one. A session with no matches in it at
   all is MODE_UNKNOWN, which is different from mixed and is said differently:
   nothing was played, or nothing was logged, and either way there is no claim to
   make. */
function labelSessions(segments, matches) {
  const list = (Array.isArray(matches) ? matches : [])
    .slice(-MAX_MATCHES)
    .map((m) => ({
      key: modeKeyOf(m),
      ms: timeOf(m && (m.ended_at !== undefined && m.ended_at !== null ? m.ended_at : m.endedAt)),
    }))
    .filter((m) => Number.isFinite(m.ms))
    .sort((a, b) => a.ms - b.ms);

  for (const s of segments) {
    const keys = new Set();
    let any = 0;
    let unproven = false;
    for (const m of list) {
      if (!(m.ms > s.fromMs && m.ms <= s.toMs)) continue;
      any += 1;
      if (m.key === null) unproven = true;
      else keys.add(m.key);
    }
    if (!any) s.mode = MODE_UNKNOWN;
    else if (unproven || keys.size !== 1) s.mode = MODE_MIXED;
    else s.mode = [...keys][0];
  }
  return segments;
}

/* The one mode every match in these sessions shares, or null when there is not
   one. Null is the answer for a mix, for a session whose mode is unknown, and for
   an empty sample: none of those is a mode to compare on. */
function singleModeOf(segments) {
  const modes = new Set();
  let matches = 0;
  for (const s of segments || []) {
    matches += Number(s.matches) || 0;
    if (s.mode === MODE_MIXED || s.mode === MODE_UNKNOWN || typeof s.mode !== "string") return null;
    modes.add(s.mode);
  }
  if (!(matches > 0) || modes.size !== 1) return null;
  return [...modes][0];
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

/* The change before this one, for the purpose of stopping this change's baseline
   from reaching back past a value the card cannot name.

   Only an earlier change to the SAME setting does that. Changing one setting does
   not make another setting's history unreadable: he opens the menu once and moves
   several at a time, and each of those cards still deserves the games played
   before any of them. Using the previous change to any setting at all put the
   floor at that change, which is the same instant as this one whenever the batch
   went up in one snapshot - and then both windows are empty and every card in the
   batch reads "too soon" for no reason but ordering.

   A change to another setting is still a real limit on the sample, just not this
   one's business: it is handled where it belongs, as the `nextMs` of the change
   that made it. */
function prevChangeOf(ordered, i) {
  const setting = ordered[i] && ordered[i].setting;
  for (let j = i - 1; j >= 0; j--) {
    if (ordered[j].setting === setting) return ordered[j].startedMs;
  }
  return -Infinity;
}

/* The change after this one.

   Changes sharing this one's instant are skipped: they are the same event, not a
   later state of the world. One snapshot moving four settings opens four tests
   stamped with the same second, and taking the next test's start as this one's
   end would leave this change's window empty - the first setting in the batch
   could never be scored at all.

   KNOWN LIMITATION, not solved here: two changes a few seconds apart with no
   reading landing between them still cannot be scored. The reading that covers
   the gap reports one movement of the counters; nothing in it says how many games
   were played on the intermediate value, so the earlier change's window has no
   honest contents. Such a change reads "too soon", which is true, though the card
   then also says "0 since the change", which is not. The real fix is per-match
   stats - a kill count and a win per match, stamped with its end time - which
   would place games inside a window instead of only at the readings either side
   of it. A time-based heuristic was tried and made a different case wrong, so it
   is not done here. */
function nextChangeOf(ordered, i) {
  const startedMs = ordered[i] && ordered[i].startedMs;
  for (let j = i + 1; j < ordered.length; j++) {
    if (ordered[j].startedMs > startedMs) return ordered[j].startedMs;
  }
  return null;
}

export function performance({ rows, tests, now = Date.now(), maxSegments = MAX_SEGMENTS, watch = null, matches = null, replays = null }) {
  const segments = labelSessions(segmentsOf((rows || []).slice(-MAX_READINGS)), matches);
  /* The replay rows, oldest first, read once. `replays` is null when the caller
     did not send any - a database without 0010, or a read that failed - and that
     is different from an empty list: null means "the second reading is not
     available here", and the payload says so rather than reporting zero games. */
  const replayMatches = Array.isArray(replays)
    ? replays.map(replayMatchOf).filter(Boolean).sort((a, b) => a.endedMs - b.endedMs)
    : null;
  /* The header's lifetime numbers, read once here because the per-change target
     sizing below falls back to the lifetime kill rate. */
  const lifetime = lifetimeOf(rows || []);
  const watchFor = watcherFor(watch);
  const changes = [];

  const ordered = (tests || [])
    .map((t) => ({ ...t, startedMs: timeOf(t.started_at) }))
    .filter((t) => Number.isFinite(t.startedMs))
    .sort((a, b) => a.startedMs - b.startedMs || Number(a.id) - Number(b.id));

  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i];
    const nextMs = nextChangeOf(ordered, i);
    const prevMs = prevChangeOf(ordered, i);

    /* The blended sample first, exactly as it was before any of this existed. It
       is what an agent sending no matches still gets, and it is the fallback. */
    const blendedDetail = sampleAfterDetailed(segments, t.startedMs, nextMs);
    const blendedAfterSegs = blendedDetail.taken;
    const blendedAfter = totalsOf(blendedAfterSegs);
    /* Games this change's window cannot account for, carried to the payload so
       the card can admit them. Replaced below if the comparison narrows to one
       mode, since then only that mode's unplaced games are relevant. */
    let unplaced = blendedDetail.unplaced;
    const blendedBeforeSegs = blendedAfter.matches > 0
      ? sampleBefore(segments, t.startedMs, blendedAfter.matches, prevMs)
      : [];
    const blendedBefore = totalsOf(blendedBeforeSegs);

    /* Then the same question asked of one mode. The games after the change are
       what decide which mode that is: they are the ones just played, so they are
       the ones the answer is wanted for. If they are not provably one mode there
       is nothing to narrow to and the blended comparison is the only honest one. */
    const afterMode = singleModeOf(blendedAfterSegs);
    let scope = "blended";
    let after = blendedAfter;
    let before = blendedBefore;

    if (afterMode !== null) {
      const scopedDetail = sampleAfterDetailed(segments.filter((x) => x.mode === afterMode), t.startedMs, nextMs);
      const scopedAfterSegs = scopedDetail.taken;
      const scopedAfter = totalsOf(scopedAfterSegs);
      const scopedBeforeSegs = scopedAfter.matches > 0
        ? sampleBefore(segments.filter((x) => x.mode === afterMode), t.startedMs, scopedAfter.matches, prevMs)
        : [];
      const scopedBefore = totalsOf(scopedBeforeSegs);

      /* Same mode on both sides only if both sides can stand on their own. A
         mode split that drops one side under MIN_GAMES would answer "too soon"
         where a blended answer was already available, which trades a real answer
         for a narrower one that is not there yet. So it falls back, and the
         fallback is labelled blended rather than passed off as a mode result. */
      const enough = scopedBefore.matches >= MIN_GAMES && scopedAfter.matches >= MIN_GAMES;
      if (enough) {
        scope = scopeOfMode(afterMode) || "blended";
        after = scopedAfter;
        before = scopedBefore;
        unplaced = scopedDetail.unplaced;
      }
    }

    const j = judge(before, after);

    /* The same question asked of the individual games the replays recorded.
       Independent of the counter path above - different source, different
       arithmetic, and it does not fall back to it, because a comparison that
       quietly changes source halfway is not a second opinion. When there are no
       replays the whole block is null and the page shows the counter reading
       alone, exactly as it did before this existed. */
    let byMatch = null;
    if (replayMatches !== null) {
      const split = perMatchSplit(replayMatches, t.startedMs, nextMs, prevMs === null || prevMs === undefined ? -Infinity : prevMs);
      const mj = judgeMatches(split.before, split.after);
      const beforeRate = split.before.length ? split.before.reduce((n, m) => n + m.kills, 0) / split.before.length : null;
      const afterRate = split.after.length ? split.after.reduce((n, m) => n + m.kills, 0) / split.after.length : null;
      /* Headshots over exactly the matches this block is already counting, so
         the figures and the kill rates describe the same set of games. A side
         with no headshot number contributes nothing rather than a zero: the
         count of matches that carried one travels beside the figure, and the
         page prints nothing at all when no side has one. */
      const shots = headshotFigures(split.before, split.after);
      byMatch = {
        verdict: mj.verdict,
        reason: mj.reason,
        before: split.before.length,
        after: split.after.length,
        headshots_before: shots.before.total,
        headshots_after: shots.after.total,
        headshots_per_match_before: shots.before.perMatch,
        headshots_per_match_after: shots.after.perMatch,
        /* How many matches on each side actually carried a count. Without it a
           per-match average over two of ninety matches would read as the
           evening's average. */
        headshots_games_before: shots.before.games,
        headshots_games_after: shots.after.games,
        /* Matches with a kill count that no reader gave a headshot number for,
           so the page can say the average covers part of the side instead of
           letting it stand for the whole. */
        headshots_missing: shots.missing,
        kills_before: beforeRate,
        kills_after: afterRate,
        kills_delta: mj.kills_delta,
        kills_interval: { before: mj.before_interval, after: mj.after_interval },
        /* Matches a replay recorded that the counter sample never saw, in either
           direction. This is the one number that explains a disagreement
           between the two readings, so it is carried rather than hidden. */
        unmatched: split.killsMissing,
        /* Games on each side that no replay accounts for but the counters did.
           Not an error: a replay only exists for a match this machine recorded,
           so a session played elsewhere is real games with no per-match row. */
        counters_only: Math.max(0, (after.matches - split.after.length) + (before.matches - split.before.length)),
        min_games: MIN_GAMES,
      };
    }

    /* Bracketed over the games the win count covers, not over every game in the
       sample. Those are the same number whenever no read was missing a counter,
       which is the ordinary case. */
    const winBeforeGames = winsGamesOf(before);
    const winAfterGames = winsGamesOf(after);
    const winBefore = before.wins !== null && winBeforeGames > 0 ? wilson(before.wins, winBeforeGames) : null;
    const winAfter = after.wins !== null && winAfterGames > 0 ? wilson(after.wins, winAfterGames) : null;

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
    /* Sized from the pooled before/after rate when both sides have one, and from
       the player's own lifetime rate when they do not.

       This used to be null the moment either interval was missing, which is
       exactly the case an OPEN test starts in: a change made an hour ago has no
       after-interval yet, so the target came back null and the progress bar
       vanished - on an account with four thousand games of history. The card then
       said "no kill rate to size a target from yet", which was untrue. A test in
       progress always knows the player's rate; it just may not know the rate
       since the change, and the lifetime rate is the honest stand-in for sizing
       a target. */
    const rateForTarget = meanKills !== null && Number.isFinite(meanKills) && meanKills > 0
      ? meanKills
      : (lifetime && lifetime.kills !== null && lifetime.matches > 0
        ? lifetime.kills / lifetime.matches
        : null);
    const games_target = rateForTarget !== null && Number.isFinite(rateForTarget) && rateForTarget > 0
      ? gamesForEffect(designEffect, rateForTarget)
      : null;

    /* The same question asked of win rate, so the page can put a price on it
       next to the kills figure. Sized from the pooled win rate, which is the
       least flattering (largest-variance) choice for a rate near eleven
       percent, and null whenever there is no move to size. */
    /* Pooled over the games both sides have a win count for, for the same reason
       the intervals are: a pooled rate is what sizes the win-rate targets below,
       and a rate divided by games it does not cover would understate the noise
       and quote a target that is too small. */
    const pooledGames = winBeforeGames + winAfterGames;
    const pooled = pooledGames > 0 && before.wins !== null && after.wins !== null
      ? (before.wins + after.wins) / pooledGames
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
        /* How many of those games the kill count actually covers, so the card
           can say when a rate rests on fewer games than the sample holds. Same
           for wins, which the card draws a rate and a range for. */
        kills_matches: before.kills_matches,
        kills_partial: before.kills_partial === true,
        wins_matches: before.wins_matches,
        wins_partial: before.wins_partial === true,
      },
      after: {
        matches: after.matches, wins: after.wins, kills: after.kills,
        win_rate: after.win_rate, kd: after.kd, kills_per_match: after.kills_per_match,
        kills_matches: after.kills_matches,
        kills_partial: after.kills_partial === true,
        wins_matches: after.wins_matches,
        wins_partial: after.wins_partial === true,
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
      /* Which mode this comparison was run in. 'ranked' and 'unranked' mean both
         sides were proved to be entirely that mode; 'blended' means they were
         not, and the numbers are the old all-modes-together ones. Said out loud
         on the page, because a mode split is a narrower sample and the reader
         should know which they are looking at. */
      scope,
      /* The mode key the split was run on, for a caller that wants to name it
         ("Ranked · Zero Build · Solo"). Null when the comparison is blended. */
      mode: scope === "blended" ? null : afterMode,
      /* Games played inside this change's window that no reading placed cleanly
         on one side: the read that covered them began before the change and
         ended after it. They are in neither figure. Counted here so the card can
         say so; 0 when every game was placed. */
      unplaced,
      /* The per-match reading of this same change, from the replay files. Null
         when no replays were loaded at all; otherwise its own verdict, which may
         disagree with the counter one and is allowed to. */
      by_match: byMatch,
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

  const chart = segments.slice(-maxSegments).map((s) => {
    const t = totalsOf([s]);
    /* The same interval the verdict uses, per session, so the page can draw the
       spread it is actually reading rather than a bare line that looks precise.
       Null when the session has no kill count, never a zero-width band. */
    const ci = t.kills !== null && t.kills_matches > 0 ? killsInterval(t.kills, t.kills_matches) : null;
    return {
      from: s.from, to: s.to, matches: s.matches,
      kills: s.kills === undefined ? null : s.kills,
      kills_per_match: t.kills_per_match,
      kills_low: ci ? ci.low : null,
      kills_high: ci ? ci.high : null,
      win_rate: t.win_rate, kd: t.kd,
      /* A session of one or two games drawn as a confident dot at 0% is a lie
         the eye believes. Below the floor the point is marked, and the page
         draws it as a hollow mark rather than on the line. */
      thin: s.matches < CHART_MIN_GAMES,
      change: ordered.some((x) => x.startedMs >= s.fromMs && x.startedMs < s.toMs),
      /* What this session was played in, so a reader can see that a dot they are
         comparing came from a different mode. */
      mode: s.mode,
    };
  });

  /* Windows counted in games, not days. The page leads with these instead of
     the lifetime totals, because "since the last change" is the window that
     answers the only question the lab exists for. Both are built over whole
     sessions, so each carries the number of games it really got.

     `sinceChange` is the window the last change opened - the primary reading on
     the page - and is null before the first change. `recent` is the fixed
     games window, which is the honest second opinion: it says how big a move a
     handful of games can see, so a short window reads as short. */
  const lastChangeMs = ordered.length ? ordered[ordered.length - 1].startedMs : null;
  const sinceChangeSegs = lastChangeMs === null ? [] : segments.filter((s) => s.fromMs >= lastChangeMs);
  const sinceChangeTotals = sinceChangeSegs.length ? totalsOf(sinceChangeSegs) : null;
  const sinceChange = sinceChangeTotals === null ? null : {
    ...sinceChangeTotals,
    from: sinceChangeSegs[0].from,
    to: sinceChangeSegs[sinceChangeSegs.length - 1].to,
    sessions: sinceChangeSegs.length,
    /* Games that the open reading covering the change cannot place: they exist
       and they are not in the figure, so they are counted here rather than
       silently dropped. */
    unplaced: lastChangeMs === null ? 0 : sampleAfterDetailed(segments, lastChangeMs, null).unplaced,
    detectable: sinceChangeTotals.kills_per_match !== null
      ? moveDetectable(sinceChangeTotals.kills_per_match, sinceChangeTotals.kills_matches)
      : null,
    interval: sinceChangeTotals.kills !== null && sinceChangeTotals.kills_matches > 0
      ? killsInterval(sinceChangeTotals.kills, sinceChangeTotals.kills_matches)
      : null,
    started_at: ordered.length ? ordered[ordered.length - 1].started_at : null,
    setting: ordered.length ? ordered[ordered.length - 1].setting : null,
    label: ordered.length ? ordered[ordered.length - 1].label : null,
  };
  /* The rate every target is priced at: the lifetime figure, which is what the
     page uses when it has to say "this many games to see a move like that".

     There is deliberately ONE window on this payload, not two. A fixed "last N
     games" window sitting beside the since-change window would nearly always be
     drawn from inside it - at this volume fifty games is often the whole since-
     change sample - and two figures built from the same games agreeing with each
     other is not a second opinion, it is the same reading printed twice. That
     exact shape was removed from this file once already for that reason, and it
     is not coming back under a new name. */
  const lifetimeRate = lifetime && lifetime.kills !== null && lifetime.matches > 0
    ? lifetime.kills / lifetime.matches
    : null;

  return {
    lifetime,
    lifetime_rate: lifetimeRate,
    since_change: sinceChange,
    /* How big a move this player's own sample size can see. Quoted next to the
       window so a short one reads as short instead of as a number to believe. */
    detectable_at_since_change: sinceChange ? sinceChange.detectable : null,
    chart,
    sessions: segments.length,
    changes: changes.reverse(),                 // newest first, for the cards
    ranked,
    primary: PRIMARY,
    min_games: MIN_GAMES,
    chart_min_games: CHART_MIN_GAMES,
    now,
  };
}
