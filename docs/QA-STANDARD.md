# QA Standard

## Enforcement ladder
Prefer the highest level that works: **codebase > CI > prose > human review**. Make the mistake impossible in code; otherwise make CI fail; otherwise write a rule; human review is last.

## Self-improving rule
When Brock corrects a bot and the mistake is likely to repeat or easy to test, the bot's next step is adding an automated check so it fails next time; one-off judgment calls stay as notes.

## "Fixed" claims
A "fixed" claim must link a green `QA Site` run (with screenshot artifact) against the Cloudflare Pages preview, not localhost.

## Checks (`.github/workflows/qa.yml`, copied from ThinkCore v1)
- Mobile layout: Playwright WebKit at 390x844 and 390x664; no fixed/sticky, footer/nav/link/button/CTA text (or any text on a page that ends within the viewport) in the bottom 100px or under fixed/sticky header on first load; no empty band >200px in the first screen. Screenshots uploaded.
- lychee link/asset check on the preview.
- Denylist: Brock, Knechtel, Kindex, Liahona in public files and live HTML (`private_denylist_exempt` for the Liahona repo).
- Icons: an icon file changed in place fails; ship a new filename.

Pilot is report-only (`continue-on-error`); it becomes a required check after tuning.

## This repo
- `.github/workflows/qa.yml` runs on pull requests, push to `main`, and manual dispatch. Report-only: never blocks a merge.
- No PR preview (no PR preview: Pages is not Git-connected for PR branches); on PRs `preview`, `mobile-layout`, `links` are `n/a – no web preview`. Runs on `main` check production `https://zoisports.com`.
- Denylist scans: `public` (tests, fixtures, e2e, code comments excluded; whole-word). Exempt: none.
- typecheck / lint run when `package.json` has that script.

## Status file
`qa-status.json` (repo, checks[{name,result,details}], passing, total, run_url, commit, updated_at) is uploaded as the `qa-status` artifact and, on `main`, committed to the `qa-status` branch (`[CI Skip]`).
Read: `GET https://api.github.com/repos/dpztxzx9nf-lab/zoi-sports/contents/qa-status.json?ref=qa-status` with `Accept: application/vnd.github.raw+json` and a read-only token (`QA_STATUS_READ_TOKEN` in ThinkCore's Pages env).
