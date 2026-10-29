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
  current: $('current'), currentNote: $('current-note'), currentMode: $('current-mode'),
  chartKpm: $('chart-kpm'), chartKpmBox: $('chart-kpm-box'),
  chartWin: $('chart-win'), chartWinBox: $('chart-win-box'),
  chartKey: $('chart-key'), chartEmpty: $('chart-empty'),
  progress: $('progress'), changes: $('changes'), ranked: $('ranked'),
  startBlock: $('start-block'),
  progressBlock: $('progress-block'), changesBlock: $('changes-block'), rankedBlock: $('ranked-block'),
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

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* A rate as a percentage with one decimal below 10%: an aim change often moves
   win rate by a point or two, and rounding 8.4% to 8% would hide it. */
const pct = v => {
  if (!isNum(v)) return '\u2014';
  const p = v * 100;
  return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
};

const points = d => {
  if (!isNum(d)) return '';
  const p = Math.abs(d) * 100;
  const shown = p >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return (d > 0 ? '+' : '\u2212') + shown;
};

const kd = v => (isNum(v) ? v.toFixed(2) : '\u2014');
const plural = (n, one, many) => n === 1 ? one : many;

/* Kills a match is the metric the verdicts run on, so it gets two decimals
   everywhere: a tenth of a kill a match is a real amount of play. */
const kpm = v => (isNum(v) ? v.toFixed(2) : '\u2014');

const signed = (v, places) => {
  if (!isNum(v)) return '\u2014';
  const a = Math.abs(v).toFixed(places);
  if (Math.abs(v) < Math.pow(10, -places) / 2) return '0.' + '0'.repeat(places);
  return (v > 0 ? '+' : '\u2212') + a;
};

const matchesWord = n => group(n) + (n === 1 ? ' game' : ' games');

/* "3.90 to 5.32" — a range, said plainly. */
const range = (iv, fmt) => (iv && isNum(iv.low) && isNum(iv.high) ? fmt(iv.low) + ' to ' + fmt(iv.high) : 'no range');

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

/* ---------- what everything is set to right now ----------
   The tracked settings only, one row each. The page already knows every label
   from the change cards, and the payload carries the value as the save holds
   it, so this is a read rather than a second settings page. */
/* ---------- the mode the last match was played in ----------
   One line, and only when the log actually proved it. The mode comes from the
   settings block the match was queued under, so it is a fact rather than an
   inference; a match joined in progress has no such block and stores nothing, and
   then this line is not drawn at all rather than reading "unknown". */
function modeWord(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || fallback;
}

function renderMode() {
  const m = state.perf && state.perf.lastMatch;
  nodes.currentMode.replaceChildren();
  const key = m && typeof m === 'object' ? modeText(m) : '';
  if (!key) { hide(nodes.currentMode); return; }
  nodes.currentMode.textContent = key;
  show(nodes.currentMode);
}

/* "Ranked · Zero Build · Solo". The three fields are the mode; a field the log did
   not name is left out rather than shown as a blank or a guess. The playlist name
   is not shown: it is an internal identifier he did not ask to read. */
function modeText(m) {
  const ranked = modeWord(m.ranked, '');
  const build = modeWord(m.build_mode !== undefined ? m.build_mode : m.buildMode, '');
  const team = modeWord(m.team_size !== undefined ? m.team_size : m.teamSize, '');
  const buildWord = build === 'Zero' ? 'Zero Build' : build === 'Build' ? 'Build' : build;
  return [ranked, buildWord, team].filter(Boolean).join(' \u00b7 ');
}

