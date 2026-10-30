/* The signed-in player's own picture and banner.
   ---------------------------------------------------------------------------
   PUT     { kind, data }  -> stores the picture and stamps its column
   DELETE  { kind }        -> removes the picture and clears its column

   Owner-scoped by the Access identity, the same way every other lab write is:
   the email in the verified token is the key, and nothing here reads an owner
   from the body. A person can only ever write their own two objects.

   The object key is <slug>/<kind>, so a new upload overwrites the old one rather
   than accumulating. That is deliberate: the address is derived from the slug and
   the row's timestamp, and the timestamp is what busts the cache - a second copy
   in R2 under a different name would be a copy nothing can ever reach or delete.

   The slug comes from the player's row, which is why a card has to exist first.
   There is no path to write to before that, and inventing one (a key off the
   email, say) would leave the picture unreachable the moment the card was saved
   with a different slug. */
import { identity, json, readBody } from "../../_lib/lab.js";
import { COLUMNS, KINDS, checkUpload, mediaUrl } from "../../_lib/media.js";

const SELECT = "SELECT slug,avatar_at,banner_at FROM player_profiles WHERE owner = ? LIMIT 1";

/* The answer both verbs give: the two public addresses and the stamps behind
   them, so the editor can repaint itself without a second read. A stamp that is
   set but whose object is gone would be an address that 404s, so nothing here
   invents one - mediaUrl() only ever pairs a stamp with the slug it came from. */
function state(row) {
  return {
    ok: true,
    avatar: mediaUrl(row && row.slug, "avatar", row && row.avatar_at),
    banner: mediaUrl(row && row.slug, "banner", row && row.banner_at),
    avatar_at: (row && row.avatar_at) || null,
    banner_at: (row && row.banner_at) || null,
  };
}

const noCard = () => json({
  ok: false,
  error: "Save your profile first: your picture lives at your card's address.",
}, 400);

export async function onRequest({ request, env }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;

  if (request.method !== "PUT" && request.method !== "DELETE") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Send the picture as JSON." }, 400);

  const kind = typeof body.kind === "string" ? body.kind : "";
  if (KINDS.indexOf(kind) === -1) {
    return json({ ok: false, error: "Choose a profile picture or a banner." }, 400);
  }
  const column = COLUMNS[kind];

  try {
    const row = await env.DB.prepare(SELECT).bind(who.id).first();
    if (!row || !row.slug) return noCard();

    if (request.method === "DELETE") {
      /* The row is cleared first and the object second. If the object delete
         failed, the picture is already unreachable - the timestamp is what the
         public read checks - and the next upload overwrites the orphan. The other
         order would leave a stamp pointing at nothing, which is a broken image
         on a public card until somebody happened to set it again. */
      await env.DB.prepare(
        "UPDATE player_profiles SET " + column + " = NULL WHERE owner = ?"
      ).bind(who.id).run();
      try {
        await env.MEDIA.delete(row.slug + "/" + kind);
      } catch (e) {
        console.error("media delete failed", kind, e);
      }
      const after = await env.DB.prepare(SELECT).bind(who.id).first();
      return json(state(after || row));
    }

    const checked = checkUpload(kind, body.data);
    if (!checked.ok) return json({ ok: false, error: checked.error }, 400);

    await env.MEDIA.put(row.slug + "/" + kind, checked.bytes, {
      httpMetadata: { contentType: checked.mime },
    });
    await env.DB.prepare(
      "UPDATE player_profiles SET " + column + " = datetime('now') WHERE owner = ?"
    ).bind(who.id).run();

    const after = await env.DB.prepare(SELECT).bind(who.id).first();
    return json(state(after || row));
  } catch (e) {
    console.error("media save failed", e);
    return json({ ok: false, error: "Couldn't save that picture just now." }, 500);
  }
}
