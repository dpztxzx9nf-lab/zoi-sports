# Controller log

Every controller change, newest first: look speed, scope multiplier, deadzone, binds,
or anything in Razer Synapse. Same shape as the other logs.

## Log

| Date | What changed | Why | Verdict | What changed in aim |
|---|---|---|---|---|
| — | — | — | — | — |

*No changes logged yet. Baseline is the 2026-10-28 read in [`current.md`](current.md) —
a baseline isn't a change, so it gets no row.*

## What's worth logging here

- **Look speed and ADS look speed.** The two numbers that decide how the game feels.
- **Scope multiplier.** Small change, outsized effect.
- **Deadzone.** Only when stick drift actually shows up.
- **Bindings.** Including the Wolverine's paddles, even though Fortnite can't see them.
- **Razer Synapse changes.** Stick curves and trigger stops compound with in-game values,
  so a change there is a change here.

Not logged here: deadzone tweaks made to chase a hardware fault, which is a Knexrig
question — is the pad drifting, or is the setting wrong?

## Worked example (fake values, real shape)

| Date | What changed | Why | Verdict | What changed in aim |
|---|---|---|---|---|
| 2026-01-14 | ADS look speed 12 → 15 | Crosshair kept trailing targets that strafed at medium range | kept | Tracking stayed with them instead of falling behind. Long-range taps got slightly twitchier, which was worth it. |
| 2026-01-14 | Scope multiplier 1.12 → 0.95 | Scoped turns felt faster than aimed, which shouldn't happen with magnification | kept | Scoped shots stopped overshooting. No cost felt. |
| 2026-01-20 | Look deadzone 0.05 → 0.07 | View drifted with hands off the stick | reverted | Drift turned out to be a stick fault, not the deadzone. Replaced the pad instead. |
