/* zoi-lab-mode - which mode each match was played in, read out of Fortnite's
   own log, plus the few other things the log states plainly about that match.

   Why this exists
   ---------------
   The lab measures a setting change by comparing the games before it with the
   games after it, using cumulative counters read from the stats API. Those
   counters are one pile for the whole account: a ranked evening and an unranked
   evening land in the same pile, so a setting that helps in one and costs
   something in the other shows up as no change at all. The log on the player's
   own PC is the only thing that says which mode a stretch of play was in, so it
   is read for that and for nothing else.

   What the log does NOT have
   --------------------------
   No per-match results. Four real logs were read end to end and there is no
   accuracy, no headshots, no damage, no hit markers, no weapon-fired counts and
   no kill events in any of them; placement appears only as HUD widget names with
   no number. So nothing here says how a match went, and nothing downstream may
   infer it. A record from this file says, at most: this mode, this match id,
   this window of time, the rank the game reported afterwards, and how many
   players the presence line said were left while it was running. It says nothing
   about kills, and no placement is ever derived from the player count: that
   counter is noisy and goes both ways (a real run reads 11, 12, 11, 14, 14, 18),
   so it is carried as a low-water mark and a reading count, never as a finishing
   position.

   How a match is proved to be in a mode
   ------------------------------------
   Three lines in the log join up, and the join is exact - no ordering guess, no
   "nearest block in time":

     1. The matchmaking settings block names a MatchmakingId and the mode.
     2. LogMatchmaking "[client_match_assigned]" names that same MatchmakingId in
        its [MatchmakingClient:<id>] tag and the game session it was assigned in
        its sessionId:<id> attribute. This is also the true moment the match
        started.
     3. The "Bad Match Attribute" block at match end names that same session as
        GameSessionID, and the playlist.

   So settings block -> assignment -> match end is a chain of shared ids, and a
   match is attributed to a mode only when all three links are present. Any link
   missing - a joined-in-progress match has no assignment, a party or creative
   map has no settings block - leaves the mode fields null rather than borrowing
   the mode of whatever was played before or after. That is the whole point: a
   match filed under the wrong mode is worse than a match filed under none.

   The other shapes it reads
   -------------------------
   - Bracket bursts, /Fortnite.com/Matchmaking:Ranked [Ranked] and friends, about
     two hundred a log. A weaker second source for the mode, used only as the
     settings source when a log predates or lacks the labelled block.
   - The ranked progress line the game prints a minute or three after a match:
     RankType='ranked-br-combined' Rank=20. Two different ladders share this
     shape (ranked-br-combined and ranked-blastberry-combined), so the type is
     kept beside the number rather than the number alone - a 20 on one ladder is
     not a 20 on the other.

     Read it as "the rank this account stood at shortly after this match", and
     nothing more. It is not a placement, it is not points earned in the match,
     and an unchanged rank across two matches is the normal case, not a sign that
     both matches were identical. Only one rank line is kept per match because
     the row has one rank column; if the game ever updated two ladders off one
     match, the first line wins and the second is dropped rather than overwriting
     a number from a different ladder.
   - The presence line's "N Left" while a match runs.

   Pure: takes lines of text and returns records. No file I/O, no fetch, no
   imports, so the same code runs in the agent on a Windows PC and in a harness
   on this box with the lines written out by hand. */

/* A log line: [2026.10.29-01.57.40:170][422]LogFortPerformance: ...
   The stamp is UTC. The frame counter is space-padded to five columns in real
   logs - "[ 87]" - so it has to be trimmed before it is compared to another. */
const LINE = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]\[ *(\d+)\](.*)$/;

