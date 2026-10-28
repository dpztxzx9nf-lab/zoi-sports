#!/usr/bin/env node
/*
  Log a scrim or tournament match into public/results.json, the single source
  of truth for the /results page.

  node tools/log-match.mjs --game "Fortnite Zero Build" --event "ZB Scrim Block" \
    --date 2026-10-30 --format "Duos, 6 matches" \
    --match 1 --placement 3 --eliminations 4 --field 25 --points 12 [--note "..."]

  Flags: --dry-run  validate and print the resulting JSON, write nothing
         --list     print a compact text table of everything logged
*/

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '..', 'public', 'results.json');

const GAMES = ['Fortnite Zero Build', 'Call of Duty'];

class InputError extends Error {}

/* ---- args ---- */
function parseArgs(argv) {
 const out = { flags: new Set(), values: {} };
 const known = new Set(['game', 'event', 'date', 'format', 'match', 'placement', 'eliminations', 'field', 'points', 'note']);
 for (let i = 0; i < argv.length; i++) {
  const raw = argv[i];
  if (!raw.startsWith('--')) throw new InputError(`Unexpected argument: ${raw}`);
  const eq = raw.indexOf('=');
  const key = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).trim();
  if (key === 'dry-run' || key === 'list' || key === 'help') { out.flags.add(key); continue; }
  if (!known.has(key)) throw new InputError(`Unknown flag: --${key}`);
  const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
  if (value === undefined) throw new InputError(`--${key} needs a value`);
  out.values[key] = value;
 }
 return out;
}

/* ---- validation ---- */
const int = (value, label, { min = 0, minLabel = '0' } = {}) => {
 if (value === undefined || value === '') throw new InputError(`--${label} is required`);
 if (!/^-?\d+$/.test(String(value).trim())) throw new InputError(`--${label} must be a whole number (got "${value}")`);
 const n = Number(value);
 if (!Number.isInteger(n)) throw new InputError(`--${label} must be a whole number (got "${value}")`);
 if (n < min) throw new InputError(`--${label} must be ${min === 1 ? 'a positive integer' : `at least ${minLabel}`} (got ${n})`);
 return n;
};

const text = (value, label) => {
 const s = String(value ?? '').trim();
 if (!s) throw new InputError(`--${label} is required`);
 if (s.length > 120) throw new InputError(`--${label} must be 120 characters or fewer`);
 return s;
};

function validate(v) {
 const game = text(v.game, 'game');
 if (!GAMES.includes(game)) throw new InputError(`--game must be one of: ${GAMES.join(' | ')} (got "${game}")`);
 const event = text(v.event, 'event');
 const date = text(v.date, 'date');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InputError(`--date must be YYYY-MM-DD (got "${date}")`);
 const d = new Date(`${date}T00:00:00Z`);
 if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new InputError(`--date is not a real calendar date: ${date}`);
 const n = int(v.match, 'match', { min: 1 });
 const placement = int(v.placement, 'placement', { min: 1 });
 const field = int(v.field, 'field', { min: 1 });
 const eliminations = int(v.eliminations, 'eliminations', { min: 0 });
 const points = int(v.points, 'points', { min: 0 });
 if (placement > field) throw new InputError(`--placement (${placement}) cannot be greater than --field (${field})`);
 return {
  game, event, date,
  format: v.format === undefined ? '' : text(v.format, 'format'),
  match: { n, placement, eliminations, field, points, note: v.note === undefined ? '' : String(v.note).trim() }
 };
}

