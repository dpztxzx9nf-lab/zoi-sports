/* Shared pieces for the private settings lab.
   Files and folders under functions/ whose names start with an underscore are
   not routed, so nothing here is reachable as an endpoint. */

export const STATUSES = ["testing", "kept", "reverted", "inconclusive"];

/* Settings the player can judge by feel, taken from public/settings.html
   (Fortnite Zero Build controller tab, read 28 October 2026).
   value is the current value as shown on that page. step is the size of one
   move for the suggested next value. */
export const CATALOG = [
  {
    id: "look_horizontal_speed", label: "Look Horizontal Speed", value: "42", type: "int", step: 2, min: 1, max: 100,
    watch: "How a turn across your body lands. Overshooting the doorway or the corner you swung for means it's too fast; not being able to cover the angle at all means it's too slow.",
  },
  {
    id: "look_vertical_speed", label: "Look Vertical Speed", value: "42", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can follow someone jumping, gliding or dropping without sliding past them, and whether looking up from a crouch takes more push than you expect.",
  },
  {
    id: "look_boost_speed", label: "Look Boost Speed", value: "0", type: "int", step: 2, min: 0, max: 100,
    watch: "Whether the end of the stick's travel adds speed you didn't ask for. A hard hold turning on someone behind you either stops where you meant it to or runs past them.",
  },
  {
    id: "look_boost_ramp", label: "Look Boost Ramp", value: "0.0", type: "decimal", step: 0.1, min: 0,
    watch: "How long the extra speed takes to arrive. Watch whether a held turn builds smoothly or shows up as a jolt partway through.",
  },
  {
    id: "look_ease_time", label: "Look Ease Time", value: "0.0", type: "decimal", step: 0.05, min: 0,
    watch: "Whether the view arrives with your thumb or trails behind it. Lag shows up as the crosshair still sliding a moment after you stop pushing.",
  },
  {
    id: "ads_look_horizontal_speed", label: "ADS Look Horizontal Speed", value: "12", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can stay on a strafing target at mid range, and whether turning while aimed in a close fight feels sluggish or overshoots.",
  },
  {
    id: "ads_look_vertical_speed", label: "ADS Look Vertical Speed", value: "12", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can track someone dropping or strafing up a ramp while aimed, and whether pulling up onto a head takes more stick than it should.",
  },
  {
    id: "ads_boost_speed", label: "ADS Boost Speed", value: "0", type: "int", step: 2, min: 0, max: 100,
    watch: "Whether the far end of the aim stick swings too far in a close fight. Watch a quick correction past the target and whether it comes back cleanly or bounces.",
  },
  {
    id: "ads_boost_ramp", label: "ADS Boost Ramp", value: "0.0", type: "decimal", step: 0.1, min: 0,
    watch: "How fast the extra aim speed kicks in during a hold. Watch for a turn that starts steady and then surges past the target.",
  },
  {
    id: "scoped_multiplier", label: "Scope Multiplier", value: "0.95", type: "decimal", step: 0.05, min: 0,
    watch: "Whether a scoped flick overshoots up close or falls short at distance. Watch the first shot after you scope in: past the head, on it, or behind it.",
  },
  {
    id: "move_stick_deadzone", label: "Move Stick Deadzone", value: "0.06", type: "decimal", step: 0.01, min: 0,
    watch: "Whether your character starts moving the moment you push, or stays put while the stick takes up slack. Pan the camera sideways and watch for a step that arrives late.",
  },
  {
    id: "look_stick_deadzone", label: "Look Stick Deadzone", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether the view drifts with your thumb off the stick, or whether the stick feels dead at the start of travel. Small aim corrections show it first.",
  },
  {
    id: "left_trigger_release", label: "Left Trigger Release", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether letting off aim drops the scope straight away or hangs on for a moment. Watch a quick scope in and out on a moving target.",
  },
  {
    id: "right_trigger_release", label: "Right Trigger Release", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether the gun stops the instant you let off, or keeps the last shot going. Watch a single tap in a fight and see whether a second round goes off.",
  },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  },
});

export const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max);

/* Two values that mean the same thing are not a test. Compare numbers numerically
   ("1.0" against "1.00"), strings as they are ("On" against "Off"). */
export const sameValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

/* ---------- Cloudflare Access sign-in ----------
   Access terminates sign-in at the edge and forwards a signed JWT in
   Cf-Access-Jwt-Assertion. Preview hostnames are not behind Access, so that
   header cannot be taken on trust: the signature is checked here against the
   team's published keys, and no claim is read until it verifies.

   Anyone Access has signed in may use the lab. The token says who someone is,
   not whether they belong: the identity it carries is the owner id that scopes
   every row they can read or change. */