function renderCurrent() {
  const c = state.perf && state.perf.current;
  nodes.current.replaceChildren();
  renderMode();
  if (!c || !Array.isArray(c.settings) || !c.settings.length) {
    nodes.current.append(el('p', 'lab-empty', 'Nothing yet. Your PC sends the whole config with every sync, so this fills in on its own.'));
    hide(nodes.currentNote);
    return;
  }

  const seen = fmtDayYear(c.taken_at);
  const ago = c.taken_at ? agoText(c.taken_at) : '';
  const list = el('dl', 'lab-now');
  let missing = 0;
  for (const row of c.settings) {
    const dt = el('dt', 'lab-now-l', row.label);
    let value = row.value;
    if (value === null || value === undefined || value === '') {
      value = '\u2014';
      missing++;
    }
    list.append(dt, el('dd', 'lab-now-v', value));
  }
  nodes.current.append(list);

  /* When it was read, in the same words the This PC list uses, so a stale
     snapshot is obvious rather than being read as the current setting. The
     agent's own name is deliberately not shown: it is an internal filename and
     tells him nothing he can act on. How long ago is the useful part. */
  const bits = [];
  if (seen) bits.push('As of ' + seen + (ago ? ' (' + ago + ')' : '') + '.');
  if (missing) bits.push(missing + (missing === 1 ? ' setting was not' : ' settings were not') + ' in the snapshot.');
  nodes.currentNote.textContent = bits.join(' ');
  if (bits.length) show(nodes.currentNote); else hide(nodes.currentNote);
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

/* series: [{ v: number|null, mark: bool, thin: bool }]. x is the session index:
   a handful of sessions spaced evenly reads better than the same handful
   squashed against a date axis, and the axis still names the days underneath.
   A point below the server's chart floor arrives with thin: true; it is drawn
   as a hollow mark off the line, because one game at 0% is not a reading of
   anything and must not look like one. */
function lineChart(series, opts) {
  const box = el('div');
  const points = series.filter(s => isNum(s.v));
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

  /* the line, broken wherever a value is missing or too thin to stand on */
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

  if (!chart.length) {
    hide(nodes.chartKpm);
    hide(nodes.chartWin);
    nodes.chartEmpty.textContent = 'No sessions yet. A session appears once two syncs show different match counts, which means you played in between.';
    show(nodes.chartEmpty);
    hide(nodes.chartKey);
    return;
  }

  show(nodes.chartKpm);
  show(nodes.chartWin);
  hide(nodes.chartEmpty);

  const first = chart[0], last = chart[chart.length - 1];
  const firstLabel = fmtDay(first.to);
  /* One session, or several inside one day, would print the same day at both
     ends of the axis and read as a broken label rather than a short history. */
  const sameDay = fmtDay(first.to) === fmtDay(last.to);
  const lastLabel = sameDay ? '' : fmtDay(last.to);
  const series = v => chart.map(s => ({ v: v(s), mark: Boolean(s.change), thin: Boolean(s.thin) }));

  /* Kills a match leads, because it is the number a verdict can move on. */
  nodes.chartKpmBox.append(lineChart(series(s => s.kills_per_match), {
    min: 0,
    max: 2,
    label: 'Kills a match by session',
    axis: v => (Math.round(v * 10) / 10).toFixed(1),
    firstLabel, lastLabel,
    empty: 'Kills a match needs a kill count in a session.',
  }));

  nodes.chartWinBox.append(lineChart(series(s => s.win_rate), {
    min: 0,
    max: 0.15,
    label: 'Win rate by session',
    axis: v => Math.round(v * 100) + '%',
    firstLabel, lastLabel,
    empty: 'Win rate needs a win recorded in a session.',
  }));

  const marks = chart.filter(s => s.change).length;
  const thins = chart.filter(s => s.thin).length;
  const bits = ['Each point is one session.'];
  if (thins) bits.push('The hollow points are sessions of fewer than ' + (p.chart_min_games || 5) + ' games: one game at 0% is not a reading, so they sit off the line.');
  bits.push(marks ? 'The dashed uprights are where a setting changed.' : 'A dashed upright appears where a setting changes.');
  nodes.chartKey.textContent = bits.join(' ');
  show(nodes.chartKey);
}

/* ---------- a range, drawn ----------
   Two horizontal intervals on one scale: the games before a change on top, the
   games after it below. When the bars do not touch, the move is bigger than the
   noise; when they do, it is not. Hand-drawn SVG, presentation attributes
   only, because that is all the CSP allows. */
function rangeChart(before, after, opts) {
  const root = svg('svg', { viewBox: '0 0 320 56', role: 'img', 'aria-label': opts.label || '' });
  if (!before || !after) return root;

  const lo = Math.min(before.low, after.low);
  const hi = Math.max(before.high, after.high);
  const span = hi - lo;
  const pad = span > 0 ? span * 0.12 : Math.max(Math.abs(hi), 1) * 0.2;
  const min = Math.max(opts.floor || 0, lo - pad);
  const max = hi + pad;
  const plotW = 320 - 16;
  const xAt = v => 8 + (max === min ? plotW / 2 : ((v - min) / (max - min)) * plotW);

  const rows = [
    { iv: before, y: 16, colour: '#a29f97', name: 'Before' },
    { iv: after, y: 40, colour: '#ffe08a', name: 'After' },
  ];
  for (const r of rows) {
    root.append(svg('line', { x1: xAt(r.iv.low).toFixed(1), y1: r.y, x2: xAt(r.iv.high).toFixed(1), y2: r.y, stroke: r.colour, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.55 }));
    root.append(svg('circle', { cx: xAt(r.iv.mean).toFixed(1), cy: r.y, r: 3.4, fill: r.colour }));
    root.append(svgText({ x: 8, y: r.y - 8, fill: '#a29f97', 'font-size': 7.5 }, r.name));
  }

  /* the gap, or the overlap, called out in the middle where the eye looks */
  const separable = after.low > before.high || after.high < before.low;
  root.append(svgText({ x: 312, y: 53, fill: separable ? '#ffe08a' : '#8d8a83', 'font-size': 7.5, 'text-anchor': 'end' }, separable ? 'ranges separate' : 'ranges overlap'));
  root.append(svgText({ x: 8, y: 53, fill: '#a29f97', 'font-size': 7.5 }, opts.axis(min) + ' to ' + opts.axis(max)));
  return root;
}

/* ---------- the changes ---------- */

const VERDICT_WORD = { better: 'Better', worse: 'Worse', even: 'No change', 'too-soon': 'Too soon' };

const NO_KILLS = 'These readings carry no kill count, so there is nothing to judge. Kills a match is the number that decides.';

/* What the primary verdict means, in words that do not oversell it. */
function killsLine(c) {
  const b = c.kills_interval && c.kills_interval.before;
  const a = c.kills_interval && c.kills_interval.after;
  const wrap = el('div', 'lab-primary');

  const head = el('div', 'lab-primary-head');
  head.append(el('span', 'lab-primary-k', 'Kills a match'));
  if (c.before && c.after && (c.verdict !== 'too-soon' || c.after.matches > 0)) {
    head.append(el('span', 'lab-primary-v', kpm(c.before.kills_per_match)));
    head.append(el('span', 'lab-arrow', '\u2192'));
    head.append(el('span', 'lab-primary-v lab-primary-now', kpm(c.after.kills_per_match)));
  }
  if (isNum(c.kills_delta)) head.append(el('span', 'lab-primary-d', signed(c.kills_delta, 2) + ' a match'));
  wrap.append(head);

  if (b && a) {
    const chart = rangeChart(b, a, {
      label: 'Kills a match before and after the change, with the 95% range for each',
      axis: v => (Math.round(v * 100) / 100).toFixed(1),
    });
    const box = el('div', 'lab-range');
    box.append(chart);
    wrap.append(box);

    const pairs = el('div', 'lab-ranges');
    const row = (name, iv, mean) => {
      const line = el('div', 'lab-ranges-row');
      line.append(el('span', 'lab-ranges-k', name), el('span', 'lab-ranges-v', kpm(mean) + ', ' + range(iv, kpm)));
      return line;
    };
    pairs.append(row('Before', b, b.mean), row('After', a, a.mean));
    wrap.append(pairs);
  }

  let note;
  if (!b || !a) {
    /* No interval on both sides means there is nothing to compare, whatever the
       verdict says. Never claim separation we cannot show. */
    note = c.verdict === 'too-soon' ? 'Not enough games yet to put a range on both sides of the change.' : 'No range to compare on this change yet.';
  } else if (c.verdict === 'too-soon') {
    const need = (state.perf && state.perf.min_games) || 25;
    const seen = c.after && c.after.matches ? c.after.matches : 0;
    const had = c.before && c.before.matches ? c.before.matches : 0;
    if (c.reason === 'kills-missing') note = NO_KILLS;
    else if (had < need) note = 'Not enough games before the change to compare against: ' + matchesWord(had) + ' of history, ' + need + ' needed.';
    else note = 'Not enough games to call it: ' + matchesWord(seen) + ' since the change, ' + need + ' needed on each side.';
  } else if (c.verdict === 'better') {
    note = 'The two ranges do not overlap, so the move is bigger than the noise in it.';
  } else if (c.verdict === 'worse') {
    note = 'The two ranges do not overlap, and the second one sits lower. The move is bigger than the noise in it.';
  } else {
    note = 'The two ranges overlap, so the move so far is not bigger than the noise. That is not a verdict either way.';
  }
  wrap.append(el('p', 'lab-c-note lab-c-note-primary', note));
  return wrap;
}

/* Win rate, underneath, never deciding on its own. */
function winRateLine(c) {
  const wrap = el('div', 'lab-secondary');
  const b = c.win_rate_interval && c.win_rate_interval.before;
  const a = c.win_rate_interval && c.win_rate_interval.after;

  const head = el('div', 'lab-secondary-head');
  head.append(el('span', 'lab-secondary-k', 'Win rate'));
  head.append(el('span', 'lab-secondary-v', pct(c.before && c.before.win_rate)));
  head.append(el('span', 'lab-arrow', '\u2192'));
  head.append(el('span', 'lab-secondary-v', pct(c.after && c.after.win_rate)));
  if (isNum(c.delta) && Math.abs(c.delta) >= 0.0005) {
    head.append(el('span', 'lab-secondary-d', points(c.delta) + ' points'));
  }
  wrap.append(head);

  if (b && a) {
    wrap.append(el('p', 'lab-c-fine', 'Ranges ' + pct(b.low) + ' to ' + pct(b.high) + ' before, ' + pct(a.low) + ' to ' + pct(a.high) + ' after.'));
  }

  /* The honest sentence, and it quotes a move worth having rather than the one
     that happened to show up. Sizing a half-point wobble gives hundreds of
     thousands of games: true, and useless. Three points is the smallest
     win-rate move worth acting on, so that is the figure on the card. */
  let note;
  if (isNum(c.win_games_target)) {
    note = 'Win rate is the slow signal. A three-point move, the smallest worth acting on, would need about ' + group(c.win_games_target) + ' games on each side. A setting gets a fraction of that, so win rate here is colour rather than evidence.';
  } else {
    note = 'Win rate is the slow signal here. It stays colour rather than evidence until there are far more games than a single setting gets.';
  }
  wrap.append(el('p', 'lab-c-fine', note));
  return wrap;
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
    row('Kills', c.before.kills === null ? '\u2014' : group(c.before.kills), c.after.kills === null ? '\u2014' : group(c.after.kills)),
    row('K/D', kd(c.before.kd), kd(c.after.kd)),
  );
  return wrap;
}

