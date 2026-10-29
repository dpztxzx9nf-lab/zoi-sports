/* zoi-replay - the numbers a Fortnite replay file carries about its own match.

   Why this exists
   ---------------
   The lab reads cumulative counters from the stats API, and those counters are
   one pile for the whole account. A setting changed in the middle of an evening
   therefore cannot be judged: the games before the change and the games after it
   arrive as a single total, and every match that straddles the change has to be
   filed as unplaced. The replay files the game already writes to the player's
   own disk are the only per-match record that exists, so they are read here for
   accuracy, kills, damage and placement - one row per match, joined to the
   match the log already proved.

   What a replay is, structurally
   ------------------------------
   A short header, then a stream of chunks. Each chunk is an eight-byte header -
   a type and a byte length - followed by that many bytes. Three of the four
   types matter here: 0 and 2 are the header and the checkpoints, which carry the
   map and the game features the match loaded; 3 is an event, and its payload
   opens with the event's id, its group and its metadata name as length-prefixed
   strings. Type 1 is the recorded network data, and it is zlib-compressed
   inside each chunk, which is why nothing here tries to read it: every fact
   this module needs sits in a type 3 event that is stored in the clear.

   The header also carries the match's start as a .NET tick count and the match's
   length in milliseconds, which together give the end of the match.

   The start clock is in local time wearing a UTC label
   ----------------------------------------------------
   The tick count is the match start in the PLAYING MACHINE'S OWN local time, but
   it is a bare tick count, so reading it as UTC produces a time off by the zone's
   offset. This is the same trap recordedAtUtc sets in the replay header and the
   same one that was caught joining replays to matches once already: in Denver it
   is six hours, and a six-hour-wrong end silently attaches every replay to
   nothing at all - the join has a three-second window - so the reader would look
   like it worked while storing rows no game ever claimed.

   The tick count cannot be corrected by a constant: Denver is -6 in summer and
   -7 in winter, and the game is played either side of a change. So the ticks are
   read as the wall clock they are, then that wall clock is resolved through the
   machine's own zone. The agent runs on the machine that recorded the replay, so
   that zone is the right one. `localWallClockToUtc` is the conversion and the
   test pins it against the real matches the lab already stored.

   The encryption
   --------------
   The two match-stats events are AES-256-ECB encrypted with the key in this
   file's own header. Not the key in the PlayerStateEncryptionKey event, which is
   a different key for a different purpose and which is why an early attempt at
   this decrypted to noise. Each event's payload is preceded by three 32-bit
   words - the start time, the end time and the length - and the length is what
   decides whether the twelve bytes after the header are the ciphertext at all.

   The trap this module is built around
   ------------------------------------
   A Creative match writes no AthenaMatchTeamStats event at all, and its
   AthenaMatchStats payload comes back with zero accuracy, zero eliminations and
   zero damage. That is not a parse failure and it is not a bad game: the event
   simply is not populated. The lab has already been burned once by a zero
   standing in for a missing reading, so nothing here returns zeros as though
   they were measurements. When the file does not positively prove it is a
   battle royale, the row is marked Creative and every number on it is null,
   which reads downstream as "not recorded" rather than as "played badly".

   Nothing here throws out of readReplayStats. A truncated file, a file the game
   is still writing, a file with no key and a file with no stats event all come
   back as { ok: false, reason } - the caller is on a timer and a bad replay must
   never take the settings sync down with it. The small helpers underneath are
   exported so a harness can test them apart from the file I/O, and those do
   throw on malformed input; readReplayStats is the guard around them. */

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";

/* The four bytes every replay opens with. Checking it is what tells a .replay
   apart from a half-written temp file with the same extension. */
export const REPLAY_MAGIC = 0x1ca2e27f;

/* Eight: a type and a length. Replays written by the versions this lab supports
   all use this, and the walk below proves it by landing exactly on the end of
   every real file it is given. */
export const CHUNK_HEADER = 8;

