/* Parse ROB RUN HUD / map / banner text from local Windows OCR.

   Never invent a value: a field that is not clearly on the screen stays null.
   Cash is not on the in-world HUD we have seen, so it stays null until a
   labeled amount is actually read. */

const LVL = /\blvl\s*(\d+)\b/i;
const PARTY = /\b(SOLO|DUO|TRIO|SQUAD)\b/i;
const ALARM = /ALARM\s+GOES\s+OFF\s+IN/i;
const LEAVE_FEDS = /LEAVE THE CITY BEFORE THE FEDS/i;
const BECOME_CRIMINAL = /BECOME A CRIMINAL|put on a mask to become a criminal/i;
const CITY_MAP = /ADD MARKER/i;
const LOOTY = /LOOTY\s*BAY/i;
const FPS = /\bFPS[:\s]*\d+/i;
const NAME_DENY = new Set(["FPS","PING","LOSS","TAB","SOLO","DUO","TRIO","SQUAD","CITY","LOOTY","BAY","ESC","BACK","SCALE","EXPAND","EARLY","ACCESS","CHAT","NAGS","LENNY","MOTEL","ALARM","GOES","OFF","QUALITY","GAME","MARKER","ADD"]);

export function normalizeHudText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function numOrNull(v, min, max) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function allowedName(s) {
  if (!s) return null;
  const n = String(s).trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{2,20}$/.test(n)) return null;
  if (NAME_DENY.has(n.toUpperCase())) return null;
  return n;
}

export function parseChatEvents(text) {
  const events = [];
  const seen = new Set();
  const src = String(text || "");
  const re = /(\d{1,2}:\d{2})\s+(\[[^\]]+\]\s+)?([^\n]+?)\s+(was arrested|died)!/gi;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[4].toLowerCase() === "died" ? "died" : "arrested";
    const ev = { at: m[1], name: m[3].trim(), kind };
    const key = ev.at + "|" + ev.name.toLowerCase() + "|" + ev.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(ev);
  }
  return events;
}

export function parseRobRunHud(input) {
  const text = typeof input === "string" ? input : (input && input.text) || "";
  const raw = String(text || "");
  const n = normalizeHudText(raw);

  let layout = "other";
  if (CITY_MAP.test(raw) && LOOTY.test(raw)) layout = "city_map";
  else if (FPS.test(raw) || /\bSOLO\b/i.test(raw) || LVL.test(n) || BECOME_CRIMINAL.test(raw)) layout = "world_hud";
  if (LEAVE_FEDS.test(raw) || /\bSHIFT\s+(REPORT|SUMMARY|COMPLETE|ENDED)\b/i.test(raw) || /\bYOU\s+(DIED|WERE ARRESTED)\b/i.test(raw)) {
    layout = "summary";
  }

  let role = null;
  if (BECOME_CRIMINAL.test(raw)) role = "civilian";
  else if (LVL.test(n) || (layout === "world_hud" && /\bCRIMINAL\b/i.test(raw) && !BECOME_CRIMINAL.test(raw))) role = "criminal";
  else if (/\bPOLICE\b|\bON DUTY\b|\bBADGE\b/i.test(raw) && layout === "world_hud") role = "police";

  const lvlM = n.match(LVL);
  const notoriety = lvlM ? numOrNull(Number(lvlM[1]), 1, 20) : null;

  const partyM = raw.match(PARTY);
  const party = partyM ? partyM[1].toUpperCase() : null;

  const bonuses = [];
  const pctRe = /\+(\d+)%/g;
  let pm;
  while ((pm = pctRe.exec(raw))) bonuses.push(Number(pm[1]));

  let player_name = null;
  const nearSolo = raw.match(/([A-Za-z][A-Za-z0-9_]{2,20})\s*(?:\n+|\s+)(SOLO|DUO|TRIO|SQUAD)\b/i);
  if (nearSolo) player_name = allowedName(nearSolo[1]);
  if (!player_name) {
    const afterChat = raw.split(/Looty Bay Chat/i).pop() || raw;
    const nm = afterChat.match(/\b([A-Za-z][A-Za-z0-9_]{2,20})\b/g) || [];
    for (const cand of nm) {
      const ok = allowedName(cand);
      if (ok) { player_name = ok; break; }
    }
  }

  const chat = parseChatEvents(raw);
  let banner = null;
  let banner_seconds = null;
  if (ALARM.test(raw)) {
    banner = "alarm";
    const near = raw.replace(/[\s\S]*ALARM\s+GOES\s+OFF\s+IN/i, " ").slice(0, 40);
    const sec = near.match(/\b(\d{1,3})\b/);
    if (sec) banner_seconds = numOrNull(Number(sec[1]), 0, 600);
  } else if (LEAVE_FEDS.test(raw)) {
    banner = "leave_city";
  }

  let cash = null;
  const cashM = raw.match(/(?:CASH|MONEY|WALLET)\s*[:$]?\s*\$?\s*([\d,]{2,})/i);
  if (cashM) {
    const v = Number(String(cashM[1]).replace(/,/g, ""));
    if (Number.isFinite(v) && v >= 0 && v <= 1e12) cash = v;
  }

  let shift_remaining_s = null;
  const shiftM = raw.match(/(?:SHIFT|FEDS|LEAVE)\D{0,24}(\d{1,2}):(\d{2})/i);
  if (shiftM && banner !== "alarm") {
    const s = Number(shiftM[1]) * 60 + Number(shiftM[2]);
    if (s >= 0 && s <= 60 * 60) shift_remaining_s = s;
  }

  return {
    layout,
    player_name,
    role,
    notoriety,
    party,
    bonuses: bonuses.length ? bonuses : null,
    banner,
    banner_seconds,
    chat,
    cash,
    shift_remaining_s,
  };
}

export function selfEvents(fields) {
  const name = fields && fields.player_name;
  const chat = (fields && fields.chat) || [];
  if (!name) return { deaths: 0, arrests: 0, events: [] };
  const want = String(name).toLowerCase();
  const events = [];
  let deaths = 0, arrests = 0;
  for (const ev of chat) {
    if (!ev || String(ev.name || "").toLowerCase() !== want) continue;
    events.push(ev);
    if (ev.kind === "died") deaths += 1;
    if (ev.kind === "arrested") arrests += 1;
  }
  return { deaths, arrests, events };
}