/* Which games the comparison was run on. A mode split is a narrower sample and a
   stronger claim, so it is named; a blended comparison says it is blended rather
   than leaving the reader to assume the games were all one mode. */
function scopeNote(c) {
  if (c.scope === 'ranked' || c.scope === 'unranked') {
    const named = modeText({ ranked: c.scope === 'ranked' ? 'Ranked' : 'Unranked', build_mode: '', team_size: '' });
    return 'Compared in ' + named + ' only';
  }
  return 'All modes together';
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
  const meta = el('p', 'lab-change-meta');
  if (when) meta.append(el('span', 'lab-change-when', when));
  meta.append(el('span', 'lab-change-primary-name', 'Judged on kills a match'));
  const scope = scopeNote(c);
  if (scope) meta.append(el('span', 'lab-change-scope', scope));
  card.append(meta);

  card.append(killsLine(c));
  card.append(winRateLine(c));
  card.append(beforeAfterRows(c));

  return card;
}

function renderChanges() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  nodes.changes.replaceChildren();
  if (!list.length) return;
  for (const c of list) nodes.changes.append(changeCard(c));
}

/* ---------- in progress ----------
   One card per change still open: what the setting did, what to watch for while
   playing it, and how far the sample has got towards what it would take. */

const UNREACHABLE = 1500;   // games a side past this is not going to happen on one setting

