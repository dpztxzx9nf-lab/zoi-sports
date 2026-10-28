import { STATUSES, SELECT_TEST, identity, json, readBody, str } from "../../_lib/lab.js";

const NOTE_MAX = 600;

const idFrom = params => {
  const n = Number(params?.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/* Someone else's row answers exactly like a row that does not exist: 404, same
   body. Saying "not yours" would confirm the id is real. */
const notFound = () => json({ ok: false, error: "No test with that id." }, 404);

export async function onRequest({ request, env, params }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;

  const id = idFrom(params);
  if (id === null) return notFound();

  if (request.method === "PATCH") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, errors: ["Send the change as JSON."] }, 422);

    let current;
    try {
      current = await env.DB.prepare(`${SELECT_TEST} WHERE id = ? AND owner = ?`).bind(id, who.id).first();
    } catch (e) {
      console.error("lab read failed", e);
      return json({ ok: false, error: "Couldn't read that test." }, 500);
    }
    if (!current || current.owner !== who.id) return notFound();

    const errors = [];
    const sets = [];
    const binds = [];

    if (body.status !== undefined) {
      const status = str(body.status, 20);
      if (!STATUSES.includes(status)) {
        errors.push("Status must be testing, kept, reverted or inconclusive.");
      } else {
        sets.push("status = ?");
        binds.push(status);
        // Moves off testing: stamp the verdict. Back to testing: clear it.
        sets.push(status === "testing" ? "decided_at = NULL" : "decided_at = datetime('now')");
      }
    }

    if (body.result_note !== undefined) {
      const note = str(body.result_note, NOTE_MAX);
      sets.push("result_note = ?");
      binds.push(note || null);
    }

    if (body.games_played !== undefined) {
      const raw = body.games_played;
      const n = raw === "" || raw === null ? null : Number(String(raw).trim());
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 50)) {
        errors.push("Games played must be a whole number from 0 to 50.");
      } else {
        sets.push("games_played = ?");
        binds.push(n);
      }
    }

    if (errors.length) return json({ ok: false, errors }, 422);
    if (!sets.length) return json({ ok: false, errors: ["Nothing to change."] }, 422);

    try {
      const res = await env.DB.prepare(
        `UPDATE lab_tests SET ${sets.join(", ")} WHERE id = ? AND owner = ?`
      ).bind(...binds, id, who.id).run();
      if (!(res?.meta?.changes ?? 0)) return notFound();
      const test = await env.DB.prepare(`${SELECT_TEST} WHERE id = ? AND owner = ?`).bind(id, who.id).first();
      return json({ ok: true, test });
    } catch (e) {
      console.error("lab update failed", e);
      return json({ ok: false, error: "Couldn't save that change." }, 500);
    }
  }

  if (request.method === "DELETE") {
    try {
      const res = await env.DB.prepare("DELETE FROM lab_tests WHERE id = ? AND owner = ?").bind(id, who.id).run();
      const changed = res?.meta?.changes ?? 0;
      if (!changed) return notFound();
      return json({ ok: true });
    } catch (e) {
      console.error("lab delete failed", e);
      return json({ ok: false, error: "Couldn't remove that test." }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
