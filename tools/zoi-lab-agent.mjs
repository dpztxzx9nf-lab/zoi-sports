#!/usr/bin/env node
/* zoi-lab-agent - send Fortnite's own settings to the settings lab.

   Reads two files the game already writes and posts a flat snapshot of them to
   the lab, which opens a test by itself whenever a tracked setting changed. It
   never writes to a Fortnite file, never changes a setting, and holds nothing
   but the token it is given.

   It also sends the Epic account id it finds in the newest
   Saved\Cloud\<id>\ folder, so the lab can pull that account's match numbers
   from the stats API. That is a folder name, not a login, and nothing else is
   read out of it. If the folder name is not 32 lowercase hex characters it is
   left out and the settings still go up.

   Watching sends when a config file changes and settles, and also once an hour
   when nothing changed at all. The hourly send is a duplicate snapshot, so the
   server opens no tests for it, but it still reads the account's match numbers:
   forty matches played without touching a setting would otherwise never reach
   the lab, and games_played would sit still.

   Usage:
     node tools/zoi-lab-agent.mjs           watch and send when the config changes
     node tools/zoi-lab-agent.mjs --once    send one snapshot and exit

   The token and address live in tools/zoi-lab-agent.json:
     { "endpoint": "https://zoisports.com/api/lab-sync", "token": "..." }

   Register it at logon (PowerShell, one line; --once is what the task runs):
     schtasks /Create /SC ONLOGON /TN "Zoi Lab Agent" /TR "\"%LOCALAPPDATA%\Programs\zoi\zoi-lab-agent.cmd\" --once" /F

   The parser below is a port of playbook/tools/parse.py, which stays the
   reference. Same tag layout, same 4-byte values, same float rounding, so both
   read a save to the same numbers. Nothing here is new logic. */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "zoi-lab-agent.json");

const POLL_MS = 60_000;        // how often the files are looked at
const QUIET_MS = 20_000;       // a file this still has finished being written
const QUIET_CHECK_MS = 4_000;
const QUIET_MAX_MS = 5 * 60_000;
const SEND_TRIES = 4;          // one try and three retries
const BACKOFF_MS = [5_000, 15_000, 45_000];
const HEARTBEAT_MS = 60 * 60_000;  // send anyway this often, even with no change

/* --------------------------------------------------------------- INI ----
   Same key list as parse.py's INI_FIELDS. Duplicates there are harmless. */
const INI_FIELDS = [
  "ResolutionSizeX", "ResolutionSizeY", "FullscreenMode", "LastConfirmedFullscreenMode",
  "FrameRateLimit", "bUseVSync", "bMotionBlur", "bShowGrass", "bShowFPS",
  "bUseDynamicResolution", "FortAntiAliasingMethod", "DLSSQuality",
  "bEnableDLSSFrameGeneration", "PotentiallyUpscaledResolutionQuality",
  "bUseNanite", "bRayTracing", "DesiredGlobalIlluminationQuality",
  "DesiredReflectionQuality", "AudioQualityLevel", "bUseHeadphoneMode",
  "bDisableMouseAcceleration", "bUseHDRDisplayOutput",
];

/* --------------------------------------------------------------- SAV ----
   The save is a tagged property stream: name, type, then 04 00 00 00 00, then
   a 4-byte value. Ported from parse.py, including the parts that look odd:
   the tag is searched for within 20 bytes of the type string, and the walk
   resumes after the type name, not after the value. */
const TYPES = new Set([
  "FloatProperty", "UInt32Property", "IntProperty", "BoolProperty",
  "StrProperty", "NameProperty", "EnumProperty", "Int64Property",
  "UInt64Property", "DoubleProperty", "ByteProperty",
  "StructProperty", "ArrayProperty", "MapProperty", "SetProperty",
]);

const SIZE_MARKER = Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00]);

/* A length-prefixed ASCII string ending in a NUL, or null where parse.py's
   fstring would refuse: short, absurdly long, unterminated, or not text. */
