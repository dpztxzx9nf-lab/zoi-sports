#!/usr/bin/env python3
"""Compare two Fortnite setting snapshots and print what changed.

Usage: python3 diff.py OLD.json NEW.json
Exits 0 with no output when nothing changed.
"""
import json, sys

# Human names and unit handling for the fields we track.
LABELS = {
    "ResolutionSizeX": ("Resolution width", "px"),
    "ResolutionSizeY": ("Resolution height", "px"),
    "FullscreenMode": ("Display mode", "mode"),
    "LastConfirmedFullscreenMode": ("Display mode (confirmed)", "mode"),
    "FrameRateLimit": ("Frame rate cap", "fps"),
    "bUseVSync": ("VSync", None),
    "bMotionBlur": ("Motion blur", None),
    "bShowGrass": ("Show grass", None),
    "bShowFPS": ("Show FPS", None),
    "bUseDynamicResolution": ("Dynamic resolution", None),
    "FortAntiAliasingMethod": ("Anti-aliasing", None),
    "DLSSQuality": ("DLSS quality", None),
    "bEnableDLSSFrameGeneration": ("DLSS frame generation", None),
    "PotentiallyUpscaledResolutionQuality": ("Upscale quality", "%"),
    "bUseNanite": ("Nanite", None),
    "bRayTracing": ("Ray tracing", None),
    "DesiredGlobalIlluminationQuality": ("Global illumination", "level"),
    "DesiredReflectionQuality": ("Reflections", "level"),
    "AudioQualityLevel": ("Audio quality", "level"),
    "bUseHeadphoneMode": ("Headphone mode", None),
    "bDisableMouseAcceleration": ("Mouse acceleration disabled", None),
    "bUseHDRDisplayOutput": ("HDR", None),
    # scalability
    "ResolutionQuality": ("3D resolution", "%"),
    "ViewDistanceQuality": ("View distance", "level"),
    "AntiAliasingQuality": ("Anti-aliasing quality", "level"),
    "ShadowQuality": ("Shadows", "level"),
    "GlobalIlluminationQuality": ("Global illumination quality", "level"),
    "ReflectionQuality": ("Reflection quality", "level"),
    "PostProcessQuality": ("Post processing", "level"),
    "TextureQuality": ("Textures", "level"),
    "EffectsQuality": ("Effects", "level"),
    "FoliageQuality": ("Foliage", "level"),
    "ShadingQuality": ("Shading", "level"),
    "LandscapeQuality": ("Landscape", "level"),
    # sensitivity
    "MouseSensitivityX": ("Sensitivity X", "raw"),
    "MouseSensitivityY": ("Sensitivity Y", "raw"),
    "ScopedSensitivityMultiplier": ("Scope sensitivity", "x"),
    "UpgradedMouseSensitivityX": ("Sensitivity X (current)", "raw"),
    "UpgradedMouseSensitivityY": ("Sensitivity Y (current)", "raw"),
}

def flatten(snap):
    out = {}
    for group in ("settings", "scalability", "sensitivity"):
        for k, v in (snap.get(group) or {}).items():
            out[k] = v
    return out

def tidy(key, value):
    if isinstance(value, float):
        return f"{value:g}"
    s = str(value)
    if s.replace(".", "", 1).lstrip("-").isdigit():
        f = float(s)
        return f"{f:g}"
    return s

def main():
    old = flatten(json.load(open(sys.argv[1], encoding="utf-8-sig")))
    new = flatten(json.load(open(sys.argv[2], encoding="utf-8-sig")))
    changes = []
    for k in sorted(set(old) | set(new)):
        a, b = old.get(k, "(absent)"), new.get(k, "(absent)")
        if isinstance(a, float) or isinstance(b, float):
            try:
                if abs(float(a) - float(b)) < 1e-9:
                    continue
            except (TypeError, ValueError):
                pass
        elif str(a) == str(b):
            continue
        label, unit = LABELS.get(k, (k, None))
        ta, tb = tidy(k, a), tidy(k, b)
        if unit and unit not in ("raw", "mode", "level", "x"):
            ta, tb = f"{ta}{unit}", f"{tb}{unit}"
        changes.append((label, k, ta, tb))

    if not changes:
        sys.exit(0)

    print(f"{len(changes)} change(s):")
    for label, key, a, b in changes:
        print(f"  {label}: {a} -> {b}   [{key}]")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: diff.py OLD.json NEW.json")
    main()
