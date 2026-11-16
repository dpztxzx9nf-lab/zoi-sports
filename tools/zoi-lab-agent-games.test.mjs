process.env.ZOI_LAB_NO_LOG = "1";
process.env.ZOI_LAB_STATE = "/tmp/zoi-lab-agent-games-test-state.json";
import test from "node:test";
import assert from "node:assert/strict";
const { runningGamesFrom, gameEvents, watch } = await import("./zoi-lab-agent.mjs");

const csv = [
  '"System Idle Process","0","Services","0","8 K"',
  '"FortniteClient-Win64-Shipping.exe","4120","Console","1","3,100,000 K"',
  '"ROB RUN.exe","9001","Console","1","2,000,000 K"',
  '"cod_launcher.exe","77","Console","1","10 K"',
].join("\r\n");

test("tasklist CSV: Fortnite and ROB RUN found by image name, a lookalike is not COD", () => {
  assert.deepEqual([...runningGamesFrom(csv)].sort(), ["fortnite", "robrun"]);
  assert.deepEqual([...runningGamesFrom('"cod.exe","1","Console","1","1 K"')], ["cod"]);
  assert.equal(runningGamesFrom("").size, 0);
});

test("start and close are edges; an unreadable list is neither", () => {
  const ev = gameEvents(new Set(["cod"]), new Set(["fortnite"]));
  assert.deepEqual(ev.started.map((g) => g.game), ["fortnite"]);
  assert.deepEqual(ev.stopped.map((g) => g.game), ["cod"]);
  assert.deepEqual(gameEvents(new Set(["cod"]), null), { started: [], stopped: [] });
});

test("watch sends once when a game starts and once when it closes, with no settings change", async () => {
  const lists = [new Set(), new Set(), new Set(["fortnite"]), new Set(["fortnite"]), new Set(["fortnite"]), new Set()];
  let i = 0;
  let sends = 0;
  let t = 0;
  await watch({}, {
    pollMs: 60_000, gamePollMs: 15_000, heartbeatMs: 10 * 60 * 60_000, ticks: 3,
    now: () => t, sleep: async (ms) => { t += ms; },
    games: async () => lists[Math.min(i++, lists.length - 1)],
    quiet: async () => true, key: async () => "same",
    send: async () => { sends++; return true; },
    readLog: async () => ({ matches: [], commit: null }),
    readReplays: async () => ({ replays: [], commit: null }),
  });
  assert.equal(sends, 2);
});
