#!/usr/bin/env bash
# Build zoi-cues from a pinned, patched FortniteReplayDecompressor.
#
#   tools/zoi-cues/build.sh
#
# Everything happens in a temporary directory that is thrown away afterwards, so
# a build never depends on a clone left lying around and never leaves one behind.
# The only inputs are this directory's three source files and
# frd-damage-cues.patch.
#
# Output: tools/zoi-cues/dist/ - committed on purpose, so the player's PC needs
# no compiler and no network, only the .NET runtime it already has.
#
# Attribution: FortniteReplayDecompressor is MIT licensed,
# Copyright (c) 2020-2026 Shiqan.
# https://github.com/Shiqan/FortniteReplayDecompressor
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRD_REPO="https://github.com/Shiqan/FortniteReplayDecompressor.git"
# The commit the patch applies to. Pinned, not a branch: a moving upstream would
# silently change the numbers this tool reports.
FRD_COMMIT="76f74c1f640069afdba71b6468e2f819327893c2"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> cloning FortniteReplayDecompressor at ${FRD_COMMIT:0:7}"
git clone --quiet "$FRD_REPO" "$WORK/frd"
git -C "$WORK/frd" checkout --quiet "$FRD_COMMIT"

echo "==> applying frd-damage-cues.patch"
git -C "$WORK/frd" apply --whitespace=nowarn "$HERE/frd-damage-cues.patch"

echo "==> staging zoi-cues sources beside the clone"
mkdir -p "$WORK/project"
cp "$HERE/Program.cs" "$HERE/CueReader.cs" "$HERE/zoi-cues.csproj" "$WORK/project/"

echo "==> dotnet publish (win-x64, framework-dependent)"
dotnet publish "$WORK/project/zoi-cues.csproj" \
  -c Release \
  -r win-x64 \
  --self-contained false \
  -p:FrdRoot="$WORK/frd" \
  -o "$WORK/publish"

echo "==> copying publish output to dist/"
rm -rf "$HERE/dist"
mkdir -p "$HERE/dist"
cp -r "$WORK/publish/." "$HERE/dist/"

# MIT requires the notice to travel with the binary it covers.
cp "$WORK/frd/LICENSE" "$HERE/dist/LICENSE-FortniteReplayDecompressor.txt"

echo "==> done: $(find "$HERE/dist" -maxdepth 1 -type f | wc -l) files, $(du -sh "$HERE/dist" | cut -f1)"
