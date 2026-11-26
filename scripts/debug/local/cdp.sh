#!/bin/bash
# Drives a page served by scripts/debug/local/serve.sh: the arguments are those of `npm run cdp` (eval, call, shot, console, devices, ...).
#   scripts/debug/local/cdp.sh call debug.setPlayerPose '"front"' 0 5 180 0
#   scripts/debug/local/cdp.sh shot out.jpg
# See _docs/interactive-browser-debugging.md, section 3d.
[ -d "$HOME/.local/share/mise/shims" ] && export PATH="$HOME/.local/share/mise/shims:$PATH"
export NONEUCLID_ADMIN_PASSWORD="${NONEUCLID_ADMIN_PASSWORD:-localdev}"
cd "$(dirname "$0")/../../.." && exec node scripts/debug/cdp.mjs --server "ws://localhost:${NONEUCLID_LOCAL_PORT:-11446}" "$@"