function progressCard(c) {
  const card = el('article', 'lab-progress');

  const head = el('div', 'lab-progress-head');
  head.append(el('p', 'lab-card-k', c.label || c.setting));
  head.append(el('span', 'lab-tag lab-tag-testing', 'Testing'));
  card.append(head);

  const values = el('p', 'lab-values');
  values.append(el('span', null, c.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, c.to_value));
  card.append(values);

  const when = fmtDay(c.started_at);
  if (when) card.append(el('span', 'lab-change-when', 'Since ' + when));

  if (c.watch) {
    const watch = el('div', 'lab-watch');
    watch.append(el('span', 'lab-watch-k', 'What to watch for'));
    watch.append(el('p', 'lab-watch-t', c.watch));
    card.append(watch);
  }

  const played = c.after && isNum(c.after.matches) ? c.after.matches : 0;

  /* Progress is measured against the games a move of one kill a match would
     need at this kill rate, which is the size of move this lab is built to
     find and the smallest one worth acting on. games_needed is the move seen so
     far, and early in a test that is nearly zero and its target runs into the
     tens of thousands: true, but not a plan. */
  const need = isNum(c.games_target) ? c.games_target : null;

  if (need === null) {
    card.append(el('p', 'lab-c-note', 'No kill rate to size a target from yet. Play a few games and this will fill in.'));
  } else if (need > UNREACHABLE) {
    card.append(el('p', 'lab-c-note', 'A move of one kill a match would take about ' + group(need) + ' games on each side at this rate, which is more than one setting is worth. Play it and trust how it feels.'));
  } else {
    const box = el('div', 'lab-bar');
    const fill = el('span', 'lab-bar-fill');
    /* The fill width is a class, not a style attribute: the CSP forbids inline
       styles and the fill is quantised to five steps anyway, which is as much
       precision as a progress bar honestly carries. */
    fill.classList.add('p' + Math.max(0, Math.min(100, Math.round((played / need) * 20) * 5)));
    box.append(fill);
    card.append(box);
    /* The target is worked out at the kill rate in the window after the change,
       so it moves as the player's rate moves: a higher rate carries more
       variance and so asks for more games. The note says which rate it used so
       the number is never a mystery next to the note on the page. */
    card.append(el('p', 'lab-c-note', matchesWord(played) + ' since the change, of about ' + group(need) + ' on each side for a move of one kill a match, at ' + kpm(c.after.kills_per_match) + ' a match.'));
  }

  if (isNum(c.after && c.after.kills_per_match)) {
    card.append(el('p', 'lab-c-fine', 'So far: ' + kpm(c.after.kills_per_match) + ' kills a match, ' + pct(c.after.win_rate) + ' win rate, over ' + matchesWord(played) + '.'));
  }

  return card;
}

