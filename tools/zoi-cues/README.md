# zoi-cues

Counts the headshots the local player landed in one Fortnite replay, so the Zoi
Sports lab can report a real number instead of `null / needs-damage-cue-reader`.

```
dotnet dist/zoi-cues.dll "C:\Users\Golf\AppData\Local\FortniteGame\Saved\Demos\x.replay"
```

```
{"ok":true,"headshots":8,"cues":167,"crit":11,"critNamed":8,"localDamage":1304,"matchDamage":1195,"damageRatio":1.091,"localPlayer":"Knecziᵀᵀ"}
```

One line of JSON on stdout. On failure, one line of JSON and a non-zero exit:

```
{"ok":false,"reason":"the replay file does not exist"}
```

There is no third answer. A replay that cannot be read is never reported as a
match with zero headshots, and a replay whose cue stream contradicts its own
stats is never reported as a count either.

## What the numbers mean

| field | meaning |
|---|---|
| `headshots` | the count, by the rule below |
| `cues` | damage cues the local player fired at all |
| `crit` | how many of those had `bIsCritical` exactly true |
| `critNamed` | how many of *those* named a victim — equal to `headshots` |
| `localDamage` | sum of `Magnitude` over the local player's named cues, critical or not |
| `matchDamage` | `damageToPlayers` from the match's own `AthenaMatchStats` |
| `damageRatio` | `localDamage / matchDamage`, to three decimals |
| `localPlayer` | the name every cue was filtered against |

`headshots == critNamed` always. The other fields are there so a wrong count is
visible in the same line as the count: `crit` says how many critical cues the
reader saw, and `localDamage` against `matchDamage` says whether the reader's
attribution survived the reconciliation.

## The headshot rule

A damage cue counts when **all** of these hold:

1. it was fired by the local player — the replay owner — not the whole lobby;
2. `bIsCritical` is exactly `true` (a missing field is not a yes);
3. the cue names a victim (non-empty victim name).

And the resulting count is published only if the reader's damage agrees with the
match's, which is the check below.

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

## The reconciliation check

The three conditions above describe the cues the reader attributed to the local
player. They cannot tell whether that attribution was right, and on some replays
it is not: the cue reader credits other players' damage cues to the local player,
which inflates the damage and the headshot count together.

So before anything is published, the tool sums `Magnitude` over every cue the
local player instigated that **named a victim** — critical and non-critical
alike, since structural hits carry no victim and are excluded — and compares it
to `damageToPlayers` from the replay's own `AthenaMatchStats`:

```
ratio = localDamage / damageToPlayers
```

`ratio <= 1.15` publishes. `ratio > 1.15` **refuses**: one line of
`{"ok":false,"reason":"the cue reader credited N damage to the local player but
the match recorded M, so the cue attribution is unreliable for this replay"}` and
a non-zero exit.

Measured against Brock's end screens, the screen-confirmed matches and the
known-wrong ones do not overlap:

| replay | screen headshots | raw `critNamed` | local named damage | `damageToPlayers` | ratio | verdict |
|---|---|---|---|---|---|---|
| `m7.replay` | 2 | 2 | 926 | 922 | 1.005 | correct |
| `m10b.replay` | 5 | 5 | 882 | 866 | 1.018 | correct |
| `m13.replay` | 2 | 2 | 1027 | 1001 | 1.026 | correct |
| `m6.replay` | (no screen captured) | 3 | 1349 | 1317 | 1.025 | consistent |
| `reload2.replay` | 8 | 8 | 1304 | 1195 | 1.091 | correct |
| `m9b.replay` | 25 | 37 | 5867 | 4478 | 1.310 | **wrong** |
| `m8.replay` | 1 | 4 | 1415 | 554 | 2.553 | **wrong** |

Every match where the raw count matches the screen is at or below 1.091. Both
wrong matches are at or above 1.310. Nothing screen-confirmed lands in between;
`reload.replay` (1.186) is in that gap and was never screen-confirmed, which is
its own reason not to publish its count, and it is refused like the others.

**Refusing is the fix, not a workaround.** A number the replay itself contradicts
is not a measurement. Publishing the inflated count would put a wrong headshot
figure on the lab; publishing zero would be worse, because zero is a real answer
for a real match and the two must stay distinguishable. The refusal carries both
totals in its reason, so the lab stores a null headshot with that reason and the
match says why it has no headshot figure.

**What does not work, and was tried.** Collapsing repeated critical cues,
deduping by victim, any time window. `m10b.replay` has four critical cues on
`Alejandro281113`, all magnitude `13.50`, inside 1.1 seconds, and the end screen
counts all four (5 total, including one earlier crit on a different victim). Any
collapse rule destroys a correct match in order to rescue two broken ones. The
reconciliation check changes nothing about a good replay's count.

### The one rescue that looks obvious and is not

