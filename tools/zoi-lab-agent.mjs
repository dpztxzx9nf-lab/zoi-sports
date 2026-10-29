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

   It runs once at logon and stays up for the whole session; it is not a
   --once task, because the watching is the point. The launcher is
   zoi-lab-agent.cmd and the task starts it with a hidden window, so no
   console ever flashes. See docs/INFRA.md for the registration line.

   Every line it prints also goes to zoi-lab-agent.log beside itself,
   because a hidden window shows nothing and a failure would otherwise
   leave no trace on the machine.

   It also tails Fortnite's own log and sends the matches it can prove, so the
   lab knows which mode a stretch of play was in. The log is never sent, only the
   handful of fields about each match; see tools/zoi-lab-mode.mjs for what the
   log does and does not say. The read is by stored byte offset, so a 50 MB log
   costs a few KB a minute and nothing is parsed twice.

   The parser below is a port of playbook/tools/parse.py, which stays the
   reference. Same tag layout, same 4-byte values, same float rounding, so both
   read a save to the same numbers. Nothing here is new logic. */

import { inflateSync } from "node:zlib";
import { open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanLog } from "./zoi-lab-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "zoi-lab-agent.json");

const POLL_MS = 60_000;        // how often the files are looked at
const QUIET_MS = 20_000;       // a file this still has finished being written
const QUIET_CHECK_MS = 4_000;
const QUIET_MAX_MS = 5 * 60_000;
const SEND_TRIES = 4;          // one try and three retries
const BACKOFF_MS = [5_000, 15_000, 45_000];
const HEARTBEAT_MS = 60 * 60_000;  // send anyway this often, even with no change

/* ------------------------------------------------------------- the log ----
   The logon task runs with no window, so anything written to stdout goes
   nowhere and a failure on a gaming PC would be invisible after the fact.
   Every line is also appended to zoi-lab-agent.log beside this file, stamped
   with the machine's own local time. Bounded: past 512 KB the file is
   rewritten with its last 200 lines, so a year of heartbeats cannot fill a
   disk. A log that cannot be written is never allowed to stop a send. */
const LOG_PATH = path.join(HERE, "zoi-lab-agent.log");
/* A harness run sets this so the checks never write into the repo. */
const LOG_OFF = process.env.ZOI_LAB_NO_LOG === "1";
const LOG_MAX_BYTES = 512 * 1024;
const LOG_KEEP_LINES = 200;

const pad2 = (n) => String(n).padStart(2, "0");

function logLine(text) {
  if (LOG_OFF) return;
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) {
      const kept = readFileSync(LOG_PATH, "utf8").split("\n").slice(-LOG_KEEP_LINES).join("\n");
      writeFileSync(LOG_PATH, kept.endsWith("\n") ? kept : kept + "\n", "utf8");
    }
    const d = new Date();
    const stamp = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    appendFileSync(LOG_PATH, stamp + "  " + text + "\n", "utf8");
  } catch { /* the log is a convenience; a send must never fail over it */ }
}

/* One line: on screen when a person runs it, and in the file when the logon
   task runs it with no console at all. */
function log(text) {
  console.log(text);
  logLine(text);
}

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

/* The cloud copy is not the raw save: it is an "ECFD" container with a zlib
   stream starting at byte 16, and the inflated body is byte-for-byte the same
   save the game writes locally. Reading it without inflating finds no
   properties at all, which looks exactly like a save with nothing in it - the
   settings silently go up empty instead of failing. So every save is inflated
   when it is a container, and a plain save passes through untouched.

   inflateSync is used rather than a stream because the whole file is 500 KB at
   most and this runs once a minute at worst. A container that will not inflate
   is returned as the bytes that were there, so the parser still has a chance
   at anything readable and nothing is lost by trying. */
