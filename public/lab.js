/* Settings Lab: what the readings add up to.
   Sign-in happens at the edge (Cloudflare Access). This file only reads:
   the changes recorded, and the numbers measured around them.

   The page itself is one plain recommendation, the session charts, and
   the open tests. Decided changes stay in the log and still feed the
   charts and the verdict, but they are not listed again. */
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

const GAME_KEY = 'zoi-lab-game';
const MODE_KEY = 'zoi-lab-cod-mode';
const storedGame = () => {
  try { return sessionStorage.getItem(GAME_KEY) || 'fortnite'; } catch { return 'fortnite'; }
};
const storedMode = () => {
  try { return sessionStorage.getItem(MODE_KEY) || ''; } catch { return ''; }
};
const rememberGame = (g) => { try { sessionStorage.setItem(GAME_KEY, g); } catch {} };
const rememberMode = (m) => { try { if (m) sessionStorage.setItem(MODE_KEY, m); } catch {} };

const state = { perf: null, tokens: [], game: storedGame() === 'cod' ? 'cod' : 'fortnite', mode: storedMode() };
const nodes = {
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), empty: $('empty'),
  nowLead: $('now-lead'), now: $('now'), nowBlock: $('now-block'),
  gameSwitch: $('game-switch'), gameFortnite: $('game-fortnite'), gameCod: $('game-cod'),
  modeSwitch: $('mode-switch'),
  chartsBlock: $('charts-block'),
  chartKpm: $('chart-kpm'), chartKpmBox: $('chart-kpm-box'),
  chartWin: $('chart-win'), chartWinBox: $('chart-win-box'), chartWinTitle: $('chart-win-title'),
  chartLegend: $('chart-legend'), chartEmpty: $('chart-empty'),
  codLog: $('cod-log'), codLogMode: $('cod-log-mode'), codLogKills: $('cod-log-kills'),
  codLogDeaths: $('cod-log-deaths'), codLogExtractedWrap: $('cod-log-extracted-wrap'),
  codLogWonWrap: $('cod-log-won-wrap'), codLogError: $('cod-log-error'),
  codLogSubmit: $('cod-log-submit'),
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

const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const isNum = v => typeof v === 'number' && Number.isFinite(v);

const kpm = v => (isNum(v) ? v.toFixed(2) : '\u2014');

const signed = (v, places) => {
  if (!isNum(v)) return '\u2014';
  const a = Math.abs(v).toFixed(places);
  if (Math.abs(v) < Math.pow(10, -places) / 2) return '0.' + '0'.repeat(places);
  return (v > 0 ? '+' : '\u2212') + a;
};

const TESTING = 'testing';
const isOpenChange = c => Boolean(c) && c.status === TESTING;

/* ---------- load ---------- */

let signInNeeded = false;

function failLoad(message) {
  nodes.loadErrorText.textContent = message;
  show(nodes.loadError);
  hide(nodes.app);
}

function needSignIn() {
  signInNeeded = true;
  failLoad('Your sign-in expired. Reload the page to sign in again.');
}

function performancePath() {
  if (state.game !== 'cod') return '/api/lab/performance';
  let path = '/api/lab/performance?game=cod';
  if (state.mode) path += '&mode=' + encodeURIComponent(state.mode);
  return path;
}

function renderGameSwitch() {
  const games = (state.perf && state.perf.games) || {};
  if (!games.cod || !nodes.gameSwitch) { if (nodes.gameSwitch) hide(nodes.gameSwitch); return; }
  nodes.gameFortnite.setAttribute('aria-pressed', state.game !== 'cod' ? 'true' : 'false');
  nodes.gameCod.setAttribute('aria-pressed', state.game === 'cod' ? 'true' : 'false');
  show(nodes.gameSwitch);
}

