# Pages publishing tool lives in the templates folder

`scripts/pages_publish.py` and `.github/workflows/pages-publish.yml` are copies of the drop-in in
`C:\Users\guraltsev\Documents\templates\git\pages-publish\` (source of truth, with its pytest suite and `install.py`).
Fix bugs there, run its tests (`python -m pytest tests`, needs pytest), then re-copy with
`python install.py <repo> --force --no-init` (this repo's `pages-publish.toml` and workflow node steps are hand-edited, so
re-copy only `scripts/pages_publish.py`). `Set-Content -Encoding utf8` in Windows PowerShell 5.1 writes a BOM; the tool
reads TOML as utf-8-sig, but prefer `[IO.File]::WriteAllText` for config files.
