// Redirect www (and pages.dev) to the apex domain.
//
// The settings lab is a private tool: the page and its API are both behind
// Cloudflare Access, which signs the person in at the edge. Preview hostnames
// (abc123.zoi-sports.pages.dev and friends) are not behind Access, so the page
// needs the same check the API has, and the JWT is verified rather than trusted.
// See _lib/lab.js for that check.
import { gate } from "./_lib/lab.js";

const isLabPath = (pathname) =>
  pathname === "/lab" || pathname.startsWith("/lab/") || pathname === "/lab.html";

export async function onRequest({ request, env, next }) {
  const u = new URL(request.url);
  if (u.hostname === "www.zoisports.com" || u.hostname === "zoi-sports.pages.dev") {
    u.hostname = "zoisports.com"; u.protocol = "https:"; u.port = "";
    return Response.redirect(u.toString(), 301);
  }

  if (isLabPath(u.pathname)) {
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
