#!/usr/bin/env python3
"""Read Fortnite's own config into one flat JSON snapshot.

Handles both files the game writes:
  GameUserSettings.ini  - plain text, display/graphics/audio
  ClientSettings.Sav    - tagged property stream, no GVAS header

Usage: python3 parse.py CONFIG_DIR OUT.json
"""
import json, os, struct, sys

# ---------------------------------------------------------------- INI ----
INI_FIELDS = [
    'ResolutionSizeX', 'ResolutionSizeY', 'FullscreenMode', 'LastConfirmedFullscreenMode',
    'FrameRateLimit', 'bUseVSync', 'bMotionBlur', 'bShowGrass', 'bShowFPS',
    'bUseDynamicResolution', 'FortAntiAliasingMethod', 'DLSSQuality',
    'bEnableDLSSFrameGeneration', 'PotentiallyUpscaledResolutionQuality',
    'bUseNanite', 'bRayTracing', 'DesiredGlobalIlluminationQuality',
    'DesiredReflectionQuality', 'AudioQualityLevel', 'bUseHeadphoneMode',
    'bDisableMouseAcceleration', 'bUseHDRDisplayOutput', 'bUseHDRDisplayOutput',
]


def read_ini(path):
    settings, scalability = {}, {}
    if not os.path.exists(path):
        return settings, scalability
    for line in open(path, encoding='utf-8', errors='replace'):
        if '=' not in line:
            continue
        k, _, v = line.partition('=')
        k, v = k.strip(), v.strip()
        if k.startswith('sg.'):
            scalability[k[3:]] = v
        elif k in INI_FIELDS:
            settings[k] = v
    return settings, scalability


# ---------------------------------------------------------------- SAV ----
TYPES = ('FloatProperty', 'UInt32Property', 'IntProperty', 'BoolProperty',
         'StrProperty', 'NameProperty', 'EnumProperty', 'Int64Property',
         'UInt64Property', 'DoubleProperty', 'ByteProperty',
         'StructProperty', 'ArrayProperty', 'MapProperty', 'SetProperty')

# The save's tag header: name, type, then 04 00 00 00 00, then the value.
SIZE_MARKER = b'\x04\x00\x00\x00\x00'


def fstring(b, at):
    if at + 4 > len(b):
        return None, at
    n = struct.unpack('<i', b[at:at + 4])[0]
    if n <= 0 or n > 400 or at + 4 + n > len(b):
        return None, at
    raw = b[at + 4:at + 4 + n]
    if raw[-1] != 0:
        return None, at
    try:
        txt = raw[:-1].decode('ascii')
    except UnicodeDecodeError:
        return None, at
    if not all(32 <= ord(c) < 127 for c in txt):
        return None, at
    return txt, at + 4 + n


def read_sav(path):
    """Return every property that carries a plain 4-byte value."""
    if not os.path.exists(path):
        return {}
    b = open(path, 'rb').read()
    out = {}
    i, n = 0, len(b)
    while i < n - 12:
        name, after_name = fstring(b, i)
        if name is None:
            i += 1
            continue
        ptype, after_type = fstring(b, after_name)
        if ptype not in TYPES:
            i += 1
            continue
        idx = b.find(SIZE_MARKER, after_type, after_type + 20)
        if idx >= 0 and ptype in ('FloatProperty', 'UInt32Property', 'IntProperty'):
            at = idx + 5
            try:
                if ptype == 'FloatProperty':
                    out[name] = round(struct.unpack('<f', b[at:at + 4])[0], 6)
                elif ptype == 'UInt32Property':
                    out[name] = struct.unpack('<I', b[at:at + 4])[0]
                else:
                    out[name] = struct.unpack('<i', b[at:at + 4])[0]
            except struct.error:
                pass
        i = after_type
    return out


def parse_bindings(path):
    """Action -> list of bound keys, from CustomGamepadActionBindings."""
    if not os.path.exists(path):
        return {}
    b = open(path, 'rb').read()
    i = b.find(b'CustomGamepadActionBindings')
    if i < 0:
        return {}
    toks, at, end = [], i, min(i + 400000, len(b))
    while at < end:
        t, nxt = fstring(b, at)
        if t is None:
            at += 1
            continue
        toks.append(t)
        at = nxt
    out, cur = {}, None
    for k, t in enumerate(toks):
        if t == 'ActionName' and k + 2 < len(toks) and toks[k + 1] == 'NameProperty':
            cur = toks[k + 2]
            out.setdefault(cur, [])
        elif t == 'KeyName' and k + 2 < len(toks) and toks[k + 1] == 'NameProperty' and cur:
            key = toks[k + 2]
            if key != 'None':
                out[cur].append(key)
    return {k: v for k, v in out.items() if v}


# -------------------------------------------------------------- build ----
def flatten(v, prefix=''):
    if isinstance(v, dict):
        out = {}
        for k, sub in v.items():
            out.update(flatten(sub, f"{prefix}{k}."))
        return out
    return {prefix[:-1]: v}


def main():
    cfg = sys.argv[1]
    out_path = sys.argv[2]
    ini_s, ini_sg = read_ini(os.path.join(cfg, 'GameUserSettings.ini'))
    sav = read_sav(os.path.join(cfg, 'ClientSettings.Sav'))
    binds = parse_bindings(os.path.join(cfg, 'ClientSettings.Sav'))

    import datetime
    snap = {
        'takenAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'display': ini_s,
        'scalability': ini_sg,
        'controller': {k: v for k, v in sav.items() if any(
            s in k for s in ('Look', 'Speed', 'Stick', 'Trigger', 'Slow', 'Multiplier', 'Scoped', 'Targeting'))},
        'sensitivity': {k: v for k, v in sav.items() if 'Sensitivity' in k},
        'bindings': binds,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(snap, f, indent=2)
    print(f"wrote {out_path}")
    print(f"  {len(ini_s)} display, {len(ini_sg)} scalability, "
          f"{len(snap['controller'])} controller, {len(binds)} actions bound")


if __name__ == '__main__':
    main()
