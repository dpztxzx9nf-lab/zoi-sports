import test from "node:test";
import assert from "node:assert/strict";
import { parseRobRunHud, parseChatEvents, selfEvents } from "./lab-robrun-aar.js";

const CRIMINAL = `0.7.0.4029 3747756711
FPS: 89 PING: 43MS LOSS: 0%
ALARM GOES OFF IN 10
22:15 [NAGS] BBeking died!
22:16 [NAGS] superbeck died!
22:18 Kneczi was arrested!
Lenny's Motel Chat
Looty Bay Chat
22:20 COGOLLON was arrested!
Kneczi
SOLO
lvl 4
+15%
+35%
+35%
TAB
EARLY ACCESS. DOES NOT REFLECT THE FINAL QUALITY OF THE GAME.`;

const CIVILIAN = `FPS: 70 PING: 40MS LOSS: 0%
Hide and put on a mask to become a Criminal
Looty Bay Chat
21:54 Kneczi was arrested!
Kneczi
SOLO
F BECOME A CRIMINAL
TAB`;

const MAP = `CITY Looty Bay
EARLY ACCESS. DOES NOT REFLECT THE FINAL QUALITY OF THE GAME.
Expand
ESC BACK
ADD MARKER
SCALE`;

test("criminal HUD reads role, notoriety, party, bonuses, alarm, and chat", () => {
  const f = parseRobRunHud(CRIMINAL);
  assert.equal(f.layout, "world_hud");
  assert.equal(f.role, "criminal");
  assert.equal(f.notoriety, 4);
  assert.equal(f.party, "SOLO");
  assert.equal(f.player_name, "Kneczi");
  assert.deepEqual(f.bonuses, [15, 35, 35]);
  assert.equal(f.banner, "alarm");
  assert.equal(f.banner_seconds, 10);
  assert.equal(f.cash, null);
  const self = selfEvents(f);
  assert.equal(self.arrests, 1);
  assert.equal(self.deaths, 0);
});

test("civilian HUD is a city shift, not a criminal", () => {
  const f = parseRobRunHud(CIVILIAN);
  assert.equal(f.layout, "world_hud");
  assert.equal(f.role, "civilian");
  assert.equal(f.player_name, "Kneczi");
  assert.equal(f.notoriety, null);
  assert.equal(f.cash, null);
});

test("the city map is not a results screen and invents no stats", () => {
  const f = parseRobRunHud(MAP);
  assert.equal(f.layout, "city_map");
  assert.equal(f.role, null);
  assert.equal(f.notoriety, null);
  assert.equal(f.cash, null);
});

test("chat events keep other players separate from the HUD name", () => {
  const ev = parseChatEvents(CRIMINAL);
  assert.equal(ev.length, 4);
  assert.equal(ev[0].kind, "died");
  assert.equal(ev[2].name, "Kneczi");
  assert.equal(ev[2].kind, "arrested");
});

test("does not invent cash from a random number on the compass", () => {
  const f = parseRobRunHud("FPS: 89 300 330 345 N 15 30 NE");
  assert.equal(f.cash, null);
  assert.equal(f.notoriety, null);
});

test("does not take FPS as the player name", () => {
  const f = parseRobRunHud("FPS: 89 PING: 43MS LOSS: 0%\nSOLO\nKneczi\nSOLO");
  assert.equal(f.player_name, "Kneczi");
});

test("duplicate chat lines from overlapping crops count once", () => {
  const ev = parseChatEvents("22:18 Kneczi was arrested!\n22:18 Kneczi was arrested!\n22:18 Kneczi was arrested!");
  assert.equal(ev.length, 1);
});

test("a name only in chat is not the player name", () => {
  const f = parseRobRunHud("FPS: 89 PING: 43MS LOSS: 0%\n22:20 Drubie was arrested!\nLooty Bay Chat\nSOLO");
  assert.equal(f.player_name, null);
});

import { chatTimeIso, eventsInShift } from "./lab-robrun-aar.js";




test("an arrest before the shift started is not counted in it", () => {
  const taken = "2026-11-11T05:27:37.794Z"; // 10:27 PM MT
  const at = chatTimeIso("22:18", taken, -420);
  assert.equal(at, "2026-11-11T05:18:00.000Z");
  const evs = [{ at: "22:18", kind: "arrested", at_iso: at }, { at: "22:28", kind: "died", at_iso: chatTimeIso("22:28", "2026-11-11T05:29:00.000Z", -420) }];
  const kept = eventsInShift(evs, taken, null);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, "died");
});

test("a chat time later than the sample belongs to the day before", () => {
  assert.equal(chatTimeIso("23:59", "2026-11-11T07:05:00.000Z", -420), "2026-11-11T06:59:00.000Z");
  assert.equal(chatTimeIso("23:59", "2026-11-11T06:30:00.000Z", -420), null); // 22.5h old: stale
  assert.equal(chatTimeIso("23:50", "2026-11-11T07:05:00.000Z", -420), "2026-11-11T06:50:00.000Z");
});

test("a dropped leading hour digit is restored only when recent", () => {
  // 22:25 read as 2:25 on a 22:34 sample
  assert.equal(chatTimeIso("2:25", "2026-11-11T05:34:17.000Z", -420), "2026-11-11T05:25:00.000Z");
  // 2:25 on a 9 PM sample cannot be repaired (hour starts with no tens digit match) -> null
  assert.equal(chatTimeIso("2:25", "2026-11-11T04:00:00.000Z", -420), null);
});

test("attributed lines count takedowns; plain lines don't", () => {
  const f = parseRobRunHud("FPS: 80\n22:40 Drubie was arrested by Kneczi!\n22:41 Kneczi was killed by Roobs!\n22:42 Jay died!\nKneczi\nSOLO");
  const s = selfEvents(f);
  assert.equal(s.takedowns, 1);
  assert.equal(s.deaths, 1);
  assert.equal(s.arrests, 0);
  assert.equal(s.attributed, true);
});

test("without attribution, takedowns are unknowable", () => {
  const s = selfEvents(parseRobRunHud("FPS: 80\n22:25 Kneczi was arrested!\n22:27 Drubie was arrested!\nKneczi\nSOLO"));
  assert.equal(s.attributed, false);
  assert.equal(s.arrests, 1);
});
