<p align="center"><img src="public/assets/zoi-icon.png" alt="Zoi logo" width="180"></p>

# Zoi — zo-EE (ζωή, "life")

**Live site:** https://zoisports.com


Website for **Zoi**, a new competitive Fortnite Zero Build esports org founded by Kneczi.

Plain static HTML/CSS/JS — no build step.

- `index.html`, `styles.css`, `main.js`, `assets/`
- Local preview: `python3 -m http.server` then open http://localhost:8000
- Hosting: Cloudflare Pages (project `zoi-sports`). Build command: none. Output directory: `/`.

Socials use @zoi_sports_gg. Kick is linked; X, YouTube, Twitch and TikTok stay "coming soon" until claimed.

## Layout
- `public/` — static site (deployed output)
- `playbook/` — [Kneczi's settings, sensitivity and strategy notes](playbook/README.md). In-game and player-side only; hardware and PC tuning live with Knexrig.
- `functions/api/apply.js` — Pages Function: `POST /api/apply` validates + stores tryout applications (honeypot + 3/hour/IP rate limit)
- `schema.sql` — D1 schema (database `zoi-tryouts`, binding `DB`)
- `wrangler.toml` — Pages config + D1 binding

## Logging a match
`/results` renders `public/results.json`, which `tools/log-match.mjs` writes. Log each match once; re-logging the same `--match` number replaces it, and events are matched on game + name + date.
```
node tools/log-match.mjs --game "Fortnite Zero Build" --event "ZB Scrim Block" --date 2026-10-30 --format "Duos, 6 matches" --match 1 --placement 3 --eliminations 4 --field 25 --points 12
```
Add `--dry-run` to validate and print the JSON without writing, or `--list` for a text table of everything logged. Bad input exits non-zero and leaves the file untouched.

## Deploy
`wrangler pages deploy --branch main`

## Reading applications
```
wrangler d1 execute zoi-tryouts --remote --command "SELECT id,created_at,epic_name,discord,region,platform,age,role,results_link,clips_link,email,why FROM applications ORDER BY id DESC"
```
