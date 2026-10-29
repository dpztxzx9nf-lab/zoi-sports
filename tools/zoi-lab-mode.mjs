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
   missing - a joined-in-progress match has no assignment, a Creative island has
   no battle-royale settings block of any kind - leaves the mode fields null
   rather than borrowing the mode of whatever was played before or after. That is
   the whole point: a match filed under the wrong mode is worse than a match
   filed under none.

   Creative islands, and why they needed a path of their own
   --------------------------------------------------------
   A Creative island match ends exactly the way a battle royale does: with a
   "Bad Match Attribute" burst naming its session id. It also STARTS the way one
   does, at a client_match_assigned line. What it lacks is the middle - there is
   no V2 MatchmakingSettings block for an island, so rank, build mode and team
   size are not merely unknown but never stated. A parser keyed on that block
   reads them as absent, which is right, and a parser that drops the match for
   want of them loses it entirely, which is what this file used to do.

   So every match now starts at a client_match_assigned line and ends at the Bad
   Match Attribute burst naming that same session. There is no fallback to the
   file's last timestamp or to the clock: a match whose end the log never states
   keeps endedAt null.

   One measured wrinkle decides where the end rule has to be careful. In his real
   log the report for match N lands three to four seconds AFTER the assignment
   that starts match N+1 (23:17:44 assigns fdb118ed, 23:17:47 reports ac52530e).
   A literal "next assignment ends the match, whichever comes first" would
   therefore stamp every match at its successor's start and discard every
   playlist in the process. So the report is authoritative for its session
   whenever it appears, and the next assignment is only an upper bound: it is
   used as an end for a match whose own report has not arrived within
   BMA_TRAIL_MS of it, and the record says so with endStated false.

   A Creative island names itself instead. Its "Island:" block carries no rank,
   no team size and no build mode, and its MatchmakingSettings block is the V1
   form rather than V2. The session id in that block is the same id the
   assignment quotes, so the island can be found again from the match, and the
   title is resolved for the island's LinkId. Failing the block, the report
   itself names the island: it carries InGameLinkMeta LinkCode in the same burst
   as the game session id, and in his log that is often the only binding there
   is. The title is kept exactly as the log wrote it - it carries non-ASCII
   characters and it is not a Battle Royale mode string, so nothing here parses
   or tidies it. In particular "2V2V2" in a title is three teams of two inside
   one island, not the duo team size; reading it as one would file the match
   under a queue it was never played in.

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

/* The queue block, in the three spellings a real log writes. "MatchmakingSettings
   V2 [" is the bare form this file matched first; "MatchmakingSettings (V2) ["
   is the same block with the version in parentheses, and it is the spelling most
   of a 60 MB log carries; "MatchmakingSettings (V1) [" is the island form. The
   first cut matched only the bare form, so two of the three were never read: the
   V1 body was walked as loose lines and the (V2) body never reached the mode
   reader at all.

   A V1 block states Privacy, Region and ProductModes and never states Ranked,
   TeamSize or BuildMode, so it is never read as a Battle Royale mode. It is
   matched anyway, for two reasons: its body must be skipped whole rather than
   walked line by line, and its own MatchmakingId must not be left lying about
   for the block before it to pick up.

   A block ends where its brackets balance, not at the first line that is a bare
   "]", because the V1 form closes on the same line as its last value
   ("Region [NA]]") and has no bare "]" line anywhere. */
