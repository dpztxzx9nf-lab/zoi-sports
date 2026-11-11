/* Manual COD match log. The player files a row after a game because MW4
   does not write a replay we can parse. Auth is the same Access identity
   as the rest of /api/lab. */
import { identity, json, readBody } from "../../_lib/lab.js";
import { isCodMode, modeOutcome } from "../../_lib/lab-cod.js";

const KILLS_MAX = 200;
const DEATHS_MAX = 200;

function whole(v, min, max) {
  if (v === undefined || v === null || v === "") return { empty: true };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < min || n > max) return { bad: true };
  return { value: n };
}

function flag(v) {
  if (v === true || v === 1 || v === "1" || v === "yes" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "no" || v === "false") return 0;
  return null;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST" && request.method !== "PATCH") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  const body = await readBody(request);
  if (!body) return json({ ok: false, errors: ["Send the match as JSON."] }, 422);

  if (request.method === "PATCH") return await patchMatch(env, who, body);

  const mode = typeof body.mode === "string" ? body.mode.trim() : "";
  const errors = [];
  if (!isCodMode(mode)) errors.push("Pick a mode.");

  const kills = whole(body.kills, 0, KILLS_MAX);
  if (kills.empty || kills.bad) errors.push("Kills has to be a whole number from 0 to " + KILLS_MAX + ".");

  const deaths = whole(body.deaths, 0, DEATHS_MAX);
  if (!deaths.empty && deaths.bad) errors.push("Deaths has to be a whole number from 0 to " + DEATHS_MAX + ".");

  const outcome = mode ? modeOutcome(mode) : "win";
  let extracted = null;
  let won = null;
  if (outcome === "extraction") {
    extracted = flag(body.extracted);
    if (extracted === null) errors.push("Say whether you extracted.");
  } else {
    won = flag(body.won);
    if (won === null) errors.push("Say whether you won.");
  }

  if (errors.length) return json({ ok: false, errors }, 422);

  const playedAt = new Date().toISOString();

  try {
    const row = await env.DB.prepare(
      `INSERT INTO lab_cod_matches (owner,played_at,mode,kills,extracted,won,deaths,source,needs_review)
       VALUES (?,?,?,?,?,?,?,'manual',0)`
    ).bind(
      who.id,
      playedAt,
      mode,
      kills.value,
      extracted,
      won,
      deaths.empty ? null : deaths.value,
    ).run();
    return json({
      ok: true,
      id: row?.meta?.last_row_id ?? null,
      played_at: playedAt,
      mode,
    }, 201);
  } catch (e) {
    console.error("cod match insert failed", e);
    return json({ ok: false, error: "Couldn't save that match. Has the migration been applied?" }, 500);
  }
}

async function patchMatch(env, who, body) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: "Pick a match." }, 422);

  const confirm = body.confirm === true || body.confirm === 1 || body.confirm === "1";
  const remove = body.deleted === true || body.deleted === 1 || body.deleted === "1";
  if (confirm === remove) return json({ ok: false, error: "Say whether to confirm or remove that match." }, 422);

  try {
    const row = await env.DB.prepare(
      "SELECT id FROM lab_cod_matches WHERE id = ? AND owner = ? AND deleted_at IS NULL LIMIT 1"
    ).bind(id, who.id).first();
    if (!row) return json({ ok: false, error: "That match is not in the log." }, 404);

    if (remove) {
      await env.DB.prepare(
        "UPDATE lab_cod_matches SET deleted_at = datetime('now') WHERE id = ? AND owner = ?"
      ).bind(id, who.id).run();
      return json({ ok: true, id, deleted: true });
    }

    await env.DB.prepare(
      "UPDATE lab_cod_matches SET needs_review = 0 WHERE id = ? AND owner = ? AND deleted_at IS NULL"
    ).bind(id, who.id).run();
    return json({ ok: true, id, needs_review: false });
  } catch (e) {
    console.error("cod match patch failed", e);
    return json({ ok: false, error: "Couldn't update that match just now." }, 500);
  }
}
