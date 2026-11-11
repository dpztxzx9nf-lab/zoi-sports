/* Parse a Call of Duty after-action report into a lab match row.

   Numbers come from local Windows OCR and a vision model. This file does
   not call the model: it turns JSON and local reads into catalog modes,
   whole numbers, a stats bag, and a majority merge. A field that cannot
   be read is left null; the row still counts. Nothing is invented. */

import { COD_MODES, isCodMode, modeOutcome } from "./lab-cod.js";

export const OCR_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const OCR_CONFIDENCE_MIN = 0.75;
export const AAR_MAX_BYTES = 8 * 1024 * 1024;
export const UNRECOGNIZED_MODE = "unrecognized";
export const KILLS_MAX = 200;
export const DEATHS_MAX = 200;
export const SCORE_MAX = 100000;
export const PLACEMENT_MAX = 200;

/* Cheap and accurate enough for a stylized scoreboard: Llama 4 Scout on
   Workers AI, natively multimodal, $0.27 / $0.85 per million tokens.
   A resized JPEG plus a short JSON answer is typically well under a cent. */
export const OCR_COST_NOTE = "Cloudflare Workers AI Llama 4 Scout (~a fraction of a cent per screenshot)";

const aliases = new Map();

function addAlias(id, names) {
  for (const name of names) aliases.set(norm(name), id);
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

for (const m of COD_MODES) {
  addAlias(m.id, [m.id, m.label]);
}

addAlias("tdm", ["team deathmatch", "tdm", "team dm"]);
addAlias("domination", ["dom", "domination"]);
addAlias("hardpoint", ["hard point", "hp"]);
addAlias("kill_confirmed", ["kill confirmed", "kc", "confirmed"]);
addAlias("ffa", ["free for all", "ffa", "free-for-all"]);
addAlias("counter_attack", ["counter attack", "counter-attack"]);
addAlias("search_and_destroy", ["search and destroy", "search & destroy", "snd", "s&d"]);
addAlias("gunfight", ["gunfight", "gun fight"]);
addAlias("gunfight_10v10", ["gunfight 10v10", "gunfight 10 v 10", "10v10 gunfight"]);
addAlias("arms_deal", ["arms deal"]);
addAlias("combat_outpost", ["combat outpost"]);
addAlias("frontal_assault", ["frontal assault"]);
addAlias("gun_game", ["gun game", "gungame"]);
addAlias("drop_zone", ["drop zone", "dropzone"]);
addAlias("dmz", ["dmz", "dark aether dmz", "extract", "extraction"]);
addAlias("warzone", ["warzone", "battle royale", "br", "battle royale warzone"]);
addAlias("resurgence", ["resurgence", "warzone resurgence"]);

export function normalizeMode(raw) {
  const key = norm(raw);
  if (!key) return null;
  if (aliases.has(key)) return aliases.get(key);
  const padded = " " + key + " ";
  for (const [alias, id] of aliases) {
    if (alias.length < 3) continue;
    if (padded.includes(" " + alias + " ")) return id;
  }
  return null;
}

function whole(v, min, max) {
  if (v === undefined || v === null || v === "") return { empty: true };
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/,/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return { bad: true };
  return { value: n };
}

function flag(v) {
  if (v === true || v === 1 || v === "1" || v === "yes" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "no" || v === "false") return 0;
  return null;
}

function confidenceOf(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1 && n <= 100) return n / 100;
  if (n > 1) return 1;
  return n;
}

export function parseJsonObject(text) {
  if (text && typeof text === "object" && !Array.isArray(text)) return sanitizeKeys(text);
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return sanitizeKeys(JSON.parse(body.slice(start, end + 1))); } catch { return null; }
}

function sanitizeKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = {};
  for (const [raw, v] of Object.entries(value)) {
    const key = String(raw).replace(/[:\s]+$/g, "").trim();
    if (!key) continue;
    out[key] = sanitizeKeys(v);
  }
  return out;
}

function parsePlacement(v) {
  if (v === undefined || v === null || v === "") return { empty: true };
  if (typeof v === "number") return whole(v, 1, PLACEMENT_MAX);
  const s = String(v).trim();
  const m = s.match(/(\d+)\s*(?:st|nd|rd|th)?/i);
  if (m) return whole(Number(m[1]), 1, PLACEMENT_MAX);
  return whole(v, 1, PLACEMENT_MAX);
}

