/* Read-only reader for ROB RUN (Steam 4262460) settings.

   The game writes a JSON file at
     %USERPROFILE%\AppData\LocalLow\Kefir\ROB RUN\settings\settings_steam_4262460_<id>.dat
   Steam Cloud also syncs it. This module only reads that file. It does not
   touch the install, Easy Anti-Cheat, or any Kefir API. Streamer-software
   secrets, if present, are never included. */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const ROBRUN_GAME = "robrun";
export const ROBRUN_STEAM_APP = "4262460";
export const ROBRUN_MIN_TRACKED = 8;

export const ROBRUN_CATALOG = [
  { id: "sensinivity_volume", label: "Mouse sensitivity" },
  { id: "sensinivity_volume_aim", label: "Aim sensitivity" },
  { id: "hold_sprint", label: "Hold to sprint" },
  { id: "hold_aim", label: "Hold to aim" },
  { id: "resolution_setting", label: "Resolution" },
  { id: "fullscreen_setting", label: "Fullscreen" },
  { id: "frame_rate_setting", label: "Frame rate" },
  { id: "vsync_setting", label: "VSync" },
  { id: "render_scale_setting", label: "Render scale" },
  { id: "anti_aliasing_mode_id_setting", label: "Anti-aliasing" },
  { id: "setting_quality", label: "Quality" },
  { id: "cast_shadow_setting", label: "Shadows" },
  { id: "motion_blur_setting", label: "Motion blur" },
  { id: "depth_of_field", label: "Depth of field" },
  { id: "hdr_setting", label: "HDR" },
  { id: "hbao_setting", label: "HBAO" },
  { id: "settings_grass", label: "Grass" },
  { id: "settings_water", label: "Water" },
  { id: "post_processing_setting", label: "Post processing" },
  { id: "anisotropic_filtering", label: "Anisotropic filtering" },
];

const trackedIds = new Set(ROBRUN_CATALOG.map((c) => c.id));

const SECRET_KEY = /secret|password|token|cookie/i;

function settingsDir(home = os.homedir()) {
  return path.join(home, "AppData", "LocalLow", "Kefir", "ROB RUN", "settings");
}

export function normalizeRobRunValue(v) {
  if (v === true || v === false) return v ? "true" : "false";
  if (typeof v === "number" && Number.isFinite(v)) {
    const t = Math.round(v * 1e6) / 1e6;
    return String(t);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s === "true" || s === "false") return s;
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return String(Math.round(n * 1e6) / 1e6);
    }
    return s;
  }
  return null;
}

export function flattenRobRunSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const flat = {};
  for (const id of trackedIds) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    if (SECRET_KEY.test(id)) continue;
    const text = normalizeRobRunValue(raw[id]);
    if (text != null && text !== "") flat[id] = text;
  }
  return flat;
}

export function parseRobRunSettings(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  return flattenRobRunSettings(raw);
}

export function robrunPayloadKey(snap) {
  if (!snap || !snap.settings) return "";
  return Object.keys(snap.settings).sort()
    .map((k) => k + "=" + String(snap.settings[k])).join("\u001f");
}

export async function robrunFileSignature(home = os.homedir()) {
  const dir = settingsDir(home);
  let names;
  try { names = await readdir(dir); } catch { return ""; }
  const parts = [];
  for (const name of names) {
    if (!/^settings_steam_4262460_\d+\.dat$/i.test(name) && name !== "settings.dat") continue;
    try {
      const st = await stat(path.join(dir, name));
      if (st.isFile()) parts.push(name + ":" + st.size + ":" + Math.round(st.mtimeMs));
    } catch { /* skip unreadable */ }
  }
  return parts.sort().join("|");
}

export async function readRobRunSnapshot(home = os.homedir()) {
  const dir = settingsDir(home);
  let names;
  try { names = await readdir(dir); } catch { return null; }
  const files = [];
  for (const name of names) {
    if (!/^settings_steam_4262460_\d+\.dat$/i.test(name)) continue;
    const p = path.join(dir, name);
    try {
      const st = await stat(p);
      if (st.isFile()) files.push({ path: p, mtimeMs: st.mtimeMs, mtime: st.mtime });
    } catch { /* skip */ }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files) {
    let text;
    try { text = await readFile(f.path, "utf8"); } catch { continue; }
    const settings = parseRobRunSettings(text);
    if (!settings || Object.keys(settings).length < ROBRUN_MIN_TRACKED) continue;
    return {
      takenAt: (f.mtime instanceof Date ? f.mtime : new Date(f.mtimeMs)).toISOString(),
      settings,
      source: "settings.dat",
    };
  }
  return null;
}
