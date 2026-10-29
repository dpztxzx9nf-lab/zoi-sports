import { TOKEN_MAX_ACTIVE, identity, json, readBody, sha256Hex, str } from "../../_lib/lab.js";
import { epicIdOf } from "../../_lib/lab-stats.js";

const LABEL_MAX = 40;
const DEFAULT_LABEL = "This PC";

/* 32 random bytes, base64url with no padding. Long enough that guessing is not
   a plan, and safe to paste into a JSON file without escaping. */
function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Someone else's token answers exactly like one that does not exist: 404, same
   body. Same rule as the tests endpoint. */
const notFound = () => json({ ok: false, error: "No token with that id." }, 404);

const idFrom = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function onRequest({ request, env }) {
  const who = await identity(request, env);
  if (!who.ok) return who.response;

  if (request.method === "GET") {
    try {
      /* Never the hash, never the token: neither can be handed out again. */
      const { results } = await env.DB.prepare(
        `SELECT id,label,created_at,last_seen_at,revoked_at,epic_account_id FROM lab_tokens
         WHERE owner = ? ORDER BY id DESC`
      ).bind(who.id).all();
      const tokens = (results || []).map((r) => ({
        id: r.id,
        label: r.label || "",
        created_at: r.created_at,
        last_seen_at: r.last_seen_at || null,
        epic_account_id: r.epic_account_id || null,
        revoked: Boolean(r.revoked_at),
      }));
      return json({ ok: true, tokens });
    } catch (e) {
      console.error("lab token list failed", e);
      return json({ ok: false, error: "Couldn't read the connected PCs." }, 500);
    }
  }

  if (request.method === "POST") {
    const body = await readBody(request);
    const label = str(body && body.label, LABEL_MAX) || DEFAULT_LABEL;

    /* Optional, and normally filled in later by the PC agent rather than typed
       here: a wrong id would quietly 404 on every stats read, so anything that
       is not 32 lowercase hex characters is refused instead of stored. */
    const rawEpic = body && body.epicAccountId !== undefined ? body.epicAccountId
      : body && body.epic_account_id !== undefined ? body.epic_account_id : null;
    let epicAccountId = null;
    if (rawEpic !== null && String(rawEpic).trim() !== "") {
      epicAccountId = epicIdOf(rawEpic);
      if (!epicAccountId) {
        return json({
          ok: false,
          errors: ["An Epic account id is 32 lowercase hex characters."],
        }, 422);
      }
    }

    const token = newToken();
    const hash = await sha256Hex(token);

    try {
      /* The cap is checked and the row written in one statement so two tabs
         cannot both slip under it. */
      const res = await env.DB.prepare(
        `INSERT INTO lab_tokens (owner,token_hash,label,epic_account_id)
         SELECT ?,?,?,? WHERE (
           SELECT COUNT(*) FROM lab_tokens WHERE owner = ? AND revoked_at IS NULL
         ) < ?`
      ).bind(who.id, hash, label, epicAccountId, who.id, TOKEN_MAX_ACTIVE).run();

      if (!(res?.meta?.changes ?? 0)) {
        return json({
          ok: false,
          error: `That is ${TOKEN_MAX_ACTIVE} connected PCs already. Remove one before adding another.`,
        }, 422);
      }

      /* The only time the plaintext leaves the server. Nothing stores it, so a
         second look is a new token. */
      return json({ ok: true, id: res?.meta?.last_row_id ?? null, token }, 201);
    } catch (e) {
      console.error("lab token create failed", e);
      return json({ ok: false, error: "Couldn't create the token. Has the migration been applied?" }, 500);
    }
  }

  if (request.method === "DELETE") {
    const body = await readBody(request);
    const raw = body && body.id !== undefined ? body.id : new URL(request.url).searchParams.get("id");
    const id = idFrom(raw);
    if (id === null) return notFound();

    try {
      /* Revoked rather than deleted, so the row keeps saying a PC was connected
         and when it was last seen. */
      const res = await env.DB.prepare(
        `UPDATE lab_tokens SET revoked_at = datetime('now') WHERE id = ? AND owner = ? AND revoked_at IS NULL`
      ).bind(id, who.id).run();
      if (!(res?.meta?.changes ?? 0)) {
        /* Already revoked is the one case that is not a 404: the end state the
           caller asked for is the one that holds. */
        const existing = await env.DB.prepare(
          "SELECT id FROM lab_tokens WHERE id = ? AND owner = ?"
        ).bind(id, who.id).first();
        if (!existing) return notFound();
      }
      return json({ ok: true });
    } catch (e) {
      console.error("lab token revoke failed", e);
      return json({ ok: false, error: "Couldn't remove that PC." }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
