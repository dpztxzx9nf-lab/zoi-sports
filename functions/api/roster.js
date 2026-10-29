/* The public roster, as saved from the lab.

   Deliberately outside the sign-in gate: this is the same information the roster
   section of the home page already shows to anyone, and the home page has to be
   able to read it without a login. What protects it is the `published` flag -
   only rows a person explicitly published are served, and the email that owns a
   row is never in the answer.

   Cached at the edge for a short while so a busy home page does not hit D1 on
   every load, but not for long: somebody who saves a profile and then looks at
   the roster expects to see it. */
import { publicProfile } from "../_lib/profile.js";

const CACHE_SECONDS = 30;

/* Written here rather than through the lab's json() helper, which stamps
   noindex and no-store on everything it answers. This endpoint is the one public
   read in the lab's corner of the site: it wants a short public cache and it must
   NOT carry a noindex tag, or a crawler reading it would be told to ignore a page
   that is deliberately public. */
const answer = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": cache,
  },
});

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return answer({ ok: false, error: "Method not allowed." }, 405, "no-store");

  try {
    const { results } = await env.DB.prepare(
      `SELECT slug,gamertag,role,region,platform,bio,socials,updated_at
       FROM player_profiles WHERE published = 1 ORDER BY gamertag COLLATE NOCASE ASC`
    ).all();
    const players = (results || []).map(publicProfile).filter((p) => p && p.gamertag);
    return answer({ ok: true, players }, 200, "public, max-age=" + CACHE_SECONDS);
  } catch (e) {
    /* A roster read that fails must not break the home page: it falls back to the
       roster baked into roster.js, which is what it showed before this existed. */
    console.error("roster read failed", e);
    return answer({ ok: false, error: "Couldn't read the roster just now." }, 500, "no-store");
  }
}
