/* The lab's numbers: how each setting change actually played out.
   Owner-scoped like everything else under /api/lab. Nothing stored yet answers
   {ok:true, ...empty} rather than an error, because an empty lab is normal.

   Two reads, both already owned by the request's identity: every counter
   reading in lab_stats, and every test in lab_tests. The work happens in
   _lib/lab-perf.js so it can be tested without a database.

   The catalog comes in here rather than inside lab-perf.js: the maths file stays
   free of imports, and this handler is the only place that knows both the test
   rows and the plain-language note about what to watch for. */
import { CATALOG, SELECT_TEST, identity, json } from "../../_lib/lab.js";
import { performance } from "../../_lib/lab-perf.js";

const READING_COLUMNS = "taken_at,created_at,matches,wins,kills,deaths,kd,win_rate";

/* setting id -> the watch text from the catalog. Built once per request. */
const watchLookup = () => {
  const map = new Map();
  for (const entry of CATALOG) {
    if (entry && typeof entry.id === "string" && typeof entry.watch === "string" && entry.watch.trim()) {
      map.set(entry.id, entry.watch.trim());
    }
  }
  return map;
};

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  try {
    /* created_at is what the maths needs: it is the moment a count was first
       read, and a repeat read only moves taken_at. Newest 400 is plenty of
       history for a per-session chart and keeps the read cheap. */
    const readings = await env.DB.prepare(
      `SELECT ${READING_COLUMNS} FROM (
         SELECT ${READING_COLUMNS} FROM lab_stats WHERE owner = ? ORDER BY id DESC LIMIT 400
       ) ORDER BY id ASC`
    ).bind(who.id).all();

    const tests = await env.DB.prepare(
      `${SELECT_TEST} WHERE owner = ? ORDER BY started_at ASC, id ASC`
    ).bind(who.id).all();

    const payload = performance({
      rows: readings.results || [],
      tests: tests.results || [],
      watch: watchLookup(),
    });

    return json({ ok: true, me: { email: who.email, name: who.name }, ...payload });
  } catch (e) {
    console.error("lab performance failed", e);
    return json({ ok: false, error: "Couldn't work out the numbers just now." }, 500);
  }
}
