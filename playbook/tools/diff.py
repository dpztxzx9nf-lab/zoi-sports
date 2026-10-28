#!/usr/bin/env python3
"""Compare two Fortnite snapshots and print what changed, in plain words.

Usage: python3 diff.py OLD.json NEW.json
Silent and exit 0 when nothing changed, so it can run on a schedule.
"""
import json, sys

LABELS = {
    # display / graphics
    'ResolutionSizeX': 'Resolution width', 'ResolutionSizeY': 'Resolution height',
    'FullscreenMode': 'Display mode', 'LastConfirmedFullscreenMode': 'Display mode (confirmed)',
    'FrameRateLimit': 'Frame rate cap', 'bUseVSync': 'VSync', 'bMotionBlur': 'Motion blur',
    'bShowGrass': 'Show grass', 'bShowFPS': 'Show FPS', 'bUseDynamicResolution': 'Dynamic resolution',
    'FortAntiAliasingMethod': 'Anti-aliasing', 'DLSSQuality': 'DLSS quality',
    'bEnableDLSSFrameGeneration': 'DLSS frame generation',
    'PotentiallyUpscaledResolutionQuality': 'Upscale quality', 'bUseNanite': 'Nanite',
    'bRayTracing': 'Ray tracing', 'AudioQualityLevel': 'Audio quality',
    'bUseHeadphoneMode': 'Headphone mode', 'bDisableMouseAcceleration': 'Mouse acceleration off',
    'bUseHDRDisplayOutput': 'HDR',
    # controller
    'LookHorizontalSpeed': 'Hipfire look speed', 'LookVerticalSpeed': 'Vertical look speed',
    'LookHorizontalSpeedAds': 'ADS look speed', 'LookVerticalSpeedAds': 'ADS vertical look speed',
    'LookHorizontalBoostSpeed': 'Look boost speed', 'LookVerticalBoostSpeed': 'Vertical boost speed',
    'LookBoostAccelerationTime': 'Look boost ramp', 'LookBoostAccelerationTimeAds': 'ADS boost ramp',
    'LookEaseTime': 'Look ease time', 'ScopedSensitivityMultiplier': 'Scope multiplier',
    'GamepadLookStickDeadZone': 'Look deadzone', 'GamepadMoveStickDeadZone': 'Move deadzone',
    'GamepadLeftTriggerReleaseThreshold': 'Left trigger release',
    'GamepadRightTriggerReleaseThreshold': 'Right trigger release',
    'TargetingSlow': 'Targeting slowdown', 'ScopedSlow': 'Scoped slowdown',
    'MotionTargetingSlow': 'Targeting slowdown (motion)',
    'MotionScopedSlow': 'Scoped slowdown (motion)',
    'BuildingMultiplier': 'Building multiplier', 'EditingMultiplier': 'Editing multiplier',
}

GROUPS = ('display', 'scalability', 'controller', 'sensitivity')


def flatten(snap):
    # A few keys live in both the controller and sensitivity groups. First one
    # wins, so a single change is never reported twice.
    out = {}
    for g in GROUPS:
        for k, v in (snap.get(g) or {}).items():
            out.setdefault(k, v)
    return out


def same(a, b):
    if a == b:
        return True
    try:
        return abs(float(a) - float(b)) < 1e-9
    except (TypeError, ValueError):
        return False


def tidy(v):
    if isinstance(v, float):
        return f'{v:g}'
    s = str(v)
    if s.replace('.', '', 1).replace('-', '', 1).isdigit():
        return f'{float(s):g}'
    return s


def main():
    old = flatten(json.load(open(sys.argv[1], encoding='utf-8-sig')))
    new = flatten(json.load(open(sys.argv[2], encoding='utf-8-sig')))
    changes = []
    for k in sorted(set(old) | set(new)):
        a, b = old.get(k, '(absent)'), new.get(k, '(absent)')
        if same(a, b):
            continue
        changes.append((LABELS.get(k, k), k, tidy(a), tidy(b)))
    if not changes:
        sys.exit(0)
    print(f'{len(changes)} change(s):')
    for label, key, a, b in changes:
        flag = '' if label != key else '  (no friendly name yet)'
        print(f'  {label}: {a} -> {b}{flag}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: diff.py OLD.json NEW.json')
    main()
