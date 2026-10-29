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
  loadError: $('load-error'), loadErrorText: $('load-error-text'), retry: $('retry'),
  app: $('app'), figures: $('figures'), figuresNote: $('figures-note'),
  now: $('now'), nowBlock: $('now-block'),
  window: $('window'), windowBlock: $('window-block'),
  current: $('current'), currentNote: $('current-note'), currentMode: $('current-mode'),
  chartKpm: $('chart-kpm'), chartKpmBox: $('chart-kpm-box'),
  chartWin: $('chart-win'), chartWinBox: $('chart-win-box'),
  chartKey: $('chart-key'), chartEmpty: $('chart-empty'),
  progress: $('progress'), changes: $('changes'), ranked: $('ranked'),
  changesBlock: $('changes-block'), rankedBlock: $('ranked-block'),
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

/* Which side of the page a change belongs on. A test still running is the live
   question and lives at the top; anything decided is history. Exactly one of the
   two, never both. */
const TESTING = 'testing';
const isOpenChange = c => Boolean(c) && c.status === TESTING;

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
    nodes.figures.append(el('p', 'lab-empty', 'No numbers yet.'));
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
  /* One session is not worth a sentence: the figures above already say so. */
  if (!sessions) { hide(nodes.figuresNote); return; }
  nodes.figuresNote.textContent = 'Split into ' + sessions + (sessions === 1 ? ' session' : ' sessions') + ' so far, one per gap between syncs.';
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
   is not shown: it is an internal identifier he did not ask to read.

   A Creative island is the one case with a name of its own. It has no rank, build
   or team size the log ever states, so the three fields would render as nothing at
   all and the line would disappear - which for an island is wrong, not cautious.
   Its title is the mode. The title is shown exactly as the game wrote it, emoji
   and all, because it is a name rather than a value to normalise. */
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

