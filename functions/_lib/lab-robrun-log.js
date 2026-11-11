/* ROB RUN's own log, read passively from files the game writes:
   - Sentry breadcrumbs (LocalLow\Kefir\ROB RUN\.sentry-native\<run>\__sentry-breadcrumb1/2),
     a msgpack ring buffer the game keeps current while it runs;
   - Player.log / Player-prev.log, plain text with local timestamps.
   Both carry the same game lines: "Init role: citizen", "Change state:
   Idle -> KnockedOut", scene loads, items taken in hands. Nothing here
   touches the game process. */

/* Minimal msgpack reader: enough for Sentry's breadcrumb maps. */
export function decodeMsgpackStream(bytes) {
  const out = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const td = new TextDecoder();
  const str = (n) => { const s = td.decode(bytes.subarray(i, i + n)); i += n; return s; };
  function read() {
    if (i >= bytes.length) throw new Error("eof");
    const b = bytes[i++];
    if (b <= 0x7f) return b;
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);
    if (b >= 0xe0) return b - 0x100;
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: { const n = bytes[i]; i += 1; const v = bytes.subarray(i, i + n); i += n; return v; }
      case 0xc5: { const n = view.getUint16(i); i += 2; const v = bytes.subarray(i, i + n); i += n; return v; }
      case 0xc6: { const n = view.getUint32(i); i += 4; const v = bytes.subarray(i, i + n); i += n; return v; }
      case 0xca: { const v = view.getFloat32(i); i += 4; return v; }
      case 0xcb: { const v = view.getFloat64(i); i += 8; return v; }
      case 0xcc: return bytes[i++];
      case 0xcd: { const v = view.getUint16(i); i += 2; return v; }
      case 0xce: { const v = view.getUint32(i); i += 4; return v; }
      case 0xcf: { const v = Number(view.getBigUint64(i)); i += 8; return v; }
      case 0xd0: { const v = view.getInt8(i); i += 1; return v; }
      case 0xd1: { const v = view.getInt16(i); i += 2; return v; }
      case 0xd2: { const v = view.getInt32(i); i += 4; return v; }
      case 0xd3: { const v = Number(view.getBigInt64(i)); i += 8; return v; }
      case 0xd9: { const n = bytes[i]; i += 1; return str(n); }
      case 0xda: { const n = view.getUint16(i); i += 2; return str(n); }
      case 0xdb: { const n = view.getUint32(i); i += 4; return str(n); }
      case 0xdc: { const n = view.getUint16(i); i += 2; return arr(n); }
      case 0xdd: { const n = view.getUint32(i); i += 4; return arr(n); }
      case 0xde: { const n = view.getUint16(i); i += 2; return map(n); }
      case 0xdf: { const n = view.getUint32(i); i += 4; return map(n); }
      default: throw new Error("unsupported msgpack byte " + b);
    }
  }
  function arr(n) { const a = []; for (let k = 0; k < n; k++) a.push(read()); return a; }
  function map(n) { const o = {}; for (let k = 0; k < n; k++) { const key = read(); o[String(key)] = read(); } return o; }
  while (i < bytes.length) {
    const start = i;
    try { out.push(read()); } catch { i = start + 1; } // skip a torn record at the ring's edge
  }
  return out;
}

const CITY_SCENE = /^City_/;

/* One game line -> a lab event, or null if it is not one we keep. */
export function eventOfLine(message, category = "") {
  const m = String(message || "").trim();
  let r;
  if ((r = /^Init role:\s*([A-Za-z_]+)/.exec(m))) return { kind: "role", detail: r[1].toLowerCase() };
  if ((r = /^Change role:\s*([A-Za-z_]+)\s*->\s*([A-Za-z_]+)/.exec(m))) return { kind: "role", detail: r[2].toLowerCase() };
  if ((r = /^Change state:\s*([A-Za-z_]+)\s*->\s*([A-Za-z_]+)/.exec(m))) return { kind: "state", detail: r[1] + "->" + r[2] };
  if ((r = /^Item (?:taken in hands|switched:\s*\S+\s*->):?\s*([A-Za-z0-9_]+)/.exec(m))) return { kind: "item", detail: r[1] };
  if ((r = /^Scene '([^']+)' was (loaded|unloaded)/.exec(m))) {
    if (r[1] === "Battle" || CITY_SCENE.test(r[1]) || /^Hub_|^Prison|^Settlement|^Realm$/.test(r[1])) {
      return { kind: "scene", detail: r[2] + ":" + r[1] };
    }
    return null;
  }
  if ((r = /^NetworkStep - Changed on "([A-Za-z]+)"/.exec(m))) return { kind: "network", detail: r[1] };
  if (/BecomeRobberMessage/.test(m) && !/validation/.test(m)) return { kind: "role", detail: "robber" };
  return null;
}

