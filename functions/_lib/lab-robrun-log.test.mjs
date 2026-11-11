import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { decodeMsgpackStream, eventsFromBreadcrumbs, eventsFromPlayerLog, robrunSessions, eventOfLine } from "./lab-robrun-log.js";

const FIX = new URL("../../tests/fixtures/robrun/", import.meta.url);

test("decodes real Sentry breadcrumbs from the game", () => {
  const bytes = new Uint8Array(readFileSync(new URL("sentry-breadcrumb2", FIX)));
  const recs = decodeMsgpackStream(bytes);
  assert.ok(recs.length >= 90);
  const evs = eventsFromBreadcrumbs(recs);
  assert.ok(evs.some((e) => e.kind === "role" && e.detail === "hubber"));
  assert.ok(evs.some((e) => e.kind === "scene" && e.detail === "loaded:Hub_Standalone"));
  assert.ok(evs.some((e) => e.kind === "item" && e.detail === "dp9_m1"));
});

test("a city visit from the breadcrumbs becomes a session", () => {
  const recs = [
    ...decodeMsgpackStream(new Uint8Array(readFileSync(new URL("sentry-breadcrumb2", FIX)))),
    ...decodeMsgpackStream(new Uint8Array(readFileSync(new URL("sentry-breadcrumb1", FIX)))),
  ];
  const s = robrunSessions(eventsFromBreadcrumbs(recs));
  const city = s.filter((x) => x.roles.includes("citizen"));
  assert.equal(city.length, 1);
  assert.equal(city[0].started_at, "2026-11-11T06:14:54.733Z");
  assert.equal(city[0].ended_at, null);
});

test("Player.log knockout and arrest land in the city session", () => {
  const log = readFileSync(new URL("player-log-excerpt.txt", FIX), "utf8");
  const evs = eventsFromPlayerLog(log, -420);
  const s = robrunSessions(evs);
  const hit = s.find((x) => x.knockdowns > 0);
  assert.ok(hit, "a session with the knockout");
  assert.equal(hit.knockdowns, 1);
  assert.equal(hit.arrests, 1);
  assert.equal(hit.started_at, "2026-11-11T02:01:18.143Z");
  assert.equal(hit.ended_at, "2026-11-11T02:13:36.288Z"); // left the battle
});

test("lines we don't use are ignored", () => {
  assert.equal(eventOfLine("ConnectUpdater.PeerConnect started id=battle"), null);
  assert.deepEqual(eventOfLine("Change state: Idle -> KnockedOut"), { kind: "state", detail: "Idle->KnockedOut" });
});
