/* Accept a screenshot of the player's own after-action report, store it
   privately in R2, read the numbers, and file a COD match row.

   Auth is the same bearer token as /api/lab-sync, and this path sits
   beside /api/lab/ for the same reason: a PC cannot sign in through
   Access. The token hashes to one owner; every object and row is
   scoped to that owner. Nothing here attaches to cod.exe. */
import { json, sha256Hex } from "../_lib/lab.js";
import { sniffImage } from "../_lib/media.js";
import {
  AAR_MAX_BYTES, OCR_GUIDED_JSON, OCR_MODEL, OCR_PROMPT, OCR_CROP_PROMPT,
  modelTextOf, parseOcrPayload, mergeMatchReads, fieldsNeedingCrop, statsJson,
  maskCropRead,
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

async function runModel(env, bytes, mime, prompt) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return { raw: "", error: "The scoreboard reader is not available." };
  }
  const payload = {
    messages: [
      { role: "system", content: "You extract match results from a Call of Duty scoreboard. Reply with JSON only." },
      { role: "user", content: contentOf(bytes, mime, prompt) },
    ],
    max_tokens: 700,
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

function localReadsOf(body) {
  const src = body && body.local_ocr && typeof body.local_ocr === "object" ? body.local_ocr : null;
  if (!src) return [];
  const frames = Array.isArray(src.frames) ? src.frames : [];
  const out = [];
  for (const frame of frames) {
    const bag = frame && (frame.fields || frame);
    if (!bag || typeof bag !== "object") continue;
    const parsed = parseOcrPayload(bag);
    if (parsed.ok) out.push(parsed);
  }
  if (!out.length && src.fields && typeof src.fields === "object") {
    const parsed = parseOcrPayload(src.fields);
    if (parsed.ok) out.push(parsed);
  }
  return out;
}

function cropImagesOf(body) {
  const src = body && body.crops && typeof body.crops === "object" ? body.crops : {};
  const out = [];
  for (const name of ["tiles", "footer", "bar", "place", "banner", "header"]) {
    if (typeof src[name] !== "string" || !src[name]) continue;
    const pic = imageFromBody({ image: src[name] });
    if (!pic.error) out.push({ name, ...pic });
  }
  return out;
}

async function readAllSources(env, pic, body) {
  const locals = localReadsOf(body).map((r) => ({ ...r, _weak: false, _source: "local" }));
  const vision = await runModel(env, pic.bytes, pic.mime, OCR_PROMPT);
  const visionParsed = vision.raw ? parseOcrPayload(vision.raw) : { ok: false };
  if (visionParsed.ok) {
    visionParsed._weak = false;
    visionParsed._source = "vision";
  }
  const lastMode = typeof body.last_mode === "string" ? body.last_mode.trim() : "";
  const textHints = [
    body && body.local_ocr && body.local_ocr.frames && Array.isArray(body.local_ocr.frames)
      ? body.local_ocr.frames.map((f) => f && f.text).filter(Boolean).join(" ")
      : "",
    vision.raw || "",
  ].join(" ");
  const localSummary = locals.length ? mergeMatchReads(locals, { lastMode, text: textHints }) : null;
  const needed = fieldsNeedingCrop(localSummary, visionParsed.ok ? visionParsed : null);
  // Always re-read tiles or placement when the mode is still unknown or damage is missing.
  if (visionParsed.ok && (visionParsed.damage == null || !localSummary || localSummary.mode === "unrecognized")) {
    for (const k of ["damage", "placement", "mode", "ed_ratio", "winstreaks"]) {
      if (!needed.includes(k)) needed.push(k);
    }
  }
  const cropParses = [];
  const cropRaws = [];
  if (needed.length) {
    for (const crop of cropImagesOf(body)) {
      const r = await runModel(env, crop.bytes, crop.mime, OCR_CROP_PROMPT);
      cropRaws.push({ name: crop.name, raw: r.raw, error: r.error || null });
      if (r.raw) {
        const parsed = parseOcrPayload(r.raw);
        if (parsed.ok) cropParses.push(maskCropRead(parsed, crop.name));
      }
    }
  }
  const reads = [...locals];
  if (visionParsed.ok) reads.push(visionParsed);
  reads.push(...cropParses);
  const merged = reads.length
    ? mergeMatchReads(reads, { lastMode, text: textHints })
    : { ok: false, mode: "unrecognized" };
  return {
    merged,
    vision,
    locals,
    needed,
    cropRaws,
  };
}

function rowFields(merged) {
  const ok = Boolean(merged && merged.ok);
  return {
    mode: ok && merged.mode ? merged.mode : "unrecognized",
    kills: ok ? merged.kills : null,
    deaths: ok ? merged.deaths : null,
    score: ok ? merged.score : null,
    placement: ok ? merged.placement : null,
    extracted: ok ? merged.extracted : null,
    won: ok ? merged.won : null,
    damage: ok ? merged.damage : null,
    stats: ok ? JSON.stringify(statsJson(merged)) : null,
    confidence: ok ? merged.confidence : null,
  };
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const token = tokenFrom(request);
  if (!token || token.length > 200) return unauthorized();

  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > AAR_MAX_BYTES * 3) {
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

  const rereadId = Number(body && body.reread_id);
  const isReread = Number.isInteger(rereadId) && rereadId > 0;

  const pic = imageFromBody(body);
  if (pic.error && !isReread) return json({ ok: false, error: pic.error }, 400);

  let existing = null;
  if (isReread) {
    try {
      existing = await env.DB.prepare(
        "SELECT id,played_at,aar_key,fingerprint FROM lab_cod_matches WHERE id = ? AND owner = ? AND deleted_at IS NULL LIMIT 1"
      ).bind(rereadId, owner).first();
    } catch (e) {
      console.error("cod aar reread lookup failed", e);
    }
    if (!existing) return json({ ok: false, error: "That match is not in the log." }, 404);
  }

  if (pic.error && existing && existing.aar_key && env.MEDIA) {
    try {
      const obj = await env.MEDIA.get(existing.aar_key);
      if (obj) {
        const buf = new Uint8Array(await obj.arrayBuffer());
        const mime = (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg";
        pic.error = null;
        pic.bytes = buf;
        pic.mime = mime;
      }
    } catch (e) {
      console.error("cod aar reread image failed", e);
    }
  }
  if (pic.error || !pic.bytes) return json({ ok: false, error: pic.error || "No screenshot was sent." }, 400);

  const fingerprint = typeof body.fingerprint === "string"
    ? body.fingerprint.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80)
    : "";
  if (fingerprint && !isReread) {
    try {
      const dup = await env.DB.prepare(
        `SELECT id,played_at,mode,kills,deaths,score,extracted,won,damage,placement,confidence
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
          placement: dup.placement,
          extracted: dup.extracted,
          won: dup.won,
          damage: dup.damage,
          confidence: dup.confidence,
        }, 200);
      }
    } catch (e) {
      console.error("cod aar dedupe failed", e);
    }
  }

  const playedAt = existing ? existing.played_at : playedAtOf(body);
  let key = existing && existing.aar_key ? existing.aar_key : null;
  if (!key) {
    const ownerHash = await sha256Hex(owner);
    const stamp = playedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    key = "cod-aar/" + ownerHash.slice(0, 16) + "/" + stamp + "-" + crypto.randomUUID().slice(0, 8) + "." + extOf(pic.mime);
    try {
      await env.MEDIA.put(key, pic.bytes, { httpMetadata: { contentType: pic.mime } });
    } catch (e) {
      console.error("cod aar store failed", e);
      return json({ ok: false, error: "Couldn't store that screenshot just now." }, 500);
    }
  }

  const read = await readAllSources(env, pic, body);
  const fields = rowFields(read.merged);
  const ocrJson = JSON.stringify({
    raw: typeof read.vision.raw === "string" ? read.vision.raw.slice(0, 4000) : "",
    parsed: read.merged && read.merged.ok ? read.merged : null,
    local: read.locals.map((r) => ({ mode: r.mode, kills: r.kills, deaths: r.deaths, assists: r.assists, contracts: r.contracts, damage: r.damage, placement: r.placement, won: r.won })),
    needed: read.needed,
    crops: read.cropRaws,
    error: read.vision.error || null,
  });

  const payload = {
    ok: true,
    mode: fields.mode,
    kills: fields.kills,
    deaths: fields.deaths,
    score: fields.score,
    placement: fields.placement,
    extracted: fields.extracted,
    won: fields.won,
    damage: fields.damage,
    assists: read.merged && read.merged.ok ? read.merged.assists : null,
    contracts: read.merged && read.merged.ok ? read.merged.contracts : null,
    ed_ratio: read.merged && read.merged.ok ? read.merged.ed_ratio : null,
    winstreaks: read.merged && read.merged.ok ? read.merged.winstreaks : null,
    stats: read.merged && read.merged.ok ? statsJson(read.merged) : null,
    confidence: fields.confidence,
  };

  try {
    if (isReread) {
      await env.DB.prepare(
        `UPDATE lab_cod_matches
            SET mode=?, kills=?, extracted=?, won=?, deaths=?, score=?, placement=?,
                source='ocr', needs_review=0, confidence=?, ocr_json=?, damage=?, stats=?
          WHERE id=? AND owner=? AND deleted_at IS NULL`
      ).bind(
        fields.mode, fields.kills, fields.extracted, fields.won, fields.deaths, fields.score, fields.placement,
        fields.confidence, ocrJson, fields.damage, fields.stats, rereadId, owner,
      ).run();
      return json({ ...payload, id: rereadId, played_at: playedAt, reread: true }, 200);
    }

    const row = await env.DB.prepare(
      `INSERT INTO lab_cod_matches
         (owner,played_at,mode,kills,extracted,won,deaths,score,placement,source,needs_review,confidence,aar_key,fingerprint,ocr_json,damage,stats)
       VALUES (?,?,?,?,?,?,?,?,?,'ocr',0,?,?,?,?,?,?)`
    ).bind(
      owner,
      playedAt,
      fields.mode,
      fields.kills,
      fields.extracted,
      fields.won,
      fields.deaths,
      fields.score,
      fields.placement,
      fields.confidence,
      key,
      fingerprint || null,
      ocrJson,
      fields.damage,
      fields.stats,
    ).run();

    return json({ ...payload, id: row?.meta?.last_row_id ?? null, played_at: playedAt }, 201);
  } catch (e) {
    console.error("cod aar insert failed", e);
    return json({ ok: false, error: "The screenshot was stored, but the match could not be saved. Has the migration been applied?" }, 500);
  }
}