/* The ciphertext lengths the two events have. AthenaMatchStats is 64 bytes of
   four-byte fields; AthenaMatchTeamStats is 16, of which the first four are an
   unknown word and the last four are padding. */
export const MATCH_STATS_BYTES = 64;
export const MATCH_TEAM_STATS_BYTES = 16;

/* Both events' unused tails are filled with a repeating byte, and a wrong key
   turns that into noise. It is a cheap second opinion on a decryption that
   already passed the length guards. */
const MATCH_STATS_PAD = 0x10;
const MATCH_TEAM_STATS_PAD = 0x04;

/* A .NET DateTime counts 100-nanosecond ticks from this instant. The header
   writes the match start that way, in real UTC, and this is the only clock in
   the file worth believing. */
const DOTNET_EPOCH_TICKS = 621355968000000000n;

/* A sanity window for the start clock. A replay whose ticks land outside it is
   not a replay this file understands, and a made-up date would join to the wrong
   match, so it is refused instead. */
const EARLIEST_MS = Date.UTC(2000, 0, 1);
const LATEST_MS = Date.UTC(2100, 0, 1);

/* No real match runs longer than six hours. A length field past this is a
   misread, not a long game. */
const MAX_LENGTH_MS = 6 * 60 * 60 * 1000;

/* The walk stops after this many chunks rather than grinding through a corrupt
   file. Every real replay seen so far has under two hundred. */
const MAX_CHUNKS = 1_000_000;

/* Thrown by the readers below when the file ends before the field they need. It
   never escapes readReplayStats; it is how a short file is reported as a reason
   instead of a stack trace. */
class ShortRead extends Error {}

/* A cursor over a buffer with the handful of types this format uses. Reading
   past the end throws ShortRead rather than returning garbage, because a
   truncated file must not be mistaken for a file whose last chunk happened to
   be zero. */
function cursor(buf, from = 0) {
  let o = from;
  const need = (n) => {
    if (n < 0 || o + n > buf.length) throw new ShortRead("the file ends before " + n + " more bytes at " + o);
  };
  return {
    get offset() { return o; },
    get left() { return buf.length - o; },
    u32() { need(4); const v = buf.readUInt32LE(o); o += 4; return v; },
    i32() { need(4); const v = buf.readInt32LE(o); o += 4; return v; },
    i64() { need(8); const v = buf.readBigInt64LE(o); o += 8; return v; },
    skip(n) { need(n); o += n; },
    bytes(n) { need(n); const v = buf.subarray(o, o + n); o += n; return v; },
    /* An Unreal string: a signed length, a positive one for bytes and a
       negative one for UTF-16, and the count includes the terminating zero. */
    fstring() {
      const n = this.i32();
      if (n === 0) return "";
      if (n > 0) {
        need(n);
        const s = buf.toString("latin1", o, o + n);
        o += n;
        return s;
      }
      const width = -n;
      need(width * 2);
      const s = buf.toString("utf16le", o, o + width * 2);
      o += width * 2;
      return s;
    },
  };
}

/* Unreal writes the zero terminator into the length, so every name arrives with
   a trailing NUL. Everything downstream compares plain names, so it comes off
   here once. */
export function plainName(s) {
  if (typeof s !== "string") return "";
  const cut = s.indexOf("\0");
  return (cut === -1 ? s : s.slice(0, cut)).trim();
}

/* The replay header: the version, the match's length, the key, and the clock.
   This is the layout tools/zoi-lab-agent.mjs already walks for a save file's
   strings, applied to a different format.

   Fields are only read when the version that introduced them says they are
   there. A version 7 file carries all of them; the guards are for the older
   ones and for a file that claims a version it does not have. */
