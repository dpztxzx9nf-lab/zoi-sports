# The short list of things only Kneczi can answer

Almost everything in this folder now reads itself off the PC — see [`tools/`](tools/). These are
the leftovers: facts that live outside Fortnite's config files, so they get asked once and then
they're known forever.

Nothing here is a change, so nothing here gets a log row. This is baseline.

```
MOUSE

Which mouse, model:      ____________________
DPI (from its software): ____________________

INPUT

Mouse and keyboard, or controller?   ____________________
```

That's it. Everything else — resolution, frame cap, DLSS, every graphics slider, sensitivity,
scope multiplier, audio — is read directly from the game files.

## Why DPI matters more than it looks

In-game sensitivity on its own is not a number you can compare to anything. 2.075% at 400 DPI
and 2.075% at 1600 DPI are the same settings menu text and four times apart in how far the mouse
travels for a full turn. DPI is the other half, so without it eDPI and cm/360 can't be worked
out, and every future sensitivity change is a number with no scale behind it.

## Why the input device matters

The save file contains both a `KeyboardAndMouse` and a `Gamepad` profile, because Fortnite
writes a profile for each input type it has ever seen. That's normal and it doesn't record which
one gets used. If it's controller, the sensitivity section needs a different shape entirely —
look speed, ADS multiplier and deadzone instead of DPI and eDPI.
