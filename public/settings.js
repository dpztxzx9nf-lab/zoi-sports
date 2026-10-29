/* The settings page: its tabs, the description strip, and the values themselves.
   ---------------------------------------------------------------------------
   The markup ships with a full set of numbers already in it, and that is on
   purpose: the page reads correctly with JavaScript off, and if the read below
   fails it stays exactly as written. What the read does is replace those numbers
   with the player's own, by data-key, so the page and the account menu's Game
   settings tab are showing the same thing.

   Nothing here builds a row. Every value lands in a span that is already in the
   document, so the page's structure, its descriptions and its layout are the
   author's, not the network's. A key the page does not carry is skipped, and a
   value the page cannot draw is skipped too - one odd row must not blank the
   rest of the page. */
(()=>{
const bar=document.querySelector('.fn-tabs'),tabs=[...document.querySelectorAll('.fn-tabs [role=tab]')];
if(!bar||!tabs.length)return;
const sel=(t,focus)=>{tabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on?'true':'false');x.tabIndex=on?0:-1;const p=document.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=!on});if(focus)t.focus()};
tabs.forEach((t,i)=>{
 t.addEventListener('click',()=>sel(t));
 t.addEventListener('keydown',e=>{
  const n=tabs.length;let j=null;
  if(e.key==='ArrowRight')j=(i+1)%n;
  else if(e.key==='ArrowLeft')j=(i-1+n)%n;
  else if(e.key==='Home')j=0;
  else if(e.key==='End')j=n-1;
  if(j===null)return;
  e.preventDefault();sel(tabs[j],true);
 });
});
sel(tabs.find(t=>t.getAttribute('aria-selected')==='true')||tabs[0]);
})();

/* description strip: the hovered row's data-desc, on hover and on focus */
(()=>{
const out=document.getElementById('fn-desc');
if(!out)return;
const def=out.getAttribute('data-default')||out.textContent;
const rows=[...document.querySelectorAll('.fn-row[data-desc],.fn-bind[data-desc],.dg-btn[data-desc]')];
const show=r=>{const d=r.getAttribute('data-desc');out.textContent=d||def};
const reset=()=>{out.textContent=def};
rows.forEach(r=>{
 r.addEventListener('mouseenter',()=>show(r));
 r.addEventListener('focus',()=>show(r));
 r.addEventListener('mouseleave',reset);
 r.addEventListener('blur',reset);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')reset()});
})();

/* Whose settings these are: ?p=<slug>, or Kneczi's when the page is opened bare.
   The slug is taken from the address rather than from roster.js, because a player
   can save settings before they have a card, and a card list baked into this file
   would only ever know the players who were here when it was written. Whether the
   slug names anybody is the API's question to answer: a 404 leaves the baked
   numbers alone, and the baked numbers are Kneczi's, whose name is on them. */
const who=(()=>{
const want=(new URLSearchParams(location.search).get('p')||'').trim().toLowerCase();
return /^[a-z0-9][a-z0-9-]{0,31}$/.test(want)?want:'kneczi';
})();

(()=>{
const tag=document.getElementById('set-tag');
if(!tag)return;
fetch('/api/roster',{headers:{accept:'application/json'}})
 .then(r=>r.ok?r.json():null)
 .then(j=>{
  const list=j&&Array.isArray(j.players)?j.players:null;if(!list)return;
  const row=list.find(x=>x&&x.slug===who&&x.gamertag);if(!row)return;
  tag.textContent=row.gamertag+"'s live Zero Build setup, read straight off the PC.";
 })
 .catch(()=>{});
})();

/* The values themselves. One request for the whole set, matched onto the page by
   data-key. The server sends each one already printed - the exact text the page
   should show, and the slider's fill class - so this block only puts them in
   place. Working the fill out here instead would mean a second copy of the fill
   rule in the browser, and a thumb a pixel off from the number beside it.

   A failure is silent by design: the page is still a full, correct set of
   numbers, just the ones it was written with. That is better than a page of
   dashes, and it is the same behaviour the page had before any of this existed. */
(() => {
const rows = new Map();
for (const n of document.querySelectorAll('.fn-row[data-key]')) rows.set(n.getAttribute('data-key'), n);
for (const n of document.querySelectorAll('.fn-bind[data-key]')) rows.set(n.getAttribute('data-key'), n);
if (!rows.size) return;

/* One row, one value. The node's shape says what to write into: an enum row has
   a .fn-eval, a slider a .fn-num, a bind a .fn-key. A row whose shape does not
   match the data is skipped rather than half-written, so a page with one odd row
   still draws the other eighty-three. */
const put = (node, cell) => {
  if (!node || !cell || typeof cell !== 'object' || typeof cell.text !== 'string') return false;
  const ev = node.querySelector('.fn-eval');
  if (ev) { ev.textContent = cell.text; return true; }
  const b = node.querySelector('.fn-bool');
  if (b) { b.textContent = cell.text; b.classList.toggle('fn-on', cell.text === 'On'); return true; }
  const num = node.querySelector('.fn-num');
  if (num) { num.textContent = cell.text; return true; }
  const plain = node.querySelector('.fn-plain');
  if (plain) { plain.textContent = cell.text; return true; }
  const key = node.querySelector('.fn-key');
  if (key) { key.textContent = cell.text; return true; }
  return false;
};

/* The fill class on a slider is the one thing that is not its text: it is the
   thumb's position, and the server sends it alongside. */
const fill = (node, cell) => {
  if (!cell || typeof cell.fill !== 'string') return;
  const slider = node.querySelector('.fn-slider');
  if (!slider) return;
  for (const c of [...slider.classList]) if (/^f\d+$/.test(c)) slider.classList.remove(c);
  slider.classList.add(cell.fill);
};

/* "Read 28 October 2026" is when the numbers were taken, not when this page was
   built, so a saved set moves it. Left alone when the API has no date to give. */
const dated = (stamp) => {
  const read = document.getElementById('set-read');
  if (!read || typeof stamp !== 'string' || !stamp) return;
  const iso = stamp.indexOf('T') === -1 ? stamp.replace(' ', 'T') + 'Z' : stamp;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return;
  read.textContent = 'Read ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

fetch('/api/settings?p=' + encodeURIComponent(who), { headers: { accept: 'application/json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    const display = j && j.display && typeof j.display === 'object' && !Array.isArray(j.display) ? j.display : null;
    if (!display) return;
    rows.forEach((node, key) => {
      const cell = display[key];
      if (!cell) return;
      if (put(node, cell)) fill(node, cell);
    });
    /* The name in the heading and the tab both belong to whoever answered. The
       baked page names Kneczi because his numbers are what is written into it;
       a page about somebody else must not keep his name in the title. */
    if (typeof j.gamertag === 'string' && j.gamertag) {
      const tag = document.getElementById('set-tag');
      if (tag) tag.textContent = j.gamertag + "'s live Zero Build setup, read straight off the PC.";
      document.title = j.gamertag + "'s game settings — Zoi";
    }
    dated(j.updated_at);
  })
  .catch(() => {});
})();