export function readReplayHeader(buf) {
  const r = cursor(buf, 0);
  const magic = r.u32();
  if (magic !== REPLAY_MAGIC) throw new Error("not a Fortnite replay: wrong magic number");
  const version = r.u32();
  /* Version 2 added a list of 20-byte custom version records. A file claiming
     more of them than could fit in its own header is not readable. */
  if (version >= 2) {
    const count = r.i32();
    if (count < 0 || count > 64) throw new Error("not a readable replay: " + count + " custom version records");
    r.skip(count * 20);
  }
  const lengthMs = r.u32();
  r.u32();                                   // network version
  r.u32();                                   // changelist
  const name = plainName(r.fstring());
  const isLive = r.u32();
  let startTicks = null;
  if (version >= 3) startTicks = r.i64();
  const isCompressed = version >= 5 ? r.u32() : 0;
  const isEncrypted = version >= 6 ? r.u32() : 0;
  let key = Buffer.alloc(0);
  if (version >= 6) {
    const keySize = r.u32();
    if (keySize > 1024) throw new Error("not a readable replay: a " + keySize + "-byte key");
    key = r.bytes(keySize);
  }
  return {
    version, lengthMs, name, isLive, isCompressed, isEncrypted, key, startTicks,
    /* Where the chunk stream begins, which is wherever the header stopped. */
    streamStart: r.offset,
  };
}

/* Ticks to a Date. Number() on the difference rather than on the tick count
   itself, because a tick count does not survive a double but a difference of
   under a century does.

   The Date this returns is not the instant the match started. The replay writes
   a local wall-clock reading into a field with no zone, so the value comes out
   with the local time sitting in the UTC fields: 00:34 in Denver in October
   reads back as "2026-10-29T00:34:37Z", six hours before the match was actually
   played. `localWallClockToUtc` is what turns it into a real instant, and
   everything that leaves this module goes through it. */
export function ticksToDate(ticks) {
  const ms = Number((BigInt(ticks) - DOTNET_EPOCH_TICKS) / 10000n);
  return new Date(ms);
}

/* The local wall-clock reading in `naive`'s UTC fields, resolved as an instant.
   Constructing a Date from local components is what applies the zone: the four
   numbers are read back out as they were written, then handed to the Date
   constructor that interprets them where the machine is standing, summer time
   and all. Nothing here assumes an offset, so a match played in March and one
   played in November both land correctly.

   One consequence worth naming: this is the only place in the module whose
   answer depends on the machine it runs on. That is not an accident to be
   engineered away - the file carries no zone, so the machine that recorded it is
   the only source of truth there is - but it does mean the result has to be
   checked against matches in a real database rather than against a number
   written down here. The suite does exactly that. */
export function localWallClockToUtc(naive) {
  return new Date(
    naive.getUTCFullYear(), naive.getUTCMonth(), naive.getUTCDate(),
    naive.getUTCHours(), naive.getUTCMinutes(), naive.getUTCSeconds(),
    naive.getUTCMilliseconds(),
  );
}

/* Every chunk in the stream, in order, with where its payload starts.

   `complete` is the important field: it is true only when the walk landed
   exactly on the last byte of the file. A replay the game is still writing ends
   in the middle of a chunk, and so does one that was copied off a disk mid-save.
   readReplayStats refuses both, because the stats event is written at the end
   and a file that has not reached its end has not written one yet. */
export function walkChunks(buf, from) {
  const chunks = [];
  let at = from;
  let complete = false;
  while (at + CHUNK_HEADER <= buf.length) {
    const type = buf.readUInt32LE(at);
    const size = buf.readInt32LE(at + 4);
    if (type > 3 || size < 0 || at + CHUNK_HEADER + size > buf.length) break;
    chunks.push({ type, at, size, dataAt: at + CHUNK_HEADER });
    at += CHUNK_HEADER + size;
    if (chunks.length > MAX_CHUNKS) break;
  }
  complete = chunks.length > 0 && at === buf.length;
  return { chunks, complete, stoppedAt: at };
}

/* The header chunk, which is the type 0 one near the front. It carries the map
   the match loaded and the game-feature list, both as plain ASCII inside an
   otherwise opaque blob, so they are searched for as strings rather than parsed
   field by field. A layout change would make a parse fail; a search simply
   stops finding them, and the caller treats that as "no evidence". */
