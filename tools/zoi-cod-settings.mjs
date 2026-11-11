/* Read-only reader for Modern Warfare 4 (cod26) settings files.

   The game writes two text files under %LOCALAPPDATA%\Activision\Call of Duty\players\:
     s.1.0.cod26.txt                 shared graphics (VSync, Reflex, FPS cap)
     <steamid>\g.cod26.1.0.l.txt     the player's FOV and mouse settings

   Lines look like:
     Fov@1;65095;45350 = 90.000000 // 60.000000 to 120.000000

   This module never writes those files. If they are missing, it returns null
   and the agent stays dormant for Call of Duty. */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const COD_TITLE = "cod26";

const LINE = /^([^@\r\n]+)@[^\s=]*\s*=\s*(.*)$/;

export function normalizeCodValue(raw) {
  if (raw == null) return "";
  let text = String(raw).trim();
  const cut = text.indexOf(" //");
  if (cut >= 0) text = text.slice(0, cut).trim();
  if (text === "true" || text === "false") return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return text;
    if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(n);
  }
  return text;
}

export function parseCodConfig(text) {
  const fields = {};
  if (typeof text !== "string" || !text) return fields;
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    if (!name) continue;
    fields[name] = normalizeCodValue(m[2]);
  }
  return fields;
}

/* Raw game keys this lab tracks, mapped to catalog ids. Names come from a
   real MW4 write on 10 November 2026. Aim response curve is a gamepad
   setting and is not in the keyboard-and-mouse file; ADS timing is the
   mouse equivalent, so that is what is tracked. */
export const COD_PROPERTY_MAP = {
  Fov: "fov",
  MouseHorizontalSensibility: "mouse_sensitivity",
  ADSSensitivity: "ads_sensitivity",
  ADSTimingSensitivity: "ads_timing",
  MouseAcceleration: "mouse_acceleration",
  MaxFpsInGame: "max_fps",
  CapFps: "max_fps",
  VSync: "vsync",
  NvidiaReflex: "nvidia_reflex",
};

export const COD_CATALOG = [
  { id: "fov", label: "FOV" },
  { id: "mouse_sensitivity", label: "Mouse Sensitivity" },
  { id: "ads_sensitivity", label: "ADS Sensitivity" },
  { id: "ads_timing", label: "ADS Timing" },
  { id: "mouse_acceleration", label: "Mouse Acceleration" },
  { id: "max_fps", label: "Max FPS" },
  { id: "vsync", label: "VSync" },
  { id: "nvidia_reflex", label: "NVIDIA Reflex" },
];

export const COD_MIN_TRACKED = 4;

function fpsValue(fields) {
  if (!fields || typeof fields !== "object") return "";
  if (normalizeCodValue(fields.CapFps) === "false") return "uncapped";
  return normalizeCodValue(fields.MaxFpsInGame) || "";
}

/* Merge the shared graphics file and the player file, then keep only the
   tracked keys, under their catalog ids. Profile values win on a name clash.
   CapFps + MaxFpsInGame become one field so an uncapped game is not logged
   as whatever number was last typed into the cap box. */
export function flattenCodSettings(shared, profile) {
  const raw = { ...(shared || {}), ...(profile || {}) };
  const out = {};
  for (const [name, id] of Object.entries(COD_PROPERTY_MAP)) {
    if (id === "max_fps") continue;
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const text = normalizeCodValue(raw[name]);
    if (text) out[id] = text;
  }
  const fps = fpsValue(raw);
  if (fps) out.max_fps = fps;
  return out;
}

async function info(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? { path: p, size: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

async function newestProfile(playersDir) {
  let best = null;
  let entries;
  try {
    entries = await readdir(playersDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(playersDir, e.name, "g.cod26.1.0.l.txt");
    const f = await info(p);
    if (f && (!best || f.mtimeMs > best.mtimeMs)) best = f;
  }
  return best;
}

/* Look in LocalAppData first, then Documents, including a COD26 subfolder
   and the older txt0/txt1 split used by Black Ops 7. The first existing
   shared file plus the newest player file wins. */
export function defaultPlayersRoots(env = process.env) {
  const local = env.LOCALAPPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Local") : "");
  const home = env.USERPROFILE || env.HOME || "";
  const roots = [];
  if (local) {
    roots.push(path.join(local, "Activision", "Call of Duty", "players"));
    roots.push(path.join(local, "Activision", "Call of Duty", "Players"));
  }
  if (home) {
    roots.push(path.join(home, "Documents", "Call of Duty", "players"));
    roots.push(path.join(home, "Documents", "Call of Duty", "players", "COD26"));
  }
  return roots;
}

const SHARED_NAMES = ["s.1.0.cod26.txt", "s.1.0.cod26.txt1", "s.1.0.cod26.txt0"];

export async function findCodFiles(env = process.env) {
  const seen = new Set();
  let shared = null;
  let profile = null;
  for (const root of defaultPlayersRoots(env)) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    if (!shared) {
      for (const name of SHARED_NAMES) {
        const f = await info(path.join(root, name));
        if (f) { shared = f; break; }
      }
    }
    const p = await newestProfile(root);
    if (p && (!profile || p.mtimeMs > profile.mtimeMs)) profile = p;
  }
  if (!shared && !profile) return null;
  return { shared, profile };
}

export async function readCodSnapshot(env = process.env, io = {}) {
  const found = io.files || await findCodFiles(env);
  if (!found || (!found.shared && !found.profile)) return null;
  let shared = {};
  let profile = {};
  let newest = 0;
  const sources = [];
  const read = io.readFile || (p => readFile(p, "utf8"));
  if (found.shared) {
    try {
      shared = parseCodConfig(await read(found.shared.path));
      sources.push(path.basename(found.shared.path));
      if (found.shared.mtimeMs > newest) newest = found.shared.mtimeMs;
    } catch { shared = {}; }
  }
  if (found.profile) {
    try {
      profile = parseCodConfig(await read(found.profile.path));
      sources.push(path.basename(found.profile.path));
      if (found.profile.mtimeMs > newest) newest = found.profile.mtimeMs;
    } catch { profile = {}; }
  }
  const settings = flattenCodSettings(shared, profile);
  if (Object.keys(settings).length < COD_MIN_TRACKED) return null;
  return {
    takenAt: new Date(newest || Date.now()).toISOString(),
    settings,
    source: sources.join("+") || "cod26",
    files: {
      shared: found.shared ? found.shared.path : null,
      profile: found.profile ? found.profile.path : null,
    },
  };
}

export function codPayloadKey(snap) {
  if (!snap || !snap.settings) return "";
  return Object.keys(snap.settings).sort()
    .map((k) => k + "=" + String(snap.settings[k])).join("\u001f");
}

export async function codFileSignature(env = process.env) {
  const found = await findCodFiles(env);
  if (!found) return "";
  const parts = [];
  for (const f of [found.shared, found.profile]) {
    if (f) parts.push(f.path + ":" + f.size + ":" + Math.round(f.mtimeMs));
  }
  return parts.sort().join("|");
}
