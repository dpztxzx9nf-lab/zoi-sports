# Zoi playbook

Kneczi's Fortnite Zero Build settings, sensitivity, aim and strategy — the part of the game that's about *him*, not the machine.

**This folder is not about hardware.** Frame times, drivers, GPU and display settings, capture tooling, overclocks and Windows tuning belong to Knexrig. If a change only matters because of the PC it runs on, it doesn't go here. If it changes how the aim feels or how the game is played, it does.

## The rule

Every entry gets three things:

1. **A date** — the day it changed, not the day it was noticed.
2. **The value** — the number or the setting, stated plainly. Not "higher," the actual figure.
3. **A reason** — why it changed. "Felt off" is a reason. "Missing wide on strafing targets at 30m" is a better one.

A fourth field is what makes the whole thing worth keeping: **what changed in aim afterwards.** That's usually Kneczi's own words rather than a score, and that's fine. The point is that no change stays open forever — every row gets a verdict at some point:

| Verdict | Means |
|---|---|
| `pending` | Changed, not judged yet. Needs a verdict at the next review. |
| `kept` | Helped. It's the new baseline. |
| `reverted` | Didn't help, or hurt. Went back. |
| `mixed` | Some things better, some worse. Say which. |

**A change with no verdict is a loose end, not a setting.** When the log has pending rows, that's the first thing to clear.

## Files

| File | What's in it |
|---|---|
| [`sensitivity/current.md`](sensitivity/current.md) | The numbers running right now, plus the derived figures worth knowing (eDPI, cm/360) |
| [`sensitivity/log.md`](sensitivity/log.md) | Every sensitivity change, dated, with why and the verdict |
| [`settings/current.md`](settings/current.md) | In-game graphics, display and input settings as they stand |
| [`settings/log.md`](settings/log.md) | Every in-game settings change, dated, with why and the verdict |
| [`aim.md`](aim.md) | Aim notes: routine, warmup, what's actually being worked on |
| [`strategy.md`](strategy.md) | Zero Build decisions: drop, loadout, rotation, endgame |
| [`tools/`](tools/) | The scripts that read Fortnite's settings off the PC and diff two snapshots |

## How this stays current without anyone typing

Fortnite stores its settings as files on the PC, which means they can be read instead of copied
off a menu screen by hand.

1. [`tools/zoi-snapshot.ps1`](tools/zoi-snapshot.ps1) reads the game's config and writes a JSON
   snapshot. Read-only — it never changes a setting.
2. [`tools/diff.py`](tools/diff.py) compares that snapshot against
   [`state/last-snapshot.json`](state/) and prints exactly what moved, in readable names.
3. Each change becomes a log row with a `pending` verdict, and `current.md` gets updated.
4. The reviewed snapshot becomes the new baseline.

The first two steps are mechanical and can run on a schedule. The third needs a reason attached,
and only Kneczi knows why he moved a number — that part stays human.

What the files can't tell anyone: mouse DPI, which mouse, Windows-level mouse acceleration,
monitor and driver state. Those are asked once and then known.

## How a change gets logged

1. Add a row to the relevant `log.md` with date, field, old value, new value, reason, and verdict `pending`.
2. Update `current.md` to match. `current.md` is always the truth; the log is the history.
3. At the next review, fill the verdict and the aim note.

Never edit a past row's value or reason. If a change was wrong, log the correction as its own row. The history is the useful part.
