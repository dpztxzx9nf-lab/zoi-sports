/* Soft-delete a ROB RUN shift the player owns. There is no manual create path. */
import { identity, json, readBody } from "../../_lib/lab.js";

export async function onRequest({ request, env }) {
  if (request.method !== "PATCH") return json({ ok: false, error: "Method not allowed." }, 405);
  const who = await identity(request, env);
  if (!who.ok) return who.response;
  const body = await readBody(request);
  if (!body) return json({ ok: false, errors: ["Send the change as JSON."] }, 422);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: "Pick a shift." }, 422);
  const remove = body.deleted === true || body.deleted === 1 || body.deleted === "1";
  if (!remove) return json({ ok: false, error: "Say whether to remove that shift." }, 422);
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM lab_robrun_shifts WHERE id = ? AND owner = ? AND deleted_at IS NULL LIMIT 1"
    ).bind(id, who.id).first();
    if (!row) return json({ ok: false, error: "That shift is not in the log." }, 404);
    await env.DB.prepare(
      "UPDATE lab_robrun_shifts SET deleted_at = datetime('now') WHERE id = ? AND owner = ?"
    ).bind(id, who.id).run();
    return json({ ok: true, id, deleted: true });
  } catch (e) {
    console.error("robrun shift patch failed", e);
    return json({ ok: false, error: "Couldn't update that shift just now." }, 500);
  }
}
