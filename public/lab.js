/* Settings Lab: what the readings add up to.
   Sign-in happens at the edge (Cloudflare Access). This file only reads:
   the changes recorded, and the numbers measured around them.

   The page itself is only what changes a setting in Fortnite: one action,
   the other open tests, and earlier verdicts that might still be worth
   reversing. Everything else was noise. */
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
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), empty: $('empty'),
  now: $('now'), nowBlock: $('now-block'),
  changes: $('changes'), changesBlock: $('changes-block'),
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

function actionLine(c) {
  const name = (c && (c.label || c.setting)) || 'This setting';
  const v = liveVerdict(c);
  if (v === 'better') return 'Keep ' + name + ' at ' + c.to_value + '.';
  if (v === 'worse') return 'Put ' + name + ' back to ' + c.from_value + '.';
  if (v === 'even') return 'Leave ' + name + ' as it is.';
  return 'Keep playing ' + name + '.';
}

function signal(c) {
  const v = liveVerdict(c);
  const d = killsMove(c);
  if (v === 'too-soon') {
    const played = c.after && isNum(c.after.matches) ? c.after.matches : 0;
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

function changeRow(c, opts) {
  const lead = Boolean(opts && opts.lead);
  const v = liveVerdict(c);
  const card = el('details', 'lab-hero lab-hero-' + v + (lead ? ' lab-hero-lead' : ''));

  const sum = el('summary', 'lab-hero-sum');
  if (lead) {
    sum.append(el('span', 'lab-hero-action', actionLine(c)));
  } else {
    const id = el('span', 'lab-hero-id');
    id.append(el('span', 'lab-hero-k', c.label || c.setting));
    const values = el('span', 'lab-hero-values');
    values.append(el('span', null, c.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, c.to_value));
    id.append(values);
    sum.append(id);
  }

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
  const pastWorse = past.filter(c => liveVerdict(c) === 'worse');
  if (rankedOpen[0] && liveVerdict(rankedOpen[0]) === 'worse') return rankedOpen[0];
  if (pastWorse[0]) return pastWorse[0];
  return rankedOpen[0] || null;
}

function render() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const open = list.filter(isOpenChange);
  const past = list.filter(c => !isOpenChange(c));
  const lead = pickLead(open, past);

  nodes.now.replaceChildren();
  nodes.changes.replaceChildren();

  if (!lead && !open.length && !past.length) {
    show(nodes.empty);
    hide(nodes.nowBlock);
    hide(nodes.changesBlock);
    return;
  }
  hide(nodes.empty);

  if (lead || open.length) {
    show(nodes.nowBlock);
    if (lead) nodes.now.append(changeRow(lead, { lead: true }));
    for (const c of open) {
      if (lead && c === lead) continue;
      nodes.now.append(changeRow(c, { lead: false }));
    }
  } else {
    hide(nodes.nowBlock);
  }

  const earlier = past.filter(c => c !== lead);
  nodes.changes.replaceChildren();
  if (!earlier.length) { hide(nodes.changesBlock); return; }
  for (const c of earlier) nodes.changes.append(changeRow(c, { lead: false }));
  show(nodes.changesBlock);
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