export function inflateSav(b) {
  if (b.length < 24 || b.subarray(0, 4).toString("ascii") !== "ECFD") return b;
  /* Find the stream by its own header rather than trusting an offset: zlib
     starts with 78 01, 78 9c, 78 da or 78 5e, and the header above is fixed in
     practice but not documented anywhere worth relying on. */
  for (const head of [[0x78, 0x01], [0x78, 0x9c], [0x78, 0xda], [0x78, 0x5e]]) {
    let at = 4;
    while (at < 64) {
      at = b.indexOf(Buffer.from(head), at);
      if (at < 0) break;
      try {
        const out = inflateSync(b.subarray(at));
        if (out.length > 0) return out;
      } catch { /* a false start inside the header is expected */ }
      at += 1;
    }
  }
  return b;
}

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
  if (!dirs.length) return null;

  /* The newest folder that actually looks like an account id. Picking the
     newest folder and then rejecting it would mean a stray folder left over
     from an older install could hide the real one forever, and Windows names
     are case-insensitive, so an upper-case id is the same account and is
     lowercased rather than dropped (the server compares it as written). */
  const account = dirs.find((d) => EPIC_ID.test(d.name.toLowerCase()));
  if (!account) {
    /* Said once per run, not once per poll, and the sync carries on without
       numbers rather than sending something the server would refuse. */
    if (!epicComplained) {
      epicComplained = true;
      log("No account folder under " + root + " looks like an Epic account id (32 hex characters), so the settings go up without match numbers.");
    }
    return null;
  }
  return account.name.toLowerCase();
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
      log("Couldn't read GameUserSettings.ini: " + e.message);
    }
  }

  let bindings = null;
  if (savFile) {
    try {
      const raw = await readFile(savFile.path);
      const b = inflateSav(raw);
      Object.assign(settings, readSav(b));
      bindings = parseBindings(b);
    } catch (e) {
      log("Couldn't read ClientSettings.Sav: " + e.message);
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

/* ------------------------------------------------------------- matches ----
   Fortnite's own log says which mode each match was played in, and the lab needs
   that to keep a ranked evening out of the same pile as an unranked one. The log
   is read here and turned into a handful of match records, which are the only
   thing that leaves this machine. See tools/zoi-lab-mode.mjs for what the log
   does and does not say; the short version is that it says the mode, the start,
   the end, the rank the game reported afterwards, and a noisy count of players
   left - and nothing else at all.

   Read by byte offset, not by re-reading the file. His log is 50 MB after a few
   evenings and a full parse every minute would be a silly thing to ask of a
   gaming PC, so the offset and the parser's own carried state go in a small JSON
   beside the agent. Everything here is best-effort: a missing log, a log the
   game is halfway through writing, or a state file that will not parse all leave
   the settings sync working exactly as it did before. */
const LOGS_DIR = path.join(savedDir, "Logs");
/* Beside the agent, like its config and its log. A harness overrides it so the
   checks never write into the repo. */
const STATE_PATH = process.env.ZOI_LAB_STATE || path.join(HERE, "zoi-lab-agent-state.json");
const STATE_VERSION = 1;
/* A poll reads at most this much, however far behind it is. A first run starts at
   the end anyway; this only bounds the case where the game wrote a great deal
   while the agent was not running. */
const READ_MAX_BYTES = 8 * 1024 * 1024;
const MATCH_SEND_MAX = 50;         // newest first is what the lab reads; the rest can wait for dedupe
let logComplained = false;

/* The file to tail: FortniteGame.log, or the newest rotated backup when the live
   one is not there. Rotation renames the live file and starts a fresh one, so by
   mtime the live file is the newest whenever the game has run at all; the tie
   break keeps it that way if the two ever land on the same clock tick. */
async function logFile() {
  let names;
  try { names = await readdir(LOGS_DIR); } catch { return null; }
  const found = [];
  for (const name of names) {
    if (name !== "FortniteGame.log" && !/^FortniteGame-backup-.*\.log$/i.test(name)) continue;
    const f = await info(path.join(LOGS_DIR, name));
    if (f) found.push({ ...f, name });
  }
  if (!found.length) return null;
  found.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.name === "FortniteGame.log" ? -1 : b.name === "FortniteGame.log" ? 1 : 0));
  return found[0];
}

