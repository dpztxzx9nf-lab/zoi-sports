/* The account menu: the avatar in the header, and the card behind it.
   ---------------------------------------------------------------------------
   This is one implementation for the whole site. It used to live inside lab.js,
   which is why the avatar only existed on the lab: every other page had no menu
   at all. The dialog is built here and put into the body, so a page only has to
   carry the avatar button in its header and load this file.

   Two things a reader can do back there: edit the card the roster shows, and - on
   the lab only, because it is about the lab only - connect and read PCs. The PC
   controls are not built on any other page. That is deliberate: a tab that
   switches to an empty pane, or a "Connect a PC" button with nothing behind it on
   a page that has no lab, is worse than no tab at all.

   Nothing here trusts the browser to keep the two identities in step. Who is
   signed in comes from /api/me, which answers on any page without a sign-in.
   Saving the card goes to the gated /api/lab/profile, so on a public page an
   expired sign-in is a real possibility, and it has to say so rather than
   pretending a save happened. */
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
const show = (n) => { if (n) n.hidden = false; };
const hide = (n) => { if (n) n.hidden = true; };

const btn = $('acct-btn');
/* A page with no avatar in its header has nothing for this file to do. */
if (!btn) return;

const LAB = document.body.classList.contains('lab-page');

/* Profile and Game settings are both on every page; PCs is the lab's own tab and
   is only in the strip where the lab is. "Game settings" rather than "Settings" is
   deliberate: this dialog also holds account things, and nothing here should be
   reachable by a word that could mean either. */
const MARKUP_TABS = `
 <div class="acct-tabs" role="tablist" aria-label="Account sections">
  <button type="button" role="tab" id="acct-tab-profile" aria-controls="acct-profile" aria-selected="true" tabindex="0">Profile</button>
  <button type="button" role="tab" id="acct-tab-settings" aria-controls="acct-settings" aria-selected="false" tabindex="-1">Game settings</button>${LAB ? `
  <button type="button" role="tab" id="acct-tab-pc" aria-controls="acct-pc" aria-selected="false" tabindex="-1">PCs</button>` : ''}
 </div>
`;

/* The profile half of the dialog is on every page. The markup is byte for byte
   what lab.html used to hold inline, so the ids, names and maxlengths a test (or a
   password manager) knows are unchanged. */
