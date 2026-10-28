/* Settings Lab: a private log for one aim change at a time.
   Sign-in happens at the edge (Cloudflare Access), so this file only reads the log. */
(() => {

const CATALOG = [
  { id: 'look_horizontal_speed', label: 'Look Horizontal Speed', value: '42', type: 'int', step: 2, min: 1, max: 100,
    watch: "How a turn across your body lands. Overshooting the doorway or the corner you swung for means it's too fast; not being able to cover the angle at all means it's too slow." },
  { id: 'look_vertical_speed', label: 'Look Vertical Speed', value: '42', type: 'int', step: 2, min: 1, max: 100,
    watch: 'Whether you can follow someone jumping, gliding or dropping without sliding past them, and whether looking up from a crouch takes more push than you expect.' },
  { id: 'look_boost_speed', label: 'Look Boost Speed', value: '0', type: 'int', step: 2, min: 0, max: 100,
    watch: "Whether the end of the stick's travel adds speed you didn't ask for. A hard hold turning on someone behind you either stops where you meant it to or runs past them." },
  { id: 'look_boost_ramp', label: 'Look Boost Ramp', value: '0.0', type: 'decimal', step: 0.1, min: 0,
    watch: 'How long the extra speed takes to arrive. Watch whether a held turn builds smoothly or shows up as a jolt partway through.' },
  { id: 'look_ease_time', label: 'Look Ease Time', value: '0.0', type: 'decimal', step: 0.05, min: 0,
    watch: 'Whether the view arrives with your thumb or trails behind it. Lag shows up as the crosshair still sliding a moment after you stop pushing.' },
  { id: 'ads_look_horizontal_speed', label: 'ADS Look Horizontal Speed', value: '12', type: 'int', step: 2, min: 1, max: 100,
    watch: 'Whether you can stay on a strafing target at mid range, and whether turning while aimed in a close fight feels sluggish or overshoots.' },
  { id: 'ads_look_vertical_speed', label: 'ADS Look Vertical Speed', value: '12', type: 'int', step: 2, min: 1, max: 100,
    watch: 'Whether you can track someone dropping or strafing up a ramp while aimed, and whether pulling up onto a head takes more stick than it should.' },
  { id: 'ads_boost_speed', label: 'ADS Boost Speed', value: '0', type: 'int', step: 2, min: 0, max: 100,
    watch: 'Whether the far end of the aim stick swings too far in a close fight. Watch a quick correction past the target and whether it comes back cleanly or bounces.' },
  { id: 'ads_boost_ramp', label: 'ADS Boost Ramp', value: '0.0', type: 'decimal', step: 0.1, min: 0,
    watch: 'How fast the extra aim speed kicks in during a hold. Watch for a turn that starts steady and then surges past the target.' },
  { id: 'ads_look_ease_time', label: 'ADS Look Ease Time', value: '0.0', type: 'decimal', step: 0.05, min: 0,
    watch: 'Whether the aim point follows your thumb directly while aimed. Any smoothing shows up as the scope drifting on after you stop moving the stick.' },
  { id: 'scoped_multiplier', label: 'Scope Multiplier', value: '0.95', type: 'decimal', step: 0.05, min: 0,
    watch: 'Whether a scoped flick overshoots up close or falls short at distance. Watch the first shot after you scope in: past the head, on it, or behind it.' },
  { id: 'move_stick_deadzone', label: 'Move Stick Deadzone', value: '0.06', type: 'decimal', step: 0.01, min: 0,
    watch: 'Whether your character starts moving the moment you push, or stays put while the stick takes up slack. Pan the camera sideways and watch for a step that arrives late.' },
  { id: 'look_stick_deadzone', label: 'Look Stick Deadzone', value: '0.05', type: 'decimal', step: 0.01, min: 0,
    watch: 'Whether the view drifts with your thumb off the stick, or whether the stick feels dead at the start of travel. Small aim corrections show it first.' },
  { id: 'left_trigger_release', label: 'Left Trigger Release', value: '0.05', type: 'decimal', step: 0.01, min: 0,
    watch: 'Whether letting off aim drops the scope straight away or hangs on for a moment. Watch a quick scope in and out on a moving target.' },
  { id: 'right_trigger_release', label: 'Right Trigger Release', value: '0.05', type: 'decimal', step: 0.01, min: 0,
    watch: 'Whether the gun stops the instant you let off, or keeps the last shot going. Watch a single tap in a fight and see whether a second round goes off.' },
];

const VERDICTS = [
  { status: 'kept', text: 'Kept' },
  { status: 'reverted', text: 'Reverted' },
  { status: 'inconclusive', text: 'Inconclusive' },
];
const VERDICT_WORD = { kept: 'kept', reverted: 'reverted', inconclusive: 'inconclusive', testing: 'testing' };

/* ---------- tiny DOM helpers (no innerHTML, no inline attributes) ---------- */
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
const show = n => { n.hidden = false; };
const hide = n => { n.hidden = true; };

/* ---------- state ---------- */
const state = { tests: [], settings: [] };
const nodes = {
  who: $('who'),
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), startForm: $('start-form'), setting: $('f-setting'), from: $('f-from'),
  to: $('f-to'), watch: $('f-watch'), games: $('f-games'), repeat: $('repeat'),
  startErrors: $('start-errors'), testing: $('testing'), history: $('history'),
};

class AuthError extends Error {}
class NetError extends Error {}

/* ---------- transport ---------- */
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

function showErrors(list, messages) {
  list.replaceChildren();
  for (const m of messages) list.append(el('li', null, m));
  show(list);
}
const clearErrors = list => { list.replaceChildren(); hide(list); };


/* ---------- load ---------- */
/* A 401 means the Access session is gone, and retrying the fetch would fail the
   same way, so the retry button reloads the page to go back through sign-in. */
let signInNeeded = false;

function failLoad(message) {
  nodes.loadErrorText.textContent = message;
  show(nodes.loadError);
  hide(nodes.app);
}

function needSignIn() {
  signInNeeded = true;
  state.tests = [];
  state.settings = [];
  hide(nodes.who);
  failLoad('Your sign-in expired. Reload the page to sign in again.');
}

async function load() {
  hide(nodes.loadError);
  let r;
  try {
    r = await api('/api/lab');
  } catch (e) {
    if (e instanceof AuthError) { needSignIn(); return false; }
    failLoad("Couldn't reach the log. Check the connection and try again.");
    return false;
  }
  if (!r.ok) {
    failLoad(errorsFrom(r.data, "Couldn't load the log. Try again.").join(' '));
    return false;
  }
  state.tests = Array.isArray(r.data && r.data.tests) ? r.data.tests : [];
  state.settings = Array.isArray(r.data && r.data.settings) ? r.data.settings : [];
  showWho(r.data && r.data.me);
  signInNeeded = false;
  hide(nodes.loadError);
  show(nodes.app);
  render();
  return true;
}

/* Who this log belongs to, straight from the API's read-only copy of the
   verified token. Purely a label: the server never takes a name from here. */
function showWho(me) {
  const seen = me && typeof me === 'object'
    ? String(me.email || me.name || '').trim()
    : '';
  nodes.who.textContent = seen ? 'Your log \u2014 signed in as ' + seen + '.' : '';
  if (seen) show(nodes.who); else hide(nodes.who);
}

/* ---------- catalog ---------- */
const entryFor = id => CATALOG.find(c => c.id === id) || null;

const decimalsOf = v => {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/* Next value to try: a step for numbers, a flip for on/off, a cycle for a list. */
function nextValue(entry) {
  if (!entry) return '';
  if (entry.type === 'onoff') return /^(on|true|1|yes)$/i.test(entry.value) ? (entry.offLabel || 'Off') : (entry.onLabel || 'On');
  if (entry.type === 'enum') {
    const opts = Array.isArray(entry.options) ? entry.options : [];
    if (!opts.length) return entry.value;
    const i = opts.indexOf(entry.value);
    return opts[(i + 1) % opts.length];
  }
  const cur = Number(entry.value);
  const step = Number(entry.step);
  if (!isFinite(cur) || !isFinite(step) || step === 0) return entry.value;
  const places = Math.max(decimalsOf(entry.value), decimalsOf(entry.step));
  let next = cur + step;
  if (isFinite(entry.min)) next = Math.max(entry.min, next);
  if (isFinite(entry.max)) next = Math.min(entry.max, next);
  return next.toFixed(places);
}

/* Where the setting stands now: the value from the last test that was kept,
   otherwise the value on the settings page. */
function currentValue(entry) {
  if (!entry) return '';
  const kept = state.tests.find(t => t.setting === entry.id && t.status === 'kept');
  return kept ? String(kept.to_value) : entry.value;
}

/* ---------- repeat warning ---------- */
const timesWord = n => (n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times');

function repeatNotice(setting) {
  const decided = state.tests.filter(t => t.setting === setting && t.status !== 'testing');
  if (!decided.length) return '';
  const counts = { kept: 0, reverted: 0, inconclusive: 0 };
  for (const t of decided) if (counts[t.status] !== undefined) counts[t.status] += 1;
  const parts = [];
  for (const k of ['kept', 'reverted', 'inconclusive']) {
    if (counts[k]) parts.push(counts[k] + ' ' + VERDICT_WORD[k]);
  }
  const total = decided.length;
  const allSame = parts.length === 1;
  let line = allSame
    ? 'Tried ' + timesWord(total) + ' before, ' + VERDICT_WORD[decided[0].status] + ' ' + timesWord(total) + '.'
    : 'Tried ' + timesWord(total) + ' before: ' + parts.join(', ') + '.';
  const reverted = decided.find(t => t.status === 'reverted');
  if (reverted) line += ' You already tried ' + reverted.from_value + ' to ' + reverted.to_value + ' and reverted it.';
  return line;
}

function updateRepeat() {
  const line = repeatNotice(nodes.setting.value);
  nodes.repeat.textContent = line;
  if (line) show(nodes.repeat); else hide(nodes.repeat);
}

/* ---------- the start form ---------- */
function fillCatalog() {
  const frag = document.createDocumentFragment();
  for (const c of CATALOG) {
    const o = el('option', null, c.label);
    o.value = c.id;
    frag.append(o);
  }
  nodes.setting.replaceChildren(frag);
}

function applySetting(resetWatch) {
  const entry = entryFor(nodes.setting.value);
  if (!entry) return;
  const from = currentValue(entry);
  nodes.from.value = from;
  nodes.to.value = nextValue(Object.assign({}, entry, { value: from }));
  if (resetWatch) nodes.watch.value = entry.watch;
  updateRepeat();
}

nodes.setting.addEventListener('change', () => { clearErrors(nodes.startErrors); applySetting(true); });

nodes.startForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors(nodes.startErrors);
  const entry = entryFor(nodes.setting.value);
  const body = {
    setting: nodes.setting.value,
    label: entry ? entry.label : '',
    from_value: nodes.from.value.trim(),
    to_value: nodes.to.value.trim(),
    watch_for: nodes.watch.value.trim(),
    games_planned: nodes.games.value.trim(),
  };
  const btn = nodes.startForm.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await api('/api/lab', { method: 'POST', body });
    if (!r.ok) { showErrors(nodes.startErrors, errorsFrom(r.data, 'Could not save that test.')); return; }
    await load();
    applySetting(true);
    nodes.games.value = '3';
  } catch (err) {
    if (err instanceof AuthError) { needSignIn(); return; }
    showErrors(nodes.startErrors, ["Couldn't reach the log. Nothing was saved. Try again."]);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- testing cards ---------- */
function verdictPanel(test) {
  const row = el('div', 'lab-verdicts');
  const panel = el('div', 'lab-note-panel');
  hide(panel);
  const label = el('label', 'lab-field', 'What changed?');
  const note = el('textarea');
  note.rows = 2;
  note.placeholder = 'One sentence is plenty.';
  label.append(note);
  const errs = el('ul', 'lab-errors');
  hide(errs);
  const actions = el('div', 'lab-row');
  const save = el('button', 'btn lab-save', 'Save');
  save.type = 'button';
  const cancel = el('button', 'lab-cancel', 'Cancel');
  cancel.type = 'button';
  actions.append(save, cancel);
  panel.append(label, errs, actions);

  let chosen = '';
  let busy = false;

  for (const v of VERDICTS) {
    const b = el('button', 'lab-v lab-v-' + v.status, v.text);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      chosen = v.status;
      for (const other of row.children) other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
      show(panel);
      note.focus();
    });
    row.append(b);
  }

  cancel.addEventListener('click', () => {
    hide(panel);
    clearErrors(errs);
    for (const b of row.children) b.setAttribute('aria-pressed', 'false');
    chosen = '';
  });

  const saveVerdict = async () => {
    if (!chosen || busy) return;
    clearErrors(errs);
    busy = true;
    save.disabled = true;
    try {
      const r = await api('/api/lab/' + test.id, { method: 'PATCH', body: { status: chosen, result_note: note.value.trim() } });
      if (!r.ok) { showErrors(errs, errorsFrom(r.data, 'Could not save that verdict.')); return; }
      await load();
    } catch (err) {
      if (err instanceof AuthError) { needSignIn(); return; }
      showErrors(errs, ["Couldn't reach the log. Nothing was saved. Try again."]);
    } finally {
      busy = false;
      save.disabled = false;
    }
  };
  save.addEventListener('click', saveVerdict);

  return { row, panel };
}

function addGameButton(test) {
  const played = Number.isInteger(test.games_played) ? test.games_played : 0;
  const inc = el('button', 'lab-mini', '+1 game');
  inc.type = 'button';
  inc.addEventListener('click', async () => {
    inc.disabled = true;
    try {
      const r = await api('/api/lab/' + test.id, { method: 'PATCH', body: { games_played: played + 1 } });
      if (!r.ok) { showErrors(errs, errorsFrom(r.data, 'Could not add a game.')); return; }
      await load();
    } catch (err) {
      if (err instanceof AuthError) { needSignIn(); return; }
      showErrors(errs, ["Couldn't reach the log. Nothing was saved."]);
    } finally {
      inc.disabled = false;
    }
  });
  const errs = el('ul', 'lab-errors');
  hide(errs);
  return { inc, errs };
}

function dropControl(test) {
  const wrap = el('div', 'lab-drop-wrap');
  const drop = el('button', 'lab-drop', 'Drop this test');
  drop.type = 'button';
  const confirmRow = el('div', 'lab-row');
  hide(confirmRow);
  const yes = el('button', 'lab-v lab-v-reverted', 'Drop it');
  yes.type = 'button';
  const no = el('button', 'lab-cancel', 'Keep it');
  no.type = 'button';
  const errs = el('ul', 'lab-errors');
  hide(errs);
  confirmRow.append(yes, no);
  drop.addEventListener('click', () => { hide(drop); show(confirmRow); });
  no.addEventListener('click', () => { hide(confirmRow); show(drop); clearErrors(errs); });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try {
      const r = await api('/api/lab/' + test.id, { method: 'DELETE' });
      if (!r.ok) { showErrors(errs, errorsFrom(r.data, 'Could not drop that test.')); return; }
      await load();
    } catch (err) {
      if (err instanceof AuthError) { needSignIn(); return; }
      showErrors(errs, ["Couldn't reach the log. Nothing was removed."]);
    } finally {
      yes.disabled = false;
    }
  });
  wrap.append(drop, confirmRow, errs);
  return wrap;
}

