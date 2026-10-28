# Sensitivity log

Every sensitivity change, newest first. One row per change, never edited after the fact — if a change was a mistake, log the correction as its own row and let the history show it.

## How to read a row

- **Date** — the day it changed.
- **What changed** — the field and the move, old → new, with real numbers.
- **Why** — what was going wrong or what was being tried. Be specific. "Felt off" is allowed but weak; "overshooting close-range flicks on stairs" gives the next change something to aim at.
- **Verdict** — `pending`, `kept`, `reverted`, or `mixed`. See the [README](../README.md).
- **What changed in aim** — filled in when the verdict lands. His own words are fine, and often better than a number.

## Log

| Date | What changed | Why | Verdict | What changed in aim |
|---|---|---|---|---|
| — | — | — | — | — |

*No changes logged yet. The first row lands when Kneczi reads his current numbers into [`current.md`](current.md) — that baseline isn't a change, so it doesn't get a row.*

## Worked example (fake numbers, real shape)

So the format is obvious before there's any history. **These are example values, not Kneczi's settings.**

| Date | What changed | Why | Verdict | What changed in aim |
|---|---|---|---|---|
| 2026-01-10 | Sensitivity X/Y 8.0% → 7.2% (eDPI 640 → 576) | Overshooting flicks at close range and correcting mid-swipe | kept | Tracking got steadier at medium range. Close flicks now land short instead of long, which is easier to fix. |
| 2026-01-04 | Targeting sensitivity 6.5% → 7.5% | ADS felt sluggish when a target strafed past | reverted | Faster on paper, but long-range taps got twitchy. Reverted on 2026-01-08. |
| 2026-01-02 | DPI 800 → 1600, in-game halved to match | Wanted finer in-game increments without changing eDPI | mixed | eDPI unchanged as intended. Mouse feels smoother, but the settings menu now shows confusingly small percentages. |

Note how the second row earns its `reverted`: it was tried, it had a cost, and the cost is written down. A log where every change was a good idea is a log nobody's learning from.

## Review habit

When there are pending rows, clear them before making another change. Changing two sensitivity fields before judging the first one means neither change can be traced to anything.