const SETTINGS_OPEN = /^\s*MatchmakingSettings V2 \[/;
const SPARSE_OPEN = /^\s*Sparse settings:\s*$/;
const CLOSE = /^\s*\]\s*$/;
const TIMESTAMP_LINE = /^\s*Timestamp:\s*(\S+)\s*$/;
const MATCHMAKING_ID = /^\s*MatchmakingId:\s*([0-9A-Fa-f]{32})\s*$/;
const PLAYLIST = /PlaylistName:\s*(\S+)/;
const PLAYLIST_TYPE = /PlaylistType:\s*(\S+)/;
const REGION_ID = /RegionId:\s*(\S+)/;
const BMA = /Bad Match Attribute:/;
const SESSION = /GameSessionID:\s*([0-9a-fA-F]{32})/;
const CLIENT_ID = /MatchmakingClient:([0-9a-fA-F]{32})/;
const SESSION_ATTR = /sessionId:([0-9a-fA-F]{32})/;
const ASSIGNED = /\[client_match_assigned\]/;
const BURST = /\/Fortnite\.com\/[^:\s]*:(\w+)\s*\[([^\]]*)\]/;
const RANK_UPDATE = /RankType='([^']+)'\s+Rank=(\d+)/;
const LEFT_TEXT = /RichText=\[([^\]]*)\]/;
const LEFT_TAIL = /(\d+)\s+Left\s*$/;

/* Which playlists a rank ladder is the ladder for. The game names its ladders
   "ranked-<family>-combined", and the match-end block names the playlist family,
   so the two can be checked against each other rather than trusted to line up.

   This matters because they do not always line up in time. In his log a Zero
   Build match ends at 00:19:12, the next match is assigned at 00:21:21, and a
   blastberry rank line is printed at 00:21:37 - nearer the match that is about
   to start than the one that just ended. Attributing it to the Zero Build match
   because it is the nearest one behind would be a made-up association, so a
   ladder whose family is not the playlist's family is not attached at all.

   A family not listed here is one this file cannot vouch for; the rank then
   stays null. Adding a family is a deliberate act, not a default. */
const LADDER_FAMILY = {
  br: new Set(["zerobuild", "battleroyale"]),
  blastberry: new Set(["blastberry"]),
};

const RANKED = new Set(["Ranked", "Unranked"]);
const BUILD = new Set(["Zero", "Build"]);
const TEAM = new Set(["Solo", "Duo", "Squad", "Trio"]);

/* Bounds on a claim, not guesses at a missing number. Outside them the field
   stays null. A rank line lands 72-404 seconds after match end in the real logs,
   so ten minutes is generous; a reading more than a few hours before a match end
   has nothing to do with that match, since no match runs that long. */
const RANK_AFTER_MS = 10 * 60 * 1000;
const WINDOW_MAX_MS = 3 * 60 * 60 * 1000;
const START_NEAR_MS = 2 * 60 * 1000;
const READINGS_KEEP = 400;
const HOLD_MAX = 8;
const BLOCKS_KEEP = 24;
const ASSIGN_MAX = 24;

const textOf = (v) => (v === null || v === undefined ? "" : String(v));

/* The log stamp as an ISO instant. The game writes these in UTC, so the Z is the
   truth and not a decoration: read as local time, every match would move by the
   player's offset and land in the wrong session. */
export function timeFromStamp(text) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(textOf(text).trim());
  if (!m) return null;
  return isoOf(m[1], m[2], m[3], m[4], m[5], m[6]);
}

