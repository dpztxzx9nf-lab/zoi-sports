import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCodConfig, normalizeCodValue, flattenCodSettings, COD_MIN_TRACKED,
} from "./zoi-cod-settings.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "cod26");

test("normalizeCodValue strips comments and trailing zeros", () => {
  assert.equal(normalizeCodValue("90.000000 // 60 to 120"), "90");
  assert.equal(normalizeCodValue("0.900000 // range"), "0.9");
  assert.equal(normalizeCodValue("disabled // one of disabled, 100%"), "disabled");
  assert.equal(normalizeCodValue("true"), "true");
});

test("parseCodConfig reads the real MW4 key shape", () => {
  const text = "Fov@1;65095;45350 = 90.000000 // 60.000000 to 120.000000\n";
  assert.equal(parseCodConfig(text).Fov, "90");
});

test("flattenCodSettings merges files and caps an uncapped FPS", () => {
  const shared = { VSync: "disabled", NvidiaReflex: "Enabled", CapFps: "false", MaxFpsInGame: "250" };
  const profile = { Fov: "90", MouseHorizontalSensibility: "8", ADSSensitivity: "0.9", ADSTimingSensitivity: "interpolated", MouseAcceleration: "0" };
  const flat = flattenCodSettings(shared, profile);
  assert.equal(flat.fov, "90");
  assert.equal(flat.mouse_sensitivity, "8");
  assert.equal(flat.ads_sensitivity, "0.9");
  assert.equal(flat.ads_timing, "interpolated");
  assert.equal(flat.mouse_acceleration, "0");
  assert.equal(flat.vsync, "disabled");
  assert.equal(flat.nvidia_reflex, "Enabled");
  assert.equal(flat.max_fps, "uncapped");
  assert.ok(Object.keys(flat).length >= COD_MIN_TRACKED);
});

test("flattenCodSettings uses the in-game cap when CapFps is on", () => {
  const flat = flattenCodSettings({ CapFps: "true", MaxFpsInGame: "250", VSync: "disabled", NvidiaReflex: "Enabled" }, { Fov: "90" });
  assert.equal(flat.max_fps, "250");
});

test("fixtures from the real laptop files produce the tracked catalog", async () => {
  const shared = parseCodConfig(await readFile(path.join(FIX, "s.1.0.cod26.txt"), "utf8"));
  const profile = parseCodConfig(await readFile(path.join(FIX, "g.cod26.1.0.l.txt"), "utf8"));
  const flat = flattenCodSettings(shared, profile);
  assert.equal(flat.fov, "90");
  assert.equal(flat.mouse_sensitivity, "8");
  assert.equal(flat.ads_sensitivity, "0.9");
  assert.equal(flat.max_fps, "250");
  assert.equal(flat.vsync, "disabled");
  assert.equal(flat.nvidia_reflex, "Enabled");
});