function renderProgress() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const open = list.filter(c => c.status === 'testing');
  nodes.progress.replaceChildren();
  if (!open.length) return;
  for (const c of open) nodes.progress.append(progressCard(c));
}

/* ---------- which setting actually helped ---------- */

function renderRanked() {
  const ranked = (state.perf && Array.isArray(state.perf.ranked)) ? state.perf.ranked : [];
  nodes.ranked.replaceChildren();
  if (!ranked.length) return;
  const list = el('ol', 'lab-rank');
  for (const g of ranked) {
    const li = el('li', 'lab-rank-row');
    const name = el('span', 'lab-rank-name', g.label || g.setting);
    const d = el('span', 'lab-rank-d', isNum(g.kills_delta) ? signed(g.kills_delta, 2) + ' a match' : '\u2014');
    const meta = el('span', 'lab-rank-meta', g.better + ' of ' + g.changes + ' better \u00b7 ' + matchesWord(g.matches) + (isNum(g.delta) ? ' \u00b7 ' + points(g.delta) + ' pts win rate' : ''));
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
  renderCurrent();
  renderCharts();
  renderProgress();
  renderChanges();
  renderRanked();
  renderEmptiness();
}

/* ---------- what to show before there is anything ----------
   A first-time reader has no changes, no open tests and nothing ranked, which
   used to render three separate dashed "nothing here yet" boxes in a row. That
   reads as a broken page. One sentence that says what to do instead, and the
   three sections stay out of the way until each has something real in it. */
function renderEmptiness() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const ranked = (state.perf && Array.isArray(state.perf.ranked)) ? state.perf.ranked : [];
  const anyOpen = list.some(c => c.status === 'testing');

  const empty = !list.length && !ranked.length;
  if (empty) show(nodes.startBlock); else hide(nodes.startBlock);

  nodes.progressBlock.hidden = !anyOpen;
  nodes.changesBlock.hidden = !list.length;
  nodes.rankedBlock.hidden = !ranked.length;
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
