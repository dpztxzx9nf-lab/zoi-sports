/* The match numbers for one person, as last read from their Epic account.
   Normal Access-JWT path like the rest of the lab: this is a page reading its
   own numbers, not a PC posting them. Owner-scoped, so one person's stats are
   never visible to another.

   Nothing stored yet is not an error: a brand-new lab answers
   {ok:true, stats:null} and the page simply shows no line. */
import { identity, json } from "../../_lib/lab.js";
import { latestStats } from "../../_lib/lab-stats.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  try {
    const stats = await latestStats(env, who.id);
    /* Never a 404 and never an error for the empty case: an honest blank is
       the right answer, and the page treats the two the same way. */
    return json({ ok: true, stats: stats || null });
  } catch (e) {
    console.error("lab stats read failed", e);
    return json({ ok: false, error: "Couldn't read the match numbers just now." }, 500);
  }
}
