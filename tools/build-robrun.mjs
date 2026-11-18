#!/usr/bin/env node
/* Builds zoisports.com/robrun: the fresh-wipe buy order for ROB RUN.

   Everything on the page lives in public/robrun/data.json. Only put things there
   the game does not already show you (no price lists). After a patch, edit it,
   bump `updated`, then run:  node tools/build-robrun.mjs
   The page is plain static HTML, so commit the regenerated file with the data.
   `--check` exits 1 if public/robrun.html is out of date with the data. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const D = JSON.parse(readFileSync(join(pub, "robrun/data.json"), "utf8"));
const SITE = "https://zoisports.com", URL_ = SITE + "/robrun", CSS_V = 59;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const LABELS = { official: ["Kefir", "Official, from Kefir"], data: ["Game data", "From the game files, via fan wikis"], player: ["Player report", "Not confirmed by Kefir or the game files"], zoi: ["Zoi tip", "Our own advice"] };
const chip = (l) => `<span class="rr-chip rr-${l}" title="${esc(LABELS[l][1])}">${LABELS[l][0]}</span>`;
const updatedHuman = new Date(D.updated + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const groupItems = (sec) => sec.groups.flatMap((g) => g.items);
const BR = D.bestRuns;
const all = [...D.plan, D.growCore, ...D.cars, ...D.rentOwn, ...D.plotSpace, ...D.tips, ...D.lastDay, ...BR.tips, { label: "player", src: BR.rankedSrc }, ...groupItems(D.duo), ...groupItems(D.raids)];
const usedSrc = [...new Set(all.flatMap((x) => x.src || []))];
const usedLabels = [...new Set(all.map((x) => x.label))];
const li = (x) => `<li>${esc(x.text)} ${chip(x.label)}</li>`;

const title = "Rob Run Guide: Best Buy Order After a Wipe, Best Runs, Raid Defense — Zoi";
const desc = "Rob Run guide: the best buy order after a wipe with running costs and payback, cars, renting vs owning, the best-paying runs, a duo playbook, and raid defense.";
const ld = { "@context": "https://schema.org", "@graph": [
  { "@type": "HowTo", "@id": URL_, url: URL_, name: "Best buy order after a Rob Run wipe", description: desc, dateModified: D.updated, inLanguage: "en",
    about: { "@type": "VideoGame", name: "Rob Run", publisher: { "@type": "Organization", name: "Kefir" }, gamePlatform: "PC (Steam)" },
    publisher: { "@type": "SportsOrganization", name: "Zoi", url: SITE + "/" },
    step: D.plan.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.do, text: s.why })) },
  { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Zoi", item: SITE + "/" }, { "@type": "ListItem", position: 2, name: "Rob Run", item: URL_ }] },
] };

const groups = (sec) => sec.groups.map((g) => `<h3 class="rr-gh">${esc(g.h)}</h3><ul class="rr-steps">${g.items.map(li).join("")}</ul>`).join("");
const rankRows = (rows) => rows.map((r) => `<li><div class="rr-rank-top"><b>${esc(r.name)}</b><span>${esc(r.rate)}</span></div><p>${esc(r.note)}</p></li>`).join("");
const bestRuns = `<p class="rr-lead">${esc(BR.lead)} ${chip("player")}</p>
<ol class="rr-rank">${rankRows(BR.ranked)}</ol>
<h3 class="rr-gh">Per job, not per hour</h3><ul class="rr-rank rr-rank-plain">${rankRows(BR.perJob)}</ul>
<h3 class="rr-gh">Make each run pay more</h3><ul class="rr-steps">${BR.tips.map(li).join("")}</ul>
<p class="rr-unknown"><b>Unknown:</b> ${esc(BR.unknown)}</p>`;
const steps = D.plan.map((s) => `<li><h3>${esc(s.do)}</h3><p>${esc(s.why)} ${chip(s.label)}</p><p class="rr-need">Costs ${usd(s.cost)} · total ${usd(s.need)} · pays back: ${esc(s.pays)}</p></li>`).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#050506">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/favicon-32.png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=9">
<link rel="canonical" href="${URL_}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${URL_}"><meta property="og:image" content="${SITE}/assets/og.jpg?v=9"><meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<link rel="stylesheet" href="/styles.css?v=${CSS_V}">
</head>
<body class="rr">
<header class="nav"><a href="/" class="brand"><img class="zw" src="/assets/zoi-wordmark-gold.png?v=10" alt="Zoi" width="600" height="320"></a>
<nav><a href="/#about">About</a><a href="/#roster">Roster</a><a href="/#tryouts">Rush</a><a href="/#events">Events</a><a href="/#socials">Socials</a><a href="/results">Results</a><a href="/robrun" class="nav-rr" aria-current="page">Rob Run</a><a href="/lab">Lab</a><a href="/shop">Shop</a></nav>
<div class="nav-end"><button class="menu" aria-label="Menu" aria-expanded="false">☰</button><button class="acct-btn" type="button" id="acct-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Your account" hidden><span class="acct-initial" id="acct-initial">?</span></button></div></header>
<main id="top">
<section class="shop-hero rr-hero"><p class="page-chapter"><span class="gr">ΖΩΗ</span><span class="dot" aria-hidden="true">·</span>Rob Run</p><h1 class="page-h1">Best buy order after a wipe</h1><p class="tag">For a duo. The Grow Room is the core. Buy in this order and keep $100k cash on hand.</p></section>
<div class="stripes" aria-hidden="true"></div>
<nav class="rr-jump" aria-label="On this page"><a href="#plan">Plan</a><a href="#land">Land</a><a href="#runs">Best runs</a><a href="#duo">Duo</a><a href="#raids">Raids</a></nav>
<section class="rr-sec" id="plan"><h2>The buy order</h2>
<p class="rr-lead">${esc(D.growCore.text)} ${chip(D.growCore.label)}</p>
<p class="rr-note rr-pays">${esc(D.paysNote)}</p>
<ol class="rr-plan">
${steps}
</ol></section>
<section class="rr-sec"><h2>Cars</h2><ul class="rr-steps">${D.cars.map(li).join("")}</ul></section>
<section class="rr-sec" id="land"><h2>Rent or own</h2><ul class="rr-steps">${D.rentOwn.map(li).join("")}</ul>
<h3 class="rr-gh">Grow Room or Workshop</h3><ul class="rr-steps">${D.plotSpace.map(li).join("")}</ul></section>
<section class="rr-sec"><h2>Tips</h2><ul class="rr-steps">${D.tips.map(li).join("")}</ul></section>
<section class="rr-sec"><h2>Last day</h2><ul class="rr-steps">${D.lastDay.map(li).join("")}</ul></section>
<section class="rr-sec" id="runs"><h2>Best runs</h2>${bestRuns}</section>
<section class="rr-sec" id="duo"><h2>Duo playbook</h2><p class="rr-lead">${esc(D.duo.lead)}</p>${groups(D.duo)}</section>
<section class="rr-sec" id="raids"><h2>Raid defense</h2><p class="rr-lead">${esc(D.raids.lead)}</p>${groups(D.raids)}</section>
<section class="rr-sec rr-sources"><p class="rr-legend">${usedLabels.map(chip).join(" ")}</p>
<p class="small">Sources: ${usedSrc.map((k) => `<a href="${esc(D.sources[k].url)}" rel="noopener" target="_blank">${esc(D.sources[k].name)}</a>`).join(" · ")}</p>
<p class="small">Last updated ${updatedHuman} · game version ${esc(D.gameVersion)} (Early Access)</p></section>
</main>
<footer><div class="stripes" aria-hidden="true"></div><img src="/assets/zoi-icon.png?v=9" alt="" width="48" height="48"><p>Zoi · ζωή · life</p><p class="small">Contact: <a href="mailto:hello@zoisports.com">hello@zoisports.com</a></p><p class="small">© 2026 Zoi. All rights reserved. · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p><p class="small">Zoi is not affiliated with or endorsed by Kefir. ROB RUN is a trademark of its owner. This is a fan guide.</p></footer>
<script src="/main.js?v=23" defer></script>
<script src="/account.js?v=7" defer></script>
</body>
</html>
`;

const p = join(pub, "robrun.html");
if (process.argv.includes("--check")) {
  let cur = ""; try { cur = readFileSync(p, "utf8"); } catch {}
  if (cur !== html) { console.error("stale: public/robrun.html"); process.exit(1); }
} else { writeFileSync(p, html); console.log("wrote public/robrun.html"); }