export function fstring(b, at) {
  if (at + 4 > b.length) return null;
  const n = b.readInt32LE(at);
  if (n <= 0 || n > 400 || at + 4 + n > b.length) return null;
  const raw = b.subarray(at + 4, at + 4 + n);
  if (raw[raw.length - 1] !== 0) return null;
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] < 32 || raw[i] >= 127) return null;
  }
  return { text: raw.subarray(0, raw.length - 1).toString("ascii"), next: at + 4 + n };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function readSav(b) {
  const out = {};
  let i = 0;
  while (i < b.length - 12) {
    const name = fstring(b, i);
    if (!name) { i += 1; continue; }
    const type = fstring(b, name.next);
    if (!type || !TYPES.has(type.text)) { i += 1; continue; }

    const from = type.next;
    const idx = b.indexOf(SIZE_MARKER, from);
    const within = idx >= 0 && idx < from + 20;
    if (within && (type.text === "FloatProperty" || type.text === "UInt32Property" || type.text === "IntProperty")) {
      const at = idx + 5;
      if (at + 4 <= b.length) {
        if (type.text === "FloatProperty") out[name.text] = round6(b.readFloatLE(at));
        else if (type.text === "UInt32Property") out[name.text] = b.readUInt32LE(at);
        else out[name.text] = b.readInt32LE(at);
      }
    }
    i = type.next;
  }
  return out;
}

/* Action -> the keys bound to it, from CustomGamepadActionBindings. Ported from
   parse.py's parse_bindings, including how it walks strings from the first
   mention of the block to 400 KB past it. */
export function parseBindings(b) {
  const start = b.indexOf(Buffer.from("CustomGamepadActionBindings", "ascii"));
  if (start < 0) return {};

  const toks = [];
  let at = start;
  const end = Math.min(start + 400000, b.length);
  while (at < end) {
    const t = fstring(b, at);
    if (!t) { at += 1; continue; }
    toks.push(t.text);
    at = t.next;
  }

  const out = {};
  let cur = null;
  for (let k = 0; k < toks.length; k++) {
    if (toks[k] === "ActionName" && k + 2 < toks.length && toks[k + 1] === "NameProperty") {
      cur = toks[k + 2];
      if (!(cur in out)) out[cur] = [];
    } else if (toks[k] === "KeyName" && k + 2 < toks.length && toks[k + 1] === "NameProperty" && cur) {
      const key = toks[k + 2];
      if (key !== "None") out[cur].push(key);
    }
  }
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  return out;
}

export function readIni(text) {
  const fields = {};
  const scalability = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k.startsWith("sg.")) scalability[k.slice(3)] = v;
    else if (INI_FIELDS.includes(k)) fields[k] = v;
  }
  return { fields, scalability };
}

/* ------------------------------------------------------------ the PC ---- */

const localAppData = process.env.LOCALAPPDATA
  || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");

const savedDir = path.join(localAppData, "FortniteGame", "Saved");
const INI_PATH = path.join(savedDir, "Config", "WindowsClient", "GameUserSettings.ini");
const LOCAL_SAV = path.join(savedDir, "Config", "ClientSettings.Sav");

/* The cloud copy is the one the game keeps current; the Config copy can sit
   stale for days. Every account folder is a candidate and the newest wins. */
async function cloudSavPaths() {
  const root = path.join(savedDir, "Cloud");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name, "ClientSettings.Sav"));
  } catch { return []; }
}

/* An Epic account id: 32 lowercase hex characters, the name Fortnite itself
   uses for the per-account folder under Saved\Cloud. Reading it from there is
   why nobody has to type it, and it is reliable where a display name is not
   (his has small-caps characters and the stats API answers 404 for it). */
const EPIC_ID = /^[0-9a-f]{32}$/;
let epicComplained = false;

/* The id whose folder was written most recently: the account that actually
   played last, not an old one left behind in the same install.
   Exported with snapshot() so a harness can point LOCALAPPDATA at a fake tree
   and check what the agent would actually send. */