function renderCurrent() {
  const c = state.perf && state.perf.current;
  nodes.current.replaceChildren();
  renderMode();
  if (!c || !Array.isArray(c.settings) || !c.settings.length) {
    nodes.current.append(el('p', 'lab-empty', 'Nothing yet.'));
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

/* ---------- the two sections that lead the page ----------

   Both answer the question the lab exists for: is the thing I just changed
   working. They read the two windows the server sends - the open test and the
   games since the last change - and neither of them is the lifetime totals,
   which average across every value the setting has ever had. */

/* How big a move a window can see, said plainly. This is the honest answer to
   "do I have enough games": a window is not short or long in the abstract, it can
   only see a move at least this big. */
function detectableText(d, games) {
  if (!isNum(d) || !isNum(games)) return '';
  const shown = Math.round(d * 100) / 100;
  return 'At ' + matchesWord(games) + ' the smallest move this sample could show is about '
    + shown.toFixed(2) + ' kills a match. Anything smaller than that is inside the noise.';
}

/* How far the window has got towards the games a one-kill move would need. A
   bar, quantised to five steps, because that is as much precision as it
   honestly carries. */
function progressBar(played, need) {
  const box = el('div', 'lab-bar');
  const fill = el('span', 'lab-bar-fill');
  fill.classList.add('p' + Math.max(0, Math.min(100, Math.round((played / need) * 20) * 5)));
  box.append(fill);
  return box;
}

/* ---------- kills the log did not report ----------

   A counter read can come back with no kill count, which leaves games in a window
   that the kill rate does not cover. The rate is then measured on the games that
   did carry one, which is right, and the card has to say so - otherwise a figure
   over twenty games reads as though it covers all sixty. Nothing is added up as
   zero to fill the gap.

   One function, used by the live card and by the settled card, so the two can
   never drift into saying slightly different things about the same shortfall. */
function killGaps(c) {
  const one = (side, word) => {
    const all = side && isNum(side.matches) ? side.matches : 0;
    const counted = side && isNum(side.kills_matches) ? side.kills_matches : all;
    if (!side || side.kills_partial !== true || counted >= all) return null;
    return matchesWord(counted) + ' of the ' + matchesWord(all) + ' ' + word + ' carried a kill count';
  };
  const gaps = [one(c.before, 'before the change'), one(c.after, 'after it')].filter(Boolean);
  if (!gaps.length) return null;
  return el('p', 'lab-c-fine', 'Kill counts were missing on some reads: ' + gaps.join(', and ')
    + '. The rate is measured on the games that had one; the rest are left out rather than counted as scoreless games.');
}

/* The same shortfall, for the other rate on the card. A win count that came
   back missing on some reads leaves games in the window the rate does not
   cover, and both the rate and its range are measured on the rest - so the
   card has to say which games the figure is over. */
function winGaps(c) {
  const one = (side, word) => {
    const all = side && isNum(side.matches) ? side.matches : 0;
    const counted = side && isNum(side.wins_matches) ? side.wins_matches : all;
    if (!side || side.wins_partial !== true || counted >= all) return null;
    return matchesWord(counted) + ' of the ' + matchesWord(all) + ' ' + word + ' carried a win count';
  };
  const gaps = [one(c.before, 'before the change'), one(c.after, 'after it')].filter(Boolean);
  if (!gaps.length) return null;
  return el('p', 'lab-c-fine', 'Win counts were missing on some reads: ' + gaps.join(', and ')
    + '. The rate and its range are measured on the games that had one; the rest are left out rather than counted as losses.');
}

/* A reading runs from one counter change to the next, so a settings change
   landing inside one leaves games that cannot be assigned to either value. They
   are in neither figure, which is right, and the card says how many - otherwise
   a 25-vs-25 card reads as everything that happened. */
function unplacedNote(c) {
  const n = isNum(c.unplaced) ? c.unplaced : 0;
  if (n <= 0) return null;
  const many = n !== 1;
  return el('p', 'lab-c-fine', matchesWord(n) + (many ? ' were' : ' was')
    + ' played while a single reading was open across the change, so there is no way to say '
    + (many ? 'which side of it each one fell on. They are counted in neither figure above.'
            : 'which side of it it fell on. It is counted in neither figure above.'));
}

/* ---------- the per-match reading ----------

   The figures above come from the account counters, which only move between
   readings, so a change made mid-session puts every game of that session in a
   reading that straddles it and the card has to leave them out. The replay files
   carry each match's own end time and its own kills, so a second reading of the
   same change can place those games exactly. Where the counter card has to
   abstain, this one can answer.

   It is shown as its own block, never merged into the figures above. Two readings
   from two sources that can disagree must be readable side by side, and a blended
   number would hide the disagreement rather than report it. When it has nothing to
   say - no replays yet, or too few games a side - it says that in one line and
   claims nothing. */

/* Headshots beside the kill figures.
   They are counted by a separate reader from the replay itself, so a match can
   carry a real kill count and still have no headshot number: the reader was not
   installed that evening, or the file would not open. Two rules follow. The line
   is drawn only when at least one of the games beside it carried a count, and it
   names how many did, so a reader never mistakes a partial count for a match
   where he hit nobody in the head. And a zero that was measured stays a zero:
   `headshots_games_*` is what tells the two apart, not the figure. */
function headshotLine(m) {
  const b = isNum(m.headshots_before) ? m.headshots_before : null;
  const a = isNum(m.headshots_after) ? m.headshots_after : null;
  const bg = isNum(m.headshots_games_before) ? m.headshots_games_before : 0;
  const ag = isNum(m.headshots_games_after) ? m.headshots_games_after : 0;
  const games = bg + ag;
  if (!games) return null;

  const total = (b === null ? 0 : b) + (a === null ? 0 : a);
  const placed = (isNum(m.before) ? m.before : 0) + (isNum(m.after) ? m.after : 0);
  const missing = isNum(m.headshots_missing) ? m.headshots_missing : 0;

  /* Said as "24 of the 190 games" only where the two differ. Where every game
     carried a count the qualifier would be noise. */
  const counted = missing > 0 && placed > games
    ? group(games) + ' of the ' + matchesWord(placed)
    : matchesWord(games);

  let sides;
  if (bg && ag) {
    sides = kpm(b / bg) + ' before the change, ' + kpm(a / ag) + ' after';
  } else if (bg) {
    sides = 'all of it before the change, since no match after it has been counted yet';
  } else {
    sides = 'all of it since the change, since no match before it was counted';
  }

  return group(total) + ' over ' + counted + ', ' + kpm(total / games) + ' a match (' + sides + ').';
}

/* Whether there is a per-match reading worth drawing for this change. */
function hasMatchReading(c) {
  const m = c && c.by_match;
  return Boolean(m && (m.before > 0 || m.after > 0));
}

/* The block itself, or null when there is nothing true to say about it. */
function matchReading(c) {
  const m = c.by_match;
  if (!m || !hasMatchReading(c)) return null;

  const box = el('div', 'lab-bymatch');
  const head = el('p', 'lab-bymatch-k');
  head.append(el('span', null, 'From your replays'));
  if (m.verdict !== 'too-soon') {
    head.append(el('span', 'lab-bymatch-tag lab-bymatch-' + m.verdict, VERDICT_WORD[m.verdict] || m.verdict));
  }
  box.append(head);

  /* What it counted. Said as the two sample sizes rather than as one figure,
     because the whole point is which games landed on which side. */
  box.append(el('p', 'lab-bymatch-n',
    matchesWord(m.before) + ' before, ' + matchesWord(m.after) + ' after, placed by when each match ended.'));

  /* The rate on each side, and the move between them, only where the numbers
     exist. A dash is used rather than a zero for a side with no games. */
  const row = el('div', 'lab-bymatch-figs');
  const fig = (name, value) => {
    const f = el('div', 'lab-bymatch-fig');
    f.append(el('span', 'lab-fig-k', name), el('span', 'lab-fig-v', value));
    return f;
  };
  row.append(
    fig('Before', isNum(m.kills_before) ? kpm(m.kills_before) + ' kills' : '\u2014'),
    fig('After', isNum(m.kills_after) ? kpm(m.kills_after) + ' kills' : '\u2014'),
    fig('Move', isNum(m.kills_delta) ? signed(m.kills_delta, 2) : '\u2014'),
  );
  box.append(row);

  /* Only where there is something to count. Nothing is drawn at all when no
     replay carried a headshot number: an empty line or a zero would both read as
     "he hit nobody in the head", which is a claim this page cannot make. */
  const shots = headshotLine(m);
  if (shots) box.append(el('p', 'lab-bymatch-hs', 'Headshots: ' + shots));

  /* Why it is not a verdict yet, in the reader's own terms. The two reasons are
     different situations and a card that blurred them would be telling a reader
     to keep playing when the problem is that no replay was ever recorded. */
  if (m.verdict === 'too-soon') {
    const floor = m.min_games || 25;
    if (m.reason === 'after-thin' && m.after === 0) {
      box.append(el('p', 'lab-c-fine', 'No recorded matches since the change yet.'));
    } else {
      box.append(el('p', 'lab-c-fine', 'Under ' + floor + ' recorded matches a side, so this is the start of the sample rather than a verdict.'));
    }
  } else if (m.verdict === 'better' || m.verdict === 'worse') {
    box.append(el('p', 'lab-c-fine', 'Placed match by match, the ranges separate.'));
  }

  /* The admission that keeps this honest: the counter sample and the replay
     sample are not the same games, and where they differ the card says so
     instead of letting a reader assume the two figures cover one thing. */
  const gaps = [];
  if (isNum(m.counters_only) && m.counters_only > 0) {
    gaps.push(matchesWord(m.counters_only) + ' the counters counted have no replay on this PC, so they are in the figures above and not in these');
  }
  if (isNum(m.unmatched) && m.unmatched > 0) {
    const one = m.unmatched === 1;
    gaps.push(group(m.unmatched) + (one ? ' recorded match carried' : ' recorded matches carried')
      + ' no kill count and ' + (one ? 'was' : 'were') + ' left out rather than counted as scoreless');
  }
  if (gaps.length) box.append(el('p', 'lab-c-fine', gaps.join('. ') + '.'));

  return box;
}

/* When the two readings disagree, say it plainly, and name which one is
   actually better informed. This is the case a single blended figure would have
   hidden, and the case worth the most: the counters lose every game that
   straddled the change, so they often sit at "too soon" while the replays have
   already put those games on the right side and settled it. Saying nothing there
   would throw away the whole point of the replay sample. */
function readingsDisagree(c) {
  const m = c && c.by_match;
  if (!m || !hasMatchReading(c)) return null;
  if (!m.verdict || !c.verdict) return null;

  /* Settled one way by the replays while the counters still cannot place the
     games: the replays win, and the card says why rather than leaving two
     contradictory signals side by side. */
  if (c.verdict === 'too-soon' && m.verdict !== 'too-soon') {
    return el('p', 'lab-c-fine',
      'The counters alone cannot call this one yet, because a match that started before the change and ended after it does not belong to either side. '
      + 'Your replays place each match by when it ended, which is enough to separate the two ranges. That is the reading to trust here.');
  }

  /* The counters have a verdict and the replays do not. Usually just a thinner
     sample on this PC, so it is an explanation and not a contradiction. */
  if (m.verdict === 'too-soon' && c.verdict !== 'too-soon') {
    const floor = m.min_games || 25;
    return el('p', 'lab-c-fine',
      'Your replays do not cover ' + floor + ' matches a side since the change yet, so they cannot confirm the call above. The counter verdict stands on its own sample.');
  }

  if (c.verdict === m.verdict) return null;

  /* Both settled, pointing opposite ways. Neither is wrong: they are counting
     different games, and the card says which is which instead of picking one. */
  return el('p', 'lab-c-fine',
    'The two readings point opposite ways: the account counters say '
    + (VERDICT_WORD[c.verdict] || c.verdict).toLowerCase() + ' and the replays say '
    + (VERDICT_WORD[m.verdict] || m.verdict).toLowerCase()
    + '. The counters cover every account on this key, the replays only matches played on this PC, so they are counting different games. Neither is wrong.');
}

/* ---------- on test now ---------- */

/* Games a side past this is not going to happen on one setting: at that point a
   progress bar is a promise the page cannot keep, so the card says so in words
   instead. */
const UNREACHABLE = 1500;

function renderNow() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const open = list.filter(isOpenChange);
  nodes.now.replaceChildren();
  if (!open.length) { hide(nodes.nowBlock); return; }
  show(nodes.nowBlock);

  for (const c of open) {
    const card = el('article', 'lab-hero');

    const head = el('div', 'lab-hero-head');
    head.append(el('p', 'lab-hero-k', c.label || c.setting));
    head.append(el('span', 'lab-tag lab-tag-testing', 'Testing'));
    card.append(head);

    const values = el('p', 'lab-hero-values');
    values.append(el('span', null, c.from_value), el('span', 'lab-arrow', '\u2192'), el('span', null, c.to_value));
    card.append(values);

    /* What was compared, and since when, on one line. A test running inside one
       mode is a narrower sample and a stronger claim, and an open test is the
       card a reader acts on, so it has to say which games it is counting just as
       a settled card does. */
    const meta = el('p', 'lab-change-meta');
    const when = fmtDay(c.started_at);
    if (when) meta.append(el('span', 'lab-change-when', 'Since ' + when));
    const scope = scopeNote(c);
    if (scope) meta.append(el('span', 'lab-change-scope', scope));
    card.append(meta);

    if (c.watch) {
      const watch = el('div', 'lab-watch');
      watch.append(el('span', 'lab-watch-k', 'What to watch for'));
      watch.append(el('p', 'lab-watch-t', c.watch));
      card.append(watch);
    }

    /* The two numbers this card is for: how it is going since the change, and how
       far that is from being enough to call. */
    const played = c.after && isNum(c.after.matches) ? c.after.matches : 0;
    const kpmNow = c.after ? c.after.kills_per_match : null;
    const kpmBefore = c.before ? c.before.kills_per_match : null;

    const fig = el('div', 'lab-hero-figs');
    const figRow = (name, value, sub) => {
      const box = el('div', 'lab-hero-fig');
      box.append(el('span', 'lab-fig-k', name), el('span', 'lab-fig-v', value));
      if (sub) box.append(el('span', 'lab-fig-sub', sub));
      return box;
    };
    fig.append(
      figRow('Kills a match now', kpm(kpmNow), isNum(kpmBefore) ? 'was ' + kpm(kpmBefore) : ''),
      figRow('Games since', group(played), ''),
      /* `delta` on a change is the win-rate move; `kills_delta` is the kill one.
         The sublabel under a win-rate figure has to be the win-rate move, or the
         card captions the wrong number. */
      figRow('Win rate now', c.after ? pct(c.after.win_rate) : '\u2014', isNum(c.delta) ? points(c.delta) + ' points' : ''),
    );
    card.append(fig);

    const need = isNum(c.games_target) ? c.games_target : null;
    if (need === null) {
      card.append(el('p', 'lab-c-note', 'No kill rate to size a target from yet.'));
    } else if (need > UNREACHABLE) {
      card.append(el('p', 'lab-c-note', 'A move of one kill a match would take about ' + group(need) + ' games on each side at your rate, which is more than one setting is worth. Play it and trust how it feels.'));
    } else {
      /* The rate the target was worked out from, which is the rate since the
         change when there is one and the lifetime rate when there is not. It is
         never printed as a dash: a target with no rate beside it reads as a
         number that came from nowhere. */
      const rateShown = isNum(c.after && c.after.kills_per_match)
        ? c.after.kills_per_match
        : (state.perf && isNum(state.perf.lifetime_rate) ? state.perf.lifetime_rate : null);
      card.append(progressBar(played, need));
      /* Two facts in one line: how far in this is, and how far it has to go.
         Written as "4 of about 187" the second number reads as a target that is
         close, which it is not - so the line spells both out. */
      card.append(el('p', 'lab-c-note', matchesWord(played) + ' since the change. Proving a one-kill move'
        + (isNum(rateShown) ? ' at ' + kpm(rateShown) + ' a match' : '')
        + ' takes about ' + group(need) + ' a side.'));
    }

    /* What the games so far can and cannot say. An open test that reads
       "no change" in its first four games is not a finding, and this says so
       rather than letting the figures above imply otherwise. */
    if (c.verdict === 'too-soon' && c.reason === 'after-thin') {
      card.append(el('p', 'lab-c-fine', 'Under ' + (state.perf.min_games || 25) + ' games a side, so nothing here is a verdict yet \u2014 it is the start of the sample.'));
    }

    /* The admissions a settled card makes, from the same functions, because this
       is the card a decision gets made on. */
    const gaps = killGaps(c);
    if (gaps) card.append(gaps);
    const winShort = winGaps(c);
    if (winShort) card.append(winShort);
    const stuck = unplacedNote(c);
    if (stuck) card.append(stuck);

    /* The per-match reading, which is the one that can place the games the note
       above had to leave out. It goes last because it is the second opinion, and
       it never replaces the figures above it. */
    const byMatch = matchReading(c);
    if (byMatch) card.append(byMatch);
    /* And the line that says which reading to trust when they part ways. On this
       card it matters most: it is the one still being tested. */
    const split = readingsDisagree(c);
    if (split) card.append(split);

    nodes.now.append(card);
  }
}

/* ---------- since the last change ---------- */

function renderWindow() {
  const w = state.perf && state.perf.since_change;
  nodes.window.replaceChildren();
  if (!w || !isNum(w.matches) || w.matches <= 0) { hide(nodes.windowBlock); return; }
  show(nodes.windowBlock);

  const card = el('div', 'lab-window');

  const figs = el('div', 'lab-figures lab-figures-3');
  const fig = (k, v, sub) => {
    const box = el('div', 'lab-fig');
    box.append(el('span', 'lab-fig-k', k), el('span', 'lab-fig-v', v));
    if (sub) box.append(el('span', 'lab-fig-sub', sub));
    return box;
  };
  figs.append(
    fig('Kills a match', kpm(w.kills_per_match), w.interval ? range(w.interval, kpm) : ''),
    fig('Win rate', pct(w.win_rate), isNum(w.wins) ? group(w.wins) + (w.wins === 1 ? ' win' : ' wins') : ''),
    fig('Games', group(w.matches), w.sessions === 1 ? 'one session' : w.sessions + ' sessions'),
  );
  card.append(figs);

  /* The band, drawn: one interval on its own, so the width of the sample is
     visible rather than described. */
  if (w.interval) {
    const box = el('div', 'lab-range');
    box.append(singleRange(w.interval, { label: 'Kills a match since the last change, with its 95% range', axis: v => (Math.round(v * 100) / 100).toFixed(1) }));
    card.append(box);
  }

  const bits = [];
  if (w.label) bits.push('Since ' + w.label + ' changed.');
  if (isNum(w.detectable)) bits.push(detectableText(w.detectable, w.kills_matches || w.matches));
  if (w.unplaced > 0) {
    bits.push(matchesWord(w.unplaced) + (w.unplaced === 1 ? ' was' : ' were') + ' played across the change and cannot be placed on either side, so ' + (w.unplaced === 1 ? 'it is' : 'they are') + ' in neither figure.');
  }
  if (bits.length) card.append(el('p', 'lab-c-fine', bits.join(' ')));

  nodes.window.append(card);
}

/* One interval, drawn as a bar with its mean marked. The counterpart of
   rangeChart, for the case where there is only one side to show. */
function singleRange(iv, opts) {
  const root = svg('svg', { viewBox: '0 0 320 46', role: 'img', 'aria-label': opts.label || '' });
  if (!iv || !isNum(iv.low) || !isNum(iv.high)) return root;
  const lo = iv.low, hi = iv.high;
  const span = hi - lo;
  const pad = span > 0 ? span * 0.14 : Math.max(Math.abs(hi), 1) * 0.2;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const plotW = 320 - 16;
  const xAt = v => 8 + (max === min ? plotW / 2 : ((v - min) / (max - min)) * plotW);
  const y = 22;
  root.append(svg('line', { x1: xAt(lo).toFixed(1), y1: y, x2: xAt(hi).toFixed(1), y2: y, stroke: '#ffe08a', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.55 }));
  root.append(svg('circle', { cx: xAt(iv.mean).toFixed(1), cy: y, r: 3.6, fill: '#ffe08a' }));
  /* The range is already written out in words beside the figures this bar sits
     under, so the bar carries no scale of its own: a second set of two numbers
     under a picture of the same two numbers is noise, not detail. */
  root.append(svgText({ x: 8, y: 42, fill: '#a29f97', 'font-size': 7.5 }, opts.axis(iv.low)));
  root.append(svgText({ x: 312, y: 42, fill: '#a29f97', 'font-size': 7.5, 'text-anchor': 'end' }, opts.axis(iv.high)));
  root.append(svgText({ x: 160, y: 42, fill: '#6f6c66', 'font-size': 7, 'text-anchor': 'middle' }, 'the bar is the range it could sit in'));
  return root;
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
  /* A ceiling, when the metric has one. Win rate cannot exceed 100%, and one
     session of four games won two of them is 50% - which used to stretch the axis
     to 115%, printing a tick above the only value the number can take. The cap
     keeps the scale inside the domain and lets a real spike hit the top of the
     plot instead of inventing headroom that cannot be occupied. */
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

  /* The interval, as a band behind the line.

     A bare line through a handful of games looks like a measurement and is not
     one: four games swinging from 0 to 7 kills a match is two points that read
     as a trend. The band is the 95% range the verdict actually uses, so a wide
     band says "this session could easily be that different" and an eye cannot
     mistake the line for precision it does not have. Only drawn where both
     edges are real numbers, and broken at the same places the line is. */
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
    nodes.chartEmpty.textContent = 'No sessions yet.';
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
  const series = v => chart.map(s => ({
    v: v(s), mark: Boolean(s.change), thin: Boolean(s.thin),
    lo: isNum(s.kills_low) ? s.kills_low : null,
    hi: isNum(s.kills_high) ? s.kills_high : null,
  }));

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
    cap: 1,
    label: 'Win rate by session',
    axis: v => Math.round(v * 100) + '%',
    firstLabel, lastLabel,
    empty: 'Win rate needs a win recorded in a session.',
  }));

  const marks = chart.filter(s => s.change).length;
  const thins = chart.filter(s => s.thin).length;
  const bits = ['Each point is one session.'];
  bits.push('The shaded band is the range each session could really sit in, so a point inside another point\u2019s band is not a change.');
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

  /* A kill count that came back missing on some reads leaves games in the
     window that the rate does not cover. The rate was measured on the rest, and
     the card says so rather than letting the games row imply every one of them
     is in the figure. Nothing is added up as zero to fill the gap. */
  const gaps = killGaps(c);
  if (gaps) wrap.append(gaps);

  const unplaced = unplacedNote(c);
  if (unplaced) wrap.append(unplaced);

  /* The same second opinion the open card carries, on the card a decision was
     actually made on. A settled verdict built from counters left out every game
     that straddled the change; the replays put those games back on the side they
     were played on, so where the two readings agree the reader gets confirmation,
     and where they disagree the line below says so in words. */
  const byMatch = matchReading(c);
  if (byMatch) wrap.append(byMatch);
  const split = readingsDisagree(c);
  if (split) wrap.append(split);

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

  const winShort = winGaps(c);
  if (winShort) wrap.append(winShort);

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
  /* An island is neither ranked nor unranked, and its games are not averaged in
     with a battle royale's, so the note says which of the two narrower samples
     this was rather than calling every narrowed sample "ranked". */
  if (c.scope === 'creative') return 'Creative island games only';
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

