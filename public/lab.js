/* Settings Lab: what the readings add up to.
   Sign-in happens at the edge (Cloudflare Access). This file only reads:
   the changes recorded, and the numbers measured around them. */
(() => {

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
const show = n => { n.hidden = false; };
const hide = n => { n.hidden = true; };

const state = { perf: null, tokens: [] };
const nodes = {
  who: $('who'),
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), figures: $('figures'), figuresNote: $('figures-note'),
  chartWin: $('chart-win'), chartWinBox: $('chart-win-box'),
  chartKd: $('chart-kd'), chartKdBox: $('chart-kd-box'),
  chartKey: $('chart-key'), chartEmpty: $('chart-empty'),
  changes: $('changes'), ranked: $('ranked'),
  pcConnect: $('pc-connect'), pcLabel: $('pc-label'), pcAdd: $('pc-add'),
  pcErrors: $('pc-errors'), pcToken: $('pc-token'), pcTokenValue: $('pc-token-value'),
  pcCopy: $('pc-copy'), pcDone: $('pc-done'), pcCopied: $('pc-copied'),
  pcList: $('pc-list'), pcEmpty: $('pc-empty'), pcStats: $('pc-stats'),
};

class AuthError extends Error {}
class NetError extends Error {}

async function api(path, options) {
  const opt = options || {};
  const headers = {};
  if (opt.body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method: opt.method || 'GET', headers, body: opt.body === undefined ? undefined : JSON.stringify(opt.body) });
  } catch { throw new NetError('offline'); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401) throw new AuthError('unauthorized');
  return { ok: res.ok, status: res.status, data };
}

const errorsFrom = (data, fallback) => {
  if (data && Array.isArray(data.errors) && data.errors.length) return data.errors.map(String);
  if (data && typeof data.error === 'string' && data.error) return [data.error];
  return [fallback];
};
const showErrors = (list, messages) => {
  list.replaceChildren();
  for (const m of messages) list.append(el('li', null, m));
  show(list);
};
const clearErrors = list => { list.replaceChildren(); hide(list); };

/* ---------- formatting ---------- */

/* D1 writes UTC with no marker on it; add one so the browser converts it. */
const timeOf = value => {
  const s = String(value || '').trim();
  if (!s) return NaN;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  return Date.parse(iso);
};

const fmtDay = value => {
  const ms = timeOf(value);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'America/Denver' }).format(new Date(ms));
};

const fmtDayYear = value => {
  const ms = timeOf(value);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Denver' }).format(new Date(ms));
};

const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* A rate as a percentage with one decimal below 10%: an aim change often moves
   win rate by a point or two, and rounding 8.4% to 8% would hide it. */
const pct = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '\u2014';
  const p = v * 100;
  return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
};

const points = d => {
  if (typeof d !== 'number' || !Number.isFinite(d)) return '';
  const p = Math.abs(d) * 100;
  const shown = p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return (d > 0 ? '+' : '\u2212') + shown;
};

const kd = v => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '\u2014');

const matchesWord = n => group(n) + (n === 1 ? ' game' : ' games');

/* ---------- load ---------- */

let signInNeeded = false;

function failLoad(message) {
  nodes.loadErrorText.textContent = message;
  show(nodes.loadError);
  hide(nodes.app);
}

function needSignIn() {
  signInNeeded = true;
  hide(nodes.who);
  failLoad('Your sign-in expired. Reload the page to sign in again.');
}

async function load() {
  hide(nodes.loadError);
  let r;
  try {
    r = await api('/api/lab/performance');
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return false; }
    failLoad("Couldn't reach the lab. Check the connection and try again.");
    return false;
  }
  if (!r.ok) {
    failLoad(errorsFrom(r.data, "Couldn't load the numbers. Try again.").join(' '));
    return false;
  }
  state.perf = r.data || {};
  showWho(r.data && r.data.me);
  signInNeeded = false;
  hide(nodes.loadError);
  show(nodes.app);
  render();
  return true;
}

