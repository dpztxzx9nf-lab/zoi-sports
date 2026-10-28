# Playbook tools

Two small scripts that keep [`sensitivity/current.md`](../sensitivity/current.md) and
[`settings/current.md`](../settings/current.md) honest without anyone typing numbers.

They only ever **read** Fortnite's config. Nothing here writes to the game, changes a setting,
or touches anything outside `%LOCALAPPDATA%\FortniteGame\Saved\Config`.

## zoi-snapshot.ps1

Reads Fortnite's settings off the PC and writes them to `C:\Users\Golf\zoi-snapshot.json`.

Run it:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Golf\zoi-snapshot.ps1"
```

Where the numbers come from:

- **Display, graphics, audio** — `GameUserSettings.ini`, plain text, read directly.
- **Sensitivity, input devices** — `ClientSettings.Sav`, a binary file. The script finds each
  property by name and reads the float that follows it.

`ClientSettings.Sav` also contains Gamepad sections, mobile keys and legacy fields. Those exist
on every install regardless of what anyone plays on, which is why the script reports *which input
profiles are present* rather than guessing which one is in use.

## diff.py

Compares two snapshots and prints what actually changed, with readable names.

```
python3 diff.py OLD.json NEW.json
```

Prints nothing and exits 0 when the two are identical, so it can be run on a schedule without
producing noise.

Example output:

```
3 change(s):
  Shadows: 0 -> 2   [ShadowQuality]
  Sensitivity X (current): 0.02075 -> 0.019   [UpgradedMouseSensitivityX]
  Motion blur: False -> True   [bMotionBlur]
```

## The loop

1. `zoi-snapshot.ps1` runs → fresh JSON.
2. `diff.py playbook/state/last-snapshot.json NEW.json` → the changes, if any.
3. Each change becomes a row in the relevant log with a `pending` verdict.
4. `current.md` is updated to the new values.
5. The new snapshot replaces `state/last-snapshot.json`.

Steps 1–2 are mechanical. Step 3 is where a reason gets attached, and that part is Kneczi's —
only he knows why he moved a number. Step 5 is what makes the next run meaningful, which is why
the baseline lives in [`state/`](../state/).

## What this can't see

- **Mouse DPI and the mouse software profile.** Not in Fortnite's files.
- **Windows-level mouse acceleration, monitor settings, GPU driver state.** Knexrig's lane.
- **Which input device he actually plays on.** The file lists profiles, not a choice.
- **Keybinds.** Stored differently from the numeric settings and not yet extracted.

Everything in that list needs a human once, and then it's known.
