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
  try {
    const g = sessionStorage.getItem(GAME_KEY);
    if (g === 'cod' || g === 'robrun' || g === 'fortnite') return g;
    return 'fortnite';
  } catch { return 'fortnite'; }
};
const storedMode = () => {
  try { return sessionStorage.getItem(MODE_KEY) || ''; } catch { return ''; }
};
const rememberGame = (g) => { try { sessionStorage.setItem(GAME_KEY, g); } catch {} };
const rememberMode = (m) => { try { if (m) sessionStorage.setItem(MODE_KEY, m); } catch {} };

const state = { perf: null, tokens: [], game: storedGame(), mode: storedMode() };
const nodes = {
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), empty: $('empty'),
  nowLead: $('now-lead'), now: $('now'), nowBlock: $('now-block'),
  gameSwitch: $('game-switch'), gameFortnite: $('game-fortnite'), gameCod: $('game-cod'), gameRobRun: $('game-robrun'), currentSettings: $('current-settings'), currentSettingsList: $('current-settings-list'),
  modeSwitch: $('mode-switch'),
  chartsBlock: $('charts-block'),
  chartKpm: $('chart-kpm'), chartKpmBox: $('chart-kpm-box'),
  chartDmg: $('chart-dmg'), chartDmgBox: $('chart-dmg-box'),
  chartWin: $('chart-win'), chartWinBox: $('chart-win-box'), chartWinTitle: $('chart-win-title'),
  chartLegend: $('chart-legend'), chartEmpty: $('chart-empty'),
  matchesTitle: $('cod-matches-title'),
  matchesNote: $('cod-matches-note'),
  codMatches: $('cod-matches'), codMatchList: $('cod-match-list'),
  codMatchesEmpty: $('cod-matches-empty'),
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

const fmtWhen = value => {
  const ms = timeOf(value);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Denver',
  }).format(new Date(ms));
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
  if (state.game === 'robrun') return '/api/lab/performance?game=robrun';
  if (state.game !== 'cod') return '/api/lab/performance';
  let path = '/api/lab/performance?game=cod';
  if (state.mode) path += '&mode=' + encodeURIComponent(state.mode);
  return path;
}

