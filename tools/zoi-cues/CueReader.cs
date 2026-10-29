/* The damage-cue capture, stripped to what the headshot rule needs.

   This is the half of the tool that is Fortnite-specific. It subclasses the
   patched ReplayReader, catches the two events the patch raises for the
   BatchedDamageCues group only - the header stream and the parsed values - and
   reconstructs individual cues from them. Everything else the replay carries is
   ignored, which is both the reason this runs in about two seconds per match and
   the reason it is safe to run on a gaming PC mid-session.

   A cue, structurally
   -------------------
   The game batches several damage cues into one RPC. Each property in the
   payload arrives as a header (which property, how many bits, where the value
   sits) and a value, and the properties of one cue are written in a strictly
   ascending run of property handles. A repeated or backwards handle is where
   the next cue in the same RPC begins. A maximal ascending run is therefore one
   cue, which is the split below.

   Attribution
   -----------
   An RPC arrives on the firing pawn's network channel. Channels are recycled
   when a pawn dies, so the channel is resolved at the moment the RPC arrives
   into a live actor guid, and that guid into a player. That is what makes
   "whose cue was this" answerable at all; the channel-keyed map alone attributes
   kills to the wrong player late in a match. A cue's victim comes from its own
   HitActor guid, resolved the same way.

   Attribution: fortnite-replay-reader-adjacent code below runs against a patched
   fork of FortniteReplayDecompressor, MIT licensed, Copyright (c) 2020-2026
   Shiqan. See README.md. */
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using FortniteReplayReader;
using Unreal.Core.Models;
using Unreal.Core.Models.Enums;

/// <summary>
/// Captures the BatchedDamageCues group's raw property headers and parsed values,
/// and resolves each RPC's pawn channel to the player who fired it.
/// </summary>
public class DamageReader : FortniteReplayReader.ReplayReader
{
    public const string DamageGroup = "/Script/FortniteGame.FortPawn:NetMulticast_Athena_BatchedDamageCues";

    public readonly List<HeaderRec> DamageHeaders = new();
    public readonly List<ValueRec> DamageValues = new();
    /// <summary>One entry per ReceiveProperties call that carried at least one damage header.</summary>
    public readonly List<RpcRec> DamageCalls = new();
    private readonly Dictionary<long, RpcRec> _callsById = new();

    public DamageReader() : base(null, ParseMode.Full)
    {
        CaptureFieldValues = true;
    }

    public sealed class HeaderRec
    {
        public long CallId;
        public uint Handle;
        public string ExportName;
        public bool Skipped;
    }

    public sealed class ValueRec
    {
        public long CallId;
        public uint Handle;
        public string Value;
    }

    public sealed class RpcRec
    {
        public long CallId;
        public string InstigatorName;
    }

    protected override void OnNetFieldHeader(NetFieldHeaderEvent header)
    {
        if (header.GroupPath != DamageGroup) return;
        DamageHeaders.Add(new HeaderRec
        {
            CallId = header.CallId,
            Handle = header.Handle,
            ExportName = header.ExportName,
            Skipped = header.Skipped,
        });

        if (_callsById.ContainsKey(header.CallId)) return;
        var rpc = new RpcRec { CallId = header.CallId };
        _callsById[header.CallId] = rpc;
        DamageCalls.Add(rpc);
        /* By the pawn's LIVE actor guid, not by the channel: channels are
           recycled when a pawn dies and respawns. */
        rpc.InstigatorName = ResolveInstigator(header.ChannelIndex);
    }

    protected override void OnNetFieldValue(NetFieldValueEvent value)
    {
        if (value.GroupPath != DamageGroup) return;
        DamageValues.Add(new ValueRec
        {
            CallId = value.CallId,
            Handle = value.Handle,
            Value = value.Value,
        });
    }

    /// <summary>
    /// The player standing on <paramref name="pawnChannel"/> at this instant, or null.
    /// </summary>
    public string ResolveInstigator(uint pawnChannel)
    {
        var b = BuilderForExperiment;
        if (b is null) return null;

        if (b.ExperimentChannelToActor.TryGetValue(pawnChannel, out var guid) && guid != 0
            && b.ExperimentResolveActorGuid(guid, out var name) && name != null)
        {
            return name;
        }

        if (b.ExperimentPawnChannelToStateChannel.TryGetValue(pawnChannel, out var stateChannel) &&
            b.ExperimentPlayers.TryGetValue(stateChannel, out var player))
        {
            return player.PlayerName;
        }
        return null;
    }

