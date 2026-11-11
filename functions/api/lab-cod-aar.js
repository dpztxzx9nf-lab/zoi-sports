/* Accept a screenshot of the player's own after-action report, store it
   privately in R2, read the numbers, and file a COD match row.

   Auth is the same bearer token as /api/lab-sync, and this path sits
   beside /api/lab/ for the same reason: a PC cannot sign in through
   Access. The token hashes to one owner; every object and row is
   scoped to that owner. Nothing here attaches to cod.exe. */
import { json, sha256Hex } from "../_lib/lab.js";
import { sniffImage } from "../_lib/media.js";
import {
  AAR_MAX_BYTES, OCR_GUIDED_JSON, OCR_MODEL, OCR_PROMPT,
  modelTextOf, parseOcrPayload, reviewOf,
} from "../_lib/lab-cod-aar.js";

const unauthorized = () => json({ ok: false, error: "Unauthorized." }, 401);

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
  if (!body || typeof body !== "object") return { error: "Send the screenshot as JSON." };
  const data = typeof body.image === "string" ? body.image : "";
  if (!data) return { error: "No screenshot was sent." };
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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function playedAtOf(body) {
  const raw = typeof body.taken_at === "string" ? body.taken_at.trim() : "";
  if (raw && ISO.test(raw)) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms) && Math.abs(Date.now() - ms) < 24 * 60 * 60 * 1000) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function contentOf(bytes, mime, prompt) {
  const b64 = btoa(bytesToChunks(bytes));
  return [
    { type: "image_url", image_url: { url: "data:" + mime + ";base64," + b64 } },
    { type: "text", text: prompt },
  ];
}

/* btoa needs a string; build it in chunks so a large screenshot does not
   blow the argument list of String.fromCharCode. */
function bytesToChunks(bytes) {
  const chars = [];
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    chars.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
  }
  return chars.join("");
}

async function readScoreboard(env, bytes, mime) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return { raw: "", error: "The scoreboard reader is not available." };
  }
  const payload = {
    messages: [
      { role: "system", content: "You extract match results from a Call of Duty scoreboard. Reply with JSON only." },
      { role: "user", content: contentOf(bytes, mime, OCR_PROMPT) },
    ],
    max_tokens: 500,
    temperature: 0,
    guided_json: OCR_GUIDED_JSON,
  };
  try {
    const result = await env.AI.run(OCR_MODEL, payload);
    return { raw: modelTextOf(result), result };
  } catch (e) {
    console.error("cod aar ocr failed", e);
    return { raw: "", error: "The scoreboard could not be read just now." };
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const token = tokenFrom(request);
  if (!token || token.length > 200) return unauthorized();

  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > AAR_MAX_BYTES + 32 * 1024) {
    return json({ ok: false, error: "That screenshot is too large." }, 413);
  }

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
    console.error("cod aar auth failed", e);
    return json({ ok: false, error: "Couldn't check that token just now." }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Send the screenshot as JSON." }, 400); }

  const pic = imageFromBody(body);
  if (pic.error) return json({ ok: false, error: pic.error }, 400);

  const fingerprint = typeof body.fingerprint === "string"
    ? body.fingerprint.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80)
    : "";
  if (fingerprint) {
    try {
      const dup = await env.DB.prepare(
        `SELECT id,played_at,mode,kills,deaths,score,extracted,won,needs_review,confidence
           FROM lab_cod_matches
          WHERE owner = ? AND fingerprint = ? AND deleted_at IS NULL
            AND datetime(played_at) >= datetime('now', '-15 minutes')
          ORDER BY id DESC LIMIT 1`
      ).bind(owner, fingerprint).first();
      if (dup) {
        return json({
          ok: true,
          duplicate: true,
          id: dup.id,
          played_at: dup.played_at,
          mode: dup.mode,
          kills: dup.kills,
          deaths: dup.deaths,
          score: dup.score,
          extracted: dup.extracted,
          won: dup.won,
          needs_review: Boolean(Number(dup.needs_review)),
          confidence: dup.confidence,
        }, 200);
      }
    } catch (e) {
      console.error("cod aar dedupe failed", e);
    }
  }

  const playedAt = playedAtOf(body);
  const ownerHash = await sha256Hex(owner);
  const stamp = playedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const key = "cod-aar/" + ownerHash.slice(0, 16) + "/" + stamp + "-" + crypto.randomUUID().slice(0, 8) + "." + extOf(pic.mime);

  try {
    await env.MEDIA.put(key, pic.bytes, { httpMetadata: { contentType: pic.mime } });
  } catch (e) {
    console.error("cod aar store failed", e);
    return json({ ok: false, error: "Couldn't store that screenshot just now." }, 500);
  }

  const ocr = await readScoreboard(env, pic.bytes, pic.mime);
  const parsed = ocr.raw ? parseOcrPayload(ocr.raw) : { ok: false };
  const flagged = reviewOf(parsed.ok ? parsed : null);
  if (ocr.error) {
    flagged.needs_review = 1;
    flagged.reasons = [ocr.error, ...flagged.reasons];
  }

  const mode = parsed.ok ? parsed.mode : "unrecognized";
  const ocrJson = JSON.stringify({
    raw: typeof ocr.raw === "string" ? ocr.raw.slice(0, 4000) : "",
    parsed: parsed.ok ? parsed : null,
    reasons: flagged.reasons,
    error: ocr.error || null,
  });

  try {
    const row = await env.DB.prepare(
      `INSERT INTO lab_cod_matches
         (owner,played_at,mode,kills,extracted,won,deaths,score,placement,source,needs_review,confidence,aar_key,fingerprint,ocr_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      owner,
      playedAt,
      mode,
      parsed.ok ? parsed.kills : null,
      parsed.ok ? parsed.extracted : null,
      parsed.ok ? parsed.won : null,
      parsed.ok ? parsed.deaths : null,
      parsed.ok ? parsed.score : null,
      parsed.ok ? parsed.placement : null,
      "ocr",
      flagged.needs_review,
      parsed.ok ? parsed.confidence : null,
      key,
      fingerprint || null,
      ocrJson,
    ).run();

    return json({
      ok: true,
      id: row?.meta?.last_row_id ?? null,
      played_at: playedAt,
      mode,
      kills: parsed.ok ? parsed.kills : null,
      deaths: parsed.ok ? parsed.deaths : null,
      score: parsed.ok ? parsed.score : null,
      placement: parsed.ok ? parsed.placement : null,
      extracted: parsed.ok ? parsed.extracted : null,
      won: parsed.ok ? parsed.won : null,
      needs_review: Boolean(flagged.needs_review),
      confidence: parsed.ok ? parsed.confidence : null,
      reasons: flagged.reasons,
    }, 201);
  } catch (e) {
    console.error("cod aar insert failed", e);
    return json({ ok: false, error: "The screenshot was stored, but the match could not be saved. Has the migration been applied?" }, 500);
  }
}
