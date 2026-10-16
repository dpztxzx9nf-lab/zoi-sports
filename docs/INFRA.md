# Zoi site: infrastructure

Snapshot of live state as of 2026-10-16. Secret values are never recorded here; only names.

| Category | Item (live state) |
|---|---|
| Hosting | Cloudflare Pages project `zoi-sports` (Direct Upload), zoisports.com, www. |
| Binding | D1 `zoi-tryouts` as `DB`; service binding `NOTIFY` -> `zoi-tryout-notify` |
| Worker | `zoi-tryout-notify` (send_email `EMAIL`, secret `NOTIFY_TO`) |
| DNS/Email | Cloudflare Email Routing (hello@zoisports.com), SPF, DKIM `cf2024-1`, DMARC `p=none` |
| Risk | Public repo; D1 database id visible in `wrangler.toml` |

## 1. Worker: `zoi-tryout-notify`

Source: `notify-worker/` (`index.js`, `wrangler.toml`).

- **What it does:** sends an email notification for each new tryout application. The Pages Function `functions/api/apply.js` stores the application in D1, then calls this Worker over the `NOTIFY` service binding with the application as JSON. The Worker builds a plain-text MIME message from `tryouts@zoisports.com` and sends it with the `send_email` binding. Fields are cleaned (newlines stripped, length capped) before use in headers/body.
- **Triggers:** `fetch` only, and only `POST` (anything else gets 405). Reached only via the service binding.
- **Routes:** none. No zone routes, no cron schedules, and `workers_dev = false` (workers.dev subdomain disabled, confirmed live). It is internal-only.
- **Bindings (live):**
  - `EMAIL`: `send_email` (Cloudflare Email Routing outbound)
  - `NOTIFY_TO`: `secret_text`
- **Secret names:** `NOTIFY_TO` (the destination address; must be a verified Email Routing destination). Set with `wrangler secret put NOTIFY_TO` from `notify-worker/`. Value deliberately not stored in the repo.
- **Deploy:** `cd notify-worker && wrangler deploy`.
- **Failure modes:** missing `NOTIFY_TO` returns 500 `not configured`; a send error is logged (`send failed`) and returns 500. The application is already saved in D1 either way.

## 2. Email (zoisports.com)

- **Inbound:** Cloudflare Email Routing. `hello@zoisports.com` forwards to Brock's Gmail hub (the kuziekey account). The destination address is not recorded here.
- **Outbound:** the notify Worker sends as `tryouts@zoisports.com` via Email Routing `send_email`.

Public DNS records as they are now:

| Type | Name | Value |
|---|---|---|
| MX | zoisports.com | `route1.mx.cloudflare.net` (56), `route2.mx.cloudflare.net` (32), `route3.mx.cloudflare.net` (84) |
| TXT (SPF) | zoisports.com | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT (DKIM) | cf2024-1._domainkey.zoisports.com | `v=DKIM1; h=sha256; k=rsa; p=...` (Cloudflare-managed public key) |
| TXT (DMARC) | _dmarc.zoisports.com | `v=DMARC1; p=none; rua=mailto:hello@zoisports.com` |

**DMARC note:** policy is `p=none` (monitor only; spoofed mail is not rejected). The `rua` address means Google (and other receivers) send daily aggregate XML reports to hello@, which then land in the Gmail hub.

**Recommended next steps (no DNS changed yet):**
1. Add a Gmail filter to label/skip-inbox the aggregate reports (or point `rua` at a dedicated report mailbox or a DMARC report service) so they don't bury real mail.
2. Watch reports for 2 to 4 weeks; confirm only Cloudflare Email Routing (and any Gmail "send as") pass SPF/DKIM alignment.
3. Then tighten to `p=quarantine` (optionally with `pct=`), and later `p=reject`. Consider `adkim=s; aspf=s` once alignment is confirmed.
4. If you send from Gmail as hello@, add that sender path (SPF include / DKIM) before tightening.

## 3. Repo visibility

The repo is **public**. `wrangler.toml` shows the D1 database id (`zoi-tryouts`, `3c5d2cf7-5335-4468-bcd0-0ebbea094760`) and the account's resource names.

**Risk:** low. A D1 id is an identifier, not a credential. Reading or writing the database requires a Cloudflare API token with D1 permission on this account (or code running in the Pages project). The real exposures to watch are: secrets or tokens committed by mistake, applicant data (never commit exports or screenshots of applications), and personal email addresses in code or docs. The `/api/apply` endpoint is public by design and is protected by a honeypot and a 3/hour/IP rate limit.

**Options (nothing changed):**
1. Keep public (current). Fine as long as no secrets or applicant data are committed; consider enabling GitHub secret scanning / push protection.
2. Make the repo private. Pages uses Direct Upload, so deploys are not affected.
3. Move ids out of git (e.g. a local, gitignored wrangler config). Little security value, more setup friction.

## Operational notes

- `wrangler d1 execute zoi-tryouts --remote ...` with the injected API token fails with error **7403**: the token lacks D1 permission on the account. The Cloudflare MCP (`d1_database_query`) works for the same database. Use the MCP, or a token with D1 Read/Edit, to read applications.
- The same injected token also cannot read zone DNS records; DNS above was taken from public DNS.