const SETTINGS_OPEN = /^\s*MatchmakingSettings\s+\(?\s*V2\s*\)?\s*\[/;
const SETTINGS_OPEN_V1 = /^\s*MatchmakingSettings\s+\(?\s*V1\s*\)?\s*\[/;
const SETTINGS_FORM = (text) => (SETTINGS_OPEN_V1.test(textOf(text)) ? "v1"
  : SETTINGS_OPEN.test(textOf(text)) ? "v2" : null);

/* The island block: "Island:", then a LinkId line, then the Session line that
   carries the game session id. That id is the one client_match_assigned quotes,
   so it is what ties a match to the island it was played on. */
const ISLAND_OPEN = /^\s*Island:\s*$/;
const LINK_ID = /LinkId\s*\[\s*Mnemonic=\[([^\]]*)\]/;
const MNEMONIC = /Mnemonic=\[([^\]]*)\]/;
const ISLAND_SESSION = /Session\s*\[\s*Session\s*Id\s*\[([0-9a-fA-F]{32})\]/;
/* The title is opaque text. It is not trimmed of its internal characters, and
   non-ASCII is carried through untouched; only the spaces around it go. */
const TITLE = /Title\s*\[([^\]]*)\]/;
const SPARSE_OPEN = /^\s*Sparse settings:\s*$/;
const CLOSE = /^\s*\]\s*$/;
const TIMESTAMP_LINE = /^\s*Timestamp:\s*(\S+)\s*$/;
const MATCHMAKING_ID = /^\s*MatchmakingId:\s*([0-9A-Fa-f]{32})\s*$/;
const PLAYLIST = /PlaylistName:\s*(\S+)/;
const PLAYLIST_TYPE = /PlaylistType:\s*(\S+)/;
const REGION_ID = /RegionId:\s*(\S+)/;
const BMA = /Bad Match Attribute:/;
const SESSION = /GameSessionID:\s*([0-9a-fA-F]{32})/;
/* Which game the session id belongs to: an island runs in Playspace_GameState_C,
   a battle royale in Athena_GameState_C. It is the one field in the end-of-match
   report that says which kind of match this was, independently of what the
   playlist happens to be called. */
const GAME_STATE = /GameState:\s*([A-Za-z0-9_]+)/;
/* The island code the end-of-match report itself carries, inside InGameLinkMeta:
   "InGameLinkMeta: {"LinkCode":"7675-8305-9560","LinkCodeVersion":74,...}". This
   is the strongest session-to-island binding in the log, and in his real log it
   is often the only one: the VK Play matches write a report carrying the code
   and no Island: block at all. Same spelling the block uses (dashed), so one
   title lookup serves both. */
const LINK_CODE = /"LinkCode"\s*:\s*"([^"]*)"/;
/* A third-party island code is four digits, a dash, three times. A battle
   royale's own report carries a LinkCode too - "playlist_nobuildbr_habanero_solo",
   the playlist's handle - and that is not an island, so only the numeric shape
   is ever taken as one. */
const ISLAND_CODE = /^\d{4}-\d{4}-\d{4}$/;
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
/* The prefix a Creative island's mode key carries, so it can never look like a
   battle-royale key ("Ranked|Zero|Solo") and can be recognised without the row. */
const CREATIVE_KEY = "creative";
const RANK_AFTER_MS = 10 * 60 * 1000;
const WINDOW_MAX_MS = 3 * 60 * 60 * 1000;
const START_NEAR_MS = 2 * 60 * 1000;
const READINGS_KEEP = 400;
const HOLD_MAX = 8;
const BLOCKS_KEEP = 24;
const ASSIGN_MAX = 24;
const ISLAND_KEEP = 24;
/* How many started-but-unclosed matches to carry. Two are in flight for a few
   seconds at a match change; a handful is generous and bounds the file. */
const INFLIGHT_MAX = 4;
const LINK_KEEP = 24;
/* How long after a LinkId line a title line is still taken to be about that
   link. The two are adjacent in the block as his log writes it; this bound is
   what stops a stray "Title [" somewhere else from being attached to whichever
   island happened to be mentioned last. */
const LINK_TITLE_WINDOW = 16;
/* A settings block is a few dozen lines. Past this the block is taken to be
   truncated and the scan gives up on it rather than eating the file. */
const SETTINGS_MAX_LINES = 400;
/* How long after the NEXT assignment a match's own end-of-match burst can still
   land. This is measured, not guessed: in his log the burst for match N arrives
   3 and 4 seconds after the assignment that started match N+1, because the
   client has already been handed the next server while it is still flushing the
   last match's report. A rule that ended a match at the next assignment and
   ignored anything after it would throw away the playlist of every Battle
   Royale match in his log - which it did, on the real excerpt, before this
   window existed. Sixty seconds is fifteen times the largest gap observed and
   still far short of the shortest real match. */