export function parseOcrPayload(input) {
  const obj = parseJsonObject(input);
  if (!obj) return { ok: false, error: "The reader did not return a result." };

  const modeGuess = typeof obj.mode === "string" && obj.mode.trim()
    ? obj.mode.trim()
    : (typeof obj.mode_label === "string" ? obj.mode_label.trim() : "");
  const mode = normalizeMode(modeGuess) || UNRECOGNIZED_MODE;

  const kills = whole(obj.kills, 0, KILLS_MAX);
  const deaths = whole(obj.deaths, 0, DEATHS_MAX);
  const score = whole(obj.score, 0, SCORE_MAX);
  const placement = parsePlacement(firstVal(obj, ["placement"]));
  const confidence = confidenceOf(obj.confidence);

  let extracted = null;
  let won = null;
  if (mode !== UNRECOGNIZED_MODE && modeOutcome(mode) === "extraction") {
    extracted = flag(obj.extracted);
    won = null;
  } else if (mode !== UNRECOGNIZED_MODE) {
    won = flag(obj.won);
    extracted = null;
  } else {
    extracted = flag(obj.extracted);
    won = flag(obj.won);
  }

  const assists = whole(firstVal(obj, ["assists"]), 0, 200);
  const contracts = whole(firstVal(obj, ["contracts"]), 0, 50);
  const damage = whole(firstVal(obj, ["damage", "total_damage", "damage_dealt"]), 0, SCORE_MAX);
  const revives = whole(firstVal(obj, ["revives"]), 0, 100);
  const xp = whole(firstVal(obj, ["xp", "total_xp"]), 0, 2000000);

  const notes = typeof obj.notes === "string" ? obj.notes.trim().slice(0, 400) : "";
  const timeAlive = stringStat(firstVal(obj, ["time_alive", "time"]));
  const map = stringStat(firstVal(obj, ["map", "map_name"]));
  const modeLabel = typeof obj.mode_label === "string" ? obj.mode_label.trim().slice(0, 80) : "";

  const core = {
    ok: true,
    mode,
    mode_guess: modeGuess || null,
    mode_label: modeLabel || modeGuess || null,
    kills: kills.empty || kills.bad ? null : kills.value,
    deaths: deaths.empty || deaths.bad ? null : deaths.value,
    score: score.empty || score.bad ? null : score.value,
    placement: placement.empty || placement.bad ? null : placement.value,
    assists: assists.empty || assists.bad ? null : assists.value,
    contracts: contracts.empty || contracts.bad ? null : contracts.value,
    damage: damage.empty || damage.bad ? null : damage.value,
    revives: revives.empty || revives.bad ? null : revives.value,
    xp: xp.empty || xp.bad ? null : xp.value,
    time_alive: timeAlive,
    map,
    extracted,
    won,
    confidence,
    notes,
    kills_bad: Boolean(kills.bad),
    deaths_bad: Boolean(deaths.bad),
    score_bad: Boolean(score.bad),
    placement_bad: Boolean(placement.bad),
    assists_bad: Boolean(assists.bad),
    contracts_bad: Boolean(contracts.bad),
    damage_bad: Boolean(damage.bad),
  };
  core.stats = statsBag(obj, core);
  return core;
}

function firstVal(obj, keys) {
  const bags = [obj];
  if (obj && obj.stats && typeof obj.stats === "object") bags.push(obj.stats);
  for (const bag of bags) {
    for (const k of keys) {
      if (bag[k] !== undefined && bag[k] !== null && bag[k] !== "") return bag[k];
    }
  }
  return null;
}

function stringStat(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().slice(0, 80);
  return s || null;
}

const META_KEYS = new Set([
  "mode", "mode_label", "mode_guess", "confidence", "notes", "ok", "stats",
  "kills_bad", "deaths_bad", "score_bad", "placement_bad", "assists_bad",
  "contracts_bad", "damage_bad",
]);

export const STAT_INT_FIELDS = ["kills", "deaths", "score", "placement", "assists", "contracts", "damage", "revives", "xp"];
export const STAT_FLAG_FIELDS = ["extracted", "won"];
export const STAT_TEXT_FIELDS = ["time_alive", "map", "mode_label"];

function statsBag(obj, core) {
  const bag = {};
  for (const k of [...STAT_INT_FIELDS, ...STAT_FLAG_FIELDS, ...STAT_TEXT_FIELDS, "mode"]) {
    if (core[k] !== undefined && core[k] !== null && core[k] !== "") bag[k] = core[k];
  }
  const extra = obj && obj.stats && typeof obj.stats === "object" && !Array.isArray(obj.stats) ? obj.stats : {};
  const top = obj && typeof obj === "object" ? obj : {};
  for (const src of [extra, top]) {
    for (const [k, v] of Object.entries(src)) {
      if (META_KEYS.has(k) || k in bag) continue;
      if (k.includes(":") || k.includes(" ")) continue;
      if (v === undefined || v === null || v === "") continue;
      if (typeof v === "number" && Number.isFinite(v)) bag[k] = Number.isInteger(v) ? v : Math.round(v);
      else if (typeof v === "boolean") bag[k] = v ? 1 : 0;
      else if (typeof v === "string") {
        const s = v.trim().slice(0, 80);
        if (s) bag[k] = s;
      }
    }
  }
  return bag;
}