function testingCard(test) {
  const card = el('article', 'lab-card');
  card.append(el('p', 'lab-card-k', test.label));
  const values = el('p', 'lab-values');
  values.append(el('span', null, test.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, test.to_value));
  card.append(values);
  if (test.watch_for) {
    const w = el('p', 'lab-watch');
    w.append(el('span', 'lab-watch-k', 'Watching for: '), document.createTextNode(test.watch_for));
    card.append(w);
  }

  const played = Number.isInteger(test.games_played) ? test.games_played : 0;
  const planned = Number.isInteger(test.games_planned) ? test.games_planned : null;
  const foot = el('div', 'lab-card-foot');
  foot.append(el('span', 'lab-games', planned ? played + ' of ' + planned + ' games' : played + ' played'));
  const game = addGameButton(test);
  foot.append(game.inc);
  card.append(foot, game.errs);

  const v = verdictPanel(test);
  card.append(v.row, v.panel);
  card.append(dropControl(test));
  return card;
}

function renderTesting() {
  const list = state.tests.filter(t => t.status === 'testing');
  nodes.testing.replaceChildren();
  if (!list.length) { nodes.testing.append(el('p', 'lab-empty', 'Nothing in testing right now.')); return; }
  for (const t of list) nodes.testing.append(testingCard(t));
}