/* Bytes from `from` to `to`. Only the new tail is ever read. */
async function readRange(p, from, to) {
  const length = Math.max(0, to - from);
  if (!length) return "";
  const fh = await open(p, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, from);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

/* Offsets are kept in a file rather than in memory, because the logon task runs
   --once and exits: an offset held in memory would be forgotten between runs and
   every run would re-read the whole log. A state file that will not parse is
   treated as a first run, which starts at the end rather than replaying a season
   of matches at once. */
async function loadMatchState() {
  const fresh = { version: STATE_VERSION, file: null, offset: 0, parser: null };
  let raw;
  try { raw = JSON.parse(await readFile(STATE_PATH, "utf8")); } catch { return fresh; }
  if (!raw || typeof raw !== "object" || raw.version !== STATE_VERSION) return fresh;
  const offset = Number(raw.offset);
  return {
    version: STATE_VERSION,
    file: typeof raw.file === "string" ? raw.file : null,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
    parser: raw.parser && typeof raw.parser === "object" ? raw.parser : null,
  };
}

async function saveMatchState(state) {
  try {
    await writeFile(STATE_PATH, JSON.stringify(state), "utf8");
  } catch (e) {
    /* Losing the offset costs a re-read, and a re-read is deduped by match key on
       the server, so this must never fail a send. */
    log("Couldn't save the log position (" + (e && e.message ? e.message : e) + "); the next read may repeat a few matches.");
  }
}

/* New matches since the last read, plus the state to commit once they are safely
   at the lab. Nothing is written to disk here: the position only moves after a
   send succeeded, so a refused token or a dropped connection costs a re-read
   rather than a batch of matches the lab will never hear about.

   Never throws: the caller is on a timer and a broken log must not stop it. */
export async function readNewMatches() {
  const note = (why) => {
    if (!logComplained) {
      logComplained = true;
      log("Not reading Fortnite's log: " + why + ". Settings still sync exactly as before.");
    }
    return { matches: [], commit: null };
  };

  let file;
  try { file = await logFile(); } catch { file = null; }
  if (!file) return note("no FortniteGame.log under " + LOGS_DIR);

  const saved = await loadMatchState();

  let offset;
  if (saved.file === null) {
    /* Nothing has ever been read, so start at the end: a match already played is
       not news, and the lab has enough history to catch up on without a season
       of it arriving at once. */
    offset = file.size;
  } else if (saved.file !== file.name) {
    /* A different file, which means the log was rotated: the new one is short and
       its first lines are the ones that say what is being queued for, so it is
       read from the start. A match that arrives twice is dropped by its key. */
    offset = 0;
  } else if (file.size < saved.offset) {
    offset = 0;                                  // truncated or replaced in place
  } else {
    offset = saved.offset;
  }

  const start = file.size - offset > READ_MAX_BYTES ? file.size - READ_MAX_BYTES : offset;
  let text;
  try { text = await readRange(file.path, start, file.size); } catch (e) {
    return note("the log could not be read (" + (e && e.message ? e.message : e) + ")");
  }

  /* Only whole lines are consumed. The game writes as it plays, so the last line
     in the file can be half written; parsing it would drop a match-end marker and
     the offset would move past it. Leaving it for the next read costs nothing. */
  let consumed = file.size;
  if (text.length && !text.endsWith("\n")) {
    const cut = text.lastIndexOf("\n");
    consumed = cut < 0 ? start : start + cut + 1;
    text = cut < 0 ? "" : text.slice(0, cut + 1);
  }

  let result;
  try {
    /* settle: the agent reads in one-minute slices and the rank line for a match
       lands a minute or three after it, so a closed match is held until its rank
       arrives or the window for one closes. */
    result = scanLog(text.split(/\r?\n/), { state: saved.parser, settle: true });
  } catch (e) {
    return note("the log could not be parsed (" + (e && e.message ? e.message : e) + ")");
  }

  logComplained = false;
  const all = Array.isArray(result.matches) ? result.matches : [];
  const commit = { version: STATE_VERSION, file: file.name, offset: consumed, parser: result.state };
  /* Nothing to send means nothing to lose: the position moves now, so a quiet
     evening does not re-read the same tail on every poll. A poll that did find
     matches hands the commit back instead, and it is only written once the lab
     has taken them. */
  if (!all.length) {
    await saveMatchState(commit);
    return { matches: [], dropped: 0, commit: null };
  }
  return { matches: all.slice(-MATCH_SEND_MAX), dropped: Math.max(0, all.length - MATCH_SEND_MAX), commit };
}

/* Remember how far the log has been read. Called only after the lab took the
   matches, so an unsent batch is read again next poll instead of vanishing. */
export async function commitMatches(commit) {
  if (commit) await saveMatchState(commit);
}

/* ------------------------------------------------------------- sending --- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    log("No config file at " + CONFIG_PATH + " - create it with the endpoint and the token from the lab page.");
    process.exitCode = 1;
    return null;
  }
  let cfg;
  try {
    cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    log("The config file at " + CONFIG_PATH + " is not valid JSON.");
    process.exitCode = 1;
    return null;
  }
  const token = typeof cfg?.token === "string" ? cfg.token.trim() : "";
  const endpoint = typeof cfg?.endpoint === "string" ? cfg.endpoint.trim() : "";
  if (!token) {
    log("The config file at " + CONFIG_PATH + " has no token - paste the one the lab page shows.");
    process.exitCode = 1;
    return null;
  }
  if (!endpoint) {
    log("The config file at " + CONFIG_PATH + " has no endpoint - use https://zoisports.com/api/lab-sync.");
    process.exitCode = 1;
    return null;
  }
  return { token, endpoint };
}

/* One line per send, whatever happened. Returns true when the lab accepted it. */
async function sendOnce(cfg, snap) {
  let status = 0;
  let note = "";
  let matches = 0;
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
      matches = Number(body?.matches?.stored) > 0 ? Number(body.matches.stored) : 0;
      note = body?.duplicate ? " (same as last time)" : made ? " (" + made + " new test" + (made === 1 ? "" : "s") + ")" : "";
      if (matches) note += " (" + matches + " new match" + (matches === 1 ? "" : "es") + ")";
    } else if (status === 401) {
      note = " - the token was refused; create a new one on the lab page";
    }
  } catch (e) {
    note = " - " + (e && e.message ? e.message : "no connection");
  }
  const count = Object.keys(snap.settings || {}).length;
  log("Sent " + count + " settings, HTTP " + (status || "no reply") + note);
  return { ok: status >= 200 && status < 300, matches };
}

