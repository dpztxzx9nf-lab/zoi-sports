#!/usr/bin/env node
/* Builds the Rob Run hub (zoisports.com/robrun) from one data file.

   Every number on those pages lives in public/robrun/data.json. Edit that file
   after a patch, then run:  node tools/build-robrun.mjs
   The pages are written as plain static HTML (good for search engines, no build
   step on Cloudflare), so commit the regenerated files with the data change.
   `--check` exits 1 if the committed HTML is out of date with the data. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const D = JSON.parse(readFileSync(join(pub, "robrun/data.json"), "utf8"));
const SITE = "https://zoisports.com";
const CSS_V = 55, JS_V = 1;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const total = (x) => (x.research == null || x.buy == null ? null : x.research + x.buy);
const LABELS = { official: ["Official", "Kefir"], data: ["Game data", "From the game files, decoded by fan wikis"], player: ["Player report", "Not confirmed by Kefir or the game files"], zoi: ["Zoi tip", "Our own advice"] };
const chip = (l) => `<span class="rr-chip rr-${l}" title="${esc(LABELS[l][1])}">${LABELS[l][0]}</span>`;
const cites = (keys = []) => keys.map((k) => `<a href="${esc(D.sources[k].url)}" rel="noopener" target="_blank">${esc(D.sources[k].name)}</a>`).join(" · ");
const updatedHuman = new Date(D.updated + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const PAGES = [
  { slug: "", tab: "Hub" },
  { slug: "wipe", tab: "Wipe" },
  { slug: "money", tab: "Money" },
  { slug: "base", tab: "Base" },
  { slug: "guides", tab: "Guides" },
  { slug: "settings", tab: "Settings" },
];
const pathOf = (slug) => (slug ? `/robrun/${slug}` : "/robrun");

const NAV = (cur) => `<nav><a href="/#about">About</a><a href="/#roster">Roster</a><a href="/#tryouts">Rush</a><a href="/#events">Events</a><a href="/#socials">Socials</a><a href="/results">Results</a><a href="/robrun" class="nav-rr"${cur ? ' aria-current="page"' : ""}>Rob Run</a><a href="/lab">Lab</a><a href="/shop">Shop</a></nav>`;

function page({ slug, title, h1, tag, desc, body, ld, sourceKeys }) {
  const url = SITE + pathOf(slug);
  const crumbs = [{ name: "Zoi", item: SITE + "/" }, { name: "Rob Run", item: SITE + "/robrun" }];
  if (slug) crumbs.push({ name: h1, item: url });
  const game = { "@type": "VideoGame", name: "Rob Run", publisher: { "@type": "Organization", name: "Kefir" }, gamePlatform: "PC (Steam)" };
  const graph = [
    { "@type": "WebPage", "@id": url, url, name: title, description: desc, dateModified: D.updated, inLanguage: "en", about: game, isPartOf: { "@type": "WebSite", name: "Zoi", url: SITE + "/" }, publisher: { "@type": "SportsOrganization", name: "Zoi", url: SITE + "/" } },
    { "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })) },
    ...(ld || []),
  ];
  const tabs = PAGES.map((p) => `<a href="${pathOf(p.slug)}"${p.slug === slug ? ' aria-current="page"' : ""}>${p.tab}</a>`).join("");
  const srcs = [...new Set(sourceKeys)];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#050506">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/favicon-32.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=9">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/assets/og.jpg?v=9"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>
<link rel="stylesheet" href="/styles.css?v=${CSS_V}">
</head>
<body class="rr">
<header class="nav"><a href="/" class="brand"><img class="zw" src="/assets/zoi-wordmark-gold.png?v=10" alt="Zoi" width="600" height="320"></a>
${NAV(true)}
<div class="nav-end"><button class="menu" aria-label="Menu" aria-expanded="false">☰</button><button class="acct-btn" type="button" id="acct-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Your account" hidden><span class="acct-initial" id="acct-initial">?</span></button></div></header>
<main id="top">
<section class="shop-hero rr-hero"><p class="page-chapter"><span class="gr">ΖΩΗ</span><span class="dot" aria-hidden="true">·</span>Rob Run</p><h1 class="page-h1">${esc(h1)}</h1><p class="tag">${tag}</p></section>
${slug ? `<nav class="rr-tabs" aria-label="Rob Run sections">${tabs}</nav>` : ""}
<div class="stripes" aria-hidden="true"></div>
${body}
<section class="rr-sec rr-sources"><p class="rr-legend">${Object.keys(LABELS).map(chip).join(" ")}</p>
<p class="small">Sources: ${cites(srcs)}</p>
<p class="small">Last updated ${updatedHuman} · game version ${esc(D.gameVersion)} (Early Access). Prices can change with any patch; check your in-game laptop.</p></section>
</main>
<footer><div class="stripes" aria-hidden="true"></div><img src="/assets/zoi-icon.png?v=9" alt="" width="48" height="48"><p>Zoi · ζωή · life</p><p class="small">Contact: <a href="mailto:hello@zoisports.com">hello@zoisports.com</a></p><p class="small">© 2026 Zoi. All rights reserved. · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p><p class="small">Zoi is not affiliated with or endorsed by Kefir. ROB RUN is a trademark of its owner. This is a fan guide.</p></footer>
<script src="/main.js?v=23" defer></script>
<script src="/account.js?v=7" defer></script>
<script src="/robrun.js?v=${JS_V}" defer></script>
</body>
</html>
`;
}

const table = (head, rows, cls = "") => `<div class="rr-tw"><table class="tbl rr-tbl ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td data-label="${head[i]}">${c}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
const sec = (h, inner, extra = "") => `<section class="rr-sec"${extra}><h2>${h}</h2>${inner}</section>`;
const flow = (steps) => `<ol class="rr-flow">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;

/* ---------- hub ---------- */
const fuse1 = D.fuses[0], fuse2 = D.fuses[1];
const perPoint = (f) => f.buy / f.points;
const hub = page({
  slug: "",
  title: "Rob Run Guide: Wipe Timer, Money Calculator, Base Costs — Zoi",
  h1: "Rob Run Guide",
  tag: "Wipe timer, money calculator and base costs for Kefir's Rob Run on Steam.",
  desc: "Rob Run guide by Zoi: weekly wipe timer, contraband money calculator, base defense and fuse costs, spend order and settings for laptops. Every number sourced.",
  sourceKeys: ["kefirWipe", "wikiWipe", "wikiCargo", "wikiItems"],
  body: `<section class="rr-sec rr-hub"><div class="cards rr-cards">
<a class="card rr-card" href="/robrun/wipe"><h3>Wipe timer</h3><p>When your realm wipes, and what you keep.</p></a>
<a class="card rr-card" href="/robrun/money"><h3>Money calculator</h3><p>Profit per crate, per hour, and time to your goal.</p></a>
<a class="card rr-card" href="/robrun/base"><h3>Base costs</h3><p>Fuses, alarms, buildings and titles.</p></a>
<a class="card rr-card" href="/robrun/guides"><h3>Guides</h3><p>Early-wipe spend order. Stack and bank.</p></a>
<a class="card rr-card" href="/robrun/settings"><h3>Settings</h3><p>Competitive settings for mid laptops.</p></a>
</div></section>`,
  ld: [],
});

