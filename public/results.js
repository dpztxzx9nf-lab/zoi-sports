/* Results page: renders /results.json into the two game panels.
   Data lives in public/results.json and is written by tools/log-match.mjs. */
(() => {
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const GAME_TABS = [...document.querySelectorAll('.game-tabs [role=tab]')];
const summary = document.getElementById('res-summary');
const updatedLine = document.getElementById('res-updated');

/* "2026-10-28" -> "28 October 2026". Split by hand so a date never shifts a day through UTC. */
const fmtDate = iso => {
 const [y, m, d] = String(iso || '').split('-').map(Number);
 if (!y || !m || !d || m < 1 || m > 12) return String(iso || '');
 return `${d} ${MONTHS[m - 1]} ${y}`;
};

const panels = GAME_TABS.map(t => document.getElementById(t.getAttribute('aria-controls')));

/* ---- tabs: same behaviour as the roster tabs in main.js, own copy ---- */
const selectTab = (tab, focus) => {
 GAME_TABS.forEach(t => {
  const on = t === tab;
  t.setAttribute('aria-selected', on ? 'true' : 'false');
  t.tabIndex = on ? 0 : -1;
  const p = document.getElementById(t.getAttribute('aria-controls'));
  if (p) p.hidden = !on;
 });
 if (focus) tab.focus();
 renderSummary();
};

GAME_TABS.forEach((tab, i) => {
 tab.addEventListener('click', () => selectTab(tab, false));
 tab.addEventListener('keydown', e => {
  const n = GAME_TABS.length;
  let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % n;
  else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = n - 1;
  if (j === null) return;
  e.preventDefault();
  selectTab(GAME_TABS[j], true);
 });
});

/* ---- state ---- */
let events = [];

const eventsFor = game => events.filter(e => e.game === game);

/* ---- summary: computed from the data, never written by hand ---- */
function renderSummary() {
 const active = GAME_TABS.find(t => t.getAttribute('aria-selected') === 'true');
 if (!active) return;
 const game = active.textContent.trim();
 const list = eventsFor(game);
 const matches = list.flatMap(e => e.matches || []);
 if (!matches.length) {
  summary.hidden = true;
  summary.replaceChildren();
  return;
 }
 const total = (key) => matches.reduce((sum, m) => sum + (Number(m[key]) || 0), 0);
 const played = matches.length;
 const elims = total('eliminations');
 const placementSum = total('placement');
 const avg = placementSum / played;
 const best = Math.min(...matches.map(m => Number(m.placement) || 0).filter(v => v > 0));
 const tiles = [
  ['Matches played', String(played)],
  ['Eliminations', String(elims)],
  ['Average placement', avg.toFixed(1)],
  ['Best placement', Number.isFinite(best) ? String(best) : '—'],
  ['Events', String(list.length)]
 ];
 summary.replaceChildren(...tiles.map(([label, value]) => {
  const tile = document.createElement('div');
  tile.className = 'res-stat';
  const v = document.createElement('span');
  v.className = 'res-stat-v';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'res-stat-l';
  l.textContent = label;
  tile.append(v, l);
  return tile;
 }));
 summary.hidden = false;
}

/* ---- one event card ---- */
function eventCard(ev) {
 const matches = [...(ev.matches || [])].sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0));
 const card = document.createElement('article');
 card.className = 'res-event';

 const h = document.createElement('h3');
 h.className = 'res-event-h';
 h.textContent = ev.name || 'Untitled event';
 card.append(h);

 const meta = document.createElement('p');
 meta.className = 'res-meta';
 const bits = [fmtDate(ev.date)];
 if (ev.format) bits.push(ev.format);
 /* only add the count when the format line doesn't already say it */
 if (!/match/i.test(ev.format || '')) bits.push(matches.length === 1 ? '1 match' : `${matches.length} matches`);
 meta.textContent = bits.join(' · ');
 card.append(meta);

 if (ev.notes) {
  const note = document.createElement('p');
  note.className = 'res-note';
  note.textContent = ev.notes;
  card.append(note);
 }

 if (!matches.length) {
  const p = document.createElement('p');
  p.className = 'res-status';
  p.textContent = 'No matches logged for this event yet.';
  card.append(p);
  return card;
 }

 const wrap = document.createElement('div');
 wrap.className = 'res-tbl-wrap';
 const table = document.createElement('table');
 table.className = 'tbl res-tbl';
 const caption = document.createElement('caption');
 caption.className = 'res-caption';
 caption.textContent = `Match log for ${ev.name || 'event'}`;
 table.append(caption);

 const thead = document.createElement('thead');
 const hr = document.createElement('tr');
 ['Match', 'Placement', 'Eliminations', 'Field', 'Points', 'Notes'].forEach((label, i) => {
  const th = document.createElement('th');
  th.scope = 'col';
  th.textContent = label;
  if (i > 0 && i < 5) th.className = 'num';
  hr.append(th);
 });
 thead.append(hr);
 table.append(thead);

 const tbody = document.createElement('tbody');
 matches.forEach(m => {
  const tr = document.createElement('tr');
  const cell = (value, cls) => {
   const td = document.createElement('td');
   if (cls) td.className = cls;
   td.textContent = value === undefined || value === null ? '' : String(value);
   return td;
  };
  tr.append(
   cell(m.n, 'num'),
   cell(m.placement, 'num strong'),
   cell(m.eliminations, 'num'),
   cell(m.field, 'num'),
   cell(m.points, 'num strong'),
   cell(m.note || '', 'note')
  );
  tbody.append(tr);
 });
 table.append(tbody);
 wrap.append(table);
 card.append(wrap);
 return card;
}

/* ---- fill one panel ---- */
function fillPanel(panel, message) {
 const status = panel.querySelector('.res-status');
 const list = panel.querySelector('.res-list');
 list.replaceChildren();
 if (message) {
  status.hidden = false;
  status.textContent = message;
  return;
 }
 const game = panel.dataset.game;
 const list_ = eventsFor(game).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
 status.hidden = true;
 status.textContent = '';
 if (!list_.length) {
  status.hidden = false;
  status.className = 'res-status res-empty';
  status.replaceChildren();
  const l1 = document.createElement('p');
  l1.textContent = 'No matches logged yet.';
  const l2 = document.createElement('p');
  l2.className = 'res-empty-sub';
  l2.textContent = 'Results go up here as scrims and tournaments happen.';
  status.append(l1, l2);
  return;
 }
 status.className = 'res-status';
 list.append(...list_.map(eventCard));
}

/* ---- boot ---- */
async function boot() {
 try {
  const res = await fetch('/results.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.events)) throw new Error('Unexpected results shape');
  events = data.events;
  if (data.updated) {
   updatedLine.textContent = `Updated ${fmtDate(data.updated)}`;
   updatedLine.hidden = false;
  } else {
   updatedLine.hidden = true;
  }
  panels.forEach(p => fillPanel(p));
  renderSummary();
 } catch (err) {
  panels.forEach(p => fillPanel(p, 'Results could not be loaded. Reload the page to try again.'));
  summary.hidden = true;
  summary.replaceChildren();
 }
}

boot();
})();
