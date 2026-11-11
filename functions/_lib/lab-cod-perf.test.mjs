import test from "node:test";
import assert from "node:assert/strict";
import { modesWithMatches, pickCodMode, performanceCod, COD_CHART_MIN_GAMES } from "./lab-cod-perf.js";
import { isCodMode, modeOutcome, COD_MODES } from "./lab-cod.js";

test("MW4 catalog has DMZ, core MP, and Warzone, but not Zombies or Campaign", () => {
  const ids = COD_MODES.map((m) => m.id);
  assert.ok(ids.includes("dmz"));
  assert.ok(ids.includes("tdm"));
  assert.ok(ids.includes("domination"));
  assert.ok(ids.includes("hardpoint"));
  assert.ok(ids.includes("search_and_destroy"));
  assert.ok(ids.includes("warzone"));
  assert.ok(ids.includes("resurgence"));
  assert.ok(!ids.includes("zombies"));
  assert.ok(!ids.includes("campaign"));
  assert.equal(modeOutcome("dmz"), "extraction");
  assert.equal(modeOutcome("tdm"), "win");
  assert.equal(modeOutcome("warzone"), "win");
  assert.ok(isCodMode("gunfight"));
  assert.ok(!isCodMode("mp"));
});

function match(mode, at, kills, extra = {}) {
  return { mode, played_at: at, kills, ...extra };
}

test("modesWithMatches lists only modes that have rows, newest first", () => {
  const modes = modesWithMatches([
    match("dmz", "2026-11-10T01:00:00Z", 4, { extracted: 1 }),
    match("tdm", "2026-11-10T03:00:00Z", 12, { won: 1 }),
    match("tdm", "2026-11-10T03:20:00Z", 8, { won: 0 }),
  ]);
  assert.deepEqual(modes.map((m) => m.id), ["tdm", "dmz"]);
  assert.equal(modes[0].matches, 2);
  assert.equal(modes[1].matches, 1);
});

test("DMZ and TDM are never pooled in a verdict or chart", () => {
  const tests = [{
    id: 1, setting: "fov", label: "FOV", from_value: "90", to_value: "100",
    status: "testing", started_at: "2026-11-10T02:00:00Z",
  }];
  const matches = [
    // 25 DMZ games before, 25 after, all extracts, 2 then 4 kills
    ...Array.from({ length: 25 }, (_, i) => match("dmz", "2026-11-09T12:00:00Z", 2, { extracted: 1 })),
    ...Array.from({ length: 25 }, (_, i) => match("dmz", "2026-11-10T12:00:00Z", 4, { extracted: 1 })),
    // TDM would look like a collapse if it were mixed in
    ...Array.from({ length: 25 }, (_, i) => match("tdm", "2026-11-10T12:05:00Z", 0, { won: 0 })),
  ];
  const dmz = performanceCod({ tests, matches, mode: "dmz" });
  const tdm = performanceCod({ tests, matches, mode: "tdm" });
  assert.equal(dmz.match_count, 50);
  assert.equal(tdm.match_count, 25);
  assert.equal(dmz.changes[0].after.kills_per_match, 4);
  assert.equal(tdm.changes[0].after.kills_per_match, 0);
  assert.equal(dmz.outcome, "extraction");
  assert.equal(tdm.outcome, "win");
  assert.equal(dmz.changes[0].verdict, "better");
  assert.equal(tdm.changes[0].verdict, "too-soon"); // no TDM games before the change
  assert.ok(dmz.chart.every((s) => s.extract_rate != null || s.thin || s.matches >= 0));
  assert.ok(tdm.chart.length === 0 || tdm.chart.every((s) => s.win_rate != null || s.extract_rate == null));
});

test("charts stay hidden until a mode has enough matches", () => {
  const matches = Array.from({ length: COD_CHART_MIN_GAMES - 1 }, (_, i) =>
    match("dmz", "2026-11-10T12:00:00Z", 3, { extracted: 1 }));
  const p = performanceCod({ tests: [], matches, mode: "dmz" });
  assert.equal(p.chart.length, 0);
  const enough = performanceCod({
    tests: [],
    matches: [...matches, match("dmz", "2026-11-10T12:10:00Z", 3, { extracted: 0 })],
    mode: "dmz",
  });
  assert.ok(enough.chart.length >= 1);
});

test("pickCodMode prefers a requested mode that has data, else the most recent", () => {
  const matches = [
    match("dmz", "2026-11-10T01:00:00Z", 1, { extracted: 0 }),
    match("tdm", "2026-11-10T03:00:00Z", 5, { won: 1 }),
  ];
  assert.equal(pickCodMode(matches, "dmz"), "dmz");
  assert.equal(pickCodMode(matches, "warzone"), "tdm");
  assert.equal(pickCodMode([], "dmz"), null);
});