const BMA_TRAIL_MS = 60 * 1000;

/* Brackets opened minus brackets closed, for finding the end of a block whose
   closing bracket may sit on the last value's line. */
function brackets(text) {
  let depth = 0;
  for (const ch of textOf(text)) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
  }
  return depth;
}

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
       of file. Carried so its PlaylistName is not lost to a poll boundary. A
       pending block is by definition a Bad Match Attribute burst, so it is a
       battle-royale end wherever it is resumed. */
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
        endedBy: "bma",
      };
    })(),
    /* Matches that have started and whose end the log has not stated yet. A
       list rather than a single slot, because two are genuinely in flight for a
       few seconds around a match change: the next match is assigned while the
       previous match's end-of-match report is still being written. `boundAt` is
       the next assignment's stamp - an upper bound on the end, not the end
       itself - and it is what closes a Creative island, which writes no report
       of its own. */
    inflight: (Array.isArray(s.inflight) ? s.inflight : [])
      .filter((o) => o && typeof o === "object" && typeof o.sessionId === "string" && typeof o.at === "string")
      .map((o) => ({
        sessionId: o.sessionId,
        at: o.at,
        boundAt: typeof o.boundAt === "string" && o.boundAt ? o.boundAt : null,
      }))
      .slice(-INFLIGHT_MAX),
    /* Session id -> the island it was played on. This is the join that names a
       Creative match, and it has to survive a poll boundary for the same reason
       the assignment does. */
    islands: (Array.isArray(s.islands) ? s.islands : [])
      .filter((x) => x && typeof x.sessionId === "string" && typeof x.linkId === "string")
      .map((x) => ({ sessionId: x.sessionId, linkId: x.linkId, at: typeof x.at === "string" ? x.at : null }))
      .slice(-ISLAND_KEEP),
    /* LinkId -> title. The title resolves on the link id, and exactly one title
       was seen per id, so the first one kept is the one that stands. */
    links: (Array.isArray(s.links) ? s.links : [])
      .filter((x) => x && typeof x.linkId === "string" && typeof x.title === "string" && x.title.trim())
      .map((x) => ({ linkId: x.linkId, title: x.title }))
      .slice(-LINK_KEEP),
  };
}

/* The mode a match was played in, as one short key, or null when the log never
   said. Two matches with the same key were played in the same mode; that is the
   only claim it makes. Accepts the record this file emits and the row D1 hands
   back, hence both spellings.

   An island is keyed by its title, not by its three battle-royale fields, which
   it never has. The key is deliberately a different shape from a battle royale's
   so the two can never collide and never be averaged into one another: a title
   is the only identity an island has, and two different islands are two
   different games even when they are queued minutes apart.

   Nothing about an island is inferred from its name. "2V2V2" stays in the title
   as text and is never read as a team size: three teams of two inside a Creative
   island is not the battle-royale duo queue, and calling it Duo would be a lie
   the page would then print. */