const JWT_HEADER = "Cf-Access-Jwt-Assertion";
const CLOCK_SKEW = 60; // seconds a clock may run ahead before nbf/iat is refused

const listOf = (value) => (typeof value === "string" ? value.split(",") : [])
  .map((v) => v.trim()).filter(Boolean);

/* Public keys, parsed once at module scope. They rotate rarely, so a kid we have
   not seen is the only reason to fetch again. The in-flight map means a burst of
   requests for the same team shares one fetch instead of one each. */
const keyCache = new Map();    // team -> Map(kid -> CryptoKey)
const keyFetches = new Map();  // team -> Promise<Map(kid -> CryptoKey>>

async function fetchKeys(team) {
  const res = await fetch("https://" + team + "/cdn-cgi/access/certs");
  if (!res.ok) throw new Error("cert fetch failed with status " + res.status);
  const body = await res.json();
  const keys = new Map();
  const list = body && Array.isArray(body.keys) ? body.keys : [];
  for (const jwk of list) {
    if (!jwk || typeof jwk !== "object" || jwk.kty !== "RSA") continue;
    if (typeof jwk.kid !== "string" || !jwk.kid) continue;
    try {
      keys.set(jwk.kid, await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ));
    } catch { /* a key that will not import is a key that cannot verify */ }
  }
  if (!keys.size) throw new Error("cert fetch returned no usable keys");
  return keys;
}

function keysFor(team) {
  let pending = keyFetches.get(team);
  if (!pending) {
    pending = fetchKeys(team)
      .then((keys) => { keyCache.set(team, keys); return keys; })
      .finally(() => { keyFetches.delete(team); });
    keyFetches.set(team, pending);
  }
  return pending;
}

/* base64url to bytes. atob wants standard base64, so translate and pad first.
   Anything outside the alphabet is a malformed token, not something to guess at. */
function b64urlBytes(part) {
  if (typeof part !== "string" || !/^[A-Za-z0-9_-]+$/.test(part)) return null;
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

const unauthorized = () => json({ ok: false, error: "Unauthorized." }, 401);

/* Who a verified token stands for. The owner id is lowercased either way: Access
   reports an email in whatever case the sign-in used, and the same person has to
   land on the same rows every time. A service token carries no email, so its
   common_name stands in. A token with neither is not an identity, so it fails
   closed rather than writing rows nobody can claim. `name` is display only and is
   never used for ownership. */
function identityFrom(claims) {
  const name = typeof claims.name === "string" ? claims.name : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (email) return { id: email, email, name };
  const commonName = typeof claims.common_name === "string" ? claims.common_name.trim().toLowerCase() : "";
  if (commonName) return { id: commonName, email: "", name };
  return null;
}

/* Verifies a raw Access JWT string against the team's published keys and
   returns what it claims, or says why it could not be trusted:

     { ok: true, claims }
     { ok: false, reason: "config" }      // no team or audience configured
     { ok: false, reason: "unavailable" } // the certs endpoint would not answer
     { ok: false, reason: "invalid" }     // everything else: no claim is read

   This is the ONE verifier. identity() below reads the Cf-Access-Jwt-Assertion
   header and goes through it; /api/me reads the CF_Authorization cookie and goes
   through it too, so the cookie path cannot drift from the header path in what
   it accepts. Nothing about the caller is trusted before the signature checks
   out; every claim is read only after that line. */
export async function verifyAccessToken(token, env) {
  const team = str(env && env.LAB_ACCESS_TEAM, 200);
  const auds = listOf(env && env.LAB_ACCESS_AUD);
  if (!team || !auds.length) return { ok: false, reason: "config" };

  const raw = str(token, 8192);
  if (!raw) return { ok: false, reason: "invalid" };

  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };

  const headerBytes = b64urlBytes(parts[0]);
  const payloadBytes = b64urlBytes(parts[1]);
  const signature = b64urlBytes(parts[2]);
  if (!headerBytes || !payloadBytes || !signature || !signature.length) return { ok: false, reason: "invalid" };

  /* alg goes first: none and the symmetric HS* family are refused before any key
     is imported, so a token cannot talk us into a different kind of check. */
  let header;
  try { header = JSON.parse(decoder.decode(headerBytes)); } catch { return { ok: false, reason: "invalid" }; }
  if (!header || typeof header !== "object" || header.alg !== "RS256") return { ok: false, reason: "invalid" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "invalid" };

  let keys = keyCache.get(team);
  let key = keys && keys.get(header.kid);
  if (!key) {
    /* An unseen kid is the only reason to go back to the endpoint, and a fetch
       already in flight is shared rather than repeated, so a burst of requests
       carrying the same new kid costs one fetch between them. */
    try {
      keys = await keysFor(team);
    } catch (e) {
      console.error("access certs unavailable", e);
      return { ok: false, reason: "unavailable" };
    }
    key = keys.get(header.kid);
  }
  if (!key) return { ok: false, reason: "invalid" };

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      encoder.encode(parts[0] + "." + parts[1]),
    );
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: "invalid" };

  /* Past this line the token was signed by Access, so its claims can be read. */
  let claims;
  try { claims = JSON.parse(decoder.decode(payloadBytes)); } catch { return { ok: false, reason: "invalid" }; }
  if (!claims || typeof claims !== "object") return { ok: false, reason: "invalid" };

  const now = Math.floor(Date.now() / 1000);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const exp = num(claims.exp);
  if (exp === null || exp <= now) return { ok: false, reason: "invalid" };

  for (const field of ["nbf", "iat"]) {
    const at = num(claims[field]);
    if (at !== null && at > now + CLOCK_SKEW) return { ok: false, reason: "invalid" };
  }

  if (claims.iss !== "https://" + team) return { ok: false, reason: "invalid" };

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((a) => typeof a === "string" && auds.includes(a))) return { ok: false, reason: "invalid" };

  return { ok: true, claims };
}