/* ---- the record ---- */
function applyMatch(data, m) {
 const events = Array.isArray(data.events) ? data.events : [];
 let ev = events.find(e => e.game === m.game && e.name === m.event && e.date === m.date);
 const newEvent = !ev;
 if (!ev) {
  ev = { id: slug(m.game, m.date, m.event), game: m.game, name: m.event, date: m.date, format: m.format, notes: '', matches: [] };
  events.push(ev);
 } else if (m.format && ev.format !== m.format) {
  ev.format = m.format;
 }
 ev.matches = Array.isArray(ev.matches) ? ev.matches : [];
 const at = ev.matches.findIndex(x => Number(x.n) === m.match.n);
 if (at === -1) ev.matches.push(m.match);
 else ev.matches[at] = m.match;
 ev.matches.sort((a, b) => Number(a.n) - Number(b.n));
 events.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
 data.events = events;
 return { created: newEvent, replaced: !newEvent && at !== -1, event: ev };
}

function slug(game, date, name) {
 const g = game === 'Fortnite Zero Build' ? 'zb' : game === 'Call of Duty' ? 'cod' : 'match';
 let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
 if (s.startsWith(`${g}-`)) s = s.slice(g.length + 1);
 return `${g}-${s || 'event'}-${date}`;
}

/* ---- today in America/Denver ---- */
function today() {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
 const get = t => parts.find(p => p.type === t).value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}

/* ---- --list ---- */
function listTable(data) {
 const events = Array.isArray(data.events) ? data.events : [];
 const rows = [['DATE', 'GAME', 'EVENT', 'M', 'PLACE', 'ELIMS', 'FIELD', 'PTS', 'NOTE']];
 for (const ev of events) {
  const matches = Array.isArray(ev.matches) ? [...ev.matches].sort((a, b) => Number(a.n) - Number(b.n)) : [];
  if (!matches.length) { rows.push([ev.date || '', ev.game || '', ev.name || '', '-', '-', '-', '-', '-', '(no matches)']); continue; }
  for (const m of matches) rows.push([ev.date || '', ev.game || '', ev.name || '', String(m.n ?? ''), String(m.placement ?? ''), String(m.eliminations ?? ''), String(m.field ?? ''), String(m.points ?? ''), m.note || '']);
 }
 if (rows.length === 1) return `No matches logged. (updated ${data.updated || 'unknown'})`;
 const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
 return rows.map(r => r.map((c, i) => (i === rows[0].length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()).join('\n');
}

/* ---- main ---- */
async function main() {
 const args = parseArgs(process.argv.slice(2));
 if (args.flags.has('help')) {
  console.log('Usage: node tools/log-match.mjs --game "<game>" --event "<name>" --date YYYY-MM-DD --format "<format>"\n'
   + '         --match N --placement N --eliminations N --field N --points N [--note "..."]\n'
   + '       node tools/log-match.mjs --list\n'
   + '       node tools/log-match.mjs ... --dry-run');
  return;
 }

 const raw = await readFile(FILE, 'utf8');
 let data;
 try { data = JSON.parse(raw); } catch { throw new InputError(`${path.relative(process.cwd(), FILE)} is not valid JSON`); }
 if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('results.json must hold a JSON object');
 if (!Array.isArray(data.events)) data.events = [];

 if (args.flags.has('list')) { console.log(listTable(data)); return; }

 const m = validate(args.values);
 const { created, replaced, event } = applyMatch(data, m);
 data.updated = today();
 const out = JSON.stringify(data, null, 2) + '\n';

 if (args.flags.has('dry-run')) {
  process.stdout.write(out);
  console.error(`dry run: no file written (${created ? 'new event' : replaced ? 'replaced match' : 'appended match'} in ${event.name})`);
  return;
 }

 await writeFile(FILE, out, 'utf8');
 console.log(`${created ? 'Created event and logged' : replaced ? 'Replaced match' : 'Logged match'} ${m.game} · ${m.event} · match ${m.match.n} — placement ${m.match.placement}/${m.match.field}, ${m.match.eliminations} elims, ${m.match.points} pts (${path.relative(process.cwd(), FILE)})`);
}

main().catch(err => {
 if (err instanceof InputError) { console.error(`log-match: ${err.message}`); process.exit(2); }
 console.error(`log-match: ${err.message}`);
 process.exit(1);
});
