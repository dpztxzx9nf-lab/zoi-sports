// Redirect www (and pages.dev) to the apex domain.
//
// The settings lab is personal rather than private to one person: anyone Access
// has signed in may use it, and each person's log is scoped to the identity in
// their token (see _lib/lab.js). Preview hostnames (abc123.zoi-sports.pages.dev
// and friends) are not behind Access, so the page needs the same check the API
// has, and the JWT is verified rather than trusted.
import { gate } from "./_lib/lab.js";

/* One path is deliberately outside that check: /api/lab/sync, the endpoint the
   PC agent posts to. A PC has no browser and cannot sit through a Google or
   email sign-in, so gating it would mean the agent could never send anything.
   What protects it instead is the bearer token in the request: sync.js hashes
   it and looks the hash up in lab_tokens, and an unknown, revoked or missing
   token is a 401 with the same body in every case. The token belongs to one
   person and scopes everything it writes to that person's owner. It is the one
   exclusion; every other lab path, page and API alike, still needs a JWT.

   This check is the Worker's own. Cloudflare Access sits in front of it and
   has its own list of protected paths, so /api/lab/sync has to be outside that
   list too, or Access turns the agent away before this file runs. That is a
   dashboard setting, not something here can change. */
const SYNC_PATH = "/api/lab/sync";

const isLabPage = (p) => p === "/lab" || p.startsWith("/lab/") || p === "/lab.html";
const isLabApi = (p) => p === "/api/lab" || p.startsWith("/api/lab/");
const isLabPath = (p) => isLabPage(p) || isLabApi(p);

export async function onRequest({ request, env, next }) {
  const u = new URL(request.url);
  if (u.hostname === "www.zoisports.com" || u.hostname === "zoi-sports.pages.dev") {
    u.hostname = "zoisports.com"; u.protocol = "https:"; u.port = "";
    return Response.redirect(u.toString(), 301);
  }

  if (isLabPath(u.pathname) && u.pathname !== SYNC_PATH) {
    // On the apex, Access has already signed the person in and attached the JWT,
    // so a signed-in visit falls straight through to the page. On a preview
    // hostname this is the only thing between a stranger and the page shell.
    const blocked = await gate(request, env);
    if (blocked) {
      const status = blocked.status;
      const message = status === 401
        ? "Sign in to view the settings lab.\n"
        : "The settings lab is not available right now.\n";
      return new Response(message, {
        status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow",
        },
      });
    }
  }

  const res = await next();
  // Keep the lab out of every index, on the page and on the JSON API alike,
  // without a path-scoped rule in _headers.
  if (isLabPath(u.pathname)) {
    const r2 = new Response(res.body, res);
    r2.headers.set("x-robots-tag", "noindex, nofollow");
    return r2;
  }
  return res;
}
