/* Per-mode COD lab numbers. Settings tests are global; the matches that
   score them are not. Each call is for one mode, and two modes are never
   averaged together.

   The verdict is the same shape as the Fortnite lab: better / worse / even /
   too-soon, judged on kills a match, with 25 games a side before a call.
   The second chart is the mode's outcome: extraction rate in DMZ, win rate
   everywhere else. Charts stay hidden until a mode has CHART_MIN matches. */

import { modeOf, modeOutcome } from "./lab-cod.js";

export const COD_MIN_GAMES = 25;
export const COD_CHART_MIN_GAMES = 5;
const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const timeOf = (value) => {
  const s = String(value || "").trim();
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)
    ? s.replace(" ", "T") + "Z" : s;
  return Date.parse(iso);
};

function rate(wins, n) {
  if (!n) return null;
  return wins / n;
}

function mean(sum, n) {
  if (!n) return null;
  return sum / n;
}

function interval(values) {
  /* Normal 95% interval on the mean, or null when the sample is too small
     to put a range on. Same idea the Fortnite verdict uses: a call needs
     two ranges that do not touch. */
  const n = values.length;
  if (n < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const varSum = values.reduce((a, v) => a + (v - m) * (v - m), 0);
  const se = Math.sqrt(varSum / (n * (n - 1)));
  if (!Number.isFinite(se)) return null;
  const z = 1.96;
  return { lo: m - z * se, hi: m + z * se, mean: m, n };
}

function sideOf(matches, outcome) {
  const n = matches.length;
  const kills = matches.map((m) => Number(m.kills)).filter(isNum);
  const killSum = kills.reduce((a, b) => a + b, 0);
  let wins = 0;
  let scored = 0;
  for (const m of matches) {
    if (outcome === "extraction") {
      if (m.extracted === 1 || m.extracted === 0 || m.extracted === true || m.extracted === false) {
        scored += 1;
        if (m.extracted === 1 || m.extracted === true) wins += 1;
      }
    } else if (m.won === 1 || m.won === 0 || m.won === true || m.won === false) {
      scored += 1;
      if (m.won === 1 || m.won === true) wins += 1;
    }
  }
  return {
    matches: n,
    kills: kills.length ? killSum : null,
    kills_per_match: mean(killSum, kills.length),
    kills_matches: kills.length,
    outcome_rate: rate(wins, scored),
    outcome_matches: scored,
    outcome_wins: scored ? wins : 0,
    kills_values: kills,
  };
}

function verdictOf(before, after, minGames) {
  if (!before || !after || before.matches < minGames || after.matches < minGames) {
    return { verdict: "too-soon", kills_delta: null };
  }
  const b = before.kills_per_match;
  const a = after.kills_per_match;
  const delta = isNum(b) && isNum(a) ? a - b : null;
  const bInt = interval(before.kills_values);
  const aInt = interval(after.kills_values);
  if (!bInt || !aInt || !isNum(delta)) {
    return { verdict: "too-soon", kills_delta: delta, kills_interval: { before: bInt, after: aInt } };
  }
  let verdict = "even";
  if (aInt.lo > bInt.hi) verdict = "better";
  else if (aInt.hi < bInt.lo) verdict = "worse";
  return {
    verdict,
    kills_delta: delta,
    kills_interval: { before: bInt, after: aInt },
  };
}

function splitAround(matches, when) {
  const t = timeOf(when);
  const before = [];
  const after = [];
  if (!Number.isFinite(t)) return { before, after };
  for (const m of matches) {
    const mt = timeOf(m.played_at);
    if (!Number.isFinite(mt)) continue;
    if (mt < t) before.push(m);
    else after.push(m);
  }
  return { before, after };
}

function sessionsOf(matches, changes, outcome) {
  const sorted = matches.slice().sort((a, b) => timeOf(a.played_at) - timeOf(b.played_at));
  const groups = [];
  let cur = [];
  let last = NaN;
  for (const m of sorted) {
    const t = timeOf(m.played_at);
    if (!Number.isFinite(t)) continue;
    if (cur.length && Number.isFinite(last) && t - last > SESSION_GAP_MS) {
      groups.push(cur);
      cur = [];
    }
    cur.push(m);
    last = t;
  }
  if (cur.length) groups.push(cur);

  const changeTimes = (changes || [])
    .map((c) => timeOf(c.started_at))
    .filter(Number.isFinite);

  return groups.map((rows) => {
    const from = rows[0].played_at;
    const to = rows[rows.length - 1].played_at;
    const start = timeOf(from);
    const end = timeOf(to);
    const side = sideOf(rows, outcome);
    const change = changeTimes.some((t) => t >= start && t <= end + 1000);
    return {
      from,
      to,
      matches: rows.length,
      kills_per_match: side.kills_per_match,
      win_rate: outcome === "win" ? side.outcome_rate : null,
      extract_rate: outcome === "extraction" ? side.outcome_rate : null,
      thin: rows.length < COD_CHART_MIN_GAMES,
      change,
    };
  });
}

export function modesWithMatches(matches) {
  const counts = new Map();
  for (const m of Array.isArray(matches) ? matches : []) {
    const id = typeof m.mode === "string" ? m.mode : "";
    const meta = modeOf(id);
    if (!meta) continue;
    const row = counts.get(id) || { id, label: meta.label, outcome: meta.outcome, matches: 0, last: null };
    row.matches += 1;
    const t = m.played_at || null;
    if (t && (!row.last || timeOf(t) >= timeOf(row.last))) row.last = t;
    counts.set(id, row);
  }
  return [...counts.values()].sort((a, b) => timeOf(b.last) - timeOf(a.last));
}

export function pickCodMode(matches, requested) {
  const available = modesWithMatches(matches);
  if (!available.length) return null;
  if (requested && available.some((m) => m.id === requested)) return requested;
  return available[0].id;
}

export function performanceCod({ tests, matches, mode, minGames } = {}) {
  const meta = modeOf(mode);
  const outcome = meta ? meta.outcome : modeOutcome(mode);
  const min = isNum(minGames) ? minGames : COD_MIN_GAMES;
  const inMode = (Array.isArray(matches) ? matches : []).filter((m) => m && m.mode === mode);
  const list = Array.isArray(tests) ? tests : [];

  const changes = list.map((t) => {
    const parts = splitAround(inMode, t.started_at);
    const before = sideOf(parts.before, outcome);
    const after = sideOf(parts.after, outcome);
    const judged = verdictOf(before, after, min);
    return {
      id: t.id,
      setting: t.setting,
      label: t.label,
      from_value: t.from_value,
      to_value: t.to_value,
      status: t.status,
      started_at: t.started_at,
      decided_at: t.decided_at,
      result_note: t.result_note,
      mode,
      scope: meta ? meta.label : mode,
      outcome,
      before,
      after,
      verdict: judged.verdict,
      kills_delta: judged.kills_delta,
      kills_interval: judged.kills_interval || null,
      min_games: min,
    };
  });

  const chart = inMode.length >= COD_CHART_MIN_GAMES
    ? sessionsOf(inMode, list, outcome)
    : [];

  return {
    mode,
    mode_label: meta ? meta.label : mode,
    outcome,
    outcome_label: outcome === "extraction" ? "Extraction rate" : "Win rate",
    min_games: min,
    chart_min_games: COD_CHART_MIN_GAMES,
    changes,
    chart,
    match_count: inMode.length,
  };
}
