<p align="center"><img src="public/assets/zoi-icon.png" alt="ZOI logo" width="180"></p>

# ZOI — zo-EE (ζωή, "life")

**Live site:** https://zoisports.com


Website for **ZOI**, a new competitive Fortnite Zero Build esports org founded by ZoiKneczi.

Plain static HTML/CSS/JS — no build step.

- `index.html`, `styles.css`, `main.js`, `assets/`
- Local preview: `python3 -m http.server` then open http://localhost:8000
- Hosting: Cloudflare Pages (project `zoi-sports`). Build command: none. Output directory: `/`.

Socials (@zoi_sports on X, YouTube, Twitch, TikTok) and contact are marked "coming soon" until claimed.

## Layout
- `public/` — static site (deployed output)
- `functions/api/apply.js` — Pages Function: `POST /api/apply` validates + stores tryout applications (honeypot + 3/hour/IP rate limit)
- `schema.sql` — D1 schema (database `zoi-tryouts`, binding `DB`)
- `wrangler.toml` — Pages config + D1 binding

## Deploy
`wrangler pages deploy --branch main`

## Reading applications
```
wrangler d1 execute zoi-tryouts --remote --command "SELECT id,created_at,epic_name,discord,region,platform,age,role,results_link,clips_link,email,why FROM applications ORDER BY id DESC"
```
