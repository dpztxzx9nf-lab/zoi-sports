import { currentRobRunOf } from "./lab-robrun.js";
import { robrunSessions } from "./lab-robrun-log.js";

/* Rob Run in the aim lab: the only combat outcomes the game shows are chat
   lines. "Kneczi died!" / "Kneczi was arrested!" are times he was taken
   down. Takedowns he made are counted only if the chat ever names who did
   it ("X was arrested by Kneczi!"); until then they stay null. Everything is
   per 10 minutes in the city so settings can be compared. */

export const ROBRUN_CHART_MIN = 5;
const MIN_MINUTES = 5;

const num = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

function statsOf(s) {
  if (s && s.stats && typeof s.stats === "object") return s.stats;
  if (s && typeof s.stats === "string" && s.stats.trim()) {
    try { const o = JSON.parse(s.stats); if (o && typeof o === "object") return o; } catch {}
  }
  return {};
}

function minutesOf(s, stats) {
  const d = num(s.duration_s);
  if (d != null && d > 0) return d / 60;
  const start = Date.parse(s.started_at || "");
  const end = Date.parse(s.ended_at || stats.last_seen_at || "");
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 60000;
  return null;
}

/* The settings snapshot that was live when a shift started. */
function snapshotSigs(snapshots) {
  return (snapshots || [])
    .map((snap) => {
      const cur = currentRobRunOf(snap);
      if (!cur) return null;
      const at = Date.parse(snap.taken_at || "");
      if (!Number.isFinite(at)) return null;
      const sig = cur.settings.map((x) => x.id + "=" + (x.value ?? "")).join("|");
      return { at, taken_at: snap.taken_at, sig, settings: cur.settings };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
}

function snapshotFor(sigs, startedAt) {
  const t = Date.parse(startedAt || "");
  if (!Number.isFinite(t)) return null;
  let pick = null;
  for (const s of sigs) { if (s.at <= t) pick = s; else break; }
  return pick;
}

function changedSettings(prev, next) {
  if (!prev || !next) return [];
  const before = new Map(prev.settings.map((x) => [x.id, x.value]));
  return next.settings
    .filter((x) => before.get(x.id) !== x.value)
    .map((x) => ({ id: x.id, label: x.label, from: before.get(x.id) ?? null, to: x.value ?? null }));
}

export function aimRowOf(s, sigs) {
  const stats = statsOf(s);
  const minutes = minutesOf(s, stats);
  const deaths = num(s.deaths);
  const arrests = num(s.arrests);
  const downed = deaths == null && arrests == null ? null : (deaths || 0) + (arrests || 0);
  const takedowns = stats.attributed_chat ? num(stats.seen_takedowns) : null;
  const per10 = (v) => (v == null || minutes == null || minutes < MIN_MINUTES ? null : Math.round((v / minutes) * 100) / 10);
  const snap = snapshotFor(sigs, s.started_at);
  return {
    minutes: minutes == null ? null : Math.round(minutes * 10) / 10,
    deaths, arrests, downed, takedowns,
    downed_per10: per10(downed),
    takedowns_per10: per10(takedowns),
    settings_at: snap ? snap.taken_at : null,
    _sig: snap ? snap.sig : null,
    _snap: snap,
  };
}

export function recentRobRunShifts(rows, snapshots = []) {
  const sigs = snapshotSigs(snapshots);
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => (Date.parse(b.started_at || "") || 0) - (Date.parse(a.started_at || "") || 0)
    || (Number(b.id) || 0) - (Number(a.id) || 0));
  return list.slice(0, 40).map((s) => {
    const id = Number(s.id);
    const aim = aimRowOf(s, sigs);
    return {
      id: Number.isInteger(id) && id > 0 ? id : null,
      started_at: s.started_at || null,
      ended_at: s.ended_at || null,
      in_progress: !s.ended_at,
      minutes: aim.minutes,
      deaths: aim.deaths,
      arrests: aim.arrests,
      takedowns: aim.takedowns,
      downed_per10: aim.downed_per10,
      takedowns_per10: aim.takedowns_per10,
      settings_at: aim.settings_at,
      source: "ocr",
      image: s.aar_key && Number.isInteger(id) && id > 0 ? "/api/lab/robrun-image?id=" + id : null,
    };
  });
}

export function robrunChart(rows, snapshots = []) {
  const sigs = snapshotSigs(snapshots);
  const done = (rows || []).filter((s) => s && s.ended_at)
    .sort((a, b) => (Date.parse(a.started_at || "") || 0) - (Date.parse(b.started_at || "") || 0));
  let prev = null;
  const chart = done.map((s) => {
    const aim = aimRowOf(s, sigs);
    const change = prev !== null && aim._sig !== null && prev._sig !== null && aim._sig !== prev._sig;
    const point = {
      to: s.ended_at || s.started_at,
      at: s.started_at,
      minutes: aim.minutes,
      downed_per10: aim.downed_per10,
      takedowns_per10: aim.takedowns_per10,
      settings_at: aim.settings_at,
      change,
      changed: change ? changedSettings(prev._snap, aim._snap) : [],
    };
    prev = aim;
    return point;
  });
  return { chart, match_count: done.length, chart_min_games: ROBRUN_CHART_MIN };
}


/* ---- Sessions from the game's own log (preferred when present) ----
   Knockdowns and arrests come straight from the game's state changes
   ("Idle -> KnockedOut", "Idle -> ArrestFinished"); time in the city from
   its role and scene changes. Deaths come from the log if it ever names
   them, otherwise from the on-screen chat ("Kneczi died!") inside the
   same window. */

function chatDeathsFrom(shifts) {
  const seen = new Set();
  const out = [];
  for (const s of shifts || []) {
    const st = statsOf(s);
    for (const e of [].concat(st.self_events || [], st.outside_events || [])) {
      if (!e || e.kind !== "died" || !e.at_iso) continue;
      if (seen.has(e.at_iso)) continue;
      seen.add(e.at_iso);
      out.push(Date.parse(e.at_iso));
    }
  }
  return out;
}

export function logSessionRows(events, shifts, snapshots = []) {
  const sigs = snapshotSigs(snapshots);
  const chatDeaths = chatDeathsFrom(shifts);
  return robrunSessions(events).map((s) => {
    const start = Date.parse(s.started_at);
    const endIso = s.ended_at || s.last_at;
    const end = Date.parse(endIso);
    const minutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60000 : null;
    const chat = chatDeaths.filter((t) => t >= start - 60000 && t <= end + 60000).length;
    const deaths = s.deaths > 0 ? s.deaths : chat;
    const per10 = (v) => (v == null || minutes == null || minutes < MIN_MINUTES ? null : Math.round((v / minutes) * 100) / 10);
    const snap = snapshotFor(sigs, s.started_at);
    return {
      id: null,
      started_at: s.started_at,
      ended_at: s.ended_at,
      in_progress: !s.ended_at,
      minutes: minutes == null ? null : Math.round(minutes * 10) / 10,
      knockdowns: s.knockdowns,
      arrests: s.arrests,
      deaths,
      knockdowns_per10: per10(s.knockdowns),
      deaths_per10: per10(deaths),
      weapons: s.items,
      settings_at: snap ? snap.taken_at : null,
      source: "game_log",
      _sig: snap ? snap.sig : null,
      _snap: snap,
    };
  });
}

export function logSessionChart(rows) {
  const done = rows.filter((r) => r.ended_at);
  let prev = null;
  const chart = done.map((r) => {
    const change = prev !== null && r._sig !== null && prev._sig !== null && r._sig !== prev._sig;
    const point = {
      at: r.started_at, to: r.ended_at, minutes: r.minutes,
      knockdowns_per10: r.knockdowns_per10, deaths_per10: r.deaths_per10,
      settings_at: r.settings_at, change,
      changed: change ? changedSettings(prev._snap, r._snap) : [],
    };
    prev = r;
    return point;
  });
  return { chart, match_count: done.length, chart_min_games: ROBRUN_CHART_MIN };
}

export function publicSessionRows(rows) {
  return rows.slice().reverse().slice(0, 40).map(({ _sig, _snap, ...r }) => r);
}
