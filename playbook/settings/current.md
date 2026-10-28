# In-game settings — current

Fortnite's own settings, read straight off the PC by
[`tools/zoi-snapshot.ps1`](../tools/zoi-snapshot.ps1).

Last synced: **2026-10-28 12:47** (Fortnite config last written 2026-10-27 13:01)

## Display

| Field | Value | What it costs or buys |
|---|---|---|
| Display mode | `0` — Fullscreen | Lowest latency. The alternative is borderless, which is smoother to alt-tab but adds a frame of input lag. |
| Resolution | 2560 × 1440 | Native for a 1440p panel. Not stretched. |
| Frame rate cap | 240 fps | Set well above 144 Hz, which is the usual competitive argument — more frames than refresh rate still cuts input latency. |
| VSync | Off | On adds latency. Off is correct for competition. |
| HDR | Off | Avoids a tone-mapping pass and the washed-out look some monitors give it. |

## Graphics

| Field | Value | Notes |
|---|---|---|
| Anti-aliasing | DLSS, quality `2` | DLSS is doing the upscaling rather than TSR. |
| DLSS frame generation | Off | Frame gen adds latency and can smear fast aim. Correct to have off. |
| Upscale quality | 85% | Rendering at 85% and upscaling to 1440p. |
| 3D resolution | 100% | The scalability slider; DLSS handles actual rendering resolution. |
| Nanite | Off | |
| Ray tracing | Off | |
| Global illumination | Level `1` | |
| Reflections | Level `1` | |
| Motion blur | Off | On would blur exactly what he needs to track. Correct. |
| Show grass | Off | Cleaner sightlines in ZB, where cover is natural terrain. |
| Dynamic resolution | Off | On would let the frame rate vary the resolution mid-fight, which makes aim inconsistent. |
| Show FPS | Off | Display choice; doesn't affect the game. |

### Scalability levels

Fortnite's scale is 0 (Low) to 4 (Epic). Everything set low except resolution:

| Slider | Level |
|---|---|
| View distance | 1 — Medium |
| Anti-aliasing | 0 — Off |
| Shadows | 0 — Off |
| Global illumination | 0 — Off |
| Reflections | 0 — Off |
| Post processing | 0 — Off |
| Textures | 0 — Low |
| Effects | 0 — Low |
| Foliage | 0 — Off |
| Shading | 1 — Medium |
| Landscape | 2 — High |

This is a pure-competitive loadout: everything that costs frames is off, and the two sliders that
affect what he can actually *see* (view distance and landscape) sit a notch or two up. One thing
worth knowing: **shadows at 0 means losing the shadow that tells you someone's about to come
around a corner.** That's a real Zero Build cost, since cover is buildings and hills.

## Audio

| Field | Value |
|---|---|
| Headphone mode | On |
| Audio quality | Level `0` |

Audio is the highest-leverage corner of this file in Zero Build. No structures means footsteps
and reloads carry further with nothing to muffle them.

## Input

| Field | Value |
|---|---|
| Mouse acceleration (game-side) | Not disabled — `bDisableMouseAcceleration = False` |
| Input device | Controller — Razer Wolverine V3 TE, wired. See [`controller/current.md`](../controller/current.md). |
| Sprint by default | — |
| Auto-open doors | — |
| Toggle or hold to aim | — |
| Keybinds | — |

These aren't in a readable field. Mouse acceleration is the one worth checking: with it off at
the Windows/software level it doesn't matter, but if it's on anywhere it makes aim
inconsistent at every speed. That's a Knexrig question (it's a PC-level setting), and this flag
is the game's own.

**Zero Build keybind note:** with no builds, four build slots and the edit key free up. If those
are still bound out of habit, that's free real estate for weapons, heals and inventory.

## Not mine

Frame times, drivers, GPU control panel, monitor settings, Windows tweaks, capture and streaming
— Knexrig's. If a change is about the machine, it isn't logged here.