function renderModeSwitch() {
  if (!nodes.modeSwitch) return;
  nodes.modeSwitch.replaceChildren();
  const modes = (state.perf && Array.isArray(state.perf.modes)) ? state.perf.modes : [];
  if (state.game !== 'cod' || !modes.length) { hide(nodes.modeSwitch); return; }
  const current = state.perf.mode || state.mode || modes[0].id;
  for (const m of modes) {
    const btn = el('button', 'lab-switch-btn');
    btn.type = 'button';
    btn.textContent = m.label;
    btn.setAttribute('aria-pressed', m.id === current ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (state.mode === m.id) return;
      state.mode = m.id;
      rememberMode(m.id);
      load();
    });
    nodes.modeSwitch.append(btn);
  }
  show(nodes.modeSwitch);
}

function fillCodModeSelect() {
  if (!nodes.codLogMode) return;
  const catalog = (state.perf && Array.isArray(state.perf.mode_catalog)) ? state.perf.mode_catalog : [];
  const previous = nodes.codLogMode.value;
  nodes.codLogMode.replaceChildren();
  let group = null, groupEl = null;
  for (const m of catalog) {
    if (m.group !== group) {
      group = m.group;
      groupEl = document.createElement('optgroup');
      groupEl.label = group;
      nodes.codLogMode.append(groupEl);
    }
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    (groupEl || nodes.codLogMode).append(opt);
  }
  const prefer = previous || state.mode || 'dmz';
  if ([...nodes.codLogMode.options].some(o => o.value === prefer)) nodes.codLogMode.value = prefer;
  syncCodOutcomeFields();
}

function modeCatalogEntry(id) {
  const catalog = (state.perf && Array.isArray(state.perf.mode_catalog)) ? state.perf.mode_catalog : [];
  return catalog.find(m => m.id === id) || null;
}

function syncCodOutcomeFields() {
  const entry = modeCatalogEntry(nodes.codLogMode && nodes.codLogMode.value);
  const extraction = entry && entry.outcome === 'extraction';
  if (nodes.codLogExtractedWrap) nodes.codLogExtractedWrap.hidden = !extraction;
  if (nodes.codLogWonWrap) nodes.codLogWonWrap.hidden = extraction;
}

function renderCodLog() {
  if (!nodes.codLog) return;
  if (state.game !== 'cod') { hide(nodes.codLog); return; }
  fillCodModeSelect();
  show(nodes.codLog);
}

function radioValue(name) {
  const picked = document.querySelector('input[name="' + name + '"]:checked');
  return picked ? picked.value : '';
}