function showWho(me) {
  const seen = me && typeof me === 'object' ? String(me.email || me.name || '').trim() : '';
  nodes.who.textContent = seen ? 'Signed in as ' + seen + '.' : '';
  if (seen) show(nodes.who); else hide(nodes.who);
}

/* ---------- lifetime figures ---------- */

function figure(k, v, sub) {
  const box = el('div', 'lab-fig');
  box.append(el('span', 'lab-fig-k', k), el('span', 'lab-fig-v', v));
  if (sub) box.append(el('span', 'lab-fig-sub', sub));
  return box;
}

function renderFigures() {
  const L = state.perf && state.perf.lifetime;
  nodes.figures.replaceChildren();
  if (!L || !(L.matches > 0)) {
    nodes.figures.append(el('p', 'lab-empty', 'No numbers yet. They arrive with the first sync from your PC.'));
    hide(nodes.figuresNote);
    return;
  }
  const sub = L.wins !== null ? group(L.wins) + (L.wins === 1 ? ' win' : ' wins') : '';
  nodes.figures.append(
    figure('Games', group(L.matches), sub),
    figure('Win rate', pct(L.win_rate)),
    figure('K/D', kd(L.kd)),
    figure('Kills', L.kills !== null ? group(L.kills) : '\u2014'),
  );

  const sessions = state.perf.sessions || 0;
  const note = sessions
    ? 'Split into ' + sessions + (sessions === 1 ? ' session' : ' sessions') + ' so far, one per gap between syncs.'
    : 'Still one reading. Play a few games and it splits into sessions.';
  nodes.figuresNote.textContent = note;
  show(nodes.figuresNote);
}

/* ---------- charts ----------
   Hand-drawn SVG with presentation attributes, because the page's CSP allows no
   inline styles and no third-party chart script. */
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs || {})) n.setAttribute(k, String(attrs[k]));
  return n;
};
const svgText = (attrs, text) => {
  const n = svg('text', attrs);
  n.textContent = text;
  return n;
};

const W = 320, H = 132;
const PAD = { l: 34, r: 8, t: 10, b: 20 };

/* series: [{ v: number|null, mark: bool }]. x is the session index: a handful of
   sessions spaced evenly reads better than the same handful squashed against a
   date axis, and the axis still names the days underneath. */
