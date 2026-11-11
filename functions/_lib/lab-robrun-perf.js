import { ROBRUN_GAME } from "./lab-robrun.js";

export const ROBRUN_CHART_MIN = 5;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function recentRobRunShifts(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => {
    const tb = Date.parse(b.started_at || "") || 0;
    const ta = Date.parse(a.started_at || "") || 0;
    return tb - ta || (Number(b.id) || 0) - (Number(a.id) || 0);
  });
  return list.slice(0, 40).map((s) => {
    const id = Number(s.id);
    let stats = null;
    if (s.stats && typeof s.stats === "object") stats = s.stats;
    else if (typeof s.stats === "string" && s.stats.trim()) {
      try { const o = JSON.parse(s.stats); if (o && typeof o === "object") stats = o; } catch {}
    }
    return {
      id: Number.isInteger(id) && id > 0 ? id : null,
      started_at: s.started_at || null,
      ended_at: s.ended_at || null,
      role: s.role || null,
      notoriety: s.notoriety == null ? null : Number(s.notoriety),
      party: s.party || null,
      player_name: s.player_name || null,
      outcome: s.outcome || null,
      duration_s: s.duration_s == null ? null : Number(s.duration_s),
      deaths: s.deaths == null ? null : Number(s.deaths),
      arrests: s.arrests == null ? null : Number(s.arrests),
      cash: stats && stats.cash_end != null ? Number(stats.cash_end) : null,
      cash_delta: stats && stats.cash_delta != null ? Number(stats.cash_delta) : null,
      stats,
      source: "ocr",
      image: s.aar_key && Number.isInteger(id) && id > 0 ? "/api/lab/robrun-image?id=" + id : null,
    };
  });
}

export function robrunChart(rows) {
  const done = (rows || []).filter((s) => s && s.ended_at);
  const chart = done.map((s) => ({
    to: s.ended_at || s.started_at,
    at: s.ended_at || s.started_at,
    notoriety: isNum(Number(s.notoriety)) ? Number(s.notoriety) : null,
    duration_s: isNum(Number(s.duration_s)) ? Number(s.duration_s) : null,
    survived: s.outcome === "left" ? 1 : (s.outcome === "in_progress" || !s.outcome ? null : 0),
  }));
  return { chart, match_count: done.length, chart_min_games: ROBRUN_CHART_MIN };
}
