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
