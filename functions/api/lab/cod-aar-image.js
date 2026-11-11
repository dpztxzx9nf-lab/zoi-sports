/* The signed-in player's own after-action screenshot, streamed from the
   private zoi-media bucket. The object key is never sent to the page;
   the match id is enough, and only the row's owner can fetch it. */
import { identity } from "../../_lib/lab.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return new Response("Method not allowed.", { status: 405, headers: { "cache-control": "no-store" } });
  }

  const who = await identity(request, env);
  if (!who.ok) return who.response;

  const id = Number(new URL(request.url).searchParams.get("id") || "");
  if (!Number.isInteger(id) || id < 1) {
    return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
  }

  try {
    const row = await env.DB.prepare(
      "SELECT aar_key FROM lab_cod_matches WHERE id = ? AND owner = ? AND deleted_at IS NULL LIMIT 1"
    ).bind(id, who.id).first();
    if (!row || !row.aar_key) {
      return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
    }
    const obj = await env.MEDIA.get(row.aar_key);
    if (!obj) return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg";
    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=3600",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (e) {
    console.error("cod aar image failed", e);
    return new Response("Couldn't load that screenshot just now.", { status: 500, headers: { "cache-control": "no-store" } });
  }
}
