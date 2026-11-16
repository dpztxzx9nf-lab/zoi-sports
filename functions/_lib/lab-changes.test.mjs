import test from "node:test";
import assert from "node:assert/strict";
import { diffSettings, pendingFor } from "./lab-changes.js";

test("fortnite: a moved setting and a moved binding come back old -> new, tracked first", () => {
  const a = { settings: { LookHorizontalSpeed: 43, Foo: "x", Bar: 1 }, bindings: { Fire: ["Gamepad_RightTrigger"] } };
  const b = { settings: { LookHorizontalSpeed: 45, Foo: "x", Bar: 2 }, bindings: { Fire: ["Gamepad_LeftTrigger"] } };
  const d = diffSettings("fortnite", JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(d.map((c) => [c.kind, c.key, c.from, c.to, c.tracked]), [
    ["setting", "LookHorizontalSpeed", "43", "45", true],
    ["setting", "Bar", "1", "2", false],
    ["binding", "Fire", "Gamepad_RightTrigger", "Gamepad_LeftTrigger", false],
  ]);
  assert.equal(d[0].label, "Look Horizontal Speed");
});

test("robrun: a key the game left out reads as its default, so no fake change", () => {
  const base = { sensinivity_volume: "0.37", sensinivity_volume_aim: "0.19", hold_aim: "true", hold_sprint: "true",
    resolution_setting: "2560x1440", fullscreen_setting: "true", setting_quality: "custom", settings_grass: "low" };
  const a = { settings: { ...base, vsync_setting: "false" } };
  const b = { settings: { ...base, sensinivity_volume: "0.18" } };
  const d = diffSettings("robrun", a, b);
  assert.deepEqual(d.map((c) => [c.key, c.from, c.to]), [["sensinivity_volume", "0.37", "0.18"]]);
});

test("no notice yet: the oldest snapshot is the baseline; same snapshot means nothing pending", () => {
  const latest = { id: 9, taken_at: "t9", payload: JSON.stringify({ settings: { fov: "90" } }) };
  const oldest = { id: 1, taken_at: "t1", payload: JSON.stringify({ settings: { fov: "80" } }) };
  const p = pendingFor("cod", null, latest, oldest);
  assert.equal(p.since.snapshotId, 1);
  assert.deepEqual(p.changes.map((c) => [c.label, c.from, c.to]), [["FOV", "80", "90"]]);
  const q = pendingFor("cod", { snapshot_id: 9, payload: latest.payload, notified_at: "x" }, latest, null);
  assert.equal(q.changes.length, 0);
  assert.deepEqual(pendingFor("cod", null, null, null).changes, []);
});