export async function epicAccountId() {
  const root = path.join(savedDir, "Cloud");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch { return null; }
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const f = await info(path.join(root, e.name, "ClientSettings.Sav"));
    dirs.push({ name: e.name, mtimeMs: f ? f.mtimeMs : 0 });
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = dirs[0];
  if (!newest) return null;
  if (!EPIC_ID.test(newest.name)) {
    /* Said once per run, not once per poll, and the sync carries on without
       numbers rather than sending something the server would refuse. */
    if (!epicComplained) {
      epicComplained = true;
      console.log("Ignoring the Cloud folder \"" + newest.name + "\": an Epic account id is 32 lowercase hex characters, so the settings go up without match numbers.");
    }
    return null;
  }
  return newest.name;
}

async function info(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? { path: p, size: s.size, mtimeMs: s.mtimeMs, mtime: s.mtime } : null;
  } catch { return null; }
}

/* Every file that can hold the config, and which of the two saves is newest.
   Reading and watching both use this, so the watcher notices a change to
   either copy rather than only to the one that was newest a minute ago. */
async function candidates() {
  const list = [await info(INI_PATH), await info(LOCAL_SAV)];
  for (const p of await cloudSavPaths()) list.push(await info(p));
  return list.filter(Boolean);
}

async function pickSav(list) {
  const saves = list.filter((f) => f.path !== INI_PATH);
  if (!saves.length) return null;
  return saves.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
}

/* One flat map: ini keys prefixed ini., scalability keys prefixed sg., and the
   save's own property names bare so they can be matched against the catalog. */
export async function snapshot() {
  const list = await candidates();
  const iniFile = list.find((f) => f.path === INI_PATH) || null;
  const savFile = await pickSav(list);

  const settings = {};
  let newest = 0;
  for (const f of [iniFile, savFile]) if (f && f.mtimeMs > newest) newest = f.mtimeMs;

  if (iniFile) {
    try {
      const { fields, scalability } = readIni(await readFile(iniFile.path, "utf8"));
      for (const [k, v] of Object.entries(fields)) settings["ini." + k] = v;
      for (const [k, v] of Object.entries(scalability)) settings["sg." + k] = v;
    } catch (e) {
      console.log("Couldn't read GameUserSettings.ini: " + e.message);
    }
  }

  let bindings = null;
  if (savFile) {
    try {
      const b = await readFile(savFile.path);
      Object.assign(settings, readSav(b));
      bindings = parseBindings(b);
    } catch (e) {
      console.log("Couldn't read ClientSettings.Sav: " + e.message);
    }
  }

  if (!Object.keys(settings).length) return null;
  const epic = await epicAccountId();
  return {
    takenAt: new Date(newest || Date.now()).toISOString(),
    settings,
    ...(bindings && Object.keys(bindings).length ? { bindings } : {}),
    ...(epic ? { epicAccountId: epic } : {}),
    source: "zoi-lab-agent",
  };
}

/* ------------------------------------------------------------- sending --- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.log("No config file at " + CONFIG_PATH + " - create it with the endpoint and the token from the lab page.");
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    console.log("The config file at " + CONFIG_PATH + " is not valid JSON.");
    process.exit(1);
  }
  const token = typeof cfg?.token === "string" ? cfg.token.trim() : "";
  const endpoint = typeof cfg?.endpoint === "string" ? cfg.endpoint.trim() : "";
  if (!token) {
    console.log("The config file at " + CONFIG_PATH + " has no token - paste the one the lab page shows.");
    process.exit(1);
  }
  if (!endpoint) {
    console.log("The config file at " + CONFIG_PATH + " has no endpoint - use https://zoisports.com/api/lab-sync.");
    process.exit(1);
  }
  return { token, endpoint };
}

/* One line per send, whatever happened. Returns true when the lab accepted it. */
async function sendOnce(cfg, snap) {
  let status = 0;
  let note = "";
  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token },
      body: JSON.stringify(snap),
    });
    status = res.status;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const made = Array.isArray(body?.created) ? body.created.length : 0;
      note = body?.duplicate ? " (same as last time)" : made ? " (" + made + " new test" + (made === 1 ? "" : "s") + ")" : "";
    } else if (status === 401) {
      note = " - the token was refused; create a new one on the lab page";
    }
  } catch (e) {
    note = " - " + (e && e.message ? e.message : "no connection");
  }
  console.log(new Date().toLocaleTimeString() + " sent " + Object.keys(snap.settings).length + " settings, HTTP " + (status || "no reply") + note);
  return status >= 200 && status < 300;
}

