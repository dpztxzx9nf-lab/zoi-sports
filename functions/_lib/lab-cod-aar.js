/* Parse a Call of Duty after-action report into a lab match row.

   The numbers come from a picture of the player's own scoreboard, read by
   a vision model. This file does not call the model: it turns the model's
   JSON into catalog modes, whole numbers, and a review flag so a shaky
   read cannot quietly enter the charts. */

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
  if (text && typeof text === "object" && !Array.isArray(text)) return text;
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
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
  const placement = whole(obj.placement, 1, PLACEMENT_MAX);
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

  const notes = typeof obj.notes === "string" ? obj.notes.trim().slice(0, 400) : "";

  return {
    ok: true,
    mode,
    mode_guess: modeGuess || null,
    kills: kills.empty || kills.bad ? null : kills.value,
    deaths: deaths.empty || deaths.bad ? null : deaths.value,
    score: score.empty || score.bad ? null : score.value,
    placement: placement.empty || placement.bad ? null : placement.value,
    extracted,
    won,
    confidence,
    notes,
    kills_bad: Boolean(kills.bad),
    deaths_bad: Boolean(deaths.bad),
    score_bad: Boolean(score.bad),
    placement_bad: Boolean(placement.bad),
  };
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
    extracted: { type: ["boolean", "null"] },
    won: { type: ["boolean", "null"] },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
  required: ["confidence"],
  additionalProperties: false,
};

export const OCR_PROMPT = [
  "This is a screenshot of a Call of Duty: Modern Warfare 4 after-action report or end-of-match scoreboard, or it is not.",
  "Read only the local player's own line if a full scoreboard is shown.",
  "Return JSON with: mode (the playlist name), mode_label (exact text on screen), kills, deaths, score, placement (finishing place, or null if the mode has none), extracted (true/false only for DMZ, otherwise null), won (true/false for multiplayer, Warzone, or Resurgence, otherwise null), confidence (0 to 1), and a short notes field.",
  "If this is not a scoreboard or after-action report, set confidence to 0 and the other fields to null.",
  "Do not invent numbers you cannot see. Preferred mode ids: "
    + COD_MODES.map((m) => m.id + " (" + m.label + ")").join(", ") + ".",
].join(" ");

export function modelTextOf(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
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