/* ---------- wipe ---------- */
const J = D.wipe.jail;
const wipe = page({
  slug: "wipe",
  title: "Rob Run Wipe Timer: Federal Raid Countdown and What Resets — Zoi",
  h1: "Wipe timer",
  tag: "Every realm wipes on its own 7-day clock. Enter your timer, get the exact time.",
  desc: "Rob Run wipe timer: turn your in-game Lifetime timer into a local date and countdown. What the Federal Raid resets, what you keep, and how cash becomes jail time.",
  sourceKeys: ["kefirWipe", "kefirBank", "wikiWipe", "wikiServers", "wikiMoney"],
  body: sec("Your countdown", `<p class="rr-lead">In game, open your realm and read its <b>Lifetime</b> timer. Type it here.</p>
<form class="rr-form" id="rr-wipe" autocomplete="off" data-cycle="${D.wipe.cycleDays}">
<div class="rr-row3"><label>Days<input type="number" name="d" min="0" max="7" inputmode="numeric" value="0"></label><label>Hours<input type="number" name="h" min="0" max="23" inputmode="numeric" value="0"></label><label>Minutes<input type="number" name="m" min="0" max="59" inputmode="numeric" value="0"></label></div>
<button class="btn" type="submit">Set timer</button>
</form>
<div class="rr-out" id="rr-wipe-out" aria-live="polite" hidden><p class="rr-big" id="rr-wipe-count"></p><p id="rr-wipe-at"></p><button class="btn ghost rr-small-btn" type="button" id="rr-wipe-clear">Clear</button></div>
<p class="rr-note">Saved on this device only. ${chip("player")} Fan sites list new East US realms opening at ${D.wipe.openingsUtc["East US"]} UTC and EU at ${D.wipe.openingsUtc.EU} UTC; your wipe is about 7 days after your own realm opened. Your in-game timer beats any schedule.</p>`)
    + sec("Kept vs lost", `<div class="rr-kl"><div class="rr-kept"><h3>Kept</h3><ul>${D.wipe.kept.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div class="rr-lost"><h3>Lost</h3><ul>${D.wipe.lost.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
<p class="rr-note">${chip("official")} Everything lost is turned into jail time and Authority. ${esc(D.wipe.disputed)}</p>`)
    + sec("Cash to jail time", `<p class="rr-lead">${chip("data")} 1 year per ${usd(J.dollarsPerYear)} of property, up to ${J.maxYearsPerWipe} years (${usd(J.maxPropertyCounted)}) per wipe. Paying Lenny's ${usd(J.lennyDebt)} debt adds ${J.lennyDebtYears} years once.</p>
<form class="rr-form" id="rr-jail" autocomplete="off" data-per="${J.dollarsPerYear}" data-max="${J.maxYearsPerWipe}"><label>Property at wipe ($)<input type="number" name="v" min="0" step="10000" inputmode="numeric" value="500000"></label></form>
<p class="rr-big" id="rr-jail-out" aria-live="polite"></p>`)
    + sec("Last day", `<ol class="rr-steps"><li>Don't start long builds or research.</li><li>Sell your cargo; sold cash is a sure number.</li><li>Agree with your clan which realm you all join next.</li></ol>`),
  ld: [{ "@type": "HowTo", name: "Find your Rob Run wipe time", step: [{ "@type": "HowToStep", text: "In game, read your realm's Lifetime timer." }, { "@type": "HowToStep", text: "Enter the days, hours and minutes on zoisports.com/robrun/wipe." }, { "@type": "HowToStep", text: "The page shows the local wipe time and a live countdown." }] }],
});

