/* The signed-in person's own profile, read and written from the account menu.

   GET  -> { ok, profile } with profile null when nothing is saved yet
   PUT  -> saves the fields it was given and answers the saved row

   Owner-scoped by the Access identity, exactly like the rest of the lab: the
   email in the verified token is the key, so one person can never write another
   person's card. Nothing here takes an owner from the request body.

   `published` is never set from the browser without being asked for: the editor
   has a checkbox and it sends true/false. A row that is edited but unpublished
   is saved and simply not served to the roster, which is what lets someone type
   a bio over two sittings without it appearing on the site half-finished. */
import { identity, json, readBody } from "../../_lib/lab.js";
import { LIMITS, NETWORKS, slugOf, socialUrl, socialsFromText, publicProfile, textField } from "../../_lib/profile.js";

const SELECT = "SELECT owner,slug,gamertag,role,region,platform,bio,socials,published,updated_at FROM player_profiles";

/* A slug that is not already taken by somebody else. The base is the gamertag;
   a collision gets -2, -3, ... so two players called the same thing still both
   have a working avatar path and public entry. */
async function uniqueSlug(env, base, owner) {
  const root = slugOf(base);
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? root : root.slice(0, 28) + "-" + n;
    const row = await env.DB.prepare(
      "SELECT owner FROM player_profiles WHERE slug = ? LIMIT 1"
    ).bind(candidate).first();
    if (!row || row.owner === owner) return candidate;
  }
  return root.slice(0, 24) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function onRequest({ request, env }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;

  if (request.method === "GET") {
    try {
      const row = await env.DB.prepare(SELECT + " WHERE owner = ? LIMIT 1").bind(who.id).first();
      /* `published` is included on the editor's own read - it is their own flag -
         but publicProfile() leaves it out, because the public side only ever sees
         rows that are already published. */
      return json({
        ok: true,
        profile: row ? { ...publicProfile(row), published: row.published === 1 } : null,
        networks: NETWORKS,
      });
    } catch (e) {
      console.error("profile read failed", e);
      return json({ ok: false, error: "Couldn't read your profile just now." }, 500);
    }
  }

  if (request.method !== "PUT") return json({ ok: false, error: "Method not allowed." }, 405);

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Send the profile as JSON." }, 400);

  const gamertag = textField(body.gamertag, LIMITS.gamertag);
  if (!gamertag) {
    return json({ ok: false, errors: ["A gamertag is required: it is the name on the card."] }, 400);
  }

  /* Socials are filtered, never rejected: a half-typed URL should not stop the
     rest of the profile being saved. It is simply not stored, and the editor
     shows the field as it was typed so it can be fixed. */
  const socials = {};
  const raw = body.socials && typeof body.socials === "object" && !Array.isArray(body.socials) ? body.socials : {};
  const dropped = [];
  for (const net of NETWORKS) {
    const value = raw[net];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const url = socialUrl(value);
    if (url) socials[net] = url;
    else dropped.push(net);
  }

  const fields = {
    gamertag,
    role: textField(body.role, LIMITS.role),
    region: textField(body.region, LIMITS.region),
    platform: textField(body.platform, LIMITS.platform),
    bio: textField(body.bio, LIMITS.bio, { multiline: true }),
    socials: JSON.stringify(socials),
    published: body.published === true ? 1 : 0,
  };

  try {
    const existing = await env.DB.prepare(
      "SELECT owner,slug,updated_at FROM player_profiles WHERE owner = ? LIMIT 1"
    ).bind(who.id).first();

    if (existing) {
      /* The slug is written only in the INSERT branch below: it is the avatar
         filename and the public key, so renaming a gamertag must not move it.
         An existing row keeps the slug it was created with. */
      await env.DB.prepare(
        `UPDATE player_profiles SET gamertag = ?, role = ?, region = ?, platform = ?, bio = ?,
           socials = ?, published = ?, updated_at = datetime('now') WHERE owner = ?`
      ).bind(fields.gamertag, fields.role, fields.region, fields.platform, fields.bio,
        fields.socials, fields.published, who.id).run();
    } else {
      const slug = await uniqueSlug(env, fields.gamertag, who.id);
      await env.DB.prepare(
        `INSERT INTO player_profiles (owner, slug, gamertag, role, region, platform, bio, socials, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(who.id, slug, fields.gamertag, fields.role, fields.region, fields.platform,
        fields.bio, fields.socials, fields.published).run();
    }

    const saved = await env.DB.prepare(SELECT + " WHERE owner = ? LIMIT 1").bind(who.id).first();
    return json({
      ok: true,
      profile: saved ? { ...publicProfile(saved), published: saved.published === 1 } : null,
      /* Named so the editor can say which fields were not saved, rather than
         silently dropping what was typed. */
      dropped,
    });
  } catch (e) {
    console.error("profile save failed", e);
    return json({ ok: false, error: "Couldn't save your profile just now." }, 500);
  }
}
