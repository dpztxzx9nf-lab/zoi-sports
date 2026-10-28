// Redirect www (and pages.dev) to the apex domain.
export async function onRequest({ request, next }) {
  const u = new URL(request.url);
  if (u.hostname === "www.zoisports.com" || u.hostname === "zoi-sports.pages.dev") {
    u.hostname = "zoisports.com"; u.protocol = "https:"; u.port = "";
    return Response.redirect(u.toString(), 301);
  }
  const res = await next();
  // The settings lab is a private tool: keep it out of every index, on the page
  // and on the JSON API alike, without a path-scoped rule in _headers.
  if (u.pathname === "/lab" || u.pathname.startsWith("/lab/") || u.pathname === "/lab.html") {
    const r2 = new Response(res.body, res);
    r2.headers.set("x-robots-tag", "noindex, nofollow");
    return r2;
  }
  return res;
}