/* ---------- money ---------- */
const L = D.loop;
const money = page({
  slug: "money",
  title: "Rob Run Money Calculator: Contraband Repack Profit — Zoi",
  h1: "Money calculator",
  tag: "The contraband loop, in numbers. Change any input.",
  desc: "Rob Run money calculator for the contraband loop: buy Contraband Cargo, repack it into Premium Cargo, sell to the Smuggler. Profit per crate, per hour and time to your goal.",
  sourceKeys: ["wikiCargo", "rrgCargo", "rrmBench", "rrrContraband", "wikiItems", "wikiMoney", "kefirBank"],
  body: sec("The loop", flow(L.steps) + `<p class="rr-note">${chip("data")} Contraband Cargo goes in, Premium Cargo (or Rarity Cargo) comes out. What decides Rarity isn't confirmed.</p>`)
    + sec("Calculator", `<form class="rr-form rr-calc" id="rr-money" autocomplete="off">
<label>Crates per batch<input type="number" name="n" min="1" max="50" value="2" inputmode="numeric"></label>
<label>Buy price per crate ($)<input type="number" name="buy" min="0" step="1000" value="${L.buy[0].price}" list="rr-buy-list" inputmode="numeric"></label><datalist id="rr-buy-list">${L.buy.map((b) => `<option value="${b.price}">${esc(b.name)}</option>`).join("")}</datalist>
<label>Sell price, level 1 ($)<input type="number" name="out" min="0" step="1000" value="${L.outputs[0].price}" list="rr-out-list" inputmode="numeric"></label><datalist id="rr-out-list">${L.outputs.map((o) => `<option value="${o.price}">${esc(o.name)}</option>`).join("")}</datalist>
<label>Notoriety level<select name="lvl">${L.notorietyBonus.map((b, i) => `<option value="${b}">Level ${i + 1} (+${Math.round(b * 100)}%)</option>`).join("")}</select></label>
<label>Minutes per batch<input type="number" name="min" min="1" max="600" value="${L.repackMinutes.value}" inputmode="numeric"></label>
<label>Laundering cut (%)<input type="number" name="cut" min="0" max="100" value="0" inputmode="numeric"></label>
<label class="rr-wide">Goal ($)<input type="number" name="goal" min="0" step="50000" value="1000000" inputmode="numeric"></label>
</form>
<div class="rr-results" id="rr-money-out" aria-live="polite"></div>
<p class="rr-note">${chip("data")} Buy: ${L.buy.map((b) => `${esc(b.name.toLowerCase())} ${usd(b.price)}`).join(", ")}. Sell: ${L.outputs.map((o) => `${esc(o.name)} ${usd(o.price)}`).join(", ")}, plus your Notoriety bonus.</p><p class="rr-note">${chip("player")} About ${L.repackMinutes.value} minutes per repack with no upgrades. Label Printers make it faster, so lower the minutes if yours is quicker. Your own Laundering Desk takes no cut; Lenny takes a share, and a settlement owner taxes renters. Police can seize cargo on the way (about ${usd(L.seizure.contraband)} per raw crate).</p>`)
    + sec("Bench upgrades", table(["Item", "Research", "Buy", "Effect"], D.bench.map((b) => [esc(b.name), usd(b.research), usd(b.buy), esc(b.effect)])) + `<p class="rr-note">${chip("data")} Upgrade effects are from game-client values reported by fan sites.</p>`),
  ld: [{ "@type": "WebApplication", name: "Rob Run money calculator", applicationCategory: "GameApplication", operatingSystem: "Any", url: SITE + "/robrun/money", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }],
});