export function majorityValue(votes) {
  const present = (votes || []).filter((v) => v !== undefined && v !== null && v !== "");
  if (!present.length) return null;
  const keyOf = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : String(v).trim());
  const counts = new Map();
  for (const v of present) {
    const k = keyOf(v);
    const cur = counts.get(k) || { v, n: 0 };
    cur.n += 1;
    counts.set(k, cur);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  if (ranked.length > 1 && ranked[0].n === ranked[1].n) return null;
  if (present.length > 1 && ranked[0].n < 2) return null;
  return ranked[0].v;
}

export function applyPlacementWon(fields) {
  const row = { ...(fields || {}) };
  if (!isCodMode(row.mode) || modeOutcome(row.mode) !== "win") return row;
  if (row.placement == null) return row;
  const fromPlace = row.placement === 1 ? 1 : 0;
  row.won = fromPlace;
  return row;
}

export function pickMode(reads) {
  const votes = (reads || []).map((r) => r && r.mode).filter((m) => isCodMode(m));
  const unique = [...new Set(votes)];
  if (!unique.length) return UNRECOGNIZED_MODE;
  if (unique.length === 1) return unique[0];
  if (unique.includes("resurgence") && unique.every((m) => m === "resurgence" || m === "warzone")) {
    return "resurgence";
  }
  return majorityValue(votes) || UNRECOGNIZED_MODE;
}

export function mergeMatchReads(reads) {
  const list = (reads || []).filter((r) => r && r.ok);
  const fields = { ok: true };
  const keys = [...STAT_INT_FIELDS, ...STAT_FLAG_FIELDS, ...STAT_TEXT_FIELDS, "mode", "mode_guess", "confidence"];
  for (const k of keys) {
    if (k === "mode") continue;
    fields[k] = majorityValue(list.map((r) => r[k]));
  }
  fields.mode = pickMode(list);
  const merged = applyPlacementWon(parseOcrPayload({
    ...fields,
    mode: fields.mode,
    mode_label: fields.mode_label,
  }));
  // parseOcrPayload re-validates ranges; restore stats extras by majority too
  const extraKeys = new Set();
  for (const r of list) {
    if (r.stats && typeof r.stats === "object") Object.keys(r.stats).forEach((k) => extraKeys.add(k));
  }
  const stats = { ...(merged.stats || {}) };
  for (const k of extraKeys) {
    if (k in stats) continue;
    const v = majorityValue(list.map((r) => (r.stats ? r.stats[k] : null)));
    if (v !== null && v !== undefined) stats[k] = v;
  }
  merged.stats = stats;
  merged.ok = true;
  return merged;
}

export function fieldsNeedingCrop(localFields, vision) {
  const keys = [...STAT_INT_FIELDS, ...STAT_FLAG_FIELDS, "mode"];
  const need = [];
  for (const k of keys) {
    const a = localFields ? localFields[k] : null;
    const b = vision ? vision[k] : null;
    const aMissing = a === undefined || a === null || a === "";
    const bMissing = b === undefined || b === null || b === "";
    if (aMissing && bMissing) continue;
    if (aMissing || bMissing || String(a) !== String(b)) need.push(k);
  }
  return need;
}

export function statsJson(row) {
  const bag = row && row.stats && typeof row.stats === "object" ? { ...row.stats } : {};
  for (const k of [...STAT_INT_FIELDS, ...STAT_FLAG_FIELDS, ...STAT_TEXT_FIELDS, "mode"]) {
    if (row && row[k] !== undefined && row[k] !== null && row[k] !== "") bag[k] = row[k];
  }
  return bag;
}

export function reviewOf(parsed) {
  const reasons = [];
  if (!parsed || !parsed.ok) return { needs_review: 1, reasons: ["The reader did not return a result."] };
  if (parsed.mode === UNRECOGNIZED_MODE || !isCodMode(parsed.mode)) {
    reasons.push("The mode could not be read.");
  }
  if (parsed.kills == null) reasons.push("Kills could not be read.");
  if (parsed.kills_bad || parsed.deaths_bad || parsed.score_bad || parsed.placement_bad) {
    reasons.push("A number on the scoreboard looked wrong.");
  }
  if (isCodMode(parsed.mode) && modeOutcome(parsed.mode) === "extraction" && parsed.extracted == null) {
    reasons.push("Extraction could not be read.");
  }
  if (isCodMode(parsed.mode) && modeOutcome(parsed.mode) === "win" && parsed.won == null) {
    reasons.push("The win could not be read.");
  }
  if (parsed.confidence == null || parsed.confidence < OCR_CONFIDENCE_MIN) {
    reasons.push("The read was not confident enough.");
  }
  return { needs_review: reasons.length ? 1 : 0, reasons };
}