export function modeKeyOf(match) {
  if (!match || typeof match !== "object") return null;
  const kind = match.kind;
  if (kind === "creative") {
    const title = typeof match.title === "string" ? match.title.trim() : "";
    return CREATIVE_KEY + "|" + title;
  }
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
  const islands = new Map(prior.islands.map((x) => [x.sessionId, x])); // session id -> { sessionId, linkId, at }
  const titles = new Map(prior.links.map((x) => [x.linkId, x.title])); // link id -> title

  let lastEnd = prior.lastEnd;
  let current = prior.mode;        // bracket-burst fallback mode only
  let pending = prior.pending ? { ...prior.pending } : null;   // the attribute block being collected
  let newestIso = null;
  let inflight = prior.inflight.map((o) => ({ ...o }));        // started, end not yet stated
  let island = null;                                           // the Island: block being read
  let lastLink = null;                                         // the latest LinkId seen, and where
  let lastTitle = null;                                        // a title seen before its LinkId, and where

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

  /* Close one match.

     p.at is the moment the log stated this match ended, or null when it stated
     none. Two things state an end: the Bad Match Attribute burst naming this
     session, and the next assignment of any kind. Nothing else does - not the
     file's last line, not the clock - so a match with neither keeps a null end
     rather than one worked out from its neighbours.

     The mode comes from the settings block its assignment named, and from
     nowhere else. A Creative island has no such block, and its mode fields are
     null by construction even if a block id were somehow in reach: the island is
     the stronger evidence, and one queue's mode must never be hung on another
     match. What a Creative match does have is a title, resolved through the
     island's LinkId, kept exactly as the log wrote it. */
  const closeMatch = (p) => {
    const assign = assigns.get(p.sessionId);
    const block = assign ? blocks.get(assign.mmId) : null;
    const mode = block ? block.mode : null;
    /* The island this session was played on, from either binding. The Island:
       block names the session outright; failing that, the end-of-match report
       names the island's LinkCode in the same burst as the session id. The
       second is not a weaker guess - it is the report saying which island it is
       reporting on - and in his real log it is the only binding the VK Play
       matches have. A report's code is recorded against the session as soon as
       it is seen, so a title that arrives later still reaches the match. */
    /* The report's own code counts only when it is an island code in an island's
       GameState. A battle royale report carries its playlist's handle here, and
       filing that as a title would put "playlist_nobuildbr_habanero_solo" where
       a name belongs. */
    const reportCode = p.linkCode && ISLAND_CODE.test(p.linkCode) && p.gameState === "Playspace_GameState_C"
      ? p.linkCode
      : null;
    const island = islands.get(p.sessionId) || (reportCode ? { sessionId: p.sessionId, linkId: reportCode, at: p.at } : null);
    if (island && !islands.has(p.sessionId)) islands.set(p.sessionId, island);
    const creative = Boolean(island);
    const title = island ? titles.get(island.linkId) || null : null;
    /* A block that named none of the three battle-royale fields proves no mode,
       and is not evidence of a battle-royale match either. */
    const brBlock = Boolean(mode && (mode.ranked || mode.buildMode || mode.teamSize));
    /* Creative is proved two ways, independently. The island block is the direct
       one: a session that belongs to an Island: block is an island match. The
       indirect one is the end-of-match report's GameState - an island runs in
       Playspace_GameState_C and a battle royale in Athena_GameState_C - which
       is how his VK Play island matches identify themselves, since those write
       a report but no island block in the same stretch of log. Either is
       evidence; neither is a guess from the playlist's spelling. */
    const playspace = p.gameState === "Playspace_GameState_C";
    const kind = creative || playspace ? "creative"
      : p.endedBy === "bma" || brBlock ? "br"
      : null;
    const endMs = Date.parse(p.at || "");

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
    /* A stated start stands on its own. It is only withheld when an end is
       stated and the two are further apart than any match can run, which is the
       sign the two belong to different sessions rather than to one match. */
    const startIso = (assign && assign.at) || null;
    const startMs = Date.parse(startIso || "");
    const usableStart = Number.isFinite(startMs) && (!Number.isFinite(endMs) || endMs - startMs <= WINDOW_MAX_MS)
      ? startIso
      : null;
    const count = usableStart && Number.isFinite(startMs) && Number.isFinite(endMs)
      ? readingsIn(startMs, endMs)
      : { low: null, first: null, readings: null };

    const record = {
      matchId: p.sessionId,
      /* 'br', 'creative', or null when neither the island block nor a
         battle-royale marker is there to say which. The two are never mixed:
         this is what stops an island's games being averaged into the ladder. */
      kind,
      /* The Creative island's title, verbatim, or null. A battle-royale match has
         no title of its own - its playlist columns say what it was. */
      title: creative ? title : null,
      endStated: p.endedBy === "bma",
      playlist: p.playlist || null,
      playlistType: p.playlistType || null,
      ranked: creative || playspace ? null : mode ? mode.ranked || null : null,
      buildMode: creative || playspace ? null : mode ? mode.buildMode || null : null,
      teamSize: creative || playspace ? null : mode ? mode.teamSize || null : null,
      region: creative || playspace ? null : (mode && mode.region) || p.region || null,
      startedAt: usableStart,
      endedAt: p.at || null,
      rankType: null,
      rank: null,
      playersLeftLow: count.low,
      playersLeftFirst: count.first,
      playersLeftReadings: count.readings,
    };
    if (p.at) lastEnd = p.at;

    if (held.some((m) => m.matchId === record.matchId)) return;
    if (out.some((m) => m.matchId === record.matchId)) return;
    /* A Creative match is released at once even when settling: there is no
       ladder for an island, so no rank line can ever arrive to correct it, and
       holding it would only delay the record by the length of a rank window. */
    if (settle && kind !== "creative") held.push(record);
    else out.push(record);
  };

  /* Close one match that is in flight: the report came, or the ceiling is all
     there is, or the log simply ran out. A match with a ceiling is ended at the
     ceiling only when the two are close enough to belong to one match; otherwise
     the ceiling is a different match's start and this one's end is unknown. */
  const flushInflight = (o) => {
    inflight = inflight.filter((x) => x !== o);
    const startMs = Date.parse(o.at || "");
    const boundMs = Date.parse(o.boundAt || "");
    const endedAt = Number.isFinite(startMs) && Number.isFinite(boundMs) && boundMs - startMs <= WINDOW_MAX_MS
      ? o.boundAt
      : null;
    closeMatch({
      sessionId: o.sessionId, playlist: null, playlistType: null, region: null,
      at: endedAt, endedBy: endedAt ? "assign" : "unknown",
    });
  };

  /* Finish the end-of-match burst being collected, and stop treating the match
     it names as in flight. */
  const settlePending = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    closeMatch(p);
    inflight = inflight.filter((x) => x.sessionId !== p.sessionId);
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

  /* A Creative match can close before the log gets round to naming its island -
     the report names the island by code, and the title may be written after it.
     When a title is learned, any already-released Creative match waiting on that
     code is given it. Nothing else is touched: a battle-royale record has no
     title to fill, and a title is never moved onto a different island. */
  const backfillTitle = (linkId, title) => {
    if (!linkId || !title) return;
    for (const m of out) {
      if (m.kind !== "creative" || m.title) continue;
      const bound = islands.get(m.matchId);
      if (bound && bound.linkId === linkId) m.title = title;
    }
    for (const m of held) {
      if (m.kind !== "creative" || m.title) continue;
      const bound = islands.get(m.matchId);
      if (bound && bound.linkId === linkId) m.title = title;
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
          they are matched on their content.

          The block ends where its brackets balance. A bare "]" line ends the
          form written as "MatchmakingSettings V2 [", but the parenthesised forms
          close on the last value's own line ("Region [NA]]") and have no bare
          "]" anywhere - so scanning for a bare "]" walks straight past them and
          swallows the next block whole. That is how a V1 island block ends up
          holding a V2 battle-royale mode, and how a mode ends up filed under
          another queue's MatchmakingId. -- */
    const form = SETTINGS_FORM(text);
    if (form) {
      const body = [];
      let depth = brackets(text);
      let j = i + 1;
      for (; j < arr.length && depth > 0 && j - i <= SETTINGS_MAX_LINES; j++) {
        const line = textOf(arr[j]);
        /* A second block opening before this one closed means this one was cut
           short. Stop here rather than reading two blocks as one. */
        if (SETTINGS_FORM(line)) { j -= 1; break; }
        depth += brackets(line);
        if (depth <= 0) break;
        body.push(arr[j]);
      }
      /* A V1 block belongs to a Creative island: no rank, no team size, no build
         mode. It is skipped rather than read, and its MatchmakingId is not kept,
         so nothing downstream can mistake it for a battle-royale queue. */
      if (form === "v2") {
        const mode = modeFromBlock(body);
        /* MatchmakingId and Timestamp follow the closing bracket. The id is what
           the assignment line will quote back, so this block can be found again
           from a later poll. */
        let id = null;
        let at = null;
        for (let k = j + 1; k < Math.min(arr.length, j + 8); k++) {
          const line = textOf(arr[k]);
          if (SETTINGS_FORM(line)) break;
          const mid = MATCHMAKING_ID.exec(line);
          if (mid) { id = mid[1].toLowerCase(); continue; }
          const t = TIMESTAMP_LINE.exec(line);
          if (t) { at = timeFromStamp(t[1]); break; }
        }
        if (id && mode) blocks.set(id, { id, at, mode });
        else if (mode && mode.ranked) current = mode;   // burst fallback
      }
      i = Math.max(i, j);
      continue;
    }

    /* -- the island: a Creative island names the session it belongs to --

       The block is three lines in a fixed order, as his log writes it:

         Island:
         LinkId [Mnemonic=[7675-8305-9560] Version=[latest]]
         Session [Session Id [1883392e...] Join Info [...]]

       So the join is directional: the Session line that FOLLOWS a LinkId line
       inside the same island block belongs to it. An earlier cut also bound the
       other way - a LinkId line reaching back to whatever Session line came
       before it - and that is wrong: two islands queued back to back then swap
       sessions, and the second island's title lands on the first island's match.
       It did exactly that on a two-island fixture. One direction only, and only
       inside a block that opened with "Island:".

       The session id is the very id client_match_assigned quotes, which is what
       lets a Creative match be found again from its own start. The title is
       bound to the LinkId nearest it; his log has exactly one title per LinkId,
       so the first one seen is the one that stands. */
    if (ISLAND_OPEN.test(text)) { island = { i }; continue; }
    if (island && i - island.i > LINK_TITLE_WINDOW) island = null;

    const link = LINK_ID.exec(text);
    if (link) {
      const linkId = link[1].trim();
      if (linkId) {
        if (island) island.linkId = linkId;
        lastLink = { linkId, i };
        /* A title that arrived before its LinkId is claimed here, once. */
        const pendingTitle = lastTitle && i - lastTitle.i <= LINK_TITLE_WINDOW ? lastTitle : null;
        if (pendingTitle && !titles.has(linkId)) {
          titles.set(linkId, pendingTitle.title);
          lastTitle = null;
          backfillTitle(linkId, pendingTitle.title);
        }
      }
      continue;
    }
    const session = ISLAND_SESSION.exec(text);
    if (session) {
      const sessionId = session[1].toLowerCase();
      if (island && island.linkId) {
        islands.set(sessionId, { sessionId, linkId: island.linkId, at: newestIso });
      }
      continue;
    }
    const titled = TITLE.exec(text);
    if (titled) {
      const title = titled[1].trim();
      if (title) {
        if (island && island.linkId) {
          /* Inside the island block: this title is the island's own. */
          if (!titles.has(island.linkId)) {
            titles.set(island.linkId, title);
            backfillTitle(island.linkId, title);
          }
        } else if (lastLink && i - lastLink.i <= LINK_TITLE_WINDOW) {
          /* Outside it: a title line standing next to a LinkId is about that
             link, but only the first title for a link is kept. */
          if (!titles.has(lastLink.linkId)) {
            titles.set(lastLink.linkId, title);
            backfillTitle(lastLink.linkId, title);
          }
        } else {
          /* A title with no LinkId in reach. Held in case the LinkId follows,
             and dropped otherwise - never attached to a link by guesswork. */
          lastTitle = { title, i };
        }
      }
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

    /* -- the assignment: this match, started now, under this settings block --

       The assignment is the one line every mode writes: a battle royale, an
       island, a replay - all of them are handed a session id here. It is the
       only universal start the log has, so it is the only thing that starts a
       match.

       It is not, on its own, the end of the match before it. Measured on his
       log, the end-of-match report for match N lands three and four seconds
       AFTER the assignment that started match N+1 - the client has the next
       server in hand while it is still flushing the last match's report. So the
       assignment only puts a ceiling on the match it interrupts: `boundAt`, the
       latest the match can have ended. If that match's own report arrives within
       BMA_TRAIL_MS the report wins and states the real end; otherwise the
       ceiling is all the log ever says, and that is what a Creative island gets,
       because an island writes no report at all. A ceiling further from the
       start than any match can run is not an end, so that match closes with a
       null end rather than a made-up one. -- */
    if (ASSIGNED.test(rest)) {
      const mm = CLIENT_ID.exec(rest);
      const se = SESSION_ATTR.exec(rest);
      if (mm && se) {
        const mmId = mm[1].toLowerCase();
        const sessionId = se[1].toLowerCase();
        const nowMs = Date.parse(at || "");
        /* Every earlier match still in flight is now known to have ended by this
           moment. Those whose grace has run out are written here; the newest one,
           still inside its grace, is left open in case its report follows. */
        for (const o of inflight.slice()) {
          if (o.sessionId === sessionId) continue;
          if (!o.boundAt) o.boundAt = at || null;
          const boundMs = Date.parse(o.boundAt || "");
          if (Number.isFinite(nowMs) && Number.isFinite(boundMs) && nowMs - boundMs > BMA_TRAIL_MS) {
            flushInflight(o);
          }
        }
        assigns.set(sessionId, { sessionId, mmId, at });
        if (!inflight.some((o) => o.sessionId === sessionId)) {
          inflight.push({ sessionId, at, boundAt: null });
          if (inflight.length > INFLIGHT_MAX) flushInflight(inflight[0]);
        }
      }
      continue;
    }

    /* The match-end marker is one burst of "Bad Match Attribute" lines written
       under a single timestamp. Frame counter also happens to repeat across a
       real burst, but the timestamp is what defines it, so a burst is grouped on
       that and on the attribute tag itself - a line that is not one of them ends
       it. */
    const isBma = BMA.test(rest);
    if (pending && (!isBma || at !== pending.at)) settlePending();

    if (isBma) {
      const sid = SESSION.exec(rest);
      if (sid) {
        if (pending) settlePending();
        pending = {
          sessionId: sid[1].toLowerCase(), playlist: null, playlistType: null,
          region: null, gameState: null, linkCode: null, at, endedBy: "bma",
        };
      }
      if (pending) {
        const play = PLAYLIST.exec(rest);
        if (play) pending.playlist = play[1];
        const ptype = PLAYLIST_TYPE.exec(rest);
        if (ptype) pending.playlistType = ptype[1];
        if (!pending.gameState) {
          const gs = GAME_STATE.exec(rest);
          if (gs) pending.gameState = gs[1];
        }
        if (!pending.linkCode) {
          const lc = LINK_CODE.exec(rest);
          if (lc) pending.linkCode = lc[1];
        }
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

  settlePending();
  /* A match still in force when the lines run out. Reading the whole log at once
     means nothing after this is ever coming, so it is reported with the end the
     log did not state: null. Reading one slice of a log that is still being
     written (the agent) means the opposite - the next assignment, and with it
     this match's end, is still to come - so it is left in state, unclosed. */
  if (!settle) {
    for (const o of inflight.slice()) flushInflight(o);
    inflight = [];
  }
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
  /* Islands and titles go the same way as assignments: once the match they name
     has been reported there is nothing left to look them up for. The match still
     in force keeps its own island, which is the one the next poll needs. */
  const keptIslands = [...islands.values()]
    .filter((x) => !seenSessions.has(x.sessionId))
    .slice(-ISLAND_KEEP);
  const liveLinks = new Set(keptIslands.map((x) => x.linkId));
  const keptLinks = [...titles.entries()]
    .filter(([linkId]) => liveLinks.has(linkId))
    .map(([linkId, title]) => ({ linkId, title }))
    .slice(-LINK_KEEP);

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
      inflight: settle ? inflight.slice(-INFLIGHT_MAX) : [],
      islands: keptIslands,
      links: keptLinks,
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
