import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRobRunSettings, normalizeRobRunValue, flattenRobRunSettings,
  ROBRUN_MIN_TRACKED, ROBRUN_CATALOG,
} from "./zoi-robrun-settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "robrun", "settings.dat");

test("normalizeRobRunValue trims float noise and booleans", () => {
  assert.equal(normalizeRobRunValue(0.370000005), "0.37");
  assert.equal(normalizeRobRunValue(true), "true");
  assert.equal(normalizeRobRunValue(false), "false");
  assert.equal(normalizeRobRunValue("2560x1440"), "2560x1440");
});

test("the live settings fixture has every tracked field", async () => {
  const text = await readFile(FIX, "utf8");
  const flat = parseRobRunSettings(text);
  assert.ok(flat);
  assert.ok(Object.keys(flat).length >= ROBRUN_MIN_TRACKED);
  for (const entry of ROBRUN_CATALOG) {
    assert.ok(entry.id in flat, "missing " + entry.id);
  }
  assert.equal(flat.resolution_setting, "2560x1440");
  assert.equal(flat.sensinivity_volume, "0.37");
  assert.equal(flat.vsync_setting, "true");
  assert.equal(flat.setting_quality, "high");
  assert.ok(!("streamer_software_secret" in flat));
});

test("flattenRobRunSettings drops secrets and unknown keys", () => {
  const flat = flattenRobRunSettings({
    resolution_setting: "1920x1080",
    vsync_setting: false,
    streamer_software_secret: "nope",
    junk: 1,
  });
  assert.equal(flat.resolution_setting, "1920x1080");
  assert.equal(flat.vsync_setting, "false");
  assert.ok(!("streamer_software_secret" in flat));
  assert.ok(!("junk" in flat));
});