function isoOf(y, mo, d, h, mi, s) {
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/* "Name - Value" on a settings line, or null. Anchored at the end of the line so
   the nested "Ranked - Enabled" under a "Ranked - Ranked" heading is not
   mistaken for the setting itself. */
function valueOf(line, name) {
  const m = new RegExp("(?:^|\\s)" + name + "\\s*-\\s*(\\S+)\\s*$").exec(textOf(line));
  return m ? m[1] : null;
}

/* The four fields the lab keeps, out of one settings block. A field the block
   does not name stays null: a guess here would put a match in a bucket it was
   never proved to be in, and that is the one thing this file must not do. */
function modeFrom(lines) {
  const out = { ranked: null, buildMode: null, teamSize: null, region: null };
  for (const raw of lines) {
    const ranked = valueOf(raw, "Ranked");
    if (ranked && RANKED.has(ranked)) out.ranked = ranked;
    const build = valueOf(raw, "BuildMode");
    if (build && BUILD.has(build)) out.buildMode = build;
    const team = valueOf(raw, "TeamSize");
    if (team && TEAM.has(team)) out.teamSize = team;
    if (out.region === null) {
      const region = valueOf(raw, "Region");
      if (region) out.region = region;
    }
  }
  return out;
}

/* The settings block's own lines. Everything after "Sparse settings:" when it is
   there, because that flat section has no nesting to misread; the whole body
   otherwise, which still reads correctly because every value is anchored to the
   end of its line. */
function modeFromBlock(body) {
  const at = body.findIndex((l) => SPARSE_OPEN.test(textOf(l)));
  return modeFrom(at >= 0 ? body.slice(at + 1) : body);
}

/* A mode object with only values the log can actually produce, or null when it
   has none of them. */
function cleanMode(mode) {
  if (!mode || typeof mode !== "object") return null;
  const out = {
    ranked: RANKED.has(mode.ranked) ? mode.ranked : null,
    buildMode: BUILD.has(mode.buildMode) ? mode.buildMode : null,
    teamSize: TEAM.has(mode.teamSize) ? mode.teamSize : null,
    region: typeof mode.region === "string" && mode.region.trim() ? mode.region.trim() : null,
  };
  return out.ranked || out.buildMode || out.teamSize || out.region ? out : null;
}

const BLANK_MODE = { ranked: null, buildMode: null, teamSize: null, region: null };

/* The carried state of a read: what the last chunk knew and the next one needs.
   The agent persists this beside itself, because a poll is one minute of log and
   a match's assignment, its end, and its rank line routinely fall in three
   different polls - a real match in his log was assigned at 22:06 and ended at
   23:17. Nothing is released from state until a match is complete. */
function cleanState(state) {
  const s = state && typeof state === "object" ? state : {};
  const readings = Array.isArray(s.readings) ? s.readings : [];
  const hold = Array.isArray(s.hold) ? s.hold : [];
  const blocks = Array.isArray(s.blocks) ? s.blocks : [];
  const assigns = Array.isArray(s.assigns) ? s.assigns : [];
  return {
    mode: cleanMode(s.mode),
    lastEnd: typeof s.lastEnd === "string" && s.lastEnd ? s.lastEnd : null,
    readings: readings
      .filter((r) => Array.isArray(r) && typeof r[0] === "string" && Number.isFinite(r[1]))
      .slice(-READINGS_KEEP),
    hold: hold.filter((m) => m && typeof m === "object" && typeof m.matchId === "string").slice(-HOLD_MAX),
    /* Settings blocks, by matchmaking id, so an assignment that arrives in a
       later poll can still find the mode it was queued under. */
    blocks: blocks
      .filter((b) => b && typeof b.id === "string" && b.mode && typeof b.mode === "object")
      .slice(-BLOCKS_KEEP),
    /* Assignments waiting for their match end: session id -> matchmaking id and
       the start time. */
    assigns: assigns
      .filter((a) => a && typeof a.sessionId === "string" && typeof a.at === "string")
      .slice(-ASSIGN_MAX),
    /* A match-end block that was still being written when the last poll ran out
       of file. Carried so its PlaylistName is not lost to a poll boundary. */
    pending: (() => {
      const p = s.pending;
      if (!p || typeof p !== "object") return null;
      if (typeof p.sessionId !== "string" || typeof p.at !== "string") return null;
      return {
        sessionId: p.sessionId,
        playlist: typeof p.playlist === "string" ? p.playlist : null,
        playlistType: typeof p.playlistType === "string" ? p.playlistType : null,
        region: typeof p.region === "string" ? p.region : null,
        at: p.at,
      };
    })(),
  };
}

/* The mode a match was played in, as one short key, or null when the log never
   said. Two matches with the same key were played in the same mode; that is the
   only claim it makes. Accepts the record this file emits and the row D1 hands
   back, hence both spellings. */
export function modeKeyOf(match) {
  if (!match || typeof match !== "object") return null;
  const ranked = match.ranked;
  const build = match.buildMode !== undefined ? match.buildMode : match.build_mode;
  const team = match.teamSize !== undefined ? match.teamSize : match.team_size;
  const parts = [ranked, build, team].filter((v) => typeof v === "string" && v);
  return parts.length ? parts.join("|") : null;
}

/* One pass over the lines. Returns the matches this pass can close, plus the
   state the next pass needs.

   opts.settle holds a closed match back until its rank line has arrived or the
   window for one has closed. The agent sets it, since it reads the log in
   one-minute slices and the rank line lands in a later slice; without it a match
   would go out with rank null and the database would never hear the correction,
   because inserts deliberately do not overwrite. A one-shot read of a whole file
   leaves it off, since everything that match will ever say is already there. */
export function scanLog(lines, opts = {}) {
  const arr = Array.isArray(lines) ? lines : [];
  const prior = cleanState(opts.state);
  const settle = opts.settle === true;
  const out = [];
  const held = prior.hold.map((m) => ({ ...m }));
  const readings = prior.readings.slice();
  const blocks = new Map(prior.blocks.map((b) => [b.id, b]));    // matchmaking id -> { id, at, mode }
  const assigns = new Map(prior.assigns.map((a) => [a.sessionId, a])); // session id -> { sessionId, mmId, at }

  let lastEnd = prior.lastEnd;
  let current = prior.mode;        // bracket-burst fallback mode only
  let pending = prior.pending ? { ...prior.pending } : null;   // the attribute block being collected
  let newestIso = null;

  /* The window a match ran in, and what the presence line said inside it. */
  const readingsIn = (fromMs, toMs) => {
    const seen = new Set();
    const values = [];
    let first = null;
    let firstMs = null;
    for (const [at, left] of readings) {
      const ms = Date.parse(at);
      if (!Number.isFinite(ms) || ms < fromMs || ms > toMs) continue;
      const key = at + "|" + left;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(left);
      if (first === null) { first = left; firstMs = ms; }
    }
    if (!values.length) return { low: null, first: null, readings: null };
    /* The opening count is only kept when the first reading is close to
       kickoff; later on it is not where the match started, so it is not
       reported as if it were. */
    const nearStart = Number.isFinite(firstMs) && firstMs - fromMs <= START_NEAR_MS;
    return { low: Math.min(...values), first: nearStart ? first : null, readings: values.length };
  };

  /* A rank line belongs to the match that just ended, if that match is one the
     line could be about. It has to have ended within the last few minutes, and
     the match has to have been proved ranked: a ladder update printed after an
     unranked or unknown-mode match is about a different ladder than that match
     was played on, so filing it under that match would be a made-up association.
     In his log a creative (VK Play) match is followed by a ranked-br-combined
     line, and that line is not about the creative match. */
  const rankFits = (m, atIso, ladder) => {
    if (m.ranked !== "Ranked") return false;
    if (!ladderMatches(m.playlistType, ladder)) return false;
    const endMs = Date.parse(m.endedAt);
    const atMs = Date.parse(atIso);
    return Number.isFinite(endMs) && Number.isFinite(atMs)
      && atMs >= endMs - 1000 && atMs - endMs <= RANK_AFTER_MS;
  };

  const release = (m) => { if (m && !out.includes(m)) out.push(m); };

  /* Close one match. The mode comes from the settings block its assignment
     named, and from nowhere else. */
  const closeMatch = (p) => {
    const assign = assigns.get(p.sessionId);
    const block = assign ? blocks.get(assign.mmId) : null;
    const mode = block ? block.mode : null;
    const endMs = Date.parse(p.at);

    /* Start is the moment the match was assigned to a server: a real event, and
       the closest the log comes to "this match began" - in his log a queue
       entered at 23:30:09 was assigned at 23:32:00.

       With no assignment line there is no start, and it stays null. The queue's
       own timestamp is not used instead: the only way to reach that block is
       through the assignment that quotes its id, so a match with no assignment
       has no block either. Matching such a match to "the settings block nearest
       behind it" would be the ordering guess this file exists to avoid - the
       queue for one match can be entered while the previous one is still
       running. A null start simply means the presence readings are not counted
       for that match, which is the smaller loss. */
    const startIso = (assign && assign.at) || null;
    const startMs = Date.parse(startIso || "");
    const usableStart = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs <= WINDOW_MAX_MS
      ? startIso
      : null;
    const fromMs = Number.isFinite(startMs) ? startMs : NaN;
    const count = usableStart && Number.isFinite(fromMs) && Number.isFinite(endMs)
      ? readingsIn(fromMs, endMs)
      : { low: null, first: null, readings: null };

    const record = {
      matchId: p.sessionId,
      playlist: p.playlist || null,
      playlistType: p.playlistType || null,
      ranked: mode ? mode.ranked || null : null,
      buildMode: mode ? mode.buildMode || null : null,
      teamSize: mode ? mode.teamSize || null : null,
      region: (mode && mode.region) || p.region || null,
      startedAt: usableStart,
      endedAt: p.at,
      rankType: null,
      rank: null,
      playersLeftLow: count.low,
      playersLeftFirst: count.first,
      playersLeftReadings: count.readings,
    };
    lastEnd = p.at;

    if (held.some((m) => m.matchId === record.matchId)) return;
    if (out.some((m) => m.matchId === record.matchId)) return;
    if (settle) held.push(record);
    else out.push(record);
  };

  /* Release any held match whose rank window has closed with no line arriving.
     The reference is the newest moment the log has actually reached, never the
     wall clock: an agent that was off for a day must not read that gap as a
     match that simply had no rank. */
  const settleHeld = () => {
    if (!settle) return;
    const nowMs = Date.parse(newestIso || "");
    for (let i = held.length - 1; i >= 0; i--) {
      const m = held[i];
      if (m.rankType !== null) { held.splice(i, 1); release(m); continue; }
      const endMs = Date.parse(m.endedAt);
      if (Number.isFinite(nowMs) && Number.isFinite(endMs) && nowMs - endMs > RANK_AFTER_MS) {
        held.splice(i, 1);
        release(m);
      }
    }
  };

  const attachRank = (type, rank, atIso) => {
    for (let i = held.length - 1; i >= 0; i--) {
      if (held[i].rankType === null && rankFits(held[i], atIso, type)) {
        held[i].rankType = type;
        held[i].rank = rank;
        return true;
      }
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].rankType === null && rankFits(out[i], atIso, type)) {
        out[i].rankType = type;
        out[i].rank = rank;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < arr.length; i++) {
    const text = textOf(arr[i]);
    if (!text.trim()) continue;

    /* -- format 1: the labelled block. Its own lines carry no log header, so
          they are matched on their content. -- */
    if (SETTINGS_OPEN.test(text)) {
      const body = [];
      let j = i + 1;
      for (; j < arr.length; j++) {
        if (CLOSE.test(textOf(arr[j]))) break;
        body.push(arr[j]);
      }
      const mode = modeFromBlock(body);
      /* MatchmakingId and Timestamp follow the closing bracket. The id is what
         the assignment line will quote back, so this block can be found again
         from a later poll. */
      let id = null;
      let at = null;
      for (let k = j + 1; k < Math.min(arr.length, j + 8); k++) {
        const line = textOf(arr[k]);
        if (SETTINGS_OPEN.test(line)) break;
        const mid = MATCHMAKING_ID.exec(line);
        if (mid) { id = mid[1].toLowerCase(); continue; }
        const t = TIMESTAMP_LINE.exec(line);
        if (t) { at = timeFromStamp(t[1]); break; }
      }
      if (id && mode) blocks.set(id, { id, at, mode });
      else if (mode && mode.ranked) current = mode;   // burst fallback
      i = j;
      continue;
    }

    const line = LINE.exec(text);
    if (!line) {
      /* -- format 2 without a log header: a bare bracket burst -- */
      const bare = BURST.exec(text);
      if (bare) current = burstInto(current, bare[1], bare[2]);
      continue;
    }

    const [, y, mo, d, h, mi, s, , frame, rest] = line;
    const at = isoOf(y, mo, d, h, mi, s);
    if (at && (!newestIso || at > newestIso)) newestIso = at;

    /* -- the assignment: this match, started now, under this settings block -- */
    if (ASSIGNED.test(rest)) {
      const mm = CLIENT_ID.exec(rest);
      const se = SESSION_ATTR.exec(rest);
      if (mm && se) {
        const mmId = mm[1].toLowerCase();
        const sessionId = se[1].toLowerCase();
        assigns.set(sessionId, { sessionId, mmId, at });
      }
      continue;
    }

    /* The match-end marker is one burst of "Bad Match Attribute" lines written
       under a single timestamp. Frame counter also happens to repeat across a
       real burst, but the timestamp is what defines it, so a burst is grouped on
       that and on the attribute tag itself - a line that is not one of them ends
       it. */
    const isBma = BMA.test(rest);
    if (pending && (!isBma || at !== pending.at)) {
      closeMatch(pending);
      pending = null;
    }

    if (isBma) {
      const sid = SESSION.exec(rest);
      if (sid) {
        if (pending) closeMatch(pending);
        pending = { sessionId: sid[1].toLowerCase(), playlist: null, playlistType: null, region: null, at };
      }
      if (pending) {
        const play = PLAYLIST.exec(rest);
        if (play) pending.playlist = play[1];
        const ptype = PLAYLIST_TYPE.exec(rest);
        if (ptype) pending.playlistType = ptype[1];
        if (!pending.region) {
          const reg = REGION_ID.exec(rest);
          if (reg) pending.region = reg[1];
        }
      }
      continue;
    }

    const rankLine = RANK_UPDATE.exec(rest);
    if (rankLine) {
      attachRank(rankLine[1].slice(0, 64), Number(rankLine[2]), at);
      continue;
    }

    const presence = LEFT_TEXT.exec(rest);
    if (presence) {
      /* Only a live count from a match counts. "In Lobby" carries no number,
         "Joinable Game - ... - 4 / 6" is a party slot fraction and
         "Joinable Game - ... - 8 Left" is a lobby advertising a slot; counting
         either would put a number into a window it was never about. */
      const left = LEFT_TAIL.exec(presence[1]);
      if (left && at && !/^\s*joinable\s+game/i.test(presence[1])) readings.push([at, Number(left[1])]);
      continue;
    }

    /* -- format 2 inside a log line -- */
    const burst = BURST.exec(rest);
    if (burst) current = burstInto(current, burst[1], burst[2]);
  }

  if (pending) closeMatch(pending);
  if (newestIso) settleHeld();

  /* State is pruned so a long run cannot grow the file without limit: readings
     by age, assignments once their match has closed, blocks to the last few. */
  if (pending && pending.at && (!newestIso || pending.at > newestIso)) newestIso = pending.at;
  const newestAt = readings.length ? Date.parse(readings[readings.length - 1][0]) : NaN;
  const keptReadings = readings
    .filter((r) => !Number.isFinite(newestAt) || newestAt - Date.parse(r[0]) <= WINDOW_MAX_MS)
    .slice(-READINGS_KEEP);
  const seenSessions = new Set([...held.map((m) => m.matchId), ...out.map((m) => m.matchId)]);
  const keptAssigns = [...assigns.values()]
    .filter((a) => !seenSessions.has(a.sessionId))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-ASSIGN_MAX);
  const keptBlocks = [...blocks.values()]
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(-BLOCKS_KEEP);

  return {
    matches: out.sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt))),
    state: {
      mode: current,
      lastEnd,
      readings: keptReadings,
      hold: held.slice(-HOLD_MAX),
      blocks: keptBlocks,
      assigns: keptAssigns,
      pending,
    },
  };
}

/* Whether a rank line's ladder is the ladder this playlist is played on. Unknown
   on either side means no: an unrecognised family is not evidence of a match. */
function ladderMatches(playlistType, ladder) {
  const m = /^ranked-([a-z0-9]+)-combined$/i.exec(textOf(ladder));
  if (!m) return false;
  const family = LADDER_FAMILY[m[1].toLowerCase()];
  if (!family) return false;
  const type = textOf(playlistType).toLowerCase();
  return type ? family.has(type) : false;
}

/* A bracket burst sets one field of the mode in force. Kept as one helper so the
   two ways a burst can arrive - with and without a log header - cannot drift. */
function burstInto(mode, name, value) {
  const m = mode ? { ...mode } : { ...BLANK_MODE };
  if (name === "Ranked" && RANKED.has(value)) m.ranked = value;
  else if (name === "BuildMode" && BUILD.has(value)) m.buildMode = value;
  else if (name === "TeamSize" && TEAM.has(value)) m.teamSize = value;
  else if (name === "Region" && value) m.region = value;
  return m;
}

/* The shape the brief asks for: the matches in these lines, oldest first. */
export function matchesIn(lines, opts) {
  return scanLog(lines, opts).matches;
}