    /// <summary>The player behind an actor guid, or null.</summary>
    public string ResolveActor(uint actorGuid)
    {
        var b = BuilderForExperiment;
        if (b is null || actorGuid == 0) return null;
        if (b.ExperimentResolveActorGuid(actorGuid, out var name)) return name;
        /* The guid map does not know every actor in every replay - it is built as
           the stream names them, and a pawn that was never named there is still
           a real player. So the same question is asked the long way round: guid
           to its live channel, channel to player state, state to name. It is the
           identical lookup, not a second opinion, and it is what the research
           harness did when these damage totals were measured. */
        foreach (var kv in b.ExperimentChannelToActor)
        {
            if (kv.Value != actorGuid) continue;
            if (b.ExperimentPawnChannelToStateChannel.TryGetValue(kv.Key, out var stateChannel) &&
                b.ExperimentPlayers.TryGetValue(stateChannel, out var player))
                return player.PlayerName;
        }
        return null;
    }

    /// <summary>Reflection access to the protected Builder field (one instance, set per ReadReplay).</summary>
    public FortniteReplayReader.FortniteReplayBuilder BuilderForExperiment
    {
        get
        {
            var f = typeof(FortniteReplayReader.ReplayReader).GetField("Builder",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            return f?.GetValue(this) as FortniteReplayReader.FortniteReplayBuilder;
        }
    }
}

/// <summary>
/// Reconstructs individual damage cues out of the raw header stream. A cue is a
/// maximal run of strictly ascending handles inside one RPC payload; the next cue
/// begins when a handle is repeated or goes backwards, which is what UE's
/// ascending bitset iteration produces when several cues are batched into one RPC.
/// </summary>
public static class CueBuilder
{
    /// <summary>One cue, as far as the headshot rule is concerned.</summary>
    public sealed class Cue
    {
        public string InstigatorName;
        public string VictimName;
        public string HitActor;
        public bool? IsCritical;
        /* How much damage the cue carried, in the game's own units. Not part of
           the headshot count; it is what lets the count be checked against the
           match's recorded damageToPlayers before it is published. Null when the
           cue did not carry the property, which is a cue whose weight is
           unknown rather than zero. */
        public float? Magnitude;
    }

    public static List<Cue> Build(DamageReader reader, string localName)
    {
        var cues = new List<Cue>();
        var valuesByCall = reader.DamageValues
            .GroupBy(v => v.CallId)
            .ToDictionary(g => g.Key, g => g.ToList());
        var headersByCall = reader.DamageHeaders
            .GroupBy(h => h.CallId)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var rpc in reader.DamageCalls.OrderBy(r => r.CallId))
        {
            if (!headersByCall.TryGetValue(rpc.CallId, out var headers) || headers.Count == 0) continue;

            var vals = valuesByCall.TryGetValue(rpc.CallId, out var vlist) ? vlist : new List<DamageReader.ValueRec>();
            var valIdx = 0;

            /* Split the payload into runs of strictly ascending handles. */
            var cue = NewCue(rpc);
            uint prev = 0;
            var started = false;
            foreach (var h in headers)
            {
                if (started && h.Handle <= prev)
                {
                    Finish(reader, cue);
                    cues.Add(cue);
                    cue = NewCue(rpc);
                }
                started = true;
                prev = h.Handle;

                /* Skipped headers produce no value, so the two streams are walked
                   together rather than zipped. */
                if (!h.Skipped && valIdx < vals.Count && vals[valIdx].CallId == rpc.CallId && vals[valIdx].Handle == h.Handle)
                {
                    var v = vals[valIdx++];
                    Assign(cue, h.ExportName, v.Value);
                }
                else
                {
                    Assign(cue, h.ExportName, null);
                }
            }
            Finish(reader, cue);
            cues.Add(cue);
        }
        return cues;
    }

    static Cue NewCue(DamageReader.RpcRec rpc) => new() { InstigatorName = rpc.InstigatorName };

    /* The victim is whatever the cue's HitActor names. A structure has a guid
       too, but no player stands behind it, so ResolveActor answers null and the
       cue is left unnamed - which is exactly what keeps a structural hit out of
       the headshot count. */
    static void Finish(DamageReader reader, Cue cue)
    {
        if (cue.HitActor == null) return;
        if (!uint.TryParse(cue.HitActor, NumberStyles.Integer, CultureInfo.InvariantCulture, out var guid) || guid == 0) return;
        cue.VictimName = reader.ResolveActor(guid);
    }

    static void Assign(Cue cue, string name, string value)
    {
        switch (name)
        {
            case "HitActor": cue.HitActor = value; break;
            case "bIsCritical": cue.IsCritical = value switch { "true" => true, "false" => false, _ => null }; break;
            /* The same parse the research harness used when the damage sums were
               measured: invariant culture, and anything unparseable is absent
               rather than a zero that would quietly shrink the total. */
            case "Magnitude": cue.Magnitude = ParseFloat(value); break;
        }
    }

    static float? ParseFloat(string s)
        => s != null && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : (float?)null;
}
