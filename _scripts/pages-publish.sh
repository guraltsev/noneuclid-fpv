#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    exec "$candidate" "$here/../.gittools/pages-publish/pages_publish.py" "$@"
  fi
done
echo "pages-publish: no Python found." >&2
exit 1