export function headerChunkText(buf, walk) {
  for (const c of walk.chunks) {
    if (c.type !== 0) continue;
    return buf.toString("latin1", c.dataAt, c.dataAt + c.size);
  }
  return "";
}

/* The two things in the header chunk worth keeping as evidence: the map the
   match loaded and the game-feature list it named. Both are plain ASCII inside a
   blob whose layout has moved between game versions, so they are found by shape
   rather than by field offset. A pattern that stops matching returns null, which
   a caller reads as "no evidence" - never as evidence of the opposite. */
export function headerFacts(text) {
  if (typeof text !== "string" || !text) return { level: null, features: null };
  /* An Unreal object path: at least two slashes, and not one of the game-feature
     URIs the same chunk also carries. */
  let level = null;
  for (const m of text.matchAll(/(?:^|\0)(\/[A-Za-z0-9_]+\/[A-Za-z0-9_\/]+)/g)) {
    if (m[1].includes("Fortnite.com")) continue;
    level = m[1];
    break;
  }
  const v = /VerseURI=([^\0]*)/.exec(text);
  return { level, features: v ? v[1] : null };
}

/* Every event in the stream, with the three names that identify it and where its
   own fields start. Type 1 chunks carry the same shape but are compressed, so
   they are skipped: an event is only real if it was stored in the clear. */
export function findEvents(buf, walk) {
  const events = [];
  for (const c of walk.chunks) {
    if (c.type !== 3) continue;
    const end = c.dataAt + c.size;
    try {
      const r = cursor(buf, c.dataAt);
      const id = plainName(r.fstring());
      const group = plainName(r.fstring());
      const metadata = plainName(r.fstring());
      if (r.offset > end) continue;
      events.push({ id, group, metadata, dataAt: r.offset, end, chunkAt: c.at });
    } catch {
      /* A type 3 chunk whose names run past its own payload is not an event
         this file can use. Skipping it is the whole of the handling it needs. */
    }
  }
  return events;
}

/* The payload of one event: three 32-bit words - start, end, length - and then
   that many bytes of ciphertext. The start and end are the same value on every
   real match-stats event, and they are the match time in milliseconds, which is
   why an equal pair plus a known length is the guard that separates the real
   event from the event-shaped strings elsewhere in the file. */
export function eventPayload(buf, event, expectedSize) {
  if (!event) return null;
  const r = cursor(buf, event.dataAt);
  let start, end, size;
  try {
    start = r.u32();
    end = r.u32();
    size = r.i32();
  } catch {
    return null;
  }
  if (size !== expectedSize || start !== end) return null;
  if (r.offset + size > buf.length) return null;
  return { start, end, size, at: r.offset, bytes: buf.subarray(r.offset, r.offset + size) };
}

/* AES-256-ECB with no padding of its own: the payload is exactly one or three
   blocks and the game writes its own filler into the tail. */
function decrypt(block, key) {
  const d = createDecipheriv("aes-256-ecb", key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(block), d.final()]);
}

/* True when every byte from `from` to the end is the same filler byte. A wrong
   key passes the length guards about as often as a coin lands heads, but it
   cannot also produce a correctly filled tail. */
function padded(pt, from, pad) {
  for (let i = from; i < pt.length; i++) if (pt[i] !== pad) return false;
  return true;
}

/* The match's own stats, or null when no event in the file survives every
   guard. The field order is fixed by the event's layout and is the only place in
   this module that knows it. */
