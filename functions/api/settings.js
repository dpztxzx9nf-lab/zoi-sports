/* One player's in-game Fortnite settings, for the public /settings page.
   ---------------------------------------------------------------------------
   Outside the sign-in gate on purpose: /settings is a public page, and it reads
   this on every load. What protects it is that the answer is only ever what the
   page already prints - one player's own numbers, looked up by the same slug the
   roster links with - and that the owner email is never part of it.

   Two ways a slug finds a player, because a player can have numbers before they
   have a card:

   1. It is a roster card's slug. That is the address the roster links to, so it
      has to work, and it resolves to whoever owns that card.
   2. It is the slug of a settings row whose owner has no card yet. Then the
      slug is the only public name there is, and it is what the page shows.

   A slug that is neither is a 404 rather than the defaults: "this player has no
   settings" and "these are Kneczi's settings" must never look alike.

   The values are merged over the page's baked defaults before they go out, so
   the page never has to decide what a missing key means: a player who has saved
   nothing, or one whose row predates a field, both get a complete set.

   Cached at the edge briefly, like /api/roster: long enough that a busy page is
   not hitting D1 per view, short enough that a save shows up on the next look. */
import { settingsOf, displayOf } from "../_lib/settings.js";

const CACHE_SECONDS = 60;

/* Written here rather than through the lab's json() helper, which stamps
   noindex and no-store: this is a public read for a public page, so it wants a
   short public cache and no noindex. */
const answer = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": cache },
});

/* The slug is only ever matched, never echoed back into markup. Lowercased to
   match slugOf()'s output, which is what the stored column holds. */
const slugParam = (url) => (url.searchParams.get("p") || "").trim().toLowerCase().slice(0, 64);

const SETTINGS_BY_OWNER = "SELECT owner,slug,settings,updated_at FROM player_settings WHERE owner = ? LIMIT 1";
const SETTINGS_BY_SLUG = "SELECT owner,slug,settings,updated_at FROM player_settings WHERE slug = ? LIMIT 1";
const CARD_BY_SLUG = "SELECT owner,slug,gamertag FROM player_profiles WHERE slug = ? LIMIT 1";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return answer({ ok: false, error: "Method not allowed." }, 405, "no-store");

  const slug = slugParam(new URL(request.url));
  if (!slug) return answer({ ok: false, error: "Name a player: /api/settings?p=<slug>." }, 400, "no-store");

  try {
    /* Who is this slug? A card first, because that is the address the roster
       links with and the gamertag it carries is the name the page should print. */
    const card = await env.DB.prepare(CARD_BY_SLUG).bind(slug).first();
    const row = card
      ? await env.DB.prepare(SETTINGS_BY_OWNER).bind(card.owner).first()
      : await env.DB.prepare(SETTINGS_BY_SLUG).bind(slug).first();

    if (!row) return answer({ ok: false, error: "No game settings for that player." }, 404, "no-store");

    const settings = settingsOf(row.settings);

    return answer({
      ok: true,
      /* The gamertag is the card's, so a rename shows up here too. With no card
         the slug is the only name the row has, and printing it is honest: it is
         exactly what the address says. */
      gamertag: (card && card.gamertag) || row.slug || slug,
      slug: (card && card.slug) || row.slug || slug,
      updated_at: row.updated_at || null,
      settings,
      /* And the same values already dressed for the page: the printed text and
         the slider's fill class. The page prints these rather than working them
         out, so a saved 0.95 cannot render as one thing on the page and another
         in the editor's own confirmation. */
      display: displayOf(settings),
    }, 200, "public, max-age=" + CACHE_SECONDS);
  } catch (e) {
    /* A failed read must not blank the page: the caller leaves the baked markup
       alone, which is what the page showed before any of this existed. */
    console.error("public settings read failed", e);
    return answer({ ok: false, error: "Couldn't read those game settings just now." }, 500, "no-store");
  }
}
