/* Who is signed in, for a page that is not behind the gate.

   GET -> { signedIn: true, email, name }  on a valid Access token
       -> { signedIn: false }              otherwise, ALWAYS with status 200

   Deliberately a sibling of /api/lab rather than a child: Cloudflare Access's
   path list has no negated entry, so a path under /api/lab/ could only be
   protected, and functions/_middleware.js gates the /api/lab prefix. Sitting at
   /api/me means a public page can ask this without a sign-in and without the
   middleware turning the answer into a 401.

   A 401 here would be worse than useless: nothing redirects on it, the page
   would just be missing its answer, and a browser shows a failed request in the
   console for a visitor who did nothing wrong. So every refusal - no cookie, a
   malformed one, an expired one, a tampered one, certs that will not load - is
   the same quiet 200 with signedIn:false.

   Verification is NOT done here. verifyAccessToken in _lib/lab.js is the one
   verifier the lab already uses for the Cf-Access-Jwt-Assertion header, and the
   cookie carries the same JWT, so this reads the cookie and hands it to that.
   Nothing is trusted before the signature checks out, and nothing beyond email
   and name is ever returned: not the subject, not the audience, not the expiry,
   not the token. */
import { ACCESS_COOKIE, cookieValue, json, verifyAccessToken } from "../_lib/lab.js";

const signedOut = () => json({ signedIn: false });

/* Display only, and trimmed to something a header can hold. The email is
   lowercased exactly the way the lab's owner id is, so what a page shows and
   what a save is scoped to read the same. */
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  let token = "";
  try {
    token = cookieValue(request.headers.get("cookie"), ACCESS_COOKIE);
  } catch {
    /* A header that will not parse is a visitor with no usable cookie. */
    return signedOut();
  }
  if (!token) return signedOut();

  let checked;
  try {
    checked = await verifyAccessToken(token, env);
  } catch (e) {
    /* verifyAccessToken answers rather than throws; this is only so a surprise
       still lands on the same quiet answer instead of a 500. */
    console.error("me: token check failed", e);
    return signedOut();
  }
  if (!checked.ok) return signedOut();

  const claims = checked.claims;
  const email = text(claims.email, 254).toLowerCase();
  const name = text(claims.name, 120);
  /* A service token has no email. It is a real identity to the lab, but not a
     person a profile menu belongs to, and there is nobody to label the avatar
     with, so it is signed out as far as a page is concerned. */
  if (!email) return signedOut();

  return json({ signedIn: true, email, name });
}