`m11` makes it tempting to rescue the count by picking the single guid that
reconciles instead of refusing. Do not. On `m11` the union of the local player's
guids is 1.94 and one guid alone is 1.02, so a per-guid pick would "work" - but
the rule that pick implies breaks the good matches. On `m7`, `m13`, `m6` and
`reload2` the local player's cues are spread across three or four guids, and no
single one of them comes close to the match's damage total: on `reload2` the four
guids carry 0.33, 0.45, 0.14 and 0.18 of it and only their sum is the match. A
reader that insisted on one guid would throw away three quarters of a correct
match to make `m11` pass. And it does not even rescue the broken ones: on `m9b`
the biggest single guid reconciles at 1.03 by itself and would publish 23 where
the screen said 25, which is a wrong number wearing the costume of a checked one.
Refusing is the only answer that is right on all eight files, which is why it is
the answer.

## Fixtures

All of these must reproduce exactly. They are the regression test; the
JavaScript side runs them too.

| replay | headshots | ratio | why |
|---|---|---|---|
| `m7.replay` | **2** | 1.005 | confirmed on the in-game end screen |
| `m10b.replay` | **5** | 1.018 | confirmed on the in-game end screen; four of the five are crits on one victim inside 1.1 s |
| `m13.replay` | **2** | 1.026 | confirmed on the in-game end screen |
| `m6.replay` | **3** | 1.025 | no screen captured; consistent with the match's recorded damage |
| `reload2.replay` | **8** | 1.091 | confirmed on the in-game end screen; the match the rule was settled on |
| `m9b.replay` | **REFUSED** | 1.310 | screen said 25, the cue stream claims 37. Over-credited by construction |
| `m8.replay` | **REFUSED** | 2.553 | screen said 1, the cue stream claims 4. Over-credited by construction |
| `m11.replay` | **REFUSED** | 1.944 | screen said 0, the cue stream claims 4. Over-credited by construction |
| `latest4.replay` | 4 | 1.009 | earlier fixture, still reproduces |
| `latest1.replay` | 5 | 0.638 | earlier fixture, still reproduces |
| `latest2.replay` | 0 | 1.038 | earlier fixture; a real match, a real zero |
| `reload.replay` | **REFUSED** | 1.186 | earlier fixture, never screen-confirmed; now over the line |

`m11` is the sharpest of the three. It is a ranked Zero Build match that ended
with 0 headshots, 0 eliminations, 10 hits and 270 damage to players, and the cue
stream reports 4 headshots and 525 damage for the local player. A zero on the
screen against a four from the reader is not a rounding disagreement, it is the
reader describing a different player. On that file the local name is attached to
two actor guids: one that fires 36 cues between 24 and 38 seconds and carries all
36 of the named hits, and one that fires 36 cues between 152 and 613 seconds and
carries none. Ten of the second guid's cues are magnitude exactly 27 - ten hits at
27 is the screen's 270 damage - so the quiet guid has the right total and the
wrong attribution, and the loud one is somebody else's work wearing Brock's name.
The reconciliation cannot pick the right guid for you, which is why it refuses
rather than choosing; what it can do is notice that the sum does not fit the match
and say so instead of printing four.

**`m9b`, `m8` and `m11` are REFUSED ON PURPOSE.** Their cue streams over-credit
the local player's damage badly — 5867 against 4478 recorded on `m9b`, 1415
against 554 on `m8`, 525 against 270 on `m11` — so the reader is demonstrably
attributing other players' cues to Brock, and any headshot count taken from those
streams would be wrong for the same reason. The refusal *is* the fix: the tool says so in one line and exits
non-zero, and the lab stores a null headshot with that reason. It is not a count,
and it is not zero.

`latest2` is the one that matters for the other direction: a real match, a real
zero. It has to come back `ok:true, headshots:0`, not as a failure, or a player
who never hit a headshot would look like a broken reader.

`reload.replay` is the fixture the rule change moved. It was never confirmed
against an end screen — the earlier table carried its count because it came out
of the reader, not because anyone checked it — and at 1.186 it sits above the
1.15 line. It is now refused for the same reason as `m9b`, `m8` and `m11`. That is the
check doing its job on a match nobody had verified, and it is recorded here
rather than quietly special-cased.

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

A cue's victim is resolved the same way, and has the same gap: the guid-keyed
actor map is built as the stream names actors, so a real player's pawn can be
missing from it. `ResolveActor` therefore falls back to guid → live channel →
player state → name, which is the identical lookup by a longer route, not a
second opinion. Without that fallback nine local cues on `reload.replay` resolve
to no victim at all and drop out of both the damage sum and the count; with it,
the damage totals reproduce the research harness's numbers to the last decimal on
every fixture. It never changes a headshot count on any of them.

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
| `Program.cs` | entry point: resolve the owner, apply the rule, check it against the match, print one line |
| `CueReader.cs` | captures the damage-cue property stream and rebuilds cues from it, magnitude included |
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
