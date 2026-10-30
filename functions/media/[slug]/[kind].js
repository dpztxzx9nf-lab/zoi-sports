/* The public read for a player's picture and banner.
   ---------------------------------------------------------------------------
   Deliberately outside the sign-in gate: the roster draws these on a public page,
   so a picture that nobody signed in can fetch is a picture nobody sees.

   What a request has to be before R2 is touched at all: a slug shaped like a slug
   and a kind that is one of the two. A path is attacker-controlled, and a bad one
   should cost nothing - not a database read, and certainly not a bucket list.

   What says a picture exists is the row's timestamp, never the bucket. An object
   can outlive its row, and a row can be cleared while the object is still there;
   in both cases the public address is dead, so the answer is 404 with an empty
   body. There is no placeholder and no fallback image: a card that has not set a
   banner has no banner, and the page draws nothing rather than a grey rectangle.
   The `avatar_at` check is what makes a removed picture stop being served the
   instant it is removed, without waiting for the bucket to agree.

   Caching is keyed to the `?v=` stamp in the address. With one, the bytes behind
   that address never change - a new upload stamps a new time and so a new address
   - and the edge may keep it for five minutes. Without one, the answer is
   no-cache: an unversioned address would otherwise pin whatever was there first
   and keep serving it after the picture changed. */
import { COLUMNS, KINDS, SLUG_RE, TYPE_LABEL } from "../../_lib/media.js";

const CACHE_SECONDS = 300;

/* An empty body, not a message: an image endpoint that answers with prose leaves
   a broken-image icon and a paragraph of text the page never renders. */
const missing = (cache) => new Response(null, {
  status: 404,
  headers: {
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }

  const slug = String((params && params.slug) || "");
  const kind = String((params && params.kind) || "");
  const hasVersion = new URL(request.url).searchParams.has("v");

  if (!SLUG_RE.test(slug) || KINDS.indexOf(kind) === -1) {
    return missing(hasVersion ? "public, max-age=" + CACHE_SECONDS : "no-cache");
  }

  try {
    const row = await env.DB.prepare(
      "SELECT avatar_at,banner_at FROM player_profiles WHERE slug = ? LIMIT 1"
    ).bind(slug).first();
    /* The column is the presence check, and it is checked before the bucket is
       asked: a row with no timestamp is "this player has no picture", whether or
       not an older object is still sitting under the key. */
    if (!row || !row[COLUMNS[kind]]) {
      return missing(hasVersion ? "public, max-age=" + CACHE_SECONDS : "no-cache");
    }

    const object = await env.MEDIA.get(slug + "/" + kind);
    if (!object) return missing("no-cache");

    const stored = (object.httpMetadata && object.httpMetadata.contentType) || "";
    /* Only a type this site writes is served back. An object put there by
       something else - a text/html upload from before this check existed - is not
       a picture, and echoing its type would let a bucket turn into a page. */
    const type = TYPE_LABEL[stored] ? stored : "application/octet-stream";

    const headers = {
      "content-type": type,
      "cache-control": hasVersion ? "public, max-age=" + CACHE_SECONDS : "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    };
    if (object.size !== undefined && object.size !== null) headers["content-length"] = String(object.size);

    /* HEAD answers the headers with no body, which is what a browser's preflight
       for an <img> and a link checker both ask for. Reading the object is the same
       cost either way in R2, so this is not worth a second code path. */
    if (request.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(object.body, { status: 200, headers });
  } catch (e) {
    console.error("media read failed", slug, kind, e);
    return new Response(null, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
