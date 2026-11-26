#!/bin/bash
# Builds the app and serves it on this machine only (plain HTTP, dev mode, so `eval` works), for a browser on the same machine.
#   scripts/debug/local/serve.sh [--no-minify]     then open http://localhost:11446/?config=001
# --no-minify keeps function names in stack traces. Stop it with Ctrl+C. See _docs/interactive-browser-debugging.md, section 3d.
[ -d "$HOME/.local/share/mise/shims" ] && export PATH="$HOME/.local/share/mise/shims:$PATH"
export NONEUCLID_ADMIN_PASSWORD="${NONEUCLID_ADMIN_PASSWORD:-localdev}"
cd "$(dirname "$0")/../../.." || exit 1
if [ "$1" = "--no-minify" ]; then npx vite build --minify false || exit 1; else npx vite build || exit 1; fi
exec node scripts/server/cli.mjs --http --dev --host 127.0.0.1 --port "${NONEUCLID_LOCAL_PORT:-11446}"