/* ---------- history ---------- */
/* D1's datetime('now') writes "2026-10-28 22:24:00", which is UTC but carries no
   marker. Add one so the browser converts it, then show the day in the player's
   zone. Strings that already carry a zone are left as they are. */
const dateParts = value => {
  let s = String(value || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  if (!d || isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Denver',
  }).formatToParts(d);
  const get = t => { const f = parts.find(p => p.type === t); return f ? f.value : ''; };
  return { day: get('day'), month: get('month'), year: get('year') };
};

const fmtDate = value => {
  const p = dateParts(value);
  return p ? p.day + ' ' + p.month + ' ' + p.year : '';
};

const verdictTag = status => el('span', 'lab-tag lab-tag-' + status, VERDICT_WORD[status] || status);

function historyRow(test) {
  const row = el('li', 'lab-hist');
  const head = el('div', 'lab-hist-head');
  const values = el('span', 'lab-hist-values');
  values.append(el('span', null, test.from_value), ' ', el('span', 'lab-arrow', '\u2192'), ' ', el('span', null, test.to_value));
  head.append(values, verdictTag(test.status));
  row.append(head);
  const date = fmtDate(test.decided_at || test.started_at);
  if (date) row.append(el('span', 'lab-hist-date', date));
  if (test.result_note) row.append(el('p', 'lab-hist-note', test.result_note));
  return row;
}