const MARKUP_PROFILE = `
<dialog class="acct" id="acct" aria-labelledby="acct-title">
 <div class="acct-head">
  <p class="acct-k" id="acct-title">Your account</p>
  <button type="button" class="acct-x" id="acct-x" aria-label="Close">&times;</button>
 </div>
 <p class="acct-who" id="acct-who" hidden></p>

${MARKUP_TABS}

 <!-- The card people see on the roster, edited here. -->
 <div class="acct-pane" role="tabpanel" id="acct-profile" aria-labelledby="acct-tab-profile" tabindex="0">
  <p class="acct-lede">This is your card on the <a href="/#roster">roster</a>. Saved here, it replaces what the public page shows.</p>
  <form class="acct-form" id="pf-form" novalidate>
   <label class="lab-field" for="pf-gamertag">Gamertag
    <input id="pf-gamertag" name="gamertag" maxlength="32" autocomplete="off" spellcheck="false" required>
   </label>
   <label class="lab-field" for="pf-role">Role
    <input id="pf-role" name="role" maxlength="40" autocomplete="off" placeholder="Founder &amp; Owner">
   </label>
   <div class="acct-two">
    <label class="lab-field" for="pf-region">Region
     <input id="pf-region" name="region" maxlength="24" autocomplete="off" placeholder="NA-East">
    </label>
    <label class="lab-field" for="pf-platform">Platform
     <input id="pf-platform" name="platform" maxlength="24" autocomplete="off" placeholder="PC">
    </label>
   </div>
   <label class="lab-field" for="pf-bio">Bio
    <textarea id="pf-bio" name="bio" rows="3" maxlength="400" placeholder="One or two lines. What you play, how you play it."></textarea>
   </label>

   <p class="acct-sub">Socials</p>
   <p class="acct-hint">Full https links. Anything else is not saved.</p>
   <div class="acct-socials">
    <label class="lab-field" for="pf-x">X<input id="pf-x" name="x" inputmode="url" autocomplete="off" placeholder="https://x.com/you"></label>
    <label class="lab-field" for="pf-tiktok">TikTok<input id="pf-tiktok" name="tiktok" inputmode="url" autocomplete="off" placeholder="https://tiktok.com/@you"></label>
    <label class="lab-field" for="pf-youtube">YouTube<input id="pf-youtube" name="youtube" inputmode="url" autocomplete="off" placeholder="https://youtube.com/@you"></label>
    <label class="lab-field" for="pf-instagram">Instagram<input id="pf-instagram" name="instagram" inputmode="url" autocomplete="off" placeholder="https://instagram.com/you"></label>
    <label class="lab-field" for="pf-twitch">Twitch<input id="pf-twitch" name="twitch" inputmode="url" autocomplete="off" placeholder="https://twitch.tv/you"></label>
    <label class="lab-field" for="pf-kick">Kick<input id="pf-kick" name="kick" inputmode="url" autocomplete="off" placeholder="https://kick.com/you"></label>
   </div>

   <label class="acct-check" for="pf-published">
    <input type="checkbox" id="pf-published" name="published">
    <span>Show this card on the public roster</span>
   </label>

   <div class="acct-actions">
    <button class="btn" type="submit" id="pf-save">Save profile</button>
    <span class="acct-saved" id="pf-saved" hidden role="status"></span>
   </div>
   <ul class="lab-errors" id="pf-errors" hidden></ul>
  </form>
 </div>

 <!-- The in-game Fortnite values the public settings page prints, edited here.
      The one line under the heading is the only filler in this file, and it earns
      its place: this dialog also holds the account's own details, and "settings"
      on its own could plausibly mean either. The fields are not in this markup -
      they are built from the API's answer, because the labels and ranges live in
      one list on the server and a second copy here would drift from it. -->
 <div class="acct-pane" role="tabpanel" id="acct-settings" aria-labelledby="acct-tab-settings" tabindex="0" hidden>
  <p class="acct-hint">Your in-game Fortnite values &mdash; not site or account settings.</p>
  <form class="acct-form" id="gs-form" novalidate>
   <div class="gs-fields" id="gs-fields"></div>
   <div class="acct-actions">
    <button class="btn" type="submit" id="gs-save">Save game settings</button>
    <span class="acct-saved" id="gs-saved" hidden role="status"></span>
   </div>
   <ul class="lab-errors" id="gs-errors" hidden></ul>
  </form>
 </div>
`;

const MARKUP_PC = `
 <!-- Connecting a PC, and what the page's numbers mean. -->
 <div class="acct-pane" role="tabpanel" id="acct-pc" aria-labelledby="acct-tab-pc" tabindex="0" hidden>
  <p class="lab-pc-lede" id="pc-lede">The lab fills itself in from your PC. Connect one, and it sends Fortnite's own settings after every change, so a change opens by itself and nobody has to log it by hand.</p>

  <p class="lab-pc-stats" id="pc-stats" hidden></p>

  <form class="lab-pc-connect" id="pc-connect" novalidate>
   <label class="lab-field lab-field-sm" for="pc-label">Name this PC
    <input id="pc-label" name="label" maxlength="40" autocomplete="off" spellcheck="false" placeholder="This PC">
   </label>
   <button class="btn lab-pc-btn" type="submit" id="pc-add">Connect a PC</button>
  </form>

  <ul class="lab-errors" id="pc-errors" hidden></ul>

  <div class="lab-pc-token" id="pc-token" hidden>
   <p class="lab-pc-note">This is the token, shown once. Paste it into <code>tools/zoi-lab-agent.json</code> beside <code>"token"</code>, then run the agent.</p>
   <code class="lab-code" id="pc-token-value"></code>
   <div class="lab-row">
    <button class="lab-mini" type="button" id="pc-copy">Copy token</button>
    <button class="lab-mini" type="button" id="pc-done">Done</button>
   </div>
   <p class="lab-pc-copied" id="pc-copied" hidden>Copied.</p>
  </div>

  <ul class="lab-pc-list" id="pc-list"></ul>
  <p class="lab-empty" id="pc-empty" hidden>No PC connected yet.</p>

  <h3 class="acct-h3">How to read this</h3>
  <div class="lab-note" id="note">
   <p>A setting nudge is small next to the noise of a few nights, so the verdicts run on kills a match, which moves fast enough to read, and win rate is the slow second opinion underneath it. The window is counted in games rather than days: at about five kills a match, a one-kill move needs roughly 190 games a side to prove out, and a week can hold twelve games or two hundred.</p>
  </div>
 </div>
`;

