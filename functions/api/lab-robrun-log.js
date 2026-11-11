/* Accept ROB RUN's own log lines from the PC helper: Sentry breadcrumb
   files (msgpack) and Player.log text, both written by the game itself.
   Same bearer-token auth as /api/lab-robrun-aar. Stores one row per event. */
import { json, sha256Hex } from "../_lib/lab.js";
import { decodeMsgpackStream, eventsFromBreadcrumbs, eventsFromPlayerLog } from "../_lib/lab-robrun-log.js";
import { tzOffsetOf } from "../_lib/lab-robrun-aar.js";

const MAX_FILE = 512 * 1024;
const MAX_TEXT = 512 * 1024;
const MAX_EVENTS = 2000;

function tokenFrom(request) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (m) return m[1];
  return (request.headers.get("x-lab-token") || "").trim();
}

function bytesOf(b64) {
  const raw = String(b64 || "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  let bin;
  try { bin = atob(raw); } catch { return null; }
  if (bin.length > MAX_FILE) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const token = tokenFrom(request);
  if (!token || token.length > 200) return json({ ok: false, error: "Unauthorized." }, 401);

  let owner;
  try {
    const row = await env.DB.prepare(
      "SELECT id,owner FROM lab_tokens WHERE token_hash = ? AND revoked_at IS NULL"
    ).bind(await sha256Hex(token)).first();
    if (!row || !row.owner) return json({ ok: false, error: "Unauthorized." }, 401);
    owner = row.owner;
  } catch (e) {
    console.error("robrun log auth failed", e);
    return json({ ok: false, error: "Couldn't check that token just now." }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Send JSON." }, 422); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Send JSON." }, 422);

  const events = [];
  if (Array.isArray(body.crumbs)) {
    for (const c of body.crumbs.slice(0, 4)) {
      const bytes = bytesOf(c);
      if (bytes) events.push(...eventsFromBreadcrumbs(decodeMsgpackStream(bytes)));
    }
  }
  if (typeof body.player_log === "string" && body.player_log.length <= MAX_TEXT) {
    events.push(...eventsFromPlayerLog(body.player_log, tzOffsetOf(body)));
  }
  if (body.event === "process_exit") {
    const ms = Date.parse(body.taken_at || "");
    events.push({
      at: new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString(),
      kind: "process_exit", detail: "", source: "helper",
    });
  }

  let added = 0;
  try {
    const stmts = events.slice(0, MAX_EVENTS).map((e) => env.DB.prepare(
      "INSERT OR IGNORE INTO lab_robrun_events (owner, at, kind, detail, source) VALUES (?,?,?,?,?)"
    ).bind(owner, e.at, e.kind, String(e.detail || "").slice(0, 120), e.source || "log"));
    for (let i = 0; i < stmts.length; i += 50) {
      const res = await env.DB.batch(stmts.slice(i, i + 50));
      for (const r of res) added += (r && r.meta && r.meta.changes) || 0;
    }
  } catch (e) {
    console.error("robrun log write failed", e);
    return json({ ok: false, error: "Couldn't save the game log just now. Has the migration been applied?" }, 500);
  }
  return json({ ok: true, seen: events.length, added });
}
