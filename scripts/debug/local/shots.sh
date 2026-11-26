#!/bin/bash
# Takes one still per line of a pose list from the page served by serve.sh, for before/after comparisons of the look.
#   scripts/debug/local/shots.sh OUT_DIR PREFIX [POSE_FILE]
# A pose line is: name cell x y yawDegrees pitchDegrees (cell-local meters). Default: scripts/debug/local/poses-001-basic-cube.txt.
# Poses are teleports: keep them clear of objects and generated landmarks, or the camera ends up inside one.
here="$(dirname "$0")"; out="$1"; prefix="$2"; poses="${3:-$here/poses-001-basic-cube.txt}"
[ -n "$out" ] && [ -n "$prefix" ] || { echo "usage: shots.sh OUT_DIR PREFIX [POSE_FILE]" >&2; exit 2; }
mkdir -p "$out"; out="$(cd "$out" && pwd)"
grep -v '^\s*\(#\|$\)' "$poses" | while read -r name cell x y yaw pitch; do
  "$here/cdp.sh" call debug.setPlayerPose "\"$cell\"" "$x" "$y" "$yaw" "$pitch" >/dev/null || exit 1
  sleep "${NONEUCLID_SHOT_SETTLE_SECONDS:-3}"
  "$here/cdp.sh" shot "$out/$prefix-$name.jpg" >/dev/null && echo "$out/$prefix-$name.jpg"
done