/* A snapshot plus whatever the log has proved since the last read. The matches
   are additive: they do not decide whether a send is due, because a new match is
   not a settings change and must not open a test. They ride along with whatever
   send happens next, which the watch loop triggers when it sees one arrive. */
async function send(cfg, prepared) {
  let snap = null;
  try {
    snap = await snapshot();
  } catch (e) {
    log("Couldn't read the Fortnite config: " + (e && e.message ? e.message : e));
    return false;
  }
  if (!snap) {
    log("No Fortnite config found under " + savedDir + " - is the game installed for this user?");
    return false;
  }

  /* The log read is not allowed to matter: if anything in it fails the snapshot
     goes up on its own, exactly as it did before matches existed. */
  let read = prepared || { matches: [], commit: null };
  if (!prepared) {
    try {
      read = await readNewMatches();
    } catch (e) {
      log("Couldn't read Fortnite's log: " + (e && e.message ? e : e) + ". Settings still synced.");
    }
  }
  if (read.dropped) {
    log("Found " + read.dropped + " more matches than one sync carries; the newest " + MATCH_SEND_MAX + " go up and the rest are skipped.");
  }
  const wire = read.matches.length ? { ...snap, matches: read.matches } : snap;

  for (let attempt = 0; attempt < SEND_TRIES; attempt++) {
    const out = await sendOnce(cfg, wire);
    if (out.ok) {
      /* Only now does the read position move. A failed send leaves it where it
         was, so the same matches are read again rather than lost. */
      await commitMatches(read.commit);
      return true;
    }
    if (attempt < SEND_TRIES - 1) await sleep(BACKOFF_MS[attempt] || 45_000);
  }
  return false;
}

/* -------------------------------------------------------------- watch ---- */

/* Something that changes whenever either config file is touched. Cheap - two
   stats - so it can run every poll, but it is only a hint that something might
   have happened, never the thing that decides a send. */
async function signature() {
  const list = await candidates();
  return list.map((f) => f.path + ":" + f.size + ":" + Math.round(f.mtimeMs)).sort().join("|");
}

/* What would actually go up, as one string: the settings and the bindings, with
   keys sorted so the order the game happens to write them in does not count.

   This, not the file's mtime, is what decides whether a send is due. Fortnite
   rewrites GameUserSettings.ini about every two minutes while it is running, and
   the bytes that move are keys this agent does not read
   (LastSelectedPrivateMatchOptions reordering, HasSeenAboutItemModalTypes), so
   the extracted values come out identical. Watching the mtime sent all of that
   churn to the lab - a post every 142 seconds against a heartbeat of an hour.
   The timestamp is deliberately not in the key: it comes from the newest file's
   mtime, so including it would put the churn straight back in. */
function payloadKey(snap) {
  if (!snap) return null;
  const flat = (map) => Object.keys(map || {}).sort()
    .map((k) => k + "=" + String(map[k])).join("\u001f");
  return [
    "settings\u001f" + flat(snap.settings),
    "bindings\u001f" + flat(snap.bindings),
    "account\u001f" + (snap.epicAccountId || ""),
  ].join("\u001e");
}

/* Read the config the same way a send would, and reduce it to that key. Called
   only when a file's stat has moved, so the expensive half of this (inflating
   and walking the save) runs when something happened, not every minute. */