const MARKUP = MARKUP_PROFILE + (LAB ? MARKUP_PC : '') + '</dialog>';

if (!$('acct')) {
  const tpl = document.createElement('template');
  tpl.innerHTML = MARKUP;
  document.body.append(tpl.content.firstElementChild);
}

/* Everything below is looked up inside this dialog rather than the document.
   The home page carries a roster popup of its own, and a document-wide lookup
   would hand this file the first element with that id - which on that page is
   the popup's, not this form's. The fields would fill and save nothing. Scoped
   lookups cannot make that mistake, and they do not care what a future page
   names its own markup. */
const acct = $('acct');
const inAcct = (id) => (acct ? acct.querySelector('#' + id) : null);
const inAcctCls = (sel) => (acct ? acct.querySelector(sel) : null);

const nodes = {
  btn, initial: $('acct-initial'), acct, x: inAcct('acct-x'), who: inAcct('acct-who'),
  tabs: inAcctCls('.acct-tabs'),
  tabProfile: inAcct('acct-tab-profile'), tabSettings: inAcct('acct-tab-settings'),
  tabPc: inAcct('acct-tab-pc'),
  profile: inAcct('acct-profile'), settings: inAcct('acct-settings'), pc: inAcct('acct-pc'),
  gsForm: inAcct('gs-form'), gsFields: inAcct('gs-fields'), gsSave: inAcct('gs-save'),
  gsSaved: inAcct('gs-saved'), gsErrors: inAcct('gs-errors'),
  form: inAcct('pf-form'), gamertag: inAcct('pf-gamertag'), role: inAcct('pf-role'),
  region: inAcct('pf-region'), platform: inAcct('pf-platform'), bio: inAcct('pf-bio'),
  published: inAcct('pf-published'), save: inAcct('pf-save'), saved: inAcct('pf-saved'),
  errors: inAcct('pf-errors'),
  socials: {
    x: inAcct('pf-x'), tiktok: inAcct('pf-tiktok'), youtube: inAcct('pf-youtube'),
    twitch: inAcct('pf-twitch'), instagram: inAcct('pf-instagram'), kick: inAcct('pf-kick'),
  },
};

/* The strip stays on every page: there are two panes everywhere now, then three on
   the lab. It used to be removed when Profile was the only tab, because a tablist
   with one tab is a control with nothing to do - that reason is gone. */
const TABS = [nodes.tabProfile, nodes.tabSettings, nodes.tabPc].filter(Boolean);

/* ---------- talking to the lab ---------- */

class AuthError extends Error {}
class NetError extends Error {}

/* The card lives behind the same gate as the lab, so on a public page a signed-out
   visitor does not get an error document - Cloudflare Access answers with a
   redirect to its login page. A plain fetch follows that redirect and hands back
   the login page with a 200, which a form would happily take as "saved". So a
   redirect, a 401/403, or a 200 that is not JSON all count as the same thing:
   this needed a sign-in. */
async function api(path, options) {
  const opt = options || {};
  const headers = {};
  if (opt.body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method: opt.method || 'GET',
      headers,
      redirect: 'manual',
      body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
    });
  } catch { throw new NetError('offline'); }
  if (res.type === 'opaqueredirect' || res.status === 0) throw new AuthError('redirected');
  if (res.status === 401 || res.status === 403) throw new AuthError('unauthorized');
  const type = (res.headers.get('content-type') || '').toLowerCase();
  let data = null;
  if (type.indexOf('json') !== -1) {
    try { data = await res.json(); } catch { data = null; }
  } else if (res.ok) {
    throw new AuthError('not-json');
  }
  return { ok: res.ok, status: res.status, data };
}