export function readMatchStats(buf, walk, key) {
  for (const e of findEvents(buf, walk)) {
    if (e.metadata !== "AthenaMatchStats") continue;
    const p = eventPayload(buf, e, MATCH_STATS_BYTES);
    if (!p) continue;
    let pt;
    try { pt = decrypt(p.bytes, key); } catch { continue; }
    if (!padded(pt, 48, MATCH_STATS_PAD)) continue;
    const accuracy = pt.readFloatLE(4);
    /* A hit fraction is between none and all of them. Anything else means the
       bytes were not this event, and a number outside that range would be
       published as a real accuracy. */
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) continue;
    return {
      atMs: p.start,
      accuracy,
      assists: pt.readUInt32LE(8),
      eliminations: pt.readUInt32LE(12),
      weaponDamage: pt.readUInt32LE(16),
      otherDamage: pt.readUInt32LE(20),
      revives: pt.readUInt32LE(24),
      damageTaken: pt.readUInt32LE(28),
      damageToStructures: pt.readUInt32LE(32),
      materialsGathered: pt.readUInt32LE(36),
      materialsUsed: pt.readUInt32LE(40),
      totalTraveled: pt.readUInt32LE(44),
    };
  }
  return null;
}

/* The match's placement, or null. This event is the one a Creative match does
   not write, which is what makes it the positive proof of a battle royale. */
export function readMatchTeamStats(buf, walk, key) {
  for (const e of findEvents(buf, walk)) {
    if (e.metadata !== "AthenaMatchTeamStats") continue;
    const p = eventPayload(buf, e, MATCH_TEAM_STATS_BYTES);
    if (!p) continue;
    let pt;
    try { pt = decrypt(p.bytes, key); } catch { continue; }
    if (!padded(pt, 12, MATCH_TEAM_STATS_PAD)) continue;
    const placement = pt.readUInt32LE(4);
    const totalPlayers = pt.readUInt32LE(8);
    /* A placement of zero, or more players placed than there were players,
       describes no match that was ever played. */
    if (placement < 1 || totalPlayers < placement) continue;
    return { atMs: p.start, placement, totalPlayers };
  }
  return null;
}

/* Accuracy is exactly hits divided by shots, and the event stores only the
   quotient as a 32-bit float. The pairs that could have produced it are
   recovered by asking which small fractions round-trip through float32 to the
   same value, smallest denominator first - 0.4013378 comes back as 120 of 299,
   which is the pair the game recorded.

   What this does NOT do is decide that the smallest pair is the true one. Three
   of the four battle-royale replays on this box return several valid pairs for
   the same float (0.1272 has dozens), so a pair is only a fact when exactly one
   survives; readReplayStats publishes hits and shots only then and leaves them
   null otherwise. The count comes back with the list so a reader can tell "no
   pair fits" from "many do". */
export function accuracyFractions(value, maxDenominator = 3000) {
  const target = Math.fround(value);
  if (!Number.isFinite(target) || target < 0 || target > 1) return [];
  const out = [];
  for (let shots = 1; shots <= maxDenominator; shots++) {
    /* Only the one or two numerators that land on the target for this
       denominator are worth testing, and rounding gives them directly. */
    const guess = Math.round(target * shots);
    for (const hits of [guess - 1, guess, guess + 1]) {
      if (hits < 0 || hits > shots) continue;
      if (Math.fround(hits / shots) === target) out.push({ hits, shots });
    }
  }
  out.sort((a, b) => (a.shots - b.shots) || (a.hits - b.hits));
  return out;
}

/* Headshots, from the local player's damage cues.

   This is the one number in a replay that AthenaMatchStats does not carry. It
   lives in the per-cue RPC stream - every local-player damage cue says whether it
   was critical, and who it landed on - and reading that stream means walking
   decompressed network data packet by packet. That reader exists as a separate
   patched C# tool, not here, and the lab agent must not grow a .NET dependency
   for one column. So the rule is written and tested here and the column stays
   null with a stated reason until the reader is wired in; see readReplayStats.

   The rule, and why each half of it is needed. A cue counts only when
   bIsCritical is true AND it names a victim. Ground truth is the end-of-match
   screen of the 21% match, cross-checked twice: 1 elimination, 8 headshots, 43
   hits, 207 shots, 1195 damage to players. That match held eleven local critical
   cues, and three of them carried no victim at all - the hit actor was a
   structure (3219 and 12665) and the magnitude was exactly 100.0, which is the
   structure-damage shape. Eleven minus those three is the eight on the screen.
   The same named-victim condition, applied to fatal cues in the same match, gave
   one where the screen showed one elimination, while every fatal cue counted
   three. One condition, two different numbers, both right.

   The function takes the cues and nothing else, so it can be checked against a
   hand-written list without a replay, a reader or a network. A cue is read as
   { bIsCritical, victim }; a missing or empty victim is not a named victim. */
