/* GET  /api/lab/changes            settings that moved since the last notice, per game
   POST /api/lab/changes {game, snapshotId}   record that snapshot as told

   Behind Access like the rest of /api/lab/*, scoped to the signed-in person.
   Reads only what lab-sync already stored, so it works with the PC off. */
import { identity, json } from "../../_lib/lab.js";
import { CHANGE_GAMES, markNotified, pendingChanges } from "../../_lib/lab-changes.js";

export async function onRequest({ request, env }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const g = url.searchParams.get("game");
      const games = g ? CHANGE_GAMES.filter((x) => x === g) : CHANGE_GAMES;
      if (!games.length) return json({ ok: false, error: "Unknown game." }, 400);
      return json({ ok: true, games: await pendingChanges(env.DB, who.id, games) });
    }
    if (request.method === "POST") {
      let body = null;
      try { body = await request.json(); } catch { body = null; }
      const game = body && typeof body.game === "string" ? body.game : "";
      const id = body ? Number(body.snapshotId) : NaN;
      if (!CHANGE_GAMES.includes(game) || !Number.isInteger(id) || id <= 0) {
        return json({ ok: false, error: "Send a game and a snapshotId." }, 400);
      }
      const ok = await markNotified(env.DB, who.id, game, id);
      return ok ? json({ ok: true }) : json({ ok: false, error: "No such snapshot." }, 404);
    }
    return json({ ok: false, error: "Method not allowed." }, 405);
  } catch (e) {
    console.error("lab changes failed", e);
    return json({ ok: false, error: "Couldn't read the settings changes just now." }, 500);
  }
}
