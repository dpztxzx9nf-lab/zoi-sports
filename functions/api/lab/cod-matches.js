/* Soft-delete (or, historically, confirm) a Call of Duty match the player owns.
   Manual create was removed: matches are filed only from the after-action
   report. Existing manual rows stay in the database and still count. */
import { identity, json, readBody } from "../../_lib/lab.js";

export async function onRequest({ request, env }) {
  if (request.method !== "PATCH") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  const body = await readBody(request);
  if (!body) return json({ ok: false, errors: ["Send the change as JSON."] }, 422);
  return await patchMatch(env, who, body);
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