export const OCR_GUIDED_JSON = {
  type: "object",
  properties: {
    mode: { type: "string" },
    mode_label: { type: "string" },
    kills: { type: ["integer", "null"] },
    deaths: { type: ["integer", "null"] },
    score: { type: ["integer", "null"] },
    placement: { type: ["integer", "null"] },
    assists: { type: ["integer", "null"] },
    contracts: { type: ["integer", "null"] },
    damage: { type: ["integer", "null"] },
    revives: { type: ["integer", "null"] },
    xp: { type: ["integer", "null"] },
    time_alive: { type: ["string", "null"] },
    map: { type: ["string", "null"] },
    extracted: { type: ["boolean", "null"] },
    won: { type: ["boolean", "null"] },
    confidence: { type: "number" },
    notes: { type: "string" },
    stats: { type: "object" },
  },
  required: ["confidence"],
  additionalProperties: true,
};

export const OCR_PROMPT = [
  "This is a screenshot of a Call of Duty: Modern Warfare 4 after-action report or end-of-match scoreboard, or it is not.",
  "Read only the local player's own line if a full scoreboard is shown.",
  "Capture every labeled stat that is visible, not only kills and deaths.",
  "On a Warzone or Resurgence Match Summary, the numbers are on the bottom bar, labeled CONTRACTS, KILLS, DEATHS, ASSISTS, and TOTAL DAMAGE, next to a large placement like 31ST PLACE. A 0 is a real value and must be read. RESURGENCE SOLOS or WARZONE in the corner is the mode. Put total damage in damage, not in score. Include any other visible stats (revives, time alive, XP, map) in the JSON.",
  "On a multiplayer scoreboard, read the local player's score, kills, deaths, assists, and any objective or damage number on that row.",
  "On a DMZ result, read whether the player extracted, plus kills and any other visible stats.",
  "Return JSON with: mode, mode_label, kills, deaths, assists, contracts, damage, score (match score only, never total damage), placement, revives, xp, time_alive, map, extracted (true/false only for DMZ, otherwise null), won (true/false for multiplayer, Warzone, or Resurgence; placement 1 is a win, any other place is not), confidence (0 to 1), notes, and stats (an object of any other labeled numbers).",
  "If this is not a scoreboard or after-action report, set confidence to 0 and the other fields to null.",
  "Do not invent numbers you cannot see. A field you cannot read must be null. Preferred mode ids: "
    + COD_MODES.map((m) => m.id + " (" + m.label + ")").join(", ") + ".",
].join(" ");

export const OCR_CROP_PROMPT = [
  "This is a crop from a Call of Duty after-action report, often the bottom stats bar or the header.",
  "Read every labeled number. On the bottom bar, CONTRACTS, KILLS, DEATHS, ASSISTS, and TOTAL DAMAGE each have a number above or beside the label. A 0 is a real value.",
  "Return the same JSON shape: mode, mode_label, kills, deaths, assists, contracts, damage (total damage), score, placement, revives, xp, time_alive, map, extracted, won, confidence, notes, stats.",
  "Do not invent numbers. If a field is not in this crop, set it to null.",
].join(" ");

export function modelTextOf(result) {
  if (result == null) return "";
  if (typeof result === "string") {
    const obj = parseJsonObject(result);
    if (obj && typeof obj === "object" && (obj.choices || obj.response || obj.result || obj.output_text)) {
      const inner = modelTextOf(obj);
      if (inner) return inner;
    }
    return result;
  }
  if (Array.isArray(result.choices) && result.choices[0]) {
    const c = result.choices[0];
    if (c && c.message && typeof c.message.content === "string") return c.message.content;
    if (c && typeof c.text === "string") return c.text;
  }
  if (typeof result.response === "string") return result.response;
  if (result.result && typeof result.result.response === "string") return result.result.response;
  if (typeof result.output_text === "string") return result.output_text;
  if (Array.isArray(result.output)) {
    const parts = [];
    for (const item of result.output) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item.content === "string") parts.push(item.content);
      else if (item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (typeof c === "string") parts.push(c);
          else if (c && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    return parts.join("\n");
  }
  try { return JSON.stringify(result); } catch { return ""; }
}