export function headshotsFromCues(cues) {
  if (!Array.isArray(cues)) return null;
  let count = 0;
  for (const cue of cues) {
    if (!cue || cue.bIsCritical !== true) continue;
    if (typeof cue.victim !== "string" || !cue.victim.trim()) continue;
    count++;
  }
  return count;
}

/* The name of the reason a headshot count is absent. Shared so the module, the
   agent and the row all say the same thing rather than three variations of it. */
export const HEADSHOTS_REASON = "needs-damage-cue-reader";

/* Which numbers on the row are measurements. Accuracy and damage are the ones a
   Creative payload leaves at zero while still writing a travelled distance, so
   "all zero" has to mean all of them or a zeroed island would pass as a real
   game with no kills. */
const MEASURED = ["accuracy", "assists", "eliminations", "weaponDamage", "otherDamage",
  "damageTaken", "damageToStructures", "totalTraveled"];

const zero = (stats) => MEASURED.every((k) => !stats[k]);

/* One replay, read.

   Returns { ok: true, ... } with the match's window, its stats and whether it
   was a battle royale; or { ok: false, reason } when the file cannot be read.
   Never throws: every failure below is a reason string, because the caller reads
   these in a loop on a timer and one bad file must not stop the rest. */
export function readReplayStats(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return { ok: false, reason: "the replay could not be opened (" + (e && e.message ? e.message : e) + ")" };
  }
  return readReplayBuffer(buf, path);
}

/* The same work on bytes already in hand, so a harness can build a file in
   memory instead of on a disk. */
