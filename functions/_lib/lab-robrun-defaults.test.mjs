import test from "node:test";
import assert from "node:assert/strict";
import { currentRobRunOf, withRobRunDefaults } from "./lab-robrun.js";
import { syncRobRunSnapshot } from "./lab-robrun-sync.js";

// Snapshot 144's tracked settings, as stored: VSync, HBAO, motion blur, depth of
// field and frame rate are missing because the game left them out of the file.
const s144 = {
  anisotropic_filtering: "2", anti_aliasing_mode_id_setting: "smaa", cast_shadow_setting: "medium",
  fullscreen_setting: "true", hdr_setting: "true", hold_aim: "true", hold_sprint: "true",
  post_processing_setting: "true", render_scale_setting: "1", resolution_setting: "2560x1440",
  sensinivity_volume: "0.37", sensinivity_volume_aim: "0.19", setting_quality: "custom",
  settings_grass: "low", settings_water: "minimum",
};

const valueOf = (cur, id) => cur.settings.find((s) => s.id === id).value;

test("a key the game left out of a full snapshot reads as its default, not blank", () => {
  const cur = currentRobRunOf({ taken_at: "2026-11-11T19:17:44.253Z", payload: JSON.stringify({ settings: s144 }) });
  assert.equal(valueOf(cur, "vsync_setting"), "false");
  assert.equal(valueOf(cur, "hbao_setting"), "false");
  assert.equal(valueOf(cur, "motion_blur_setting"), "false");
  assert.equal(valueOf(cur, "depth_of_field"), "false");
  assert.equal(valueOf(cur, "frame_rate_setting"), "Default");
  assert.equal(valueOf(cur, "sensinivity_volume_aim"), "0.19");
});

test("a value the file does carry is never overwritten", () => {
  const out = withRobRunDefaults({ ...s144, vsync_setting: "true", frame_rate_setting: "2" });
  assert.equal(out.vsync_setting, "true");
  assert.equal(out.frame_rate_setting, "2");
});

test("a partial snapshot is left alone rather than padded with guesses", () => {
  assert.deepEqual(withRobRunDefaults({ sensinivity_volume: "0.37" }), { sensinivity_volume: "0.37" });
});

function fakeEnv(previousSettings) {
  const tests = [];
  const prev = previousSettings ? { payload: JSON.stringify({ settings: previousSettings }), payload_hash: "x" } : null;
  const DB = {
    prepare(sql) {
      const stmt = {
        bind: (...args) => { stmt.args = args; return stmt; },
        async first() {
          if (/pragma_table_info|PRAGMA/i.test(sql)) return { n: 1 };
          if (/FROM lab_snapshots/.test(sql)) return prev;
          return null;
        },
        async all() { return { results: [{ name: "game" }] }; },
        async run() {
          if (/INSERT INTO lab_tests/.test(sql)) tests.push({ setting: stmt.args[0], from: stmt.args[2], to: stmt.args[3] });
          return { meta: { changes: 1, last_row_id: tests.length } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB }, tests };
}

test("turning VSync off (key dropped) opens a test from On to Off", async () => {
  const { env, tests } = fakeEnv({ ...s144, vsync_setting: "true", frame_rate_setting: "2" });
  const r = await syncRobRunSnapshot(env, "me", { robrun: { takenAt: "2026-11-11T19:30:00Z", settings: s144 } });
  assert.equal(r.error, undefined);
  assert.deepEqual(tests.find((t) => t.setting === "vsync_setting"), { setting: "vsync_setting", from: "true", to: "false" });
  assert.deepEqual(tests.find((t) => t.setting === "frame_rate_setting"), { setting: "frame_rate_setting", from: "2", to: "Default" });
});

test("re-sending an old-style snapshot with defaults filled opens no tests", async () => {
  const { env, tests } = fakeEnv(s144);
  await syncRobRunSnapshot(env, "me", { robrun: { takenAt: "2026-11-11T19:30:00Z", settings: s144 } });
  assert.deepEqual(tests, []);
});
