#!/bin/bash
# Walks the player by script in the page served by serve.sh and fails if a frame threw meanwhile.
#   scripts/debug/local/walk-check.sh [meters]
# A change that touches movement, collision or anything a frame calls must pass this: unit tests do not run the shell's frame loop.
here="$(dirname "$0")"; meters="${1:-3}"; log="$(mktemp)"
"$here/cdp.sh" console 25 >"$log" 2>&1 &
watcher=$!
sleep 2
before="$("$here/cdp.sh" call debug.playerPose | tr -d ' \n')"
timeout 20 "$here/cdp.sh" call motion.walk "$meters" >/dev/null 2>&1
after="$("$here/cdp.sh" call debug.playerPose | tr -d ' \n')"
wait "$watcher"
if grep -q "frame error" "$log"; then echo "FAIL: frames threw while walking:"; grep -m1 -A8 "frame error" "$log"; rm -f "$log"; exit 1; fi
rm -f "$log"
[ "$before" != "$after" ] || { echo "FAIL: the player did not move"; exit 1; }
echo "ok: walked, no frame errors"