/* Groups come from the API's settings array (which counts every test), and each
   block lists that setting's decided tests newest first. */
function renderHistory() {
  const decided = state.tests.filter(t => t.status !== 'testing');
  nodes.history.replaceChildren();

  if (!state.tests.length) {
    nodes.history.append(el('p', 'lab-empty', 'Nothing tested yet. The first one starts above.'));
    return;
  }
  if (!decided.length) {
    nodes.history.append(el('p', 'lab-empty', 'Nothing decided yet. Verdicts show up here once you save one.'));
    return;
  }

  const seen = new Set();
  const groups = [];
  for (const t of decided) {
    if (seen.has(t.setting)) continue;
    seen.add(t.setting);
    const summary = state.settings.find(s => s.setting === t.setting);
    groups.push({ setting: t.setting, label: (summary && summary.label) || t.label, kept: summary ? summary.kept : 0, reverted: summary ? summary.reverted : 0 });
  }

  const frag = document.createDocumentFragment();
  for (const g of groups) {
    const rows = decided.filter(t => t.setting === g.setting);
    const det = el('details', 'lab-group');
    const sum = el('summary', 'lab-sum');
    sum.append(el('span', 'lab-sum-t', g.label || g.setting), el('span', 'lab-sum-m', g.kept + ' kept \u00b7 ' + g.reverted + ' reverted'));
    const inner = el('ul', 'lab-hist-list');
    for (const t of rows) inner.append(historyRow(t));
    det.append(sum, inner);
    frag.append(det);
  }
  nodes.history.append(frag);
}

function render() {
  renderTesting();
  renderHistory();
  updateRepeat();
}

/* ---------- boot ---------- */
function boot() {
  fillCatalog();
  nodes.retry.addEventListener('click', () => {
    if (signInNeeded) { location.reload(); return; }
    load();
  });
  applySetting(true);
  load();
}

boot();
})();