export function readReplayBuffer(buf, path = "(in memory)") {
  const base = { ok: false, path, source: "", stats: null, reason: "" };

  let header;
  try {
    header = readReplayHeader(buf);
  } catch (e) {
    return { ...base, reason: String(e && e.message ? e.message : e) };
  }

  /* No key means no stats, and that is not a parse failure to work around: the
     file is encrypted and there is nothing here to decrypt it with. */
  if (!header.isEncrypted) return { ...base, reason: "the replay is not encrypted, so it carries no match stats" };
  if (header.key.length !== 32) {
    return { ...base, reason: "the replay header carries a " + header.key.length + "-byte key; match stats need 32" };
  }
  if (!(header.lengthMs > 0) || header.lengthMs > MAX_LENGTH_MS) {
    return { ...base, reason: "the replay states a match length of " + header.lengthMs + " ms, which is not a match" };
  }
  if (header.startTicks === null) {
    return { ...base, reason: "the replay has no start clock, so the match cannot be placed in time" };
  }

  /* The tick count is local wall clock; this resolves it to the real instant.
     See localWallClockToUtc - a six-hour error here does not fail loudly, it
     makes every replay miss its match by six hours and attach to nothing. */
  const started = localWallClockToUtc(ticksToDate(header.startTicks));
  const startedMs = started.getTime();
  if (!Number.isFinite(startedMs) || startedMs < EARLIEST_MS || startedMs > LATEST_MS) {
    return { ...base, reason: "the replay's start clock is not a date this century" };
  }
  const endedMs = startedMs + header.lengthMs;

  const walk = walkChunks(buf, header.streamStart);
  if (!walk.complete) {
    /* The distinguishing fact between a finished replay and one the game is
       still writing is that the finished one's chunk stream lands exactly on its
       last byte. Said in those words, because "truncated" alone reads as a bug
       in the reader rather than as a file to try again later. */
    return {
      ...base,
      reason: "the replay stops in the middle of a chunk at " + walk.stoppedAt + " of " + buf.length +
        " bytes, so it is truncated or the game is still writing it",
    };
  }

  const team = readMatchTeamStats(buf, walk, header.key);
  const stats = readMatchStats(buf, walk, header.key);

  /* No stats event at all is a file this module cannot say anything about. It is
     reported as a failure rather than as a Creative match, because a Creative
     match does write the event - it just writes it empty. */
  if (!stats) return { ...base, reason: "the replay has no AthenaMatchStats event" };

  /* A battle royale is proved by its own ladder event, which a Creative match
     never writes. Deliberately one-sided: the absence of proof is Creative, so
     an island - or a file whose layout has moved on - lands as unknown instead
     of as a real 0%. The header chunk's game-feature list is read for the record
     but is not allowed to prove anything on its own, because Creative islands
     load the Creative root next to the battle-royale one and "the island loaded
     a BR feature" is not evidence that a ladder was played. */
  const creative = team === null;
  const facts = headerFacts(headerChunkText(buf, walk));

  const out = {
    ...base,
    ok: true,
    source: path,
    name: header.name,
    version: header.version,
    lengthMs: header.lengthMs,
    startedAtUtc: started.toISOString(),
    endedAtUtc: new Date(endedMs).toISOString(),
    creative,
    /* The map the match loaded, as the file wrote it, and the game features it
       named. Neither is a decision here; they are carried so a person reading a
       row can see why the rule above landed where it did. */
    level: facts.level,
    features: facts.features,
    /* Everything a caller might display, all null until the row is a
       measurement. `stats` stays null until then as well, and is the one field a
       caller has to check: the flat keys below exist so a reader does not have
       to reach through an object for one number, and the object exists so
       "nothing was recorded" is a single test rather than eight null checks. */
    stats: null,
    accuracy: null,
    assists: null,
    eliminations: null,
    weaponDamage: null,
    otherDamage: null,
    damageTaken: null,
    damageToStructures: null,
    totalTraveled: null,
    placement: null,
    totalPlayers: null,
    /* The recovered hit and shot counts. Both null unless exactly one pair of
       small whole numbers round-trips to the stored float; the percentage above
       is always the measurement, this pair is the readable form of it. */
    accuracyHits: null,
    accuracyShots: null,
    accuracyCandidates: 0,
    /* Damage to players, which the event splits into weapon and other damage and
       the end-of-match screen shows as one number. Their sum is exact - 821 + 374
       is the screen's 1195 on the ground-truth match - so it is computed here
       rather than stored, and it is null whenever either half is. */
    damageToPlayers: null,
    /* Not in this event at all; see headshotsFromCues above. Null with a reason,
       never a zero, because a zero here would read as "he hit nobody in the head"
       and that is a claim this reader cannot make. */
    headshots: null,
    headshotsReason: HEADSHOTS_REASON,
  };

  if (creative) {
    return {
      ...out,
      reason: "no AthenaMatchTeamStats event, so this is not a battle royale and its match stats are not a ladder " +
        "reading; the payload still carries " + stats.damageTaken + " damage taken and " + stats.totalTraveled +
        " travelled, which is why an all-zero test alone would have called it a real game",
    };
  }

  if (zero(stats)) {
    return { ...out, reason: "the match's stats payload is entirely zero, which is what the game writes when it did not record them" };
  }

  const pairs = accuracyFractions(stats.accuracy);
  return {
    ...out,
    reason: "",
    stats: {
      accuracy: stats.accuracy,
      assists: stats.assists,
      eliminations: stats.eliminations,
      weaponDamage: stats.weaponDamage,
      otherDamage: stats.otherDamage,
      damageToPlayers: stats.weaponDamage + stats.otherDamage,
      damageTaken: stats.damageTaken,
      damageToStructures: stats.damageToStructures,
      totalTraveled: stats.totalTraveled,
      placement: team.placement,
      totalPlayers: team.totalPlayers,
      accuracyHits: pairs.length === 1 ? pairs[0].hits : null,
      accuracyShots: pairs.length === 1 ? pairs[0].shots : null,
      headshots: null,
      headshotsReason: HEADSHOTS_REASON,
    },
    accuracy: stats.accuracy,
    assists: stats.assists,
    eliminations: stats.eliminations,
    weaponDamage: stats.weaponDamage,
    otherDamage: stats.otherDamage,
    damageToPlayers: stats.weaponDamage + stats.otherDamage,
    damageTaken: stats.damageTaken,
    damageToStructures: stats.damageToStructures,
    totalTraveled: stats.totalTraveled,
    placement: team.placement,
    totalPlayers: team.totalPlayers,
    /* A pair is published only when it is the only one that fits; see
       accuracyFractions for why the smallest is not good enough on its own. */
    accuracyHits: pairs.length === 1 ? pairs[0].hits : null,
    accuracyShots: pairs.length === 1 ? pairs[0].shots : null,
    accuracyCandidates: pairs.length,
  };
}

