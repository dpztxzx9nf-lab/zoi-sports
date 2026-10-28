# Playbook tools

Two scripts keep [`controller/current.md`](../controller/current.md) and
[`settings/current.md`](../settings/current.md) honest without anyone typing a number.

They only **read** Fortnite's config. Nothing here writes to the game, changes a setting,
or touches a file outside `%LOCALAPPDATA%\FortniteGame\Saved\Config`.

## The three steps

```
powershell -NoProfile -ExecutionPolicy Bypass -File zoi-snapshot.ps1
python3 parse.py fortnite-config snapshot.json
python3 diff.py playbook/state/last-snapshot.json snapshot.json
```

**1. `zoi-snapshot.ps1`** copies two files into `fortnite-config\` beside the script:

- `GameUserSettings.ini` — display, graphics, audio. Plain text.
- `ClientSettings.Sav` — sensitivity, controller, bindings. Binary.

It's a plain copy on purpose. Parsing happens in Python, where it can be tested, instead of
in PowerShell, where a byte offset that's off by one silently returns a wrong number.

**2. `parse.py`** reads both and writes one flat JSON snapshot. It reads
`ClientSettings.Sav`'s tagged property stream — name, type, a size marker, then a 4-byte
value — which is more reliable than searching for byte patterns that might appear anywhere
in a 480 KB file.

**3. `diff.py`** compares two snapshots and prints what moved, in plain names. Prints
nothing and exits 0 when they're identical, so it can run on a schedule without noise.

## The loop

1. Snapshot, parse, diff.
2. Each change becomes a log row with a `pending` verdict.
3. `current.md` gets the new values.
4. The reviewed snapshot replaces `state/last-snapshot.json`.

Steps 1–2 are mechanical and run on a schedule. Step 2's *reason* is the part only Kneczi
knows, which is why the log has a column for it.

## What this can't see

- **Razer Synapse.** Paddle assignments, stick curves, trigger stops, polling rate — the pad
  holds those itself and Fortnite's files never mention them.
- **Anything set in the controller.** The save shows what the *game* thinks the bindings are.
  If the Wolverine remaps A to a paddle in hardware, Fortnite still calls it A.
- **Keybinds for a keyboard.** Mouse and keyboard bindings live in a different part of the
  save stream and aren't extracted yet.
- **PC and hardware.** Frame times, drivers, monitor settings. Knexrig's lane.
