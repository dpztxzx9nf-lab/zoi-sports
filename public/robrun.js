/* Rob Run hub tools: wipe countdown, jail-time and money calculators.
   Numbers come from the page itself (built from public/robrun/data.json). */
(() => {
const $ = (id) => document.getElementById(id);
const usd = (n) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
const num = (el) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : 0; };

/* ---- wipe countdown: Lifetime timer -> absolute time, kept on this device ---- */
const wf = $('rr-wipe');
if (wf) {
  const KEY = 'zoi-rr-wipe-at', out = $('rr-wipe-out'), cnt = $('rr-wipe-count'), at = $('rr-wipe-at');
  let tick = null;
  const fmtLeft = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (d ? d + 'd ' : '') + h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(x).padStart(2, '0') + 's'; };
  const show = (t) => {
    out.hidden = false;
    at.textContent = 'Wipes ' + new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    clearInterval(tick);
    const draw = () => { const left = t - Date.now(); cnt.textContent = left > 0 ? fmtLeft(left) : 'Wiped. Set your new timer.'; if (left <= 0) clearInterval(tick); };
    draw(); tick = setInterval(draw, 1000);
  };
  const saved = parseInt(localStorage.getItem(KEY) || '', 10);
  if (saved && saved > Date.now() - 864e5) show(saved);
  wf.addEventListener('submit', (e) => {
    e.preventDefault();
    const ms = ((num(wf.elements.d) * 24 + num(wf.elements.h)) * 60 + num(wf.elements.m)) * 60000;
    if (ms <= 0) { at.textContent = 'Enter the time left on your Lifetime timer.'; out.hidden = false; cnt.textContent = ''; return; }
    const t = Date.now() + ms; localStorage.setItem(KEY, String(t)); show(t);
  });
  $('rr-wipe-clear').addEventListener('click', () => { localStorage.removeItem(KEY); clearInterval(tick); out.hidden = true; });
}

/* ---- property -> jail years ---- */
const jf = $('rr-jail');
if (jf) {
  const per = +jf.dataset.per, max = +jf.dataset.max, o = $('rr-jail-out');
  const run = () => { const y = Math.min(max, Math.floor(num(jf.elements.v) / per)); o.textContent = y + (y === 1 ? ' year' : ' years') + (y >= max ? ' (max)' : ''); };
  jf.addEventListener('input', run); jf.addEventListener('submit', (e) => e.preventDefault()); run();
}

/* ---- contraband loop ---- */
const mf = $('rr-money');
if (mf) {
  const o = $('rr-money-out');
  const run = () => {
    const n = Math.max(1, num(mf.elements.n)), buy = num(mf.elements.buy), sell = num(mf.elements.out) * (1 + num(mf.elements.lvl));
    const mins = Math.max(1, num(mf.elements.min)), cut = Math.min(100, Math.max(0, num(mf.elements.cut))) / 100, goal = num(mf.elements.goal);
    const perCrate = sell * (1 - cut) - buy, perBatch = perCrate * n, perHour = perBatch * 60 / mins;
    const batches = perBatch > 0 ? Math.ceil(goal / perBatch) : Infinity;
    const hrs = batches * mins / 60;
    const rows = [
      ['Profit per crate', usd(perCrate)],
      ['Profit per batch', usd(perBatch)],
      ['Per hour', usd(perHour)],
      ['Cash to start a batch', usd(buy * n)],
      ['Batches to goal', Number.isFinite(batches) ? String(batches) : '—'],
      ['Time to goal', Number.isFinite(hrs) ? (hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1) + ' h') : '—'],
    ];
    o.replaceChildren(...rows.map(([k, v], i) => { const d = document.createElement('div'); if (i === 2) d.className = 'rr-hl'; const s = document.createElement('span'); s.textContent = k; const b = document.createElement('b'); b.textContent = v; d.append(s, b); return d; }));
  };
  mf.addEventListener('input', run); mf.addEventListener('change', run); mf.addEventListener('submit', (e) => e.preventDefault()); run();
}
})();