/* The shape the sync endpoint and the agent both carry: the row without the
   fields that describe the reader's own work. `recorded` is the one a reader
   looks at first, and it is true only when there are numbers to look at.

   `cues` is the cue reader's answer for this replay, as
   tools/zoi-cues.mjs returns it: { ok: true, headshots } or { ok: false, reason }.
   It is a third argument because headshots come from a different reader than
   everything else on the row, and the two fail independently - a replay whose
   stats read perfectly can still fail its cue read, and the row has to say so
   rather than drop the match. Omitted, it behaves exactly as it always did:
   null with the reason, because nothing was measured.

   A measured zero is a number and travels as one. Only a failed or absent read
   is null, and it always carries the reason, so no caller can mistake a reader
   that did not run for a match with no headshots. */
export function replayRow(result, source, cues) {
  const r = result || {};
  const recorded = Boolean(r.ok && r.stats !== null);
  return {
    source: source || (typeof r.source === "string" ? r.source : ""),
    recorded,
    creative: r.creative === true,
    reason: typeof r.reason === "string" ? r.reason : "",
    startedAtUtc: r.startedAtUtc || null,
    endedAtUtc: r.endedAtUtc || null,
    lengthMs: typeof r.lengthMs === "number" ? r.lengthMs : null,
    accuracy: recorded ? r.accuracy : null,
    /* How many hit/shot pairs fit the stored float. Carried so a null pair reads
       as "fourteen pairs fit this percentage" instead of as a reader that missed
       the count. */
    accuracyPairs: recorded && typeof r.accuracyCandidates === "number" ? r.accuracyCandidates : null,
    assists: recorded ? r.assists : null,
    eliminations: recorded ? r.eliminations : null,
    weaponDamage: recorded ? r.weaponDamage : null,
    otherDamage: recorded ? r.otherDamage : null,
    damageToPlayers: recorded ? r.damageToPlayers : null,
    damageTaken: recorded ? r.damageTaken : null,
    damageToStructures: recorded ? r.damageToStructures : null,
    totalTraveled: recorded ? r.totalTraveled : null,
    placement: recorded ? r.placement : null,
    totalPlayers: recorded ? r.totalPlayers : null,
    /* The measured count when the cue reader ran, null with the reason when it
       did not. The reason travels with the null so a stored row says why,
       instead of looking like a match in which nobody was shot in the head.
       Only a recorded match carries a count: a Creative island's cues are real
       hits on real players, so counting them would report headshots from a
       match that has no match stats at all. */
    headshots: recorded && cues && cues.ok === true && Number.isFinite(cues.headshots) ? cues.headshots : null,
    headshotsReason: recorded && cues && cues.ok === true && Number.isFinite(cues.headshots)
      ? null
      : (cues && typeof cues.reason === "string" && cues.reason ? cues.reason : HEADSHOTS_REASON),
  };
}

if (process.argv[1] && process.argv[1].endsWith("zoi-replay.mjs") && process.argv[2]) {
  const r = readReplayStats(process.argv[2]);
  console.log(JSON.stringify(r, null, 2));
}
