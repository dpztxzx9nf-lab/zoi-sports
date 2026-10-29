/* zoi-cues - how many headshots did the local player land in this replay?

   One argument, one line of JSON on stdout:

     {"ok":true,"headshots":8,"cues":167,"crit":11,"critNamed":8,"localPlayer":"Kneczi\u1D40\u1D40"}

   or, when the count cannot be measured:

     {"ok":false,"reason":"..."}

   and a non-zero exit. There is no third answer: a file that cannot be read is
   never reported as a match with zero headshots.

   Why a separate program
   ----------------------
   The headshot signal is not in any event a replay stores in the clear. It is
   inside the compressed network stream: the game batches its damage cues into
   NetMulticast_Athena_BatchedDamageCues RPCs, and each cue says whether the hit
   was critical (bIsCritical) and which actor it landed on. Reading that means
   decompressing the stream and walking it packet by packet, which is what
   FortniteReplayDecompressor does, and it is not something the Node side of the
   lab is going to re-implement. So the count is computed here, by the same code
   that proved the rule, and the JavaScript side only reads the number.

   The rule, and why it is this rule
   ---------------------------------
   A cue counts when ALL of these hold:
     * it was fired by the local player - the replay owner (IsReplayOwner), not
       the whole lobby. Counting everyone gives 67 on a match whose true answer
       is 2, which is how the whole-lobby version was ruled out;
     * bIsCritical is exactly true. A missing field is not a yes;
     * the cue names a victim.

   The victim condition is the one that looks arbitrary and is not. On the
   ground-truth match (21% accuracy, one elimination) the end screen said 8
   headshots. That match held eleven local critical cues; three of them carried
   no victim at all, because the thing they hit was a structure - magnitude
   exactly 100.0, hit actor 3219 or 12665. Eleven minus those three is eight.
   The rival rule "critical and not fatal" does not survive the same file: it
   needs one of those structural hits to count while dropping a real fatal
   headshot. Do not re-derive any of this; it is settled and pinned by the
   fixture table in tools/zoi-cues/README.md.

   What is deliberately absent
   ---------------------------
   The research harness this was cut from also wrote a CSV of every cue, a
   kill-feed cross-check, the raw header stream and the internal channel maps.
   None of that is needed to answer the question, all of it costs milliseconds
   per match and megabytes per file, and this runs on the player's PC beside a
   live game. What is left is the smallest program that can apply the rule.

   Attribution: this depends on a patched fork of FortniteReplayDecompressor -
   MIT licensed, Copyright (c) 2020-2026 Shiqan. The patch lives beside this file
   and build.sh applies it to a pinned commit. */
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using FortniteReplayReader;
using FortniteReplayReader.Models;

