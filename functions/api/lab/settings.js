/* The signed-in player's own in-game Fortnite settings, read and written from
   the account menu's Game settings tab.

   GET  -> { ok, settings, defaults, groups } where settings is every key filled
           in - the saved values over the defaults - so the editor never has to
           guess what an empty field means.
   PUT  -> checks every key, saves the lot, answers what was stored.

   Owner-scoped by the Access identity, exactly like /api/lab/profile: the email
   in the verified token is the key, and nothing here takes an owner from the
   body. This lives under /api/lab/ so the middleware's existing gate covers it;
   the public read of the same data is /api/settings, which is deliberately
   outside that gate and only ever answers one player at a time.

   The whole set is required on a save, and a bad value is a 400 naming the
   field rather than a partial write. Both follow from the same thing: these
   numbers go on a public page as this player's settings, so a save that wrote
   three of them and ignored the fourth would leave the page showing a mixture
   the player never chose. */
import { identity, json, readBody } from "../../_lib/lab.js";
import { DEFAULTS, editorShape, cleanSettings, settingsOf } from "../../_lib/settings.js";
import { slugOf } from "../../_lib/profile.js";

const SELECT = "SELECT owner,slug,settings,updated_at FROM player_settings";

/* The public key for this player. A profile card's slug wins, because that is
   the address the roster already links to and the page's ?p= already knows; a
   player without a card gets one from their name, so they can save numbers
   before they have written a bio. An existing row keeps the slug it was created
   with: this is a public address, and changing it would break a link somebody
   already shared. */
async function slugFor(env, who) {
  const card = await env.DB.prepare(
    "SELECT slug FROM player_profiles WHERE owner = ? LIMIT 1"
  ).bind(who.id).first();
  if (card && card.slug) return card.slug;
  return slugOf(who.name || String(who.id || "").split("@")[0]);
}

export async function onRequest({ request, env }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;

  if (request.method === "GET") {
    try {
      const row = await env.DB.prepare(SELECT + " WHERE owner = ? LIMIT 1").bind(who.id).first();
      return json({
        ok: true,
        settings: settingsOf(row ? row.settings : null),
        /* The page's own baked values. Sent so the editor can say "this is what
           the public page shows when nobody has saved" without keeping a second
           copy of them in the browser. */
        defaults: DEFAULTS,
        groups: editorShape(),
        updated_at: row ? row.updated_at || null : null,
      });
    } catch (e) {
      console.error("settings read failed", e);
      return json({ ok: false, error: "Couldn't read your game settings just now." }, 500);
    }
  }

  if (request.method !== "PUT") return json({ ok: false, error: "Method not allowed." }, 405);

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Send the game settings as JSON." }, 400);

  const clean = cleanSettings(body.settings !== undefined ? body.settings : body);
  if (clean.errors.length) return json({ ok: false, errors: clean.errors }, 400);

  try {
    const existing = await env.DB.prepare(
      "SELECT owner,slug FROM player_settings WHERE owner = ? LIMIT 1"
    ).bind(who.id).first();

    const stored = JSON.stringify(clean.values);
    if (existing) {
      await env.DB.prepare(
        `UPDATE player_settings SET settings = ?, updated_at = datetime('now') WHERE owner = ?`
      ).bind(stored, who.id).run();
    } else {
      const slug = await slugFor(env, who);
      await env.DB.prepare(
        `INSERT INTO player_settings (owner, slug, settings) VALUES (?, ?, ?)`
      ).bind(who.id, slug, stored).run();
    }

    const saved = await env.DB.prepare(SELECT + " WHERE owner = ? LIMIT 1").bind(who.id).first();
    return json({
      ok: true,
      settings: settingsOf(saved ? saved.settings : stored),
      updated_at: saved ? saved.updated_at || null : null,
    });
  } catch (e) {
    console.error("settings save failed", e);
    return json({ ok: false, error: "Couldn't save your game settings just now." }, 500);
  }
}