function renderGameSwitch() {
  const games = (state.perf && state.perf.games) || {};
  const count = ['fortnite', 'cod', 'robrun'].filter((k) => games[k]).length;
  if (count < 2 || !nodes.gameSwitch) { if (nodes.gameSwitch) hide(nodes.gameSwitch); return; }
  if (nodes.gameFortnite) nodes.gameFortnite.setAttribute('aria-pressed', state.game === 'fortnite' ? 'true' : 'false');
  if (nodes.gameCod) nodes.gameCod.setAttribute('aria-pressed', state.game === 'cod' ? 'true' : 'false');
  if (nodes.gameRobRun) nodes.gameRobRun.setAttribute('aria-pressed', state.game === 'robrun' ? 'true' : 'false');
  if (nodes.gameFortnite) nodes.gameFortnite.hidden = !games.fortnite && state.game !== 'fortnite';
  if (nodes.gameCod) nodes.gameCod.hidden = !games.cod && state.game !== 'cod';
  if (nodes.gameRobRun) nodes.gameRobRun.hidden = !games.robrun && state.game !== 'robrun';
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


function renderCodMatches() {
  if (!nodes.codMatches) return;
  if (state.game !== 'cod' && state.game !== 'robrun') { hide(nodes.codMatches); return; }
  if (nodes.matchesTitle) nodes.matchesTitle.textContent = state.game === 'robrun' ? 'Shifts' : 'Matches';
  if (nodes.matchesNote) {
    nodes.matchesNote.textContent = state.game === 'robrun'
      ? 'While ROB RUN is running, the lab reads the HUD and files each city shift automatically.'
      : 'While Call of Duty is running, the lab watches for the after-action report on this PC and files every readable stat automatically. F9 captures the screen as a backup.';
  }
  if (nodes.codMatchesEmpty) {
    nodes.codMatchesEmpty.textContent = state.game === 'robrun'
      ? 'No shifts yet. Stay in Looty Bay for a bit and the lab will pick the HUD up on its own.'
      : 'No matches yet. Play a game and leave the after-action report up for a couple of seconds.';
  }
  show(nodes.codMatches);
  const all = (state.perf && Array.isArray(state.perf.recent_matches)) ? state.perf.recent_matches : [];
  const current = (state.perf && state.perf.mode) || state.mode || '';
  const rows = state.game === 'robrun' ? all : all.filter(m => !current || m.mode === current);
  const seen = new Set();
  const ordered = [];
  for (const m of rows) {
    const key = m.id || (m.played_at + ':' + m.mode);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(m);
  }
  if (nodes.codMatchList) nodes.codMatchList.replaceChildren();
  if (!ordered.length) {
    if (nodes.codMatchesEmpty) show(nodes.codMatchesEmpty);
    return;
  }
  if (nodes.codMatchesEmpty) hide(nodes.codMatchesEmpty);
  for (const m of ordered) {
    nodes.codMatchList.append(state.game === 'robrun' ? robrunShiftRow(m) : codMatchRow(m));
  }
}

function codMatchRow(m) {
  const li = el('li', 'lab-match');
  const title = el('p', 'lab-match-line');
  const bits = [];
  bits.push(m.mode_label || m.mode || 'Match');
  if (m.placement != null) bits.push('placed ' + m.placement);
  if (m.kills != null) bits.push(m.kills + (m.kills === 1 ? ' kill' : ' kills'));
  if (m.deaths != null) bits.push(m.deaths + (m.deaths === 1 ? ' death' : ' deaths'));
  const assists = m.assists != null ? m.assists : (m.stats && m.stats.assists);
  const contracts = m.contracts != null ? m.contracts : (m.stats && m.stats.contracts);
  const damage = m.damage != null ? m.damage : (m.stats && m.stats.damage);
  if (assists != null && assists !== '') bits.push(assists + (Number(assists) === 1 ? ' assist' : ' assists'));
  if (contracts != null && contracts !== '') bits.push(contracts + (Number(contracts) === 1 ? ' contract' : ' contracts'));
  if (damage != null && damage !== '') bits.push(group(damage) + ' damage');
  const ed = m.ed_ratio != null ? m.ed_ratio : (m.stats && m.stats.ed_ratio);
  const streaks = m.winstreaks != null ? m.winstreaks : (m.stats && m.stats.winstreaks);
  if (ed != null && ed !== '') bits.push('E/D ' + Number(ed).toFixed(2));
  if (streaks != null && streaks !== '') bits.push(streaks + (Number(streaks) === 1 ? ' winstreak' : ' winstreaks'));
  if (m.score != null) bits.push('score ' + group(m.score));
  if (m.extracted === 1) bits.push('extracted');
  if (m.extracted === 0) bits.push('did not extract');
  if (m.won === 1) bits.push('won');
  if (m.won === 0) bits.push('lost');
  const skip = new Set(['mode','mode_label','kills','deaths','assists','contracts','damage','score','placement','extracted','won','map','ed_ratio','winstreaks','total_damage','player_id']);
  if (m.stats && typeof m.stats === 'object') {
    for (const [k, v] of Object.entries(m.stats)) {
      if (skip.has(k) || v == null || v === '') continue;
      bits.push(String(k).replace(/_/g, ' ') + ' ' + v);
    }
  }
  title.textContent = bits.join(' · ');
  li.append(title);
  const meta = el('p', 'lab-match-meta');
  const src = m.source === 'ocr' ? 'From the scoreboard' : 'From an earlier log';
  const when = fmtWhen(m.played_at);
  meta.textContent = [when, src].filter(Boolean).join(' · ');
  li.append(meta);
  if (m.image) {
    const img = document.createElement('img');
    img.className = 'lab-match-shot';
    img.src = m.image;
    img.alt = 'After-action report';
    li.append(img);
  }
  if (m.id) {
    const actions = el('div', 'lab-match-actions');
    const rm = el('button', 'lab-mini', 'Remove');
    rm.type = 'button';
    rm.addEventListener('click', () => patchCodMatch(m.id, { deleted: true }, rm));
    actions.append(rm);
    li.append(actions);
  }
  return li;
}

function robrunShiftRow(m) {
  const li = el('li', 'lab-match');
  const title = el('p', 'lab-match-line');
  const bits = [];
  const role = m.role ? (m.role.charAt(0).toUpperCase() + m.role.slice(1)) : null;
  if (role) bits.push(role);
  if (m.notoriety != null) bits.push('notoriety ' + m.notoriety);
  if (m.party) bits.push(m.party);
  if (m.duration_s != null) bits.push(fmtMins(m.duration_s) + ' in the city');
  if (m.arrests) bits.push(m.arrests === 1 ? '1 arrest' : m.arrests + ' arrests');
  if (m.deaths) bits.push(m.deaths === 1 ? '1 death' : m.deaths + ' deaths');
  if (m.cash_delta != null) bits.push((m.cash_delta >= 0 ? '+' : '') + group(m.cash_delta) + ' cash');
  else if (m.cash != null) bits.push(group(m.cash) + ' cash');
  if (m.outcome === 'in_progress' || !m.ended_at) bits.push('in progress');
  else if (m.outcome === 'left') bits.push('left the city');
  else if (m.outcome === 'arrested') bits.push('ended in an arrest');
  else if (m.outcome === 'died') bits.push('died');
  else if (m.outcome === 'disconnected') bits.push('disconnected');
  title.textContent = bits.join(' · ') || 'City shift';
  li.append(title);
  const meta = el('p', 'lab-match-meta');
  meta.textContent = [fmtWhen(m.started_at), 'From the HUD'].filter(Boolean).join(' · ');
  li.append(meta);
  if (m.image) {
    const img = document.createElement('img');
    img.className = 'lab-match-shot';
    img.src = m.image;
    img.alt = 'ROB RUN HUD';
    li.append(img);
  }
  if (m.id) {
    const actions = el('div', 'lab-match-actions');
    const rm = el('button', 'lab-mini', 'Remove');
    rm.type = 'button';
    rm.addEventListener('click', () => patchRobRunShift(m.id, rm));
    actions.append(rm);
    li.append(actions);
  }
  return li;
}

async function patchRobRunShift(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/lab/robrun-shifts', { method: 'PATCH', body: { id, deleted: true } });
    if (!r.ok) throw new Error('fail');
    await load();
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return; }
    if (btn) btn.disabled = false;
  }
}