static class Entry
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0]))
                return Fail("no replay was given on the command line");
            return Count(args[0]);
        }
        catch (Exception ex)
        {
            /* Everything upstream of this throws on a file it does not
               understand, and a stack trace on stdout would be neither one line
               nor JSON. The message is shortened because it travels into a
               database column. */
            return Fail("the replay could not be read (" + Short(ex.Message) + ")");
        }
    }

    static int Count(string replayPath)
    {
        if (!File.Exists(replayPath)) return Fail("the replay file does not exist");

        var reader = new DamageReader();
        var replay = reader.ReadReplay(replayPath);

        /* The local player is the replay's owner, and the owner's name is what
           every cue's instigator is compared against. There is no fallback by
           name: guessing whose cues these are would be a different rule, and a
           replay that does not say who recorded it is one this tool declines. */
        var players = replay.PlayerData?.ToList() ?? new List<PlayerData>();
        var localName = OwnerName(reader, players);
        if (string.IsNullOrWhiteSpace(localName))
            return Fail("the replay does not name its owner, so the local player's cues cannot be told apart");

        /* A Creative island writes an AthenaMatchStats event that is empty and
           writes no AthenaMatchTeamStats at all - and its damage cues are real
           hits on real players, so the rule above would happily report two dozen
           "headshots" from a match that never had one. Refusing here, on the one
           event only a battle royale writes, is the same test
           tools/zoi-replay.mjs already applies. */
        if (replay.TeamStats == null || replay.Stats == null)
            return Fail("not a battle royale: the replay writes no AthenaMatchTeamStats event");

        var cues = CueBuilder.Build(reader, localName);

        var local = cues.Where(c => c.InstigatorName == localName).ToList();
        var crit = local.Where(c => c.IsCritical == true).ToList();
        var named = crit.Where(c => !string.IsNullOrWhiteSpace(c.VictimName)).ToList();

        var line = "{\"ok\":true"
            + ",\"headshots\":" + named.Count
            /* The three numbers that explain the count rather than describing
               it: cues the local player fired, how many of them were critical,
               and how many of those named a victim. headshots equals the third,
               so a disagreement between the two is a bug visible in one line. */
            + ",\"cues\":" + local.Count
            + ",\"crit\":" + crit.Count
            + ",\"critNamed\":" + named.Count
            + ",\"localPlayer\":\"" + Json(localName) + "\"}";
        Write(line);
        return 0;
    }

    /* Who recorded this replay.
       --------------------------
       The owner is the player whose player state is the one the recorder drove,
       and FortniteReplayDecompressor already knows the answer: GameData.RecorderId
       is that player state's actor guid, and it sets PlayerData.IsReplayOwner from
       exactly that comparison. The catch is a race inside its builder - the flag is
       only ever set at the moment the player state is first seen, and only if the
       channel map already pointed that channel at the recorder's actor by then. On
       three of the seven fixture replays the state arrives first, the comparison is
       skipped, and the flag is never revisited, so a plain IsReplayOwner lookup
       reports "does not name its owner" on a replay that obviously does.
       So: believe the flag when it is set, and otherwise run the same comparison
       once the whole replay has been parsed, when every map is populated. Both
       paths ask the identical question - whose player state is the recorder's -
       which is why this is the same rule and not a second one. What is NOT done
       here is guessing by name: if the maps cannot name a single owner, the count
       is refused rather than attributed to whoever looks likely. */
    static string OwnerName(DamageReader reader, List<PlayerData> players)
    {
        var flagged = players.FirstOrDefault(p => p.IsReplayOwner && !string.IsNullOrWhiteSpace(p.PlayerName));
        if (flagged != null) return flagged.PlayerName;

        var builder = reader.BuilderForExperiment;
        var recorder = builder?.ExperimentRecorderId;
        if (builder is null || recorder is null || recorder.Value == 0) return null;

        var named = builder.ExperimentPlayers
            .Where(kv => builder.ExperimentChannelToActor.TryGetValue(kv.Key, out var actor) && actor == recorder.Value)
            .Select(kv => kv.Value.PlayerName)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Distinct()
            .ToList();

        /* Exactly one, or none. Two names for one recorder is a map this tool does
           not understand, and a guess there would be a fabricated number. */
        return named.Count == 1 ? named[0] : null;
    }

    /* One line, UTF-8, straight onto the standard output stream. Writing bytes
       rather than Console.Out is what makes the player name come through intact
       on a Windows console whose code page is not UTF-8 - the name carries
       superscript characters, and a mangled name would still be one line of
       valid JSON with the wrong text in it. */
    static void Write(string line)
    {
        var bytes = new UTF8Encoding(false).GetBytes(line + "\n");
        using var stdout = Console.OpenStandardOutput();
        stdout.Write(bytes, 0, bytes.Length);
        stdout.Flush();
    }

    static int Fail(string reason)
    {
        Write("{\"ok\":false,\"reason\":\"" + Json(reason) + "\"}");
        return 1;
    }

    static string Short(string s)
    {
        if (string.IsNullOrEmpty(s)) return "no detail";
        s = s.Replace('\n', ' ').Replace('\r', ' ').Trim();
        return s.Length <= 60 ? s : s.Substring(0, 60);
    }

    static string Json(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (var ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                    else sb.Append(ch);
                    break;
            }
        }
        return sb.ToString();
    }
}