async function load() {
  hide(nodes.loadError);
  let r;
  try {
    r = await api(performancePath());
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
  if (state.game === 'cod' && state.perf.mode) {
    state.mode = state.perf.mode;
    rememberMode(state.mode);
  }
  /* A remembered COD view with no snapshot yet falls back to Fortnite. */
  if (state.game === 'cod' && state.perf.games && !state.perf.games.cod) {
    state.game = 'fortnite';
    rememberGame('fortnite');
  }
  signInNeeded = false;
  hide(nodes.loadError);
  show(nodes.app);
  render();
  return true;
}

/* ---------- the verdict that changes what he does next ----------

   Prefer a settled replay reading when the counters cannot place the games. */
function liveVerdict(c) {
  const m = c && c.by_match;
  if (m && m.verdict && m.verdict !== 'too-soon') return m.verdict;
  return (c && c.verdict) || 'too-soon';
}

function killsMove(c) {
  const m = c && c.by_match;
  if (m && m.verdict && m.verdict !== 'too-soon' && isNum(m.kills_delta)) return m.kills_delta;
  if (isNum(c && c.kills_delta)) return c.kills_delta;
  if (m && isNum(m.kills_delta)) return m.kills_delta;
  return null;
}

function killsSides(c) {
  const m = c && c.by_match;
  const useReplay = Boolean(m && m.verdict && m.verdict !== 'too-soon' && (isNum(m.kills_before) || isNum(m.kills_after)));
  if (useReplay) return { before: m.kills_before, after: m.kills_after };
  return {
    before: c && c.before ? c.before.kills_per_match : null,
    after: c && c.after ? c.after.kills_per_match : null,
  };
}

function modeWord(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || fallback;
}

function modeText(m) {
  if (m.kind === 'creative') {
    const title = typeof m.title === 'string' ? m.title.trim() : '';
    return title;
  }
  const ranked = modeWord(m.ranked, '');
  const build = modeWord(m.build_mode !== undefined ? m.build_mode : m.buildMode, '');
  const team = modeWord(m.team_size !== undefined ? m.team_size : m.teamSize, '');
  const buildWord = build === 'Zero' ? 'Zero Build' : build === 'Build' ? 'Build' : build;
  return [ranked, buildWord, team].filter(Boolean).join(' \u00b7 ');
}

/* Named only when the sample was narrowed. "All modes together" is the default
   and does not change what he does, so it is not shown. */
function scopeNote(c) {
  if (c.scope === 'ranked' || c.scope === 'unranked') {
    const named = modeText({ ranked: c.scope === 'ranked' ? 'Ranked' : 'Unranked', build_mode: '', team_size: '' });
    return 'Compared in ' + named + ' only';
  }
  if (c.scope === 'creative') return 'Creative island games only';
  return '';
}

function settingName(c) {
  return (c && (c.label || c.setting)) || 'This setting';
}

function killsReason(c) {
  const d = killsMove(c);
  if (!isNum(d) || Math.abs(d) < 0.005) return '';
  const n = Math.abs(d).toFixed(2);
  return n + (d < 0 ? ' fewer' : ' more') + ' kills a match since the change.';
}

function verdictBlock(c) {
  const v = liveVerdict(c);
  const name = settingName(c);
  const box = el('div', 'lab-verdict');
  let action = '';
  let reason = '';
  if (v === 'worse') {
    action = 'Put ' + name + ' back to ' + c.from_value + '.';
    reason = killsReason(c);
  } else if (v === 'better') {
    action = 'Keep ' + name + ' at ' + c.to_value + '.';
    reason = killsReason(c);
  } else if (v === 'even') {
    action = name + ' made no difference. Your call.';
  }
  box.append(el('p', 'lab-verdict-action', action));
  if (reason) box.append(el('p', 'lab-verdict-reason', reason));
  return box;
}

function earlyVerdict(openCount) {
  const box = el('div', 'lab-verdict');
  box.append(el('p', 'lab-verdict-action', 'Too early to call. Keep your settings and play more games.'));
  if (openCount > 0) {
    box.append(el('p', 'lab-verdict-sub', openCount === 1 ? '1 test running' : openCount + ' tests running'));
  }
  return box;
}

function signal(c) {
  const v = liveVerdict(c);
  const d = killsMove(c);
  if (v === 'too-soon') {
    const replayed = c.by_match && isNum(c.by_match.after) ? c.by_match.after : 0;
    const counted = c.after && isNum(c.after.matches) ? c.after.matches : 0;
    const played = replayed || counted;
    return { kind: 'early', text: 'Still early' + (played ? ' \u00b7 ' + group(played) + (played === 1 ? ' game' : ' games') : '') };
  }
  if (isNum(d)) return { kind: d < 0 ? 'down' : d > 0 ? 'up' : 'flat', text: signed(d, 2) };
  return null;
}

/* The only detail that justifies the verdict: kills a match before and after.
   A narrowed scope is the one other fact that can change whether he acts. */
function justification(c) {
  const body = el('div', 'lab-hero-body');
  const sides = killsSides(c);
  if (isNum(sides.before) || isNum(sides.after)) {
    body.append(el('p', 'lab-just', kpm(sides.before) + ' \u2192 ' + kpm(sides.after) + ' kills a match'));
  }
  const scope = scopeNote(c);
  if (scope) body.append(el('span', 'lab-change-scope', scope));
  return body.childNodes.length ? body : null;
}

function changeRow(c) {
  const v = liveVerdict(c);
  const card = el('details', 'lab-hero lab-hero-' + v);

  const sum = el('summary', 'lab-hero-sum');
  const id = el('span', 'lab-hero-id');
  id.append(el('span', 'lab-hero-k', c.label || c.setting));
  const values = el('span', 'lab-hero-values');
  values.append(el('span', null, c.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, c.to_value));
  id.append(values);
  sum.append(id);

  const side = el('span', 'lab-hero-side');
  const sig = signal(c);
  if (sig) {
    const cls = sig.kind === 'early' ? 'lab-tag lab-tag-too-soon' : 'lab-hero-d lab-hero-d-' + sig.kind;
    side.append(el('span', cls, sig.text));
  }
  sum.append(side);
  card.append(sum);

  const body = justification(c);
  if (body) card.append(body);
  else {
    /* Nothing to expand, so this is not a disclosure. Keep the same look. */
    card.removeAttribute('open');
  }
  return card;
}

function pickLead(open, past) {
  const order = { worse: 0, better: 1, even: 2, 'too-soon': 3 };
  const rankedOpen = open.slice().sort((a, b) => (order[liveVerdict(a)] ?? 9) - (order[liveVerdict(b)] ?? 9));
  const pastOf = v => past.filter(c => liveVerdict(c) === v);
  if (rankedOpen[0] && liveVerdict(rankedOpen[0]) === 'worse') return rankedOpen[0];
  if (pastOf('worse')[0]) return pastOf('worse')[0];
  if (rankedOpen[0] && liveVerdict(rankedOpen[0]) === 'better') return rankedOpen[0];
  if (pastOf('better')[0]) return pastOf('better')[0];
  if (rankedOpen[0] && liveVerdict(rankedOpen[0]) === 'even') return rankedOpen[0];
  if (pastOf('even')[0]) return pastOf('even')[0];
  return rankedOpen[0] || null;
}

function isSettledLead(c) {
  const v = c ? liveVerdict(c) : 'too-soon';
  return v === 'worse' || v === 'better' || v === 'even';
}

/* ---------- charts ----------
   Hand-drawn SVG with presentation attributes: the CSP allows no inline styles
   and no third-party chart script. Always on the page, never in a fold. */
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

/* series: [{ v: number|null, mark: bool, thin: bool }]. x is the session index.
   A point below the server's chart floor arrives with thin: true; it is drawn
   as a hollow mark off the line. */
function lineChart(series, opts) {
  const box = el('div');
  const points = series.filter(s => isNum(s.v));
  if (!points.length) {
    box.append(el('p', 'lab-empty', opts.empty || 'Nothing measured yet.'));
    return box;
  }
  const values = points.map(s => s.v);
  /* Win rate cannot exceed 100%. A one-game 100% used to stretch the axis past
     the only value the number can take. */
  const cap = isNum(opts.cap) ? opts.cap : null;
  const rawTop = Math.max(opts.max || 0, ...values);
  const top = cap === null ? rawTop : Math.min(cap, rawTop);
  const yMax = cap !== null && rawTop >= cap ? cap : (top <= 0 ? 1 : top * 1.15);
  const yMin = opts.min || 0;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xAt = i => PAD.l + (series.length <= 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
  const yAt = v => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || '' });

  for (let g = 0; g <= 2; g++) {
    const v = yMin + ((yMax - yMin) * g) / 2;
    const y = yAt(v);
    root.append(svg('line', { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: '#ffffff14', 'stroke-width': 1 }));
    root.append(svgText({ x: PAD.l - 5, y: y + 3.5, fill: '#a29f97', 'font-size': 8, 'text-anchor': 'end' }, opts.axis(v)));
  }

  series.forEach((s, i) => {
    if (!s.mark) return;
    const x = xAt(i);
    root.append(svg('line', { x1: x, y1: PAD.t, x2: x, y2: PAD.t + plotH, stroke: '#e6d3a055', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
  });

  let band = [];
  const flushBand = () => {
    if (band.length > 1) {
      const up = band.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.hi.toFixed(1)).join(' ');
      const down = band.slice().reverse().map((p) => 'L' + p.x.toFixed(1) + ' ' + p.lo.toFixed(1)).join(' ');
      root.append(svg('path', { d: up + ' ' + down + ' Z', fill: '#ffe08a', 'fill-opacity': 0.13, stroke: 'none' }));
    }
    band = [];
  };
  series.forEach((s, i) => {
    if (!isNum(s.lo) || !isNum(s.hi) || s.thin) { flushBand(); return; }
    band.push({ x: xAt(i), lo: yAt(s.lo), hi: yAt(s.hi) });
  });
  flushBand();

  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const d = run.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
      root.append(svg('path', { d, fill: 'none', stroke: '#ffe08a', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    run = [];
  };
  series.forEach((s, i) => {
    if (!isNum(s.v) || s.thin) { flush(); return; }
    run.push({ x: xAt(i), y: yAt(s.v) });
  });
  flush();

  series.forEach((s, i) => {
    if (!isNum(s.v)) return;
    if (s.thin) {
      root.append(svg('circle', { cx: xAt(i).toFixed(1), cy: yAt(s.v).toFixed(1), r: 2.4, fill: 'none', stroke: '#a29f97', 'stroke-width': 1.2 }));
      return;
    }
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
  nodes.chartKpmBox.replaceChildren();
  nodes.chartWinBox.replaceChildren();
  nodes.chartLegend.replaceChildren();

  if (!chart.length) {
    hide(nodes.chartKpm);
    hide(nodes.chartWin);
    hide(nodes.chartLegend);
    hide(nodes.chartEmpty);
    hide(nodes.chartsBlock);
    return;
  }

  show(nodes.chartsBlock);
  show(nodes.chartKpm);
  show(nodes.chartWin);
  hide(nodes.chartEmpty);

  const first = chart[0], last = chart[chart.length - 1];
  const firstLabel = fmtDay(first.to);
  const sameDay = fmtDay(first.to) === fmtDay(last.to);
  const lastLabel = sameDay ? '' : fmtDay(last.to);
  const series = v => chart.map(s => ({
    v: v(s), mark: Boolean(s.change), thin: Boolean(s.thin),
    lo: isNum(s.kills_low) ? s.kills_low : null,
    hi: isNum(s.kills_high) ? s.kills_high : null,
  }));

  nodes.chartKpmBox.append(lineChart(series(s => s.kills_per_match), {
    min: 0,
    max: 2,
    label: 'Kills a match by session',
    axis: v => (Math.round(v * 10) / 10).toFixed(1),
    firstLabel, lastLabel,
    empty: 'Kills a match needs a kill count in a session.',
  }));

  const outcome = p.outcome === 'extraction' ? 'extraction' : 'win';
  const outcomeLabel = p.outcome_label || (outcome === 'extraction' ? 'Extraction rate' : 'Win rate');
  if (nodes.chartWinTitle) nodes.chartWinTitle.textContent = outcomeLabel;
  nodes.chartWinBox.append(lineChart(series(s => outcome === 'extraction' ? s.extract_rate : s.win_rate), {
    min: 0,
    max: 0.15,
    cap: 1,
    label: outcomeLabel + ' by session',
    axis: v => Math.round(v * 100) + '%',
    firstLabel, lastLabel,
    empty: outcomeLabel + ' needs a result recorded in a session.',
  }));

  /* A tiny legend, only for the marks that are actually on the chart. No prose. */
  const marks = chart.some(s => s.change);
  const thins = chart.some(s => s.thin);
  const minGames = p.chart_min_games || 5;
  if (marks || thins) {
    if (thins) nodes.chartLegend.append(el('span', null, '\u25cb under ' + minGames + ' games'));
    if (marks) nodes.chartLegend.append(el('span', null, '\u250a change'));
    show(nodes.chartLegend);
  } else {
    hide(nodes.chartLegend);
  }
}

function render() {
  renderGameSwitch();
  renderModeSwitch();
  renderCodLog();
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const open = list.filter(isOpenChange);
  const past = list.filter(c => !isOpenChange(c));
  const lead = pickLead(open, past);
  const settled = isSettledLead(lead);

  nodes.nowLead.replaceChildren();
  nodes.now.replaceChildren();

  if (!list.length) {
    show(nodes.empty);
    hide(nodes.nowLead);
    hide(nodes.nowBlock);
    renderCharts();
    return;
  }
  hide(nodes.empty);

  if (settled) {
    nodes.nowLead.append(verdictBlock(lead));
    show(nodes.nowLead);
  } else if (open.length) {
    nodes.nowLead.append(earlyVerdict(open.length));
    show(nodes.nowLead);
  } else {
    hide(nodes.nowLead);
  }

  renderCharts();

  const skip = settled ? lead : null;
  let listed = 0;
  for (const c of open) {
    if (skip && c === skip) continue;
    nodes.now.append(changeRow(c));
    listed++;
  }
  if (listed) show(nodes.nowBlock);
  else hide(nodes.nowBlock);
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


async function submitCodLog(e) {
  e.preventDefault();
  if (nodes.codLogError) { nodes.codLogError.textContent = ''; hide(nodes.codLogError); }
  const mode = nodes.codLogMode.value;
  const entry = modeCatalogEntry(mode);
  const kills = Number(nodes.codLogKills.value);
  const deathsRaw = nodes.codLogDeaths.value.trim();
  const body = { mode, kills };
  if (deathsRaw !== '') body.deaths = Number(deathsRaw);
  if (entry && entry.outcome === 'extraction') {
    const v = radioValue('cod-extracted');
    if (v !== 'yes' && v !== 'no') {
      nodes.codLogError.textContent = 'Say whether you extracted.';
      show(nodes.codLogError);
      return;
    }
    body.extracted = v === 'yes';
  } else {
    const v = radioValue('cod-won');
    if (v !== 'yes' && v !== 'no') {
      nodes.codLogError.textContent = 'Say whether you won.';
      show(nodes.codLogError);
      return;
    }
    body.won = v === 'yes';
  }
  nodes.codLogSubmit.disabled = true;
  try {
    const r = await api('/api/lab/cod-matches', { method: 'POST', body });
    if (!r.ok) {
      nodes.codLogError.textContent = errorsFrom(r.data, "Couldn't save that match.").join(' ');
      show(nodes.codLogError);
      return;
    }
    state.mode = mode;
    rememberMode(mode);
    nodes.codLogKills.value = '';
    nodes.codLogDeaths.value = '';
    for (const name of ['cod-extracted', 'cod-won']) {
      document.querySelectorAll('input[name="' + name + '"]').forEach(i => { i.checked = false; });
    }
    await load();
  } catch (err) {
    if (err instanceof AuthError) { needSignIn(); return; }
    nodes.codLogError.textContent = "Couldn't reach the lab. Nothing was saved.";
    show(nodes.codLogError);
  } finally {
    nodes.codLogSubmit.disabled = false;
  }
}

function boot() {
  nodes.retry.addEventListener('click', () => {
    if (signInNeeded) { location.reload(); return; }
    load();
  });
  if (nodes.gameFortnite) {
    nodes.gameFortnite.addEventListener('click', () => {
      if (state.game === 'fortnite') return;
      state.game = 'fortnite';
      rememberGame('fortnite');
      load();
    });
  }
  if (nodes.gameCod) {
    nodes.gameCod.addEventListener('click', () => {
      if (state.game === 'cod') return;
      state.game = 'cod';
      rememberGame('cod');
      load();
    });
  }
  if (nodes.codLog) nodes.codLog.addEventListener('submit', submitCodLog);
  if (nodes.codLogMode) nodes.codLogMode.addEventListener('change', syncCodOutcomeFields);
  if (nodes.pcConnect) bootPc();
  load();
  if (nodes.pcConnect) loadPc();
  if (nodes.pcStats) loadStats();
}

boot();
})();