async function patchCodMatch(id, body, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/lab/cod-matches', { method: 'PATCH', body: { id, ...body } });
    if (!r.ok) throw new Error('fail');
    await load();
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return; }
    if (btn) btn.disabled = false;
  }
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
  const games = state.perf.games || {};
  if (state.game === 'cod' && games && !games.cod) {
    state.game = games.robrun ? 'robrun' : 'fortnite';
    rememberGame(state.game);
  }
  if (state.game === 'robrun' && games && !games.robrun) {
    state.game = games.cod ? 'cod' : 'fortnite';
    rememberGame(state.game);
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

function damageMove(c) {
  if (isNum(c && c.damage_delta)) return c.damage_delta;
  return null;
}

function damageReason(c) {
  const d = damageMove(c);
  if (!isNum(d) || Math.abs(d) < 0.5) return '';
  const n = Math.abs(d).toFixed(0);
  return n + (d < 0 ? ' less' : ' more') + ' damage a match since the change.';
}

function verdictBlock(c) {
  const v = liveVerdict(c);
  const name = settingName(c);
  const box = el('div', 'lab-verdict');
  let action = '';
  let reason = '';
  if (v === 'worse') {
    action = 'Put ' + name + ' back to ' + c.from_value + '.';
    reason = [killsReason(c), damageReason(c)].filter(Boolean).join(' ');
  } else if (v === 'better') {
    action = 'Keep ' + name + ' at ' + c.to_value + '.';
    reason = [killsReason(c), damageReason(c)].filter(Boolean).join(' ');
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
  const dmgBefore = c && c.before ? c.before.damage_per_match : null;
  const dmgAfter = c && c.after ? c.after.damage_per_match : null;
  if (isNum(dmgBefore) || isNum(dmgAfter)) {
    body.append(el('p', 'lab-just', kpm(dmgBefore) + ' \u2192 ' + kpm(dmgAfter) + ' damage a match'));
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

function fmtMins(s) {
  if (!isNum(s)) return '';
  const m = Math.round(s / 60);
  return m + 'm';
}

function renderRobRunCharts(chart, p) {
  const minGames = p.chart_min_games || 5;
  if (!chart.length) {
    hide(nodes.chartKpm);
    if (nodes.chartDmg) hide(nodes.chartDmg);
    hide(nodes.chartWin);
    hide(nodes.chartLegend);
    hide(nodes.chartEmpty);
    hide(nodes.chartsBlock);
    return;
  }
  show(nodes.chartsBlock);
  hide(nodes.chartEmpty);
  const first = chart[0], last = chart[chart.length - 1];
  const firstLabel = fmtDay(first.to || first.at);
  const lastLabel = fmtDay(first.to || first.at) === fmtDay(last.to || last.at) ? '' : fmtDay(last.to || last.at);
  const series = v => chart.map(s => ({
    v: v(s), mark: Boolean(s.change), thin: chart.length < minGames,
    lo: null, hi: null,
  }));
  const kTitle = document.querySelector('#chart-kpm .lab-chart-k');
  if (kTitle) kTitle.textContent = 'Notoriety';
  show(nodes.chartKpm);
  nodes.chartKpmBox.append(lineChart(series(s => s.notoriety), {
    min: 0, max: 5, label: 'Notoriety by shift',
    axis: v => String(Math.round(v)),
    firstLabel, lastLabel,
    empty: 'Notoriety needs a level read from the HUD.',
  }));
  if (nodes.chartDmg && nodes.chartDmgBox) {
    const dTitle = document.querySelector('#chart-dmg .lab-chart-k');
    if (dTitle) dTitle.textContent = 'Time in the city';
    show(nodes.chartDmg);
    nodes.chartDmgBox.append(lineChart(series(s => s.duration_s != null ? s.duration_s / 60 : null), {
      min: 0, max: 40, label: 'Minutes in the city',
      axis: v => String(Math.round(v)),
      firstLabel, lastLabel,
      empty: 'Time in the city needs a finished shift.',
    }));
  }
  if (nodes.chartWinTitle) nodes.chartWinTitle.textContent = 'Left the city';
  show(nodes.chartWin);
  nodes.chartWinBox.append(lineChart(series(s => s.survived), {
    min: 0, max: 0.15, cap: 1, label: 'Left the city by shift',
    axis: v => Math.round(v * 100) + '%',
    firstLabel, lastLabel,
    empty: 'Leaving the city is counted when a shift ends on the HUD.',
  }));
  if (chart.length < minGames) {
    nodes.chartLegend.append(el('span', null, '\u25cb under ' + minGames + ' shifts'));
    show(nodes.chartLegend);
  } else {
    hide(nodes.chartLegend);
  }
}

function renderCharts() {
  const p = state.perf || {};
  const chart = Array.isArray(p.chart) ? p.chart : [];
  nodes.chartKpmBox.replaceChildren();
  if (nodes.chartDmgBox) nodes.chartDmgBox.replaceChildren();
  nodes.chartWinBox.replaceChildren();
  nodes.chartLegend.replaceChildren();

  if (!chart.length) {
    hide(nodes.chartKpm);
    if (nodes.chartDmg) hide(nodes.chartDmg);
    hide(nodes.chartWin);
    hide(nodes.chartLegend);
    hide(nodes.chartEmpty);
    hide(nodes.chartsBlock);
    return;
  }

  if (state.game === 'robrun') {
    renderRobRunCharts(chart, p);
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

  const showDamage = Boolean(p.has_damage) && chart.some(s => isNum(s.damage_per_match));
  if (nodes.chartDmg && nodes.chartDmgBox) {
    if (showDamage) {
      show(nodes.chartDmg);
      nodes.chartDmgBox.append(lineChart(series(s => s.damage_per_match), {
        min: 0,
        max: 400,
        label: 'Damage a match by session',
        axis: v => String(Math.round(v)),
        firstLabel, lastLabel,
        empty: 'Damage a match needs a damage count in a session.',
      }));
    } else {
      hide(nodes.chartDmg);
    }
  }

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

function renderCurrentSettings() {
  if (!nodes.currentSettings || !nodes.currentSettingsList) return false;
  const cur = state.perf && state.perf.current;
  const rows = cur && Array.isArray(cur.settings) ? cur.settings.filter((s) => s && s.value != null && s.value !== '') : [];
  nodes.currentSettingsList.replaceChildren();
  if (!rows.length) { hide(nodes.currentSettings); return false; }
  for (const s of rows) {
    const dt = document.createElement('dt');
    dt.textContent = s.label || s.id;
    const dd = document.createElement('dd');
    dd.textContent = prettySetting(s.value);
    nodes.currentSettingsList.append(dt, dd);
  }
  show(nodes.currentSettings);
  return true;
}

function prettySetting(v) {
  if (v === 'true') return 'On';
  if (v === 'false') return 'Off';
  return String(v);
}

function render() {
  renderGameSwitch();
  renderModeSwitch();
  renderCodMatches();
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const open = list.filter(isOpenChange);
  const past = list.filter(c => !isOpenChange(c));
  const lead = pickLead(open, past);
  const settled = isSettledLead(lead);
  const hasCodMatches = (state.game === 'cod' || state.game === 'robrun') && state.perf && Array.isArray(state.perf.recent_matches) && state.perf.recent_matches.length;
  const hasCurrent = renderCurrentSettings();

  nodes.nowLead.replaceChildren();
  nodes.now.replaceChildren();

  if (!list.length) {
    if (hasCodMatches || hasCurrent) hide(nodes.empty);
    else show(nodes.empty);
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
  if (nodes.gameRobRun) {
    nodes.gameRobRun.addEventListener('click', () => {
      if (state.game === 'robrun') return;
      state.game = 'robrun';
      rememberGame('robrun');
      load();
    });
  }
  if (nodes.pcConnect) bootPc();
  load();
  if (nodes.pcConnect) loadPc();
  if (nodes.pcStats) loadStats();
}

boot();
})();
