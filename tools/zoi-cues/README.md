# zoi-cues

Counts the headshots the local player landed in one Fortnite replay, so the Zoi
Sports lab can report a real number instead of `null / needs-damage-cue-reader`.

```
dotnet dist/zoi-cues.dll "C:\Users\Golf\AppData\Local\FortniteGame\Saved\Demos\x.replay"
```

```
{"ok":true,"headshots":8,"cues":167,"crit":11,"critNamed":8,"localPlayer":"Knecziᵀᵀ"}
```

One line of JSON on stdout. On failure, one line of JSON and a non-zero exit:

```
{"ok":false,"reason":"the replay file does not exist"}
```

There is no third answer. A replay that cannot be read is never reported as a
match with zero headshots.

## What the numbers mean

| field | meaning |
|---|---|
| `headshots` | the count, by the rule below |
| `cues` | damage cues the local player fired at all |
| `crit` | how many of those had `bIsCritical` exactly true |
| `critNamed` | how many of *those* named a victim — equal to `headshots` |
| `localPlayer` | the name every cue was filtered against |

`headshots == critNamed` always. The other two are there so a wrong count is
visible in the same line as the count.

## The headshot rule

A damage cue counts when **all** of these hold:

1. it was fired by the local player — the replay owner — not the whole lobby;
2. `bIsCritical` is exactly `true` (a missing field is not a yes);
3. the cue names a victim (non-empty victim name).

This is settled. It was proven against ground truth and it is not open to
re-tuning.

**Why filter to the local player.** Counting every cue in the lobby gives 67
headshots on a match whose real answer is 2. The local filter is the whole
difference.

**Why the victim condition.** On the ground-truth replay — 21% accuracy, one
elimination, `/workspace/replay-probe/reload2.replay` — the game's own end screen
said **8 headshots**. That replay holds eleven local critical cues. Three of them
carry no victim at all, because what they hit was a structure: magnitude exactly
`100.0`, hit actor `3219` or `12665`. Eleven minus three is eight.

**Why not "critical and not fatal".** It fails the same file. It has to count one
of those structural hits while dropping a real fatal headshot — two errors that
happen to be equal and opposite on one match, which is why it looked plausible.

**What a Creative island does.** It writes an empty `AthenaMatchStats` event and
no `AthenaMatchTeamStats` at all, but its damage cues are real hits on real
players, so the rule above would report two dozen "headshots" from a match that
never had one. The tool refuses anything with no `AthenaMatchTeamStats`, the same
test `tools/zoi-replay.mjs` already applies.

## Fixtures

All seven of these must reproduce exactly. They are the regression test; the
JavaScript side runs them too.

| replay | eliminations | headshots |
|---|---|---|
| `reload2.replay` | 1 | **8** (confirmed on the in-game end screen) |
| `m7.replay` | 2 | 2 (confirmed on the in-game end screen) |
| `latest4.replay` | 2 | 4 |
| `m6.replay` | 3 | 3 |
| `reload.replay` | 7 | 7 |
| `latest1.replay` | 13 | 5 |
| `latest2.replay` | 0 | 0 |

`latest2` is the one that matters for honesty: a real match, a real zero. It has
to come back `ok:true, headshots:0`, not as a failure, or a player who never hit
a headshot would look like a broken reader.

## Who is the local player

The owner is the player whose player state the recorder drove. The decompressor
already answers this — `GameData.RecorderId` is that state's actor guid, and
`PlayerData.IsReplayOwner` is set from exactly that comparison — but it only
performs the comparison at the instant the player state is first seen, and only
if the channel map is already populated. On three of the seven fixtures the state
arrives first, the comparison is skipped and never revisited, so `IsReplayOwner`
stays false on a replay that plainly does name its owner.

So: believe `IsReplayOwner` when it is set; otherwise run the identical comparison
once the whole replay is parsed, when the maps are complete. If that yields
anything other than exactly one name, the count is refused. There is deliberately
no fallback that guesses by name — guessing whose cues these are would be a
different rule, and it is the kind of guess that quietly invents a number.

## Rebuilding

`dist/` is a committed, prebuilt win-x64 build. Rebuild only when changing the
C# or bumping the decompressor.

```
tools/zoi-cues/build.sh
```

Needs a .NET 10 SDK and `git` on `PATH` (`dotnet` 10.0.403 was used). The script
clones the pinned commit into a temporary directory, applies
`frd-damage-cues.patch`, publishes `-c Release -r win-x64 --self-contained false`
and copies the output into `dist/`. Nothing outside this directory is touched and
the clone is deleted on exit — a build never depends on a checkout left lying
around.

**Pinned decompressor commit:** `76f74c1f640069afdba71b6468e2f819327893c2` of
[`Shiqan/FortniteReplayDecompressor`](https://github.com/Shiqan/FortniteReplayDecompressor).
Pinned to a commit and not a branch on purpose: a moving upstream would silently
change the numbers this tool reports.

## Why `dist/` is committed

Because of where this runs. The tool executes on the player's gaming PC, beside
Fortnite, with no SDK, no NuGet restore and no network requirement it can rely on.
Committing the build means deploying is a file copy and the only prerequisite is
the .NET runtime that PC already has. It is 15 files, about 916 KB.

It is a build artifact in source control, which is normally wrong, and it is right
here for that reason alone. If it ever drifts from the sources, `build.sh` fixes
it; the fixture table is what catches a stale or wrong build at runtime.

## Files

| file | what it is |
|---|---|
| `Program.cs` | entry point: resolve the owner, apply the rule, print one line |
| `CueReader.cs` | captures the damage-cue property stream and rebuilds cues from it |
| `zoi-cues.csproj` | minimal console project, `ProjectReference` to the patched decompressor |
| `build.sh` | the reproducible build described above |
| `frd-damage-cues.patch` | the patch that adds the damage-cue export to the decompressor |
| `dist/` | committed win-x64 build output |

## Attribution

This depends on a patched fork of **FortniteReplayDecompressor**, MIT licensed,
Copyright (c) 2020-2026 **Shiqan** — https://github.com/Shiqan/FortniteReplayDecompressor.
The license text is in `dist/` alongside the binaries it covers.

The patch adds one thing: a pair of events raised for the
`NetMulticast_Athena_BatchedDamageCues` group carrying each property's raw header
and parsed value, plus live views of the decompressor's channel/actor/player maps
so a damage RPC can be attributed to a player. Read and value capture only; it
changes no parsing behaviour of its own.