export async function currentPayloadKey() {
  return payloadKey(await snapshot());
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
  log("The config kept changing; sending what is there now.");
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
  const readLog = opts.readLog ?? readNewMatches;
  const ticks = opts.ticks ?? Infinity;     // harness only: stop after N polls

  log("Watching Fortnite's config and log. Sending when the config changes and settles, when a match finishes, and once an hour regardless.");
  let last = await signature();
  /* What was last sent, in values rather than bytes. A file the game rewrote
     without changing any setting it sends must not produce a post. */
  let lastKey = opts.key ? await opts.key() : await currentPayloadKey();
  let churnNotedAt = -Infinity;
  if (!last) log("No config found yet under " + savedDir + " - waiting for the game to run.");

  /* A fresh start counts as just sent: the logon task runs --once, so nothing is
     due until a full heartbeat has gone by. */
  let lastSentAt = clock();

  for (let i = 0; i < ticks; i++) {
    await sleepFor(pollMs);
    const sig = await signature();

    /* The stat says a file moved; that is not the same as a setting changing.
       Settle first - the save is only whole once the game has stopped writing -
       then read the values and see whether what would be sent is actually
       different. A touch with identical values falls through to the heartbeat,
       which is the only thing that should post during ordinary play. */
    let changed = false;
    let keyNow = null;
    if (sig !== last) {
      last = sig;
      await waitForQuiet();
      last = await signature();
      keyNow = opts.key ? await opts.key() : await currentPayloadKey();
      changed = keyNow !== lastKey;
      /* Said once an hour at most. The game rewrites its config every couple of
         minutes, so a line per rewrite would bury everything else in the log for
         a thing that is working as intended. */
      if (!changed && clock() - churnNotedAt >= heartbeatMs) {
        churnNotedAt = clock();
        log("The game rewrote its config, but every setting it sends is the same, so nothing went up.");
      }
    }

    /* The log is read on every poll, not only when a send is due: that is how a
       finished match is noticed at all, since playing a match does not touch the
       config. A failed read leaves matches empty and the loop behaves exactly as
       it did before this existed. */
    let read = { matches: [], commit: null };
    try {
      read = await readLog();
    } catch (e) {
      log("Couldn't read Fortnite's log: " + (e && e.message ? e : e) + ". Settings still synced.");
    }
    const played = Array.isArray(read.matches) ? read.matches.length : 0;

    const due = clock() - lastSentAt >= heartbeatMs;
    if (!changed && !due && !played) continue;   // nothing happened: say nothing

    if (changed) {
      /* fall through to the send: a real value moved */
    } else if (played) {
      /* A match ended. There is no settings change in this, so no test is opened
         and nothing is deduped away - the matches are additive and the lab files
         them by their own key. Worth a line, because an evening of play with no
         settings touched would otherwise look like the agent doing nothing. */
      log("A match finished - sending it with the current settings.");
    } else {
      /* Nothing moved. The snapshot is identical to the last one, so the lab
         dedupes it and opens no tests - but the stats read still runs, which is
         the only thing that moves games_played on a long session that never
         touched a setting. Said out loud so a send with no change is not a
         mystery in the log. */
      log("Nothing changed in the last " + Math.round(heartbeatMs / 60_000) +
        " minutes - sending anyway so the match numbers stay current.");
    }

    const delivered = await sendNow(cfg, read);
    /* Any attempt restarts the clock, so a refused token or a dropped connection
       costs one line a heartbeat rather than one a poll. */
    lastSentAt = clock();
    last = await signature();                // whatever the send did, watch from here
    /* The key only moves forward when the lab actually took the snapshot. A
       refused send leaves it alone, so the change is still different from what
       was last delivered and goes up with the next heartbeat rather than being
       recorded as already known.

       What it moves to is keyNow when there was one: that is the exact key the
       send carried. Re-reading here instead could pick up a value written while
       the send was in flight, record it as delivered when it was not, and lose
       that change until something else moved. */
    if (delivered || keyNow === null) {
      lastKey = keyNow !== null ? keyNow : (opts.key ? await opts.key() : await currentPayloadKey());
    }
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
  /* A missing or broken config has already said why and set the exit code; it
     must not fall through to watching, which would retry the same bad file
     every minute and fill the log. */
  if (cfg) {
    if (process.argv.includes("--once")) {
      const sent = await send(cfg);
      /* process.exit() while stdout is still draining is what trips libuv on
         Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") - a
         crash after a successful send, which looks like a failure in the log
         and gives a task a bad exit code. Setting the code and letting the loop
         empty is enough: nothing here keeps the process alive. */
      process.exitCode = sent ? 0 : 1;
    } else {
      await watch(cfg);
    }
  }
}
