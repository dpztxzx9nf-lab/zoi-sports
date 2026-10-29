/* The lab's numbers: how each setting change actually played out.
   Owner-scoped like everything else under /api/lab. Nothing stored yet answers
   {ok:true, ...empty} rather than an error, because an empty lab is normal.

   Three reads, all owned by the request's identity: every counter reading in
   lab_stats, every test in lab_tests, and the newest config snapshot in
   lab_snapshots. The arithmetic happens in _lib/lab-perf.js so it can be tested
   without a database.

   The catalog comes in here rather than inside lab-perf.js: the maths file stays
   free of imports, and this handler is the only place that knows both the test
   rows and the plain-language note about what to watch for. */
import { CATALOG, SELECT_TEST, identity, json, currentOf } from "../../_lib/lab.js";
import { performance } from "../../_lib/lab-perf.js";

const READING_COLUMNS = "taken_at,created_at,matches,wins,kills,deaths,kd,win_rate";
/* Everything a session label or the page's mode line needs, and nothing else. The
   per-match rank and player count are deliberately not read here: they are for a
   match view that does not exist yet, and carrying them would be reading more of
   the player's log than this page uses. */
const MATCH_COLUMNS = "playlist,playlist_type,ranked,build_mode,team_size,region,rank_type,rank,"
  + "players_left_low,players_left_first,players_left_readings,started_at,ended_at";
/* The columns 0008 adds. Read separately, because a database that has not had
   0008 applied does not have them and a SELECT naming a missing column throws -
   which here would silently empty the match list and take the mode line with it.
   The probe is the lab's own introspection statement, so the fake D1's guard
   recognises it. */
const KIND_COLUMNS = "kind,title";

/* Whether lab_matches has a column. Same statement the sync handler probes with:
   the fake D1 knows the shape, and a database without 0008 answers no. */
async function hasColumn(env, table, column) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?")
      .bind(table, column).first();
    return Boolean(row && Number(row.n) > 0);
  } catch {
    return false;
  }
}

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

/* The most recent match, preferring one with a stated end: a row with a null end
   sorts first under the read's ORDER BY, and it is not the most recent thing
   played - it is the one the log stopped talking about. A Creative island's own
   line is worth showing, so such a row still wins if it is the only kind there. */
function lastMatchOf(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m && m.ended_at !== null && m.ended_at !== undefined) return m;
  }
  return matches[matches.length - 1];
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  try {
    /* created_at is what the maths needs: it is the moment a count was first
       read, and a repeat read only moves taken_at. Newest 400 is plenty of
       history for a per-session chart and keeps the read cheap.

       id has to be carried through the subquery: the outer ORDER BY sorts by it
       to put the newest 400 back into reading order, and a column the subquery
       does not select is not visible outside it. Without it the whole handler
       throws and the page shows the sorry message. */
    const readings = await env.DB.prepare(
      `SELECT ${READING_COLUMNS} FROM (
         SELECT id,${READING_COLUMNS} FROM lab_stats WHERE owner = ? ORDER BY id DESC LIMIT 400
       ) ORDER BY id ASC`
    ).bind(who.id).all();

    const tests = await env.DB.prepare(
      `${SELECT_TEST} WHERE owner = ? ORDER BY started_at ASC, id ASC`
    ).bind(who.id).all();

    /* The newest snapshot only. Everything older is history the page does not
       show: this section answers "what is it set to now", and the change cards
       are what say how it got there. */
    const snapshot = await env.DB.prepare(
      "SELECT taken_at,payload FROM lab_snapshots WHERE owner = ? ORDER BY id DESC LIMIT 1"
    ).bind(who.id).first();

    /* The matches, oldest first, for two jobs: the session labels the comparison
       runs on, and the page's one line about the mode last seen playing. Bounded
       to the window the readings cover, since a match that ended before the
       oldest reading cannot label any session here.

       A lab_matches read that fails must not take the page down: everything below
       works without it, and the page then omits the mode line rather than
       printing a guess. */
    let matches = [];
    try {
      /* A row with no stated end cannot be placed on the timeline the sessions
         walk, and datetime(NULL) >= datetime(?) is not true, so the windowed read
         leaves it out on its own. The whole-table read keeps it, sorted first,
         and labelSessions drops it for having no finite time. So neither read
         needs a NULL branch: an island the log never finished is stored and
         counted, but never used to label a session it cannot be placed in. */
      const columns = (await hasColumn(env, "lab_matches", "kind"))
        ? MATCH_COLUMNS + "," + KIND_COLUMNS
        : MATCH_COLUMNS;
      const list = Array.isArray(readings.results) ? readings.results : [];
      const oldest = list.length ? String(list[0].created_at || "") : "";
      /* Newest 400, then flipped back into the ascending order the session
         labelling walks, exactly as the readings read above is written. ASC with
         a LIMIT would keep the OLDEST 400 in the window instead: once a window
         holds more than 400 matches the recent ones fall off the end, the page's
         "last match" line names a match from weeks ago, and the recent sessions
         lose their labels and stop being provable as one mode. */
      const rows = oldest
        ? await env.DB.prepare(
          `SELECT ${columns} FROM (
             SELECT id,${columns} FROM lab_matches
             WHERE owner = ? AND datetime(ended_at) >= datetime(?)
             ORDER BY datetime(ended_at) DESC, id DESC LIMIT 400
           ) ORDER BY datetime(ended_at) ASC, id ASC`
        ).bind(who.id, oldest).all()
        : await env.DB.prepare(
          `SELECT ${columns} FROM (
             SELECT id,${columns} FROM lab_matches
             WHERE owner = ?
             ORDER BY datetime(ended_at) DESC, id DESC LIMIT 400
           ) ORDER BY datetime(ended_at) ASC, id ASC`
        ).bind(who.id).all();
      matches = (rows && Array.isArray(rows.results)) ? rows.results : [];
    } catch (e) {
      console.error("lab matches read failed", e);
      matches = [];
    }

    const payload = performance({
      rows: readings.results || [],
      tests: tests.results || [],
      watch: watchLookup(),
      matches,
    });

    return json({
      ok: true,
      me: { email: who.email, name: who.name },
      ...payload,
      /* The single most recent match row, or null. The page renders one line from
         it and nothing else; the full history is not sent, because a page that
         is about settings does not need it. */
      lastMatch: lastMatchOf(matches),
      current: currentOf(snapshot),
    });
  } catch (e) {
    console.error("lab performance failed", e);
    return json({ ok: false, error: "Couldn't work out the numbers just now." }, 500);
  }
}
