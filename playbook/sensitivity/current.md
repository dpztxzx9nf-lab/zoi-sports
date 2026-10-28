# Sensitivity — current

The numbers running right now, read straight off the PC by
[`tools/zoi-snapshot.ps1`](../tools/zoi-snapshot.ps1). No typing, no screenshots.

Last synced: **2026-10-28 12:47** (Fortnite config last written 2026-10-26 12:52)

## Core — read from the game

| Field | Value | Source |
|---|---|---|
| Sensitivity X | `0.02075` | `MouseSensitivityX` |
| Sensitivity Y | `0.02075` | `MouseSensitivityY` |
| Scope sensitivity | `1.12` | `ScopedSensitivityMultiplier` — a multiplier on the above, not a separate percentage |
| Legacy sensitivity | `-1` | `MouseSensitivity` — unset, which is correct. The X/Y pair above is what the game uses. |
| Settings version | `0` | `MouseSensitivityDefaultVersion` |

Fortnite's own settings screen shows sensitivity as a percentage, so `0.02075` on disk is
**2.075%** in the menu. The file stores the raw 0–1 value; the menu multiplies by 100. Written
here as the raw number because that's what the file holds, and it's what a diff compares
against — no rounding drift.

X and Y match, which is the usual and the right default. Unmatching them changes diagonal
feel and makes every log row ambiguous.

## Mouse — not readable from the game files

| Field | Value | Notes |
|---|---|---|
| Mouse | — | Which mouse he actually competes on |
| DPI | — | The other half of every sensitivity number. Lives in the mouse's own software, not Fortnite's config. |

## Derived — the numbers that actually compare

Needs DPI, so these fill in once it's known. For reference at the current 2.075%:

| DPI | eDPI | cm/360 |
|---|---|---|
| 400 | 8.3 | — |
| 800 | 16.6 | — |
| 1600 | 33.2 | — |
| 3200 | 66.4 | — |

eDPI is DPI × the in-game percentage. cm/360 also needs the mouse's real rotation sensitivity
(its "counts per inch" as the game sees it), which is why the column is blank — it can't be
worked out from DPI alone. eDPI is the honest comparison figure here.

## Input device

Both `KeyboardAndMouse` and `Gamepad` profiles exist in the save file, which is normal —
Fortnite writes a profile for each input type it has ever seen. **Which one he actually plays
on isn't recorded in the file.** Worth confirming once so every log row below is unambiguous.

**Zero Build means no build or edit sensitivity to track** — three fields instead of six, and no
build-mode muscle memory to keep in sync with gun aim.

## Open questions

- Which mouse, and what DPI is it set to?
- Mouse and keyboard, or controller? The numbers above assume mouse.