/* The history: every change that is no longer being played.

   The split is by status and nothing else. An open test belongs to the top of the
   page in full, and printing the same setting twice - once as a live test, once
   as a card with the same numbers - was the page arguing with itself. So a test
   still running appears only under "On test now", and once it is decided it
   appears only here. No change is ever drawn in both places. */
function renderChanges() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const past = list.filter(c => !isOpenChange(c));
  nodes.changes.replaceChildren();
  if (!past.length) return;
  for (const c of past) nodes.changes.append(changeCard(c));
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
    /* A setting that made things worse used to be visible only as the gap
       between "better" and "changes": 0 of 3 better reads as three games that
       taught nothing, when all three went the other way. The count is the one
       thing worth saying twice, so it goes in the same line. */
    const worse = isNum(g.worse) ? g.worse : 0;
    const meta = el('span', 'lab-rank-meta', g.better + ' of ' + g.changes + ' better'
      + (worse > 0 ? ', ' + worse + ' worse' : '')
      + ' \u00b7 ' + matchesWord(g.matches) + (isNum(g.delta) ? ' \u00b7 ' + points(g.delta) + ' pts win rate' : ''));
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
/* Order matters as much as content here: the page is read top-down, and the top
   is the only part that gets read on a phone between games. The open test comes
   first because it is the live question, then the window it is measured over,
   then the history, then the reference material. */
function render() {
  renderNow();
  renderWindow();
  renderCharts();
  renderChanges();
  renderRanked();
  renderCurrent();
  renderFigures();
  renderEmptiness();
}

/* ---------- what to show before there is anything ----------
   A first-time reader has no changes and nothing ranked, which used to render
   two separate dashed "nothing here yet" boxes in a row. That reads as a broken
   page, so both sections stay out of the way until each has something real. */
function renderEmptiness() {
  const list = (state.perf && Array.isArray(state.perf.changes)) ? state.perf.changes : [];
  const ranked = (state.perf && Array.isArray(state.perf.ranked)) ? state.perf.ranked : [];

  /* The open-test block is owned by renderNow, which hides it when there is
     nothing open. This one only decides the history sections. */
  /* Same filter renderChanges uses, so the heading never sits over an empty box. */
  const past = list.filter(c => !isOpenChange(c));
  nodes.changesBlock.hidden = !past.length;
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