async function send(cfg) {
  let snap = null;
  try {
    snap = await snapshot();
  } catch (e) {
    console.log("Couldn't read the Fortnite config: " + (e && e.message ? e.message : e));
    return false;
  }
  if (!snap) {
    console.log("No Fortnite config found under " + savedDir + " - is the game installed for this user?");
    return false;
  }
  for (let attempt = 0; attempt < SEND_TRIES; attempt++) {
    if (await sendOnce(cfg, snap)) return true;
    if (attempt < SEND_TRIES - 1) await sleep(BACKOFF_MS[attempt] || 45_000);
  }
  return false;
}

/* -------------------------------------------------------------- watch ---- */

/* Something that changes whenever either config file is touched. */
async function signature() {
  const list = await candidates();
  return list.map((f) => f.path + ":" + f.size + ":" + Math.round(f.mtimeMs)).sort().join("|");
}

/* Wait until no candidate file has changed size or mtime for QUIET_MS. The game
   is closed by then, which is when the save is whole. */
async function waitQuiet() {
  const started = Date.now();
  let last = await signature();
  let stableSince = Date.now();
  while (Date.now() - started < QUIET_MAX_MS) {
    await sleep(QUIET_CHECK_MS);
    const now = await signature();
    if (now !== last) { last = now; stableSince = Date.now(); continue; }
    if (Date.now() - stableSince >= QUIET_MS) return true;
  }
  console.log("The config kept changing; sending what is there now.");
  return false;
}

/* The watch loop. Timings, the clock, the send and the quiet wait are all
   optional so a harness can run an hour of watching in a moment; with nothing
   passed in it is the loop above, unchanged. */
export async function watch(cfg, opts = {}) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const clock = opts.now ?? Date.now;
  const sleepFor = opts.sleep ?? sleep;
  const waitForQuiet = opts.quiet ?? waitQuiet;
  const sendNow = opts.send ?? send;
  const ticks = opts.ticks ?? Infinity;     // harness only: stop after N polls

  console.log("Watching Fortnite's config. Sending when it changes and settles, and once an hour regardless.");
  let last = await signature();
  if (!last) console.log("No config found yet under " + savedDir + " - waiting for the game to run.");

  /* A fresh start counts as just sent: the logon task runs --once, so nothing is
     due until a full heartbeat has gone by. */
  let lastSentAt = clock();

  for (let i = 0; i < ticks; i++) {
    await sleepFor(pollMs);
    const sig = await signature();
    const changed = sig !== last;
    const due = clock() - lastSentAt >= heartbeatMs;
    if (!changed && !due) continue;          // nothing changed and not due: say nothing

    if (changed) {
      last = sig;
      await waitForQuiet();
    } else {
      /* Nothing moved. The snapshot is identical to the last one, so the lab
         dedupes it and opens no tests - but the stats read still runs, which is
         the only thing that moves games_played on a long session that never
         touched a setting. Said out loud so a send with no change is not a
         mystery in the log. */
      console.log("Nothing changed in the last " + Math.round(heartbeatMs / 60_000) +
        " minutes - sending anyway so the match numbers stay current.");
    }

    await sendNow(cfg);
    /* Any attempt restarts the clock, so a refused token or a dropped connection
       costs one line a heartbeat rather than one a poll. */
    lastSentAt = clock();
    last = await signature();                // whatever the send did, watch from here
  }
}

/* ---------------------------------------------------------------- main --- */

/* The parser is exported so a harness can run it over the same files parse.py
   reads and compare the two. Everything below only happens when this file is
   the thing that was run. */
const runDirectly = (() => {
  try {
    return realpathSync(process.argv[1] || "") === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
})();

if (runDirectly) {
  const cfg = await loadConfig();
  if (process.argv.includes("--once")) {
    process.exit((await send(cfg)) ? 0 : 1);
  }
  await watch(cfg);
}