/* ---------- base ---------- */
const fuseRows = D.fuses.map((f) => [esc(f.name), String(f.points), f.research == null ? "—" : usd(f.research), f.buy == null ? esc(f.note) : usd(f.buy), f.buy == null ? "—" : `<b>${usd(perPoint(f))}</b>`]);
const fillRows = D.buildings.map((b) => [esc(b.name), String(b.base), String(b.slots), `+${b.slots} for ${usd(b.slots * fuse1.buy)}`, `+${b.slots * fuse2.points} for ${usd(b.slots * fuse2.buy)}`, String(b.max)]);
const base = page({
  slug: "base",
  title: "Rob Run Base Defense: Fuse, Alarm and Building Costs — Zoi",
  h1: "Base costs",
  tag: "What defense costs, per point and per building.",
  desc: "Rob Run base defense costs: Fuse I vs Fuse II price per defense point, fuses to fill each building, alarm prices, building and title costs, station slots.",
  sourceKeys: ["wikiRaid", "wikiItems", "wikiPlot", "rrrContraband", "rrmBench"],
  body: sec("Fuses", table(["Fuse", "Points", "Research", "Buy", "Per point"], fuseRows) + `<p class="rr-note">${chip("data")} Prices. ${chip("player")} Points per fuse. Research is paid once per wipe.</p>`)
    + sec("Fill a building", table(["Building", "Base", "Slots", "All Fuse I", "All Fuse II", "Max"], fillRows) + `<p class="rr-note">${chip("player")} Defense and slots. Max is every slot on Fuse III. Each defense point is one more Decoder I the raider needs.</p>`)
    + sec("Alarms", table(["Alarm", "Research", "Buy", "What it does"], D.alarms.map((a) => [esc(a.name), usd(a.research), usd(a.buy), esc(a.effect)])) + `<p class="rr-note">${chip("data")} Alarms add no defense; they only warn you. Clan Alarm unlocks after the Personal Alarm.</p>`)
    + sec("Buildings", table(["Building", "Research", "Buy", "Total", "Stations"], D.buildings.map((b) => [esc(b.name), b.research == null ? "—" : usd(b.research), b.buy == null ? "—" : usd(b.buy), b.research == null || b.buy == null ? "—" : `<b>${usd(total(b))}</b>`, b.stations == null ? "—" : String(b.stations)])) + `<p class="rr-note">${chip("data")} Prices. ${chip("player")} Stations = how many workbenches the building holds.</p>`)
    + sec("Titles", table(["Title", "Research", "Buy", "Total"], D.titles.map((t) => [esc(t.name), usd(t.research), usd(t.buy), `<b>${usd(total(t))}</b>`])) + `<p class="rr-note">${chip("data")} A plot title lets you rent in a district of that level. A settlement title buys the whole settlement.</p>`),
});

