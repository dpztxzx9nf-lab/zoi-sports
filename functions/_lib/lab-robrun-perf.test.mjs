import test from "node:test";
import assert from "node:assert/strict";
import { robrunChart, recentRobRunShifts } from "./lab-robrun-perf.js";

const snap = (at, sens) => ({ taken_at: at, payload: JSON.stringify({ settings: { sensinivity_volume: sens } }) });

test("rates are per 10 minutes in the city; takedowns stay null without attribution", () => {
  const rows = [{ id: 1, started_at: "2026-11-11T05:00:00Z", ended_at: "2026-11-11T05:40:00Z", duration_s: 2400, deaths: 1, arrests: 1, stats: "{}" }];
  const { chart } = robrunChart(rows, []);
  assert.equal(chart[0].downed_per10, 0.5);
  assert.equal(chart[0].takedowns_per10, null);
});

test("short shifts get no rate rather than a noisy one", () => {
  const rows = [{ id: 1, started_at: "2026-11-11T05:00:00Z", ended_at: "2026-11-11T05:03:00Z", duration_s: 180, deaths: 1, arrests: 0, stats: "{}" }];
  assert.equal(robrunChart(rows, []).chart[0].downed_per10, null);
});

test("each shift is tied to the settings live then; a change is marked", () => {
  const snaps = [snap("2026-11-11T04:00:00Z", "0.37"), snap("2026-11-11T05:50:00Z", "0.45")];
  const rows = [
    { id: 1, started_at: "2026-11-11T05:00:00Z", ended_at: "2026-11-11T05:40:00Z", duration_s: 2400, deaths: 0, arrests: 0, stats: "{}" },
    { id: 2, started_at: "2026-11-11T06:00:00Z", ended_at: "2026-11-11T06:40:00Z", duration_s: 2400, deaths: 2, arrests: 0, stats: JSON.stringify({ attributed_chat: true, seen_takedowns: 4 }) },
  ];
  const { chart } = robrunChart(rows, snaps);
  assert.equal(chart[0].change, false);
  assert.equal(chart[1].change, true);
  assert.equal(chart[1].settings_at, "2026-11-11T05:50:00Z");
  assert.equal(chart[1].takedowns_per10, 1);
  const recent = recentRobRunShifts(rows, snaps);
  assert.equal(recent[0].id, 2);
  assert.equal(recent[0].takedowns, 4);
});

test("an open shift uses the last time it was seen in the city", () => {
  const rows = [{ id: 1, started_at: "2026-11-11T05:20:29Z", ended_at: null, deaths: 0, arrests: 1, stats: JSON.stringify({ last_seen_at: "2026-11-11T05:40:29Z" }) }];
  const r = recentRobRunShifts(rows, [])[0];
  assert.equal(r.minutes, 20);
  assert.equal(r.downed_per10, 0.5);
  assert.equal(r.in_progress, true);
});