function lineChart(series, opts) {
  const box = el('div');
  const points = series.filter(s => typeof s.v === 'number' && Number.isFinite(s.v));
  if (!points.length) {
    box.append(el('p', 'lab-empty', opts.empty || 'Nothing measured yet.'));
    return box;
  }
  const values = points.map(s => s.v);
  const top = Math.max(opts.max || 0, ...values);
  const yMax = top <= 0 ? 1 : top * 1.15;
  const yMin = opts.min || 0;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xAt = i => PAD.l + (series.length <= 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
  const yAt = v => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || '' });

  /* three gridlines, labelled: enough to read a value off, few enough to stay
     legible on a 390px screen. */
  for (let g = 0; g <= 2; g++) {
    const v = yMin + ((yMax - yMin) * g) / 2;
    const y = yAt(v);
    root.append(svg('line', { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: '#ffffff14', 'stroke-width': 1 }));
    root.append(svgText({ x: PAD.l - 5, y: y + 3.5, fill: '#a29f97', 'font-size': 8, 'text-anchor': 'end' }, opts.axis(v)));
  }

  /* a dashed upright at every session that contains a setting change */
  series.forEach((s, i) => {
    if (!s.mark) return;
    const x = xAt(i);
    root.append(svg('line', { x1: x, y1: PAD.t, x2: x, y2: PAD.t + plotH, stroke: '#e6d3a055', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
  });

  /* the line, broken wherever a value is missing rather than bridged */
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const d = run.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
      root.append(svg('path', { d, fill: 'none', stroke: '#ffe08a', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    run = [];
  };
  series.forEach((s, i) => {
    if (typeof s.v !== 'number' || !Number.isFinite(s.v)) { flush(); return; }
    run.push({ x: xAt(i), y: yAt(s.v) });
  });
  flush();

  series.forEach((s, i) => {
    if (typeof s.v !== 'number' || !Number.isFinite(s.v)) return;
    root.append(svg('circle', { cx: xAt(i).toFixed(1), cy: yAt(s.v).toFixed(1), r: s.mark ? 2.8 : 2, fill: s.mark ? '#fffbe0' : '#ffe08a' }));
  });

  if (opts.firstLabel) {
    root.append(svgText({ x: PAD.l, y: H - 6, fill: '#a29f97', 'font-size': 8 }, opts.firstLabel));
  }
  if (opts.lastLabel) {
    root.append(svgText({ x: W - PAD.r, y: H - 6, fill: '#a29f97', 'font-size': 8, 'text-anchor': 'end' }, opts.lastLabel));
  }

  box.append(root);
  return box;
}

function renderCharts() {
  const p = state.perf || {};
  const chart = Array.isArray(p.chart) ? p.chart : [];
  nodes.chartWinBox.replaceChildren();
  nodes.chartKdBox.replaceChildren();

  if (!chart.length) {
    hide(nodes.chartWin);
    hide(nodes.chartKd);
    nodes.chartEmpty.textContent = 'No sessions yet. A session appears once two syncs show different match counts, which means you played in between.';
    show(nodes.chartEmpty);
    hide(nodes.chartKey);
    return;
  }

  show(nodes.chartWin);
  show(nodes.chartKd);
  hide(nodes.chartEmpty);

  const first = chart[0], last = chart[chart.length - 1];
  const firstLabel = fmtDay(first.to);
  const lastLabel = fmtDay(last.to);

  nodes.chartWinBox.append(lineChart(
    chart.map(s => ({ v: s.win_rate, mark: Boolean(s.change) })),
    {
      min: 0,
      max: 0.15,
      label: 'Win rate by session',
      axis: v => Math.round(v * 100) + '%',
      firstLabel, lastLabel,
      empty: 'Win rate needs a win recorded in a session.',
    },
  ));

  /* K/D comes from the same rows; the endpoint carries it per session only when
     the counters allow it, so a session without a death count is a gap. */
  nodes.chartKdBox.append(lineChart(
    chart.map(s => ({ v: typeof s.kd === 'number' ? s.kd : null, mark: Boolean(s.change) })),
    {
      min: 0,
      max: 2,
      label: 'Kills per death by session',
      axis: v => (Math.round(v * 10) / 10).toFixed(1),
      firstLabel, lastLabel,
      empty: 'K/D needs a death counted in a session.',
    },
  ));

  const marks = chart.filter(s => s.change).length;
  nodes.chartKey.textContent = marks
    ? 'Each point is one session. The dashed uprights are where a setting changed.'
    : 'Each point is one session. A dashed upright appears where a setting changes.';
  show(nodes.chartKey);
}

/* ---------- the changes ---------- */

const VERDICT_WORD = { better: 'Better', worse: 'Worse', even: 'No change', 'too-soon': 'Too soon' };

function deltaLine(c) {
  if (c.verdict === 'too-soon') {
    const need = state.perf && state.perf.min_games ? state.perf.min_games : 10;
    const seen = c.after && c.after.matches ? c.after.matches : 0;
    return el('p', 'lab-c-note', 'Not enough games to call it: ' + matchesWord(seen) + ' since the change, ' + need + ' needed on each side.');
  }
  const d = points(c.delta);
  const bits = ['Win rate ' + (c.delta > 0 ? 'up ' : c.delta < 0 ? 'down ' : 'level at ') + d.replace('+', '') + (d === '0' ? '' : ' points')];
  if (typeof c.kd_delta === 'number' && Number.isFinite(c.kd_delta)) {
    const k = c.kd_delta;
    bits.push('K/D ' + (Math.abs(k) < 0.005 ? 'level' : (k > 0 ? 'up ' : 'down ') + Math.abs(k).toFixed(2)));
  }
  return el('p', 'lab-c-note', bits.join('. ') + '.');
}

function beforeAfterRows(c) {
  const wrap = el('div', 'lab-ba');
  const row = (name, b, a) => {
    const line = el('div', 'lab-ba-row');
    line.append(el('span', 'lab-ba-k', name), el('span', 'lab-ba-v', b), el('span', 'lab-ba-arrow', '\u2192'), el('span', 'lab-ba-v', a));
    return line;
  };
  wrap.append(
    row('Games', String(c.before.matches), String(c.after.matches)),
    row('Win rate', pct(c.before.win_rate), pct(c.after.win_rate)),
    row('K/D', kd(c.before.kd), kd(c.after.kd)),
  );
  return wrap;
}

function changeCard(c) {
  const card = el('article', 'lab-change lab-change-' + c.verdict);
  const head = el('div', 'lab-change-head');
  head.append(el('p', 'lab-card-k', c.label || c.setting));
  const badge = el('span', 'lab-tag lab-tag-' + c.verdict, VERDICT_WORD[c.verdict] || c.verdict);
  head.append(badge);
  card.append(head);

  const values = el('p', 'lab-values');
  values.append(el('span', null, c.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, c.to_value));
  card.append(values);

  const when = fmtDayYear(c.started_at);
  if (when) card.append(el('span', 'lab-change-when', when));

  card.append(deltaLine(c));
  card.append(beforeAfterRows(c));

  return card;
}

function renderChanges() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  nodes.changes.replaceChildren();
  if (!list.length) {
    nodes.changes.append(el('p', 'lab-empty', 'No changes recorded yet. Change a setting in Fortnite and the next sync logs it by itself.'));
    return;
  }
  for (const c of list) nodes.changes.append(changeCard(c));
}

/* ---------- which setting actually helped ---------- */

function renderRanked() {
  const ranked = (state.perf && Array.isArray(state.perf.ranked)) ? state.perf.ranked : [];
  nodes.ranked.replaceChildren();
  if (!ranked.length) {
    nodes.ranked.append(el('p', 'lab-empty', 'Nothing to rank yet. This fills in once a change has enough games on both sides.'));
    return;
  }
  const list = el('ol', 'lab-rank');
  for (const g of ranked) {
    const li = el('li', 'lab-rank-row');
    const name = el('span', 'lab-rank-name', g.label || g.setting);
    const d = el('span', 'lab-rank-d', (g.delta > 0 ? '+' : g.delta < 0 ? '\u2212' : '\u00b1') + (Math.round(Math.abs(g.delta) * 1000) / 10) + ' pts');
    const meta = el('span', 'lab-rank-meta', g.better + ' of ' + g.changes + ' better \u00b7 ' + matchesWord(g.matches));
    const line = el('div', 'lab-rank-head');
    line.append(name, d);
    li.append(line, meta);
    list.append(li);
  }
  nodes.ranked.append(list);
}

/* ---------- connected PCs ---------- */
let pcTokens = [];

function whenFrom(value) {
  const ms = timeOf(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function agoText(value) {
  const d = whenFrom(value);
  if (!d) return 'not yet';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 90) return 'a moment ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins === 1 ? 'a minute ago' : mins + ' minutes ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'a day ago' : days + ' days ago';
  const weeks = Math.round(days / 7);
  return weeks === 1 ? 'a week ago' : weeks + ' weeks ago';
}

function showPcErrors(messages) {
  if (!messages.length) { clearErrors(nodes.pcErrors); return; }
  showErrors(nodes.pcErrors, messages);
}

function hideToken() {
  nodes.pcTokenValue.textContent = '';
  hide(nodes.pcCopied);
  hide(nodes.pcToken);
}

function renderPc() {
  nodes.pcList.replaceChildren();
  const live = pcTokens.filter(t => !t.revoked);
  if (!live.length) { show(nodes.pcEmpty); return; }
  hide(nodes.pcEmpty);
  const frag = document.createDocumentFragment();
  for (const t of live) {
    const li = el('li', 'lab-pc-item');
    const who = el('div');
    who.append(el('span', 'lab-pc-name', t.label || 'This PC'));
    const when = t.last_seen_at ? 'Last seen ' + agoText(t.last_seen_at) : 'Not seen yet';
    who.append(el('span', 'lab-pc-when', when));
    const remove = el('button', 'lab-mini', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => revokePc(t, remove));
    li.append(who, remove);
    frag.append(li);
  }
  nodes.pcList.append(frag);
}

const groupThousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function pcStatsLine(stats) {
  if (!stats || !Number.isFinite(stats.matches)) return '';
  const bits = [groupThousands(stats.matches) + (stats.matches === 1 ? ' match' : ' matches') + ' from your Epic account'];
  if (Number.isFinite(stats.win_rate)) {
    const p = stats.win_rate * 100;
    bits.push((p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '% won');
  }
  if (Number.isFinite(stats.wins)) bits.push(groupThousands(stats.wins) + (stats.wins === 1 ? ' win' : ' wins'));
  const when = stats.taken_at ? agoText(stats.taken_at) : '';
  return bits.join(' \u00b7 ') + (when ? ', updated ' + when : '') + '.';
}

function renderStats(stats) {
  const line = pcStatsLine(stats);
  if (!line) { nodes.pcStats.textContent = ''; hide(nodes.pcStats); return; }
  nodes.pcStats.textContent = line;
  show(nodes.pcStats);
}

async function loadStats() {
  try {
    const r = await api('/api/lab/stats');
    if (!r.ok) { renderStats(null); return; }
    renderStats(r.data && r.data.stats ? r.data.stats : null);
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return; }
    renderStats(null);
  }
}

async function loadPc() {
  try {
    const r = await api('/api/lab/token');
    if (!r.ok) { pcTokens = []; renderPc(); return; }
    pcTokens = Array.isArray(r.data && r.data.tokens) ? r.data.tokens : [];
    renderPc();
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return; }
    pcTokens = [];
    renderPc();
  }
}

async function revokePc(token, btn) {
  btn.disabled = true;
  showPcErrors([]);
  try {
    const r = await api('/api/lab/token', { method: 'DELETE', body: { id: token.id } });
    if (!r.ok) { showPcErrors(errorsFrom(r.data, 'Could not remove that PC.')); return; }
    await loadPc();
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return; }
    showPcErrors(["Couldn't reach the log. Nothing was removed."]);
  } finally {
    btn.disabled = false;
  }
}

async function copyToken(btn) {
  const text = nodes.pcTokenValue.textContent || '';
  if (!text || !navigator.clipboard || !navigator.clipboard.writeText) return;
  try {
    await navigator.clipboard.writeText(text);
    show(nodes.pcCopied);
  } catch { /* clipboard blocked; the code block is still there to select */ }
  btn.disabled = false;
}

function bootPc() {
  hideToken();
  clearErrors(nodes.pcErrors);
  renderStats(null);

  nodes.pcConnect.addEventListener('submit', async e => {
    e.preventDefault();
    showPcErrors([]);
    hideToken();
    const label = nodes.pcLabel.value.trim().slice(0, 40);
    nodes.pcAdd.disabled = true;
    try {
      const r = await api('/api/lab/token', { method: 'POST', body: { label } });
      if (!r.ok) { showPcErrors(errorsFrom(r.data, 'Could not connect that PC.')); return; }
      const token = r.data && typeof r.data.token === 'string' ? r.data.token : '';
      if (token) {
        nodes.pcTokenValue.textContent = token;
        show(nodes.pcToken);
      }
      nodes.pcLabel.value = '';
      await loadPc();
    } catch (err) {
      if (err instanceof AuthError) { needSignIn(); return; }
      showPcErrors(["Couldn't reach the log. Nothing was connected."]);
    } finally {
      nodes.pcAdd.disabled = false;
    }
  });

  nodes.pcCopy.addEventListener('click', () => copyToken(nodes.pcCopy));
  nodes.pcDone.addEventListener('click', hideToken);
}

/* ---------- boot ---------- */
function render() {
  renderFigures();
  renderCharts();
  renderChanges();
  renderRanked();
}

function boot() {
  nodes.retry.addEventListener('click', () => {
    if (signInNeeded) { location.reload(); return; }
    load();
  });
  bootPc();
  load();
  loadPc();
  loadStats();
}

boot();
})();