/* ---------- guides ---------- */
const by = (n) => [...D.bench, ...D.alarms, ...D.buildings, ...D.titles].find((x) => x.name === n);
const order = [
  ["Land Plot Title I", total(by("Land Plot Title I")), "Your base. Players report a free Trailer comes with it."],
  ["Contraband Workbench", total(by("Contraband Workbench")), "Start the loop right away."],
  ["Label Printer", total(by("Label Printer (Uncommon)")), "Faster repacks."],
  ["Banknote Counter", total(by("Banknote Counter")), "Faster laundering."],
  ["Fuse I × 9 on the Trailer", fuse1.research + 9 * fuse1.buy, "Research once, then 9 fuses."],
  ["Personal Alarm", total(by("Personal Alarm")), "Know when a raid starts."],
  ["Tool Box (Epic)", total(by("Tool Box (Epic)")), "Second crate per bench."],
  ["Small House", total(by("Small House")), "Two stations, 15 base defense."],
];
let run = 0;
const orderRows = order.map(([n, c, why], i) => { run += c; return [`${i + 1}. ${esc(n)}`, usd(c), usd(run), esc(why)]; });
const guides = page({
  slug: "guides",
  title: "Rob Run Guides: Early-Wipe Spend Order, Stack and Bank — Zoi",
  h1: "Guides",
  tag: "What to buy first, and how to keep it.",
  desc: "Rob Run strategy: what to buy first after a wipe with running costs, and the stack-and-bank method that keeps your money safe until the Federal Raid.",
  sourceKeys: ["kefirBank", "kefirWipe", "wikiItems", "wikiPlot", "wikiMoney", "wikiWipe", "rrmBench"],
  body: sec("Early-wipe spend order", `<p class="rr-lead">${chip("zoi")} Our order for a small clan. Prices are ${chip("data")}.</p>` + table(["Buy", "Cost", "Running", "Why"], orderRows) + `<p class="rr-note">Clan of 2 or more? Add the Clan Alarm (${usd(total(by("Clan Alarm")))}) after the Personal Alarm.</p>`)
    + sec("Stack and bank", `<ol class="rr-steps">
<li><b>Launder after every run.</b> ${chip("official")} Money in the bank can't be stolen by players until the wipe.</li>
<li><b>Keep nothing at the base.</b> Cash and cargo there can be raided.</li>
<li><b>Sell before the wipe.</b> Each ${usd(J.dollarsPerYear)} you hold then is +1 year of jail time, up to ${usd(J.maxPropertyCounted)}.</li>
<li><b>Skip big buys on the last day.</b> They won't pay back before the raid.</li>
</ol><p class="rr-note">${chip("official")} Banked cash is wiped too, but it still counts toward your jail time and Authority.</p>`),
  ld: [{ "@type": "HowTo", name: "Rob Run early-wipe spend order", step: order.map(([n, c, why]) => ({ "@type": "HowToStep", name: n, text: `${n} (${usd(c)}): ${why}` })) }],
});

/* ---------- settings ---------- */
const S = D.settings;
const settings = page({
  slug: "settings",
  title: "Best Rob Run Settings for Laptops (Competitive FPS) — Zoi",
  h1: "Settings",
  tag: "Competitive settings for mid laptops.",
  desc: "Best Rob Run settings for competitive play on a mid-range gaming laptop: what to turn down, what to turn off, and how to cap your frame rate. Plus minimum specs.",
  sourceKeys: ["wikiFps"],
  body: sec("In-game", `<p class="rr-lead">${chip("zoi")} ${esc(S.for)}.</p>` + table(["Setting", "Set to", "Why"], S.rows.map((r) => [esc(r[0]), `<b>${esc(r[1])}</b>`, esc(r[2])])))
    + sec("Outside the game", `<ul class="rr-steps">${S.extra.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="rr-note">${chip("official")} Minimum: ${esc(S.minimum)}. Recommended: ${esc(S.recommended)}.</p>`),
});

const out = { "robrun.html": hub, "robrun/wipe.html": wipe, "robrun/money.html": money, "robrun/base.html": base, "robrun/guides.html": guides, "robrun/settings.html": settings };
const check = process.argv.includes("--check");
let stale = 0;
for (const [f, html] of Object.entries(out)) {
  const p = join(pub, f);
  if (check) { let cur = ""; try { cur = readFileSync(p, "utf8"); } catch {} if (cur !== html) { stale++; console.error("stale: public/" + f); } }
  else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, html); console.log("wrote public/" + f); }
}
if (check && stale) process.exit(1);