/* The Access cookie. On the apex, Access puts the same JWT it asserts in this
   cookie as well as in the header; a page read on a hostname where the header is
   not attached can still say who is signed in if the cookie came along. Named
   here so the one place that reads a cookie and the tests agree on the name. */
export const ACCESS_COOKIE = "CF_Authorization";

/* One Set-Cookie header value to one token: the pieces before the first ";" are
   name=value, and only the named cookie is returned. A malformed percent escape
   is a cookie that cannot be read, not something to guess around. */
export function cookieValue(header, name) {
  if (typeof header !== "string" || !header) return "";
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    if (piece.slice(0, eq).trim() !== name) continue;
    let raw = piece.slice(eq + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    try { return decodeURIComponent(raw).trim(); } catch { return ""; }
  }
  return "";
}

/* Verifies the Access JWT and says who is signed in:
   { ok: true, id, email, name } or { ok: false, response }, where response is
   the thing to send instead of the handler's own reply. */
export async function identity(request, env) {
  const token = (request.headers.get(JWT_HEADER) || "").trim();
  const checked = await verifyAccessToken(token, env);
  if (!checked.ok) {
    if (checked.reason === "config") {
      return { ok: false, response: json({ ok: false, error: "Sign-in is not configured." }, 500) };
    }
    if (checked.reason === "unavailable") {
      return { ok: false, response: json({ ok: false, error: "Couldn't check your sign-in just now. Try again in a moment." }, 503) };
    }
    return { ok: false, response: unauthorized() };
  }

  const who = identityFrom(checked.claims);
  if (!who) return { ok: false, response: unauthorized() };
  return { ok: true, ...who };
}

/* Returns a Response to send instead of the handler's, or null to continue.
   Thin wrapper so a caller that only needs the go/no-go stays one line. */
export async function gate(request, env) {
  const who = await identity(request, env);
  return who.ok ? null : who.response;
}
export async function readBody(request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

/* owner is the signed-in person's id, and every statement that reads or writes a
   test carries it: a row is only ever visible to the owner it was written with. */
export const SELECT_TEST = "SELECT id,setting,label,from_value,to_value,watch_for,games_planned,games_played,status,result_note,started_at,decided_at,owner FROM lab_tests";

/* Group rows by setting. Input is expected newest first; the first row seen for a
   setting decides the label, so the most recent label wins. */
export function groupBySetting(tests) {
  const map = new Map();
  for (const t of tests) {
    let g = map.get(t.setting);
    if (!g) {
      g = { setting: t.setting, label: t.label, tests: 0, kept: 0, reverted: 0, lastDecidedAt: null };
      map.set(t.setting, g);
    }
    g.tests += 1;
    if (t.status === "kept") g.kept += 1;
    else if (t.status === "reverted") g.reverted += 1;
    if (t.decided_at && (!g.lastDecidedAt || t.decided_at > g.lastDecidedAt)) g.lastDecidedAt = t.decided_at;
  }
  return [...map.values()];
}

/* ---------- snapshots sent from a player's PC ----------
   The PC agent (tools/zoi-lab-agent.mjs) posts a flat map of Fortnite's own
   settings. Two things here are shared between the token endpoint, the sync
   endpoint and the tests: how a token is hashed, and which of Fortnite's
   property names mean anything to the catalog. */

export const TOKEN_MAX_ACTIVE = 5;        // per person, at once
export const SNAPSHOT_MAX_BYTES = 200 * 1024;
export const SNAPSHOT_MAX_SETTINGS = 2000;
export const SNAPSHOT_KEEP = 200;         // newest N kept per person
export const MIN_SETTINGS = 5;            // below this it is not a config
/* Five names tells a config from a handful of bytes, but it does not tell this
   lab's config from any other object with five keys in it: the endpoint skips
   names it does not recognise, so a blob of nonsense met the count, was stored
   as a snapshot, and became the diff baseline the next real read was measured
   against. These are the names the catalog reads. A real save carries thirteen
   of the fourteen, so requiring three still admits a save that is missing one
   or two, and refuses anything that is not a settings file. MIN_SETTINGS stays
   as the floor on the number of names; this is the separate question of whether
   any of them are ours. */
export const MIN_TRACKED = 3;

/* SHA-256, lowercase hex. Tokens are only ever stored this way, so a copy of the
   database cannot be turned back into a working token. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* JSON with object keys sorted at every level, so the same settings always hash
   the same way whatever order the agent wrote them in. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}

const VALUE_TEXT_MAX = 24;

/* One scalar setting as the short string the log stores. Objects and arrays are
   not settings, so they come back empty and the caller drops them. */
export function valueText(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value).slice(0, VALUE_TEXT_MAX) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim().slice(0, VALUE_TEXT_MAX);
  return "";
}

