/* Accept ROB RUN HUD / shift samples from the PC helper.
   Same bearer-token auth as /api/lab-cod-aar. Images, when sent, go to
   private R2. Fields the reader could not see stay null. */
import { json, sha256Hex } from "../_lib/lab.js";
import { sniffImage } from "../_lib/media.js";
import { AAR_MAX_BYTES } from "../_lib/lab-cod-aar.js";
import { parseRobRunHud, selfEvents } from "../_lib/lab-robrun-aar.js";

const unauthorized = () => json({ ok: false, error: "Unauthorized." }, 401);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const OPEN_GAP_MS = 8 * 60 * 1000;
const SHIFT_MAX_MS = 50 * 60 * 1000;

function tokenFrom(request) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (m) return m[1];
  return (request.headers.get("x-lab-token") || "").trim();
}

function bytesOf(base64) {
  const raw = String(base64 || "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return null;
  let bin;
  try { bin = atob(raw); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function imageFromBody(body) {
  if (!body || typeof body !== "object") return { none: true };
  const data = typeof body.image === "string" ? body.image : "";
  if (!data) return { none: true };
  const comma = data.indexOf(",");
  const head = comma === -1 ? "" : data.slice(0, comma);
  const raw = comma === -1 ? data : data.slice(comma + 1);
  if (comma !== -1 && !/^data:[^;,]*;base64$/i.test(head.replace(/\s+$/, ""))) {
    return { error: "Send the screenshot as a base64 data URL." };
  }
  const bytes = bytesOf(raw);
  if (!bytes || !bytes.length) return { error: "That screenshot came through empty." };
  if (bytes.length > AAR_MAX_BYTES) return { error: "That screenshot is too large." };
  const mime = sniffImage(bytes);
  if (!mime) return { error: "That file is not a JPEG, PNG or WebP image." };
  return { bytes, mime };
}

function extOf(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function takenAtOf(body) {
  const raw = typeof body.taken_at === "string" ? body.taken_at.trim() : "";
  if (raw && ISO.test(raw)) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms) && Math.abs(Date.now() - ms) < 24 * 60 * 60 * 1000) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function fieldsFromBody(body) {
  const local = body && body.local_ocr && typeof body.local_ocr === "object" ? body.local_ocr : null;
  const text = (local && typeof local.text === "string" && local.text)
    || (typeof body.text === "string" && body.text)
    || "";
  const parsed = parseRobRunHud(text);
  if (local && local.fields && typeof local.fields === "object") {
    for (const k of ["layout", "player_name", "role", "notoriety", "party", "banner", "banner_seconds", "cash", "shift_remaining_s"]) {
      if (parsed[k] == null && local.fields[k] != null && local.fields[k] !== "") parsed[k] = local.fields[k];
    }
    if ((!parsed.bonuses || !parsed.bonuses.length) && Array.isArray(local.fields.bonuses)) parsed.bonuses = local.fields.bonuses;
    if ((!parsed.chat || !parsed.chat.length) && Array.isArray(local.fields.chat)) parsed.chat = local.fields.chat;
  }
  return { text, fields: parsed };
}

function eventOf(body, fields) {
  const ev = typeof body.event === "string" ? body.event.trim() : "";
  if (ev === "shift_end" || ev === "process_exit" || ev === "disconnected") return ev;
  if (fields.layout === "summary" && fields.banner === "leave_city") return "leave_city";
  return ev || "sample";
}

function mergeStats(prev, fields, takenAt, event) {
  let stats = {};
  if (prev && typeof prev === "string" && prev.trim()) {
    try { stats = JSON.parse(prev) || {}; } catch { stats = {}; }
  } else if (prev && typeof prev === "object") stats = { ...prev };
  const samples = Array.isArray(stats.samples) ? stats.samples.slice(-40) : [];
  samples.push({
    at: takenAt,
    layout: fields.layout,
    role: fields.role,
    notoriety: fields.notoriety,
    party: fields.party,
    banner: fields.banner,
    banner_seconds: fields.banner_seconds,
    cash: fields.cash,
    event,
  });
  stats.samples = samples;
  if (fields.bonuses) stats.bonuses = fields.bonuses;
  if (fields.cash != null) {
    if (stats.cash_start == null) stats.cash_start = fields.cash;
    stats.cash_end = fields.cash;
    if (stats.cash_start != null) stats.cash_delta = fields.cash - stats.cash_start;
  }
  if (fields.notoriety != null) {
    stats.notoriety_peak = Math.max(Number(stats.notoriety_peak) || 0, fields.notoriety);
  }
  const self = selfEvents(fields);
  const evs = [];
  const have = new Set();
  for (const e of (stats.self_events || []).concat(self.events || [])) {
    if (!e) continue;
    const k = String(e.at || "") + ":" + String(e.kind || "") + ":" + String(e.name || "").toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    evs.push(e);
  }
  stats.self_events = evs;
  stats.seen_deaths = evs.filter((e) => e.kind === "died").length;
  stats.seen_arrests = evs.filter((e) => e.kind === "arrested").length;
  return stats;
}

function pickRole(prev, next) {
  if (next === "criminal" || prev === "criminal") return "criminal";
  if (next === "police" || prev === "police") return "police";
  return next || prev || null;
}

function finalizeOutcome(event, fields, stats) {
  if (event === "process_exit" || event === "disconnected") return "disconnected";
  if (event === "leave_city" || event === "shift_end") return "left";
  if (fields && fields.layout === "summary") {
    const t = JSON.stringify(fields).toLowerCase();
    if (t.includes("you died")) return "died";
    if (t.includes("arrested")) return "arrested";
    if (t.includes("leave_city") || (fields.banner === "leave_city")) return "left";
  }
  const evs = (stats && stats.self_events) || [];
  const last = evs[evs.length - 1];
  if (event === "shift_end" && last && last.kind === "died") return "died";
  if (event === "shift_end" && last && last.kind === "arrested") return "arrested";
  return event === "shift_end" ? "left" : "in_progress";
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const token = tokenFrom(request);
  if (!token || token.length > 200) return unauthorized();

  let owner = null;
  try {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT id,owner FROM lab_tokens WHERE token_hash = ? AND revoked_at IS NULL"
    ).bind(hash).first();
    if (!row || !row.owner) return unauthorized();
    owner = row.owner;
    await env.DB.prepare(
      "UPDATE lab_tokens SET last_seen_at = datetime('now') WHERE id = ?"
    ).bind(row.id).run();
  } catch (e) {
    console.error("robrun aar auth failed", e);
    return json({ ok: false, error: "Couldn't check that token just now." }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Send the sample as JSON." }, 422); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Send the sample as JSON." }, 422);
  }

  const pic = imageFromBody(body);
  if (pic.error) return json({ ok: false, error: pic.error }, 422);

  const takenAt = takenAtOf(body);
  const { text, fields } = fieldsFromBody(body);
  const event = eventOf(body, fields);
  const inCity = fields.layout === "world_hud" || fields.layout === "city_map" || fields.layout === "summary";

  let key = null;
  if (pic.bytes && env.MEDIA) {
    try {
      const ownerHash = await sha256Hex(owner);
      const stamp = takenAt.replace(/[-:]/g, "").replace("T", "T").replace(".000Z", "Z");
      key = "robrun-aar/" + ownerHash.slice(0, 16) + "/" + takenAt.replace(/[:.]/g, "") + "-" + crypto.randomUUID().slice(0, 8) + "." + extOf(pic.mime);
      await env.MEDIA.put(key, pic.bytes, { httpMetadata: { contentType: pic.mime } });
    } catch (e) {
      console.error("robrun aar r2 failed", e);
      return json({ ok: false, error: "Couldn't store that screenshot just now." }, 500);
    }
  }

  const ocr = JSON.stringify({
    text: String(text || "").slice(0, 4000),
    fields,
    event,
    local: body.local_ocr || null,
  });

  let open = null;
  try {
    const opens = await env.DB.prepare(
      `SELECT * FROM lab_robrun_shifts
        WHERE owner = ? AND deleted_at IS NULL AND ended_at IS NULL
        ORDER BY id ASC`
    ).bind(owner).all();
    const list = opens.results || [];
    open = list[0] || null;
    /* A race can open two in-progress rows. Keep the earliest and close the rest. */
    for (const extra of list.slice(1)) {
      await env.DB.prepare(
        `UPDATE lab_robrun_shifts SET deleted_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND owner = ? AND ended_at IS NULL AND deleted_at IS NULL`
      ).bind(extra.id, owner).run();
    }
  } catch (e) {
    console.error("robrun shift lookup failed", e);
    return json({ ok: false, error: "Couldn't read the shift log. Has the migration been applied?" }, 500);
  }

  const takenMs = Date.parse(takenAt);
  if (open && Number.isFinite(takenMs)) {
    const startMs = Date.parse(open.started_at);
    if (Number.isFinite(startMs) && takenMs - startMs > SHIFT_MAX_MS) {
      /* A 40-minute shift plus a little slack has already elapsed. Close it
         and start a new row rather than stretching one trip across two. */
      const dur = Math.max(0, Math.round((startMs + SHIFT_MAX_MS - startMs) / 1000));
      await env.DB.prepare(
        `UPDATE lab_robrun_shifts SET ended_at = ?, outcome = 'left', duration_s = ?, updated_at = datetime('now')
          WHERE id = ? AND owner = ? AND ended_at IS NULL`
      ).bind(new Date(startMs + SHIFT_MAX_MS).toISOString(), 40 * 60, open.id, owner).run();
      open = null;
    }
  }

  const closing = event === "shift_end" || event === "process_exit" || event === "disconnected" || event === "leave_city";
  if (!open && !inCity && closing) {
    return json({ ok: true, skipped: true, reason: "no open shift" });
  }

  try {
    if (!open && inCity) {
      const stats = mergeStats(null, fields, takenAt, event);
      const self = selfEvents(fields);
      const outcome = closing ? finalizeOutcome(event, fields, stats) : "in_progress";
      const ended = closing ? takenAt : null;
      const dur = ended ? 0 : null;
      const row = await env.DB.prepare(
        `INSERT INTO lab_robrun_shifts
           (owner,started_at,ended_at,role,notoriety,party,player_name,outcome,duration_s,deaths,arrests,source,confidence,aar_key,fingerprint,ocr_json,stats,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'ocr',1,?,?,?,?,datetime('now'))`
      ).bind(
        owner, takenAt, ended, fields.role, fields.notoriety, fields.party, fields.player_name,
        outcome, dur, self.deaths || 0, self.arrests || 0, key, body.fingerprint || null, ocr, JSON.stringify(stats)
      ).run();
      return json({ ok: true, id: row?.meta?.last_row_id ?? null, started_at: takenAt, outcome, fields }, ended ? 200 : 201);
    }

    if (!open) return json({ ok: true, skipped: true, reason: "not in a city shift" });

    const stats = mergeStats(open.stats, fields, takenAt, event);
    const self = selfEvents(fields);
    const deaths = Number(stats.seen_deaths) || 0;
    const arrests = Number(stats.seen_arrests) || 0;
    const role = pickRole(open.role, fields.role);
    const notoriety = fields.notoriety != null
      ? Math.max(Number(open.notoriety) || 0, fields.notoriety)
      : (open.notoriety ?? null);
    const party = fields.party || open.party || null;
    const player_name = open.player_name || fields.player_name || null;
    const aarKey = key || open.aar_key || null;
    let ended = open.ended_at;
    let outcome = open.outcome || "in_progress";
    let duration_s = open.duration_s;
    if (closing) {
      ended = takenAt;
      outcome = finalizeOutcome(event, fields, stats);
      const startMs = Date.parse(open.started_at);
      duration_s = Number.isFinite(startMs) && Number.isFinite(takenMs)
        ? Math.max(0, Math.round((takenMs - startMs) / 1000))
        : duration_s;
    }
    await env.DB.prepare(
      `UPDATE lab_robrun_shifts SET
         ended_at = ?, role = ?, notoriety = ?, party = ?, player_name = ?,
         outcome = ?, duration_s = ?, deaths = ?, arrests = ?,
         aar_key = ?, ocr_json = ?, stats = ?, updated_at = datetime('now')
       WHERE id = ? AND owner = ?`
    ).bind(
      ended, role, notoriety, party, player_name, outcome, duration_s, deaths, arrests,
      aarKey, ocr, JSON.stringify(stats), open.id, owner
    ).run();
    return json({ ok: true, id: open.id, started_at: open.started_at, ended_at: ended, outcome, fields });
  } catch (e) {
    console.error("robrun shift write failed", e);
    return json({ ok: false, error: "Couldn't save that shift just now." }, 500);
  }
}
