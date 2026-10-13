// Redirect www (and pages.dev) to the apex domain.
export async function onRequest({ request, next }) {
  const u = new URL(request.url);
  if (u.hostname === "www.zoisports.com" || u.hostname === "zoi-sports.pages.dev") {
    u.hostname = "zoisports.com"; u.protocol = "https:"; u.port = "";
    return Response.redirect(u.toString(), 301);
  }
  return next();
}
