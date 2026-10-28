# Controller — current

Razer Wolverine V3 TE, wired. Read off the PC by
[`tools/zoi-snapshot.ps1`](../tools/zoi-snapshot.ps1) and [`tools/parse.py`](../tools/parse.py).

Last synced: **2026-10-28** (Fortnite last wrote the save file 2026-10-26 12:52)

## Look — the numbers that decide how aiming feels

| Setting | Value | Field | Notes |
|---|---|---|---|
| Hipfire look speed | `43` | `LookHorizontalSpeed` / `LookVerticalSpeed` | Equal on both axes, which is what you want |
| ADS look speed | `12` | `LookHorizontalSpeedAds` / `LookVerticalSpeedAds` | The number that matters — most fights happen with sights up |
| Scope multiplier | `1.12` | `ScopedSensitivityMultiplier` | Above 1.0, so scoped turns *faster* than aimed |
| Look boost speed | `0` | `LookHorizontalBoostSpeed` | No acceleration past the base rate |
| Look boost ramp | `0.0` | `LookBoostAccelerationTime` | Time to reach boost speed; moot at zero boost |
| Look ease time | `0.0` | `LookEaseTime` | No smoothing |
| Targeting slowdown | `0.43` | `TargetingSlow` | Likely aim-assist slowdown rather than turn speed — unconfirmed |
| Scoped slowdown | `0.43` | `ScopedSlow` | Same |

**ADS at 12 against hipfire at 43** is the headline. Aiming drops turn rate by about
72%, so the speed he actually plays at is 12.

**The scope multiplier at 1.12 is the odd one out.** A magnified optic needs less stick
movement for the same on-screen result, not more, so a multiplier above 1.0 usually means
it was never adjusted. First thing to test.

## Sticks and triggers

| Setting | Value | Field |
|---|---|---|
| Look deadzone | `0.05` | `GamepadLookStickDeadZone` |
| Move deadzone | `0.06` | `GamepadMoveStickDeadZone` |
| Left trigger release | `0.05` | `GamepadLeftTriggerReleaseThreshold` |
| Right trigger release | `0.05` | `GamepadRightTriggerReleaseThreshold` |

Both deadzones are low, which the Wolverine's hall-effect sticks can carry. If the view
ever drifts with hands off the stick, raise the look deadzone first.

## Binds

Default layout throughout. Zero Build's live actions:

| Action | Button |
|---|---|
| Jump | A |
| Crouch | Right stick click |
| Sprint | Left stick click |
| Fire | Right trigger |
| Aim | Left trigger |
| Use / reload | X |
| Next weapon | RB |
| Previous weapon | LB |
| Pickaxe | Y |
| Place marker | D-pad left |

The Wolverine V3 TE has extra buttons, and they don't appear in this file at all — the
controller remaps in hardware. So the file can't say whether they're in use.

**The Zero Build opportunity:** with no building, five weapon slots plus heals are all
reached by cycling. Direct slot selection on the paddles is the free win here.

## Dead weight

`BuildingMultiplier` and `EditingMultiplier` are both still set (1.15). Harmless in Zero
Build, but they're the kind of thing that makes a settings file look busier than it is.

## The Wolverine's own settings

Not in Fortnite's files — the pad stores them itself. That means paddle assignments,
trigger stops if the TE has them set, stick curves in Razer Synapse, polling rate, and
onboard profile switching all need looking at separately. Worth knowing because a curve
set in Synapse and a look speed set in Fortnite compound — one of them should be flat.