const NETWORK_LABEL = {
  x: 'X', tiktok: 'TikTok', youtube: 'YouTube',
  instagram: 'Instagram', twitch: 'Twitch', kick: 'Kick',
};

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
function clearProfileErrors() { nodes.errors.replaceChildren(); hide(nodes.errors); }

/* What a reader sees when the card cannot be reached because the sign-in is not
   there: the reason, a way to fix it, and - on a save - the fact that nothing was
   written. A failed save that looks like a working one is the one outcome this
   whole file has to avoid. */
function showSignInNeeded(extra) {
  const li = el('li', null, 'Sign in to edit your card. ');
  const a = document.createElement('a');
  a.href = '/lab';
  a.textContent = 'Sign in at the lab';
  li.append(a, document.createTextNode('.'));
  if (extra) li.append(document.createTextNode(' ' + extra));
  nodes.errors.replaceChildren(li);
  show(nodes.errors);
}

/* ---------- who is signed in ---------- */

/* /api/me answers on every page and never asks for a sign-in to do it. No answer
   means no avatar: an avatar in the corner of a signed-out page is a control that
   leads nowhere. */
async function whoAmI() {
  try {
    const res = await fetch('/api/me', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.signedIn === true ? data : null;
  } catch { return null; }
}

function showAccount(me) {
  const email = me && typeof me === 'object' ? String(me.email || '').trim() : '';
  const name = me && typeof me === 'object' ? String(me.name || '').trim() : '';
  const shown = name || email;
  if (!shown) { hide(nodes.btn); return; }
  nodes.initial.textContent = shown.charAt(0).toUpperCase();
  nodes.btn.setAttribute('aria-label', 'Your account' + (email ? ', signed in as ' + email : ''));
  if (email) {
    nodes.who.textContent = 'Signed in as ' + email + '.';
    show(nodes.who);
  } else {
    hide(nodes.who);
  }
  show(nodes.btn);
}

/* ---------- opening, closing, switching ---------- */

let profileLoaded = false;
let settingsLoaded = false;

/* The three panes, in tab order. Which one is showing is a name, and the tab and
   the pane for that name are a pair - so a pane cannot be selected without its tab
   agreeing. A pane that is not in this document (PCs off the lab) is skipped
   rather than addressed. */
const PANES = [
  { name: 'profile', tab: nodes.tabProfile, pane: nodes.profile },
  { name: 'settings', tab: nodes.tabSettings, pane: nodes.settings },
  { name: 'pc', tab: nodes.tabPc, pane: nodes.pc },
].filter((p) => p.tab && p.pane);

function acctPane(which) {
  if (!PANES.length) return;
  const want = PANES.some((p) => p.name === which) ? which : PANES[0].name;
  for (const p of PANES) {
    const on = p.name === want;
    p.tab.setAttribute('aria-selected', on ? 'true' : 'false');
    p.tab.tabIndex = on ? 0 : -1;
    p.pane.hidden = !on;
  }
  /* Reading the settings waits until the pane is actually looked at. Most visits
     to this dialog are a profile edit, and a read nobody asked for is a request
     per dialog opened, on every page, for nothing. */
  if (want === 'settings' && !settingsLoaded) loadSettings();
}

function openAccount() {
  acctPane('profile');
  nodes.acct.showModal();
  nodes.btn.setAttribute('aria-expanded', 'true');
  nodes.x.focus();
  if (!profileLoaded) loadProfile();
}

function closeAccount() {
  nodes.acct.close();
  nodes.btn.setAttribute('aria-expanded', 'false');
  nodes.btn.focus();
}

/* ---------- the profile form ---------- */

/* Which fields the reader has already typed into. The profile arrives from the
   network while the dialog is open, and it used to be written straight into the
   boxes: open the menu, start typing fast, and the load landed on top of the
   keystrokes half way through a gamertag, giving "PlayerOneZB" from a field the
   reader had typed "OneZB" into. A fetch that started before they typed must
   never overwrite what they typed, so every field carries a dirty flag and a
   load only fills the ones still untouched.

   The save path passes force, because there the server's answer is the truth and
   the form should show exactly what was stored. */
const pfTouched = new Set();

function fillProfile(p, force) {
  const has = Boolean(p);
  const put = (input, key, value) => {
    if (!input) return;
    if (!force && pfTouched.has(key)) return;
    input.value = value;
  };

  put(nodes.gamertag, 'gamertag', has && p.gamertag ? p.gamertag : '');
  put(nodes.role, 'role', has && p.role ? p.role : '');
  put(nodes.region, 'region', has && p.region ? p.region : '');
  put(nodes.platform, 'platform', has && p.platform ? p.platform : '');
  put(nodes.bio, 'bio', has && p.bio ? p.bio : '');
  if (force || !pfTouched.has('published')) {
    nodes.published.checked = has ? p.published === true : false;
  }
  const socials = has && p.socials && typeof p.socials === 'object' ? p.socials : {};
  for (const net of Object.keys(nodes.socials)) {
    put(nodes.socials[net], 'social:' + net, typeof socials[net] === 'string' ? socials[net] : '');
  }
}

/* Wire the dirty flags once. Any keystroke in a field marks it, and a field the
   reader has cleared counts as typed in too: deleting a bio on purpose must not
   be undone by the load either. */
function watchProfileFields() {
  const map = {
    gamertag: nodes.gamertag, role: nodes.role, region: nodes.region,
    platform: nodes.platform, bio: nodes.bio,
  };
  for (const key of Object.keys(map)) {
    const input = map[key];
    if (input) input.addEventListener('input', () => pfTouched.add(key));
  }
  for (const net of Object.keys(nodes.socials)) {
    const input = nodes.socials[net];
    if (input) input.addEventListener('input', () => pfTouched.add('social:' + net));
  }
  nodes.published.addEventListener('change', () => pfTouched.add('published'));
}

async function loadProfile() {
  clearProfileErrors();
  try {
    const r = await api('/api/lab/profile');
    if (!r.ok) {
      showErrors(nodes.errors, errorsFrom(r.data, "Couldn't read your profile just now."));
      return;
    }
    fillProfile(r.data && r.data.profile ? r.data.profile : null, false);
    profileLoaded = true;
  } catch (e) {
    if (e instanceof AuthError) { showSignInNeeded(); return; }
    showErrors(nodes.errors, ["Couldn't reach the lab. Your profile was not loaded."]);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  clearProfileErrors();
  hide(nodes.saved);

  const gamertag = nodes.gamertag.value.trim();
  if (!gamertag) {
    showErrors(nodes.errors, ['A gamertag is required: it is the name on the card.']);
    nodes.gamertag.focus();
    return;
  }

  const socials = {};
  for (const net of Object.keys(nodes.socials)) {
    const raw = (nodes.socials[net].value || '').trim();
    if (raw) socials[net] = raw;
  }

  nodes.save.disabled = true;
  try {
    const r = await api('/api/lab/profile', {
      method: 'PUT',
      body: {
        gamertag,
        role: nodes.role.value,
        region: nodes.region.value,
        platform: nodes.platform.value,
        bio: nodes.bio.value,
        socials,
        published: nodes.published.checked,
      },
    });
    if (!r.ok) {
      showErrors(nodes.errors, errorsFrom(r.data, "Couldn't save your profile."));
      return;
    }
    const saved = r.data && r.data.profile ? r.data.profile : null;
    /* A social that was not a usable https link is filtered out on the way in
       rather than refusing the whole save. Saying which ones is the difference
       between "my link vanished" and "that link was not usable" - and the field
       has to keep what was typed, or there is nothing left to correct. So the
       form is refilled from the saved row FIRST, then the refused fields are put
       back as they were. */
    const dropped = r.data && Array.isArray(r.data.dropped) ? r.data.dropped : [];
    const typed = {};
    for (const net of dropped) if (nodes.socials[net]) typed[net] = nodes.socials[net].value;
    fillProfile(saved, true);
    pfTouched.clear();
    for (const net of Object.keys(typed)) nodes.socials[net].value = typed[net];
    profileLoaded = true;
    if (dropped.length) {
      showErrors(nodes.errors, dropped.map(net =>
        NETWORK_LABEL[net] + ' was not saved: it needs to be a full https link.'));
    } else {
      /* role="status" on this line is what a screen reader hears after a save, so
         it has to be true. It is only ever filled in from the server's own answer. */
      nodes.saved.textContent = saved && saved.published
        ? 'Saved. Your card is on the public roster.'
        : 'Saved. It stays off the public roster until you tick the box.';
      show(nodes.saved);
    }
  } catch (e) {
    if (e instanceof AuthError) { showSignInNeeded('Nothing was saved.'); return; }
    showErrors(nodes.errors, ["Couldn't reach the lab. Nothing was saved."]);
  } finally {
    nodes.save.disabled = false;
  }
}

/* ---------- the game settings form ---------- */

/* The fields are built from the API's answer, not written into the markup. The
   list of settings - labels, order, allowed values, ranges - lives in one place
   on the server, and the public page's rows are keyed to it. A second copy here
   would be a second thing to keep in step, and the drift would be invisible: a
   select with one fewer option saves a value the page then refuses to print.

   So the GET sends `groups`: the same fields in the same order, with just enough
   for a control - the key, the label, the type, the range or the choices. This
   file draws one control per field and posts the key back. */
const gsInputs = new Map();

const fieldControl = (f) => {
  const id = 'gs-' + f.key;
  const label = el('label', 'lab-field', f.label);
  label.setAttribute('for', id);

  if (f.type === 'enum' || f.type === 'bool') {
    const sel = document.createElement('select');
    sel.id = id;
    sel.name = f.key;
    const options = f.type === 'bool' ? ['On', 'Off'] : (Array.isArray(f.values) ? f.values : []);
    for (const v of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.append(o);
    }
    label.append(sel);
    gsInputs.set(f.key, { input: sel, type: f.type });
    return label;
  }

  const input = document.createElement('input');
  input.id = id;
  input.name = f.key;
  input.autocomplete = 'off';
  if (f.type === 'bind') {
    input.type = 'text';
    input.spellcheck = false;
    input.maxLength = Number(f.max) || 24;
  } else {
    input.type = 'number';
    input.inputMode = 'decimal';
    if (Number.isFinite(f.min)) input.min = String(f.min);
    if (Number.isFinite(f.max)) input.max = String(f.max);
    input.step = String(Number(f.step) > 0 ? Number(f.step) : (f.type === 'plain' ? 1 : 0.01));
  }
  label.append(input);
  gsInputs.set(f.key, { input, type: f.type });
  return label;
};

/* One group heading, then its fields in a two-column grid where the screen has
   the room. Built once; a later load only rewrites values, so a reader half way
   through a number is never shown a fresh set of boxes. */
function buildSettingsForm(groups) {
  nodes.gsFields.replaceChildren();
  gsInputs.clear();
  for (const g of groups) {
    const fields = Array.isArray(g && g.fields) ? g.fields : [];
    if (!fields.length) continue;
    const wrap = el('div', 'gs-group');
    if (g.group) wrap.append(el('h3', 'acct-sub', g.group));
    const grid = el('div', 'gs-grid');
    for (const f of fields) {
      if (!f || typeof f.key !== 'string' || !f.key) continue;
      grid.append(fieldControl(f));
    }
    wrap.append(grid);
    nodes.gsFields.append(wrap);
  }
}

/* Writing the values in. Same rule as the profile form: nothing here is force-
   filled while a read is in flight unless the reader has not touched it, because
   a load landing on top of typing is how a saved 42 becomes 4. */
const gsTouched = new Set();

function fillSettings(values, force) {
  const v = values && typeof values === 'object' ? values : {};
  for (const [key, slot] of gsInputs) {
    if (!force && gsTouched.has(key)) continue;
    const value = v[key];
    if (value === undefined || value === null) continue;
    /* A boolean is stored as true/false but its control is a two-value select
       reading On/Off, and String(false) is neither - assigning it left the box
       blank, so HDR and VSync showed nothing at all and a reader could not tell
       off from never-set. The stored value is already the truth; this is only
       how it is written into a control. */
    slot.input.value = slot.type === 'bool' ? (value === true || value === 'On' || value === 1 || value === '1' ? 'On' : 'Off') : String(value);
  }
}

const clearGsErrors = () => {
  nodes.gsErrors.replaceChildren();
  hide(nodes.gsErrors);
};

async function loadSettings() {
  clearGsErrors();
  hide(nodes.gsSaved);
  try {
    const r = await api('/api/lab/settings');
    if (!r.ok) {
      showErrors(nodes.gsErrors, errorsFrom(r.data, "Couldn't read your game settings just now."));
      return;
    }
    const data = (r.data && r.data) || {};
    if (!gsInputs.size) buildSettingsForm(Array.isArray(data.groups) ? data.groups : []);
    fillSettings(data.settings, false);
    gsTouched.clear();
    settingsLoaded = true;
  } catch (e) {
    if (e instanceof AuthError) {
      const li = el('li', null, 'Sign in to edit your game settings. ');
      const a = document.createElement('a');
      a.href = '/lab';
      a.textContent = 'Sign in at the lab';
      li.append(a, document.createTextNode('.'));
      nodes.gsErrors.replaceChildren(li);
      show(nodes.gsErrors);
      return;
    }
    showErrors(nodes.gsErrors, ["Couldn't reach the lab. Your game settings were not loaded."]);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  clearGsErrors();
  hide(nodes.gsSaved);

  const settings = {};
  for (const [key, slot] of gsInputs) settings[key] = slot.input.value;

  nodes.gsSave.disabled = true;
  try {
    const r = await api('/api/lab/settings', { method: 'PUT', body: { settings } });
    if (!r.ok) {
      showErrors(nodes.gsErrors, errorsFrom(r.data, "Couldn't save your game settings."));
      return;
    }
    const saved = r.data && r.data.settings ? r.data.settings : null;
    fillSettings(saved, true);
    gsTouched.clear();
    settingsLoaded = true;
    /* role="status", so the line has to be literally true: the server has just
       answered with the values it stored, and those are what the boxes now hold. */
    nodes.gsSaved.textContent = 'Saved. Your game settings page now shows these.';
    show(nodes.gsSaved);
  } catch (e) {
    if (e instanceof AuthError) {
      const li = el('li', null, 'Sign in to edit your game settings. ');
      const a = document.createElement('a');
      a.href = '/lab';
      a.textContent = 'Sign in at the lab';
      li.append(a, document.createTextNode('. Nothing was saved.'));
      nodes.gsErrors.replaceChildren(li);
      show(nodes.gsErrors);
      return;
    }
    showErrors(nodes.gsErrors, ["Couldn't reach the lab. Nothing was saved."]);
  } finally {
    nodes.gsSave.disabled = false;
  }
}

/* A field the reader has typed in, marked so a load cannot overwrite it. The
   listener sits on the pane, not the fields: the fields are built on the first
   load, so anything bound to them would have to be bound again after every
   rebuild, and one missed rebind is the "my 42 became 4" bug. */
function watchSettingsFields() {
  if (!nodes.gsFields) return;
  const mark = (e) => {
    const input = e.target;
    if (input && input.name && gsInputs.has(input.name)) gsTouched.add(input.name);
  };
  nodes.gsFields.addEventListener('input', mark);
  nodes.gsFields.addEventListener('change', mark);
}

/* ---------- boot ---------- */

function bootAccount() {
  nodes.btn.addEventListener('click', openAccount);
  nodes.x.addEventListener('click', closeAccount);
  /* Every tab switches to the pane it names, whichever panes this document has.
     Arrow keys walk the tabs that are present, which is what a tablist is
     expected to do once it has been announced as one - and on a public page that
     is two tabs, not three. */
  PANES.forEach((p) => p.tab.addEventListener('click', () => acctPane(p.name)));
  TABS.forEach((tab, i) => tab.addEventListener('keydown', (e) => {
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    const next = PANES.find((p) => p.tab === TABS[j]);
    if (!next) return;
    acctPane(next.name);
    TABS[j].focus();
  }));
  /* Escape and the backdrop both close it; the native dialog handles Escape, so
     this only has to keep the button's state honest. */
  nodes.acct.addEventListener('close', () => nodes.btn.setAttribute('aria-expanded', 'false'));
  nodes.acct.addEventListener('click', (e) => {
    if (e.target !== nodes.acct) return;
    const r = nodes.acct.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeAccount();
  });
  nodes.form.addEventListener('submit', saveProfile);
  nodes.gsForm.addEventListener('submit', saveSettings);
  watchProfileFields();
  watchSettingsFields();
  whoAmI().then(showAccount);
}

bootAccount();
})();