function isoOrNull(t) {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function eventsFromBreadcrumbs(records) {
  const out = [];
  for (const r of records || []) {
    if (!r || typeof r !== "object") continue;
    const at = isoOrNull(r.timestamp);
    if (!at) continue;
    const ev = eventOfLine(r.message, r.category);
    if (ev) out.push({ at, ...ev, source: "sentry" });
  }
  return out;
}

/* Player.log: "[2026-11-10 19:13:05.920] [140437]\n[Info] Change state: ..." in local time. */
export function eventsFromPlayerLog(text, tzOffsetMin) {
  const out = [];
  if (!Number.isInteger(tzOffsetMin)) return out;
  const re = /\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,3})\] \[\d+\]\r?\n\[(?:Info|Network|Warning)\] ([^\r\n]+)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7].padEnd(3, "0"));
    const at = new Date(local - tzOffsetMin * 60000).toISOString();
    const ev = eventOfLine(m[8]);
    if (ev) out.push({ at, ...ev, source: "player_log" });
  }
  return out;
}

const CITY_ROLES = new Set(["citizen", "robber", "criminal", "cop", "police", "policeman"]);
const OFF_ROLES = new Set(["hubber", "prisoner", "settler"]);
const SESSION_MAX_MS = 3 * 60 * 60 * 1000;

/* City sessions from the event stream. A session starts when the game puts
   him in the city (a city role, or a City_ scene load) and ends when it
   leaves the battle, gives a non-city role, or the game closes. */
export function robrunSessions(events) {
  const list = (events || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sessions = [];
  let cur = null;
  const close = (at) => {
    if (!cur) return;
    cur.ended_at = at;
    sessions.push(cur);
    cur = null;
  };
  for (const e of list) {
    const t = Date.parse(e.at);
    if (cur && t - Date.parse(cur.last_at) > SESSION_MAX_MS) close(cur.last_at);
    const entersCity = (e.kind === "role" && CITY_ROLES.has(e.detail))
      || (e.kind === "scene" && /^loaded:City_/.test(e.detail));
    const leaves = (e.kind === "role" && OFF_ROLES.has(e.detail))
      || (e.kind === "network" && e.detail === "InRealmNotInBattle")
      || (e.kind === "scene" && (e.detail === "unloaded:Battle" || /^unloaded:City_/.test(e.detail) || /^loaded:(Hub_|Prison|Settlement)/.test(e.detail)))
      || e.kind === "process_exit";
    if (entersCity) {
      if (!cur) cur = { started_at: e.at, ended_at: null, last_at: e.at, knockdowns: 0, arrests: 0, deaths: 0, roles: [], items: [] };
      if (e.kind === "role" && !cur.roles.includes(e.detail)) cur.roles.push(e.detail);
      cur.last_at = e.at;
      continue;
    }
    if (leaves) { close(e.at); continue; }
    if (!cur) continue;
    cur.last_at = e.at;
    if (e.kind === "state") {
      const to = e.detail.split("->")[1] || "";
      if (to === "KnockedOut") cur.knockdowns += 1;
      else if (to === "ArrestFinished") cur.arrests += 1;
      else if (/^(Dead|Death|Died)/i.test(to)) cur.deaths += 1;
    } else if (e.kind === "item" && !cur.items.includes(e.detail)) {
      cur.items.push(e.detail);
    }
  }
  if (cur) sessions.push(cur);
  return sessions;
}