/* Fortnite's own property names, exactly as tools/parse.py lifts them out of
   ClientSettings.Sav, mapped to catalog ids. Only names seen in a real save
   (playbook/state/last-snapshot.json, Fortnite last wrote it 26 October 2026)
   are here; a name that is wrong would silently never fire, so guessing is
   worse than leaving a setting out.
   Left out on purpose:
     LookVerticalBoostSpeed and LookVerticalBoostSpeedAds - both are real keys in
       the save, but the catalog tracks boost speed as one entry mapped to the
       horizontal property, so the vertical one has nowhere to go. Mapping it as
       well would let one stick change open two tests for one setting.
     Every other property in the save has a catalog entry, and every catalog
       entry has a line here. A test in the harness holds both halves of that,
       because the failure it catches is silent: a tracked setting that never
       opens a test looks exactly like a setting nobody changed. */
export const PROPERTY_MAP = {
  LookHorizontalSpeed: "look_horizontal_speed",
  LookVerticalSpeed: "look_vertical_speed",
  LookHorizontalBoostSpeed: "look_boost_speed",
  LookBoostAccelerationTime: "look_boost_ramp",
  LookEaseTime: "look_ease_time",
  LookHorizontalSpeedAds: "ads_look_horizontal_speed",
  LookVerticalSpeedAds: "ads_look_vertical_speed",
  LookHorizontalBoostSpeedAds: "ads_boost_speed",
  LookBoostAccelerationTimeAds: "ads_boost_ramp",
  ScopedSensitivityMultiplier: "scoped_multiplier",
  GamepadLookStickDeadZone: "look_stick_deadzone",
  GamepadMoveStickDeadZone: "move_stick_deadzone",
  GamepadLeftTriggerReleaseThreshold: "left_trigger_release",
  GamepadRightTriggerReleaseThreshold: "right_trigger_release",
};

/* ---------- what everything is set to right now ----------
   The PC agent sends every key in the save, but the page only shows the ones the
   catalog tracks: the same settings a change can open a test on, with the label
   the rest of the page uses. All ninety-one keys would be a wall to scroll, and
   the public settings page already mirrors the in-game menu for that.

   The value shown is the value the save holds, untouched: the page should show
   what Fortnite is set to, not a prettied version of it. A tracked setting the
   snapshot did not carry comes back with value null rather than being dropped,
   so a missing key looks missing instead of looking like a setting that does not
   exist. */
export function currentOf(snapshot) {
  if (!snapshot || typeof snapshot.payload !== "string" || !snapshot.payload) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(snapshot.payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  /* settings is a plain object of name to value. An array would pass a bare
     typeof check and then have no keys to read. */
  if (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) return null;

  /* One property per id is the rule, but the map is consulted rather than
     assumed, so a second property added later would show up here too. */
  const propsFor = new Map();
  for (const name of Object.keys(PROPERTY_MAP)) {
    const id = PROPERTY_MAP[name];
    if (!propsFor.has(id)) propsFor.set(id, []);
    propsFor.get(id).push(name);
  }

  const settings = [];
  for (const entry of CATALOG) {
    const names = propsFor.get(entry.id) || [];
    let value = null;
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(parsed.settings, name)) continue;
      const text = valueText(parsed.settings[name]);
      if (text) { value = text; break; }
    }
    settings.push({ id: entry.id, label: entry.label, value });
  }

  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : null;
  return {
    taken_at: snapshot.taken_at || null,
    source,
    settings,
  };
}
