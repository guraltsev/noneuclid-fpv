# Pages publishing tool lives in the templates folder

`.gittools/pages-publish/pages_publish.py` (and its README) and `.github/workflows/pages-publish.yml` are copies of the tool in
`C:\Users\guraltsev\Documents\templates\git\tools\pages-publish\` (source of truth, with its pytest suite and `install.py`).
Fix bugs there, run its tests (`python -m pytest tests`, needs pytest), then re-copy `pages_publish.py` and `README.md` into
`.gittools/pages-publish/` (do not re-run the installer over this repo's `config.toml` or its workflow, which has hand-added
Node steps). All git tools of a repository share `.gittools/`, one subfolder each, no registry. `Set-Content -Encoding utf8`
in Windows PowerShell 5.1 writes a BOM; the tool reads TOML as utf-8-sig, but prefer `[IO.File]::WriteAllText` for config files.
In PowerShell, `R` is an alias of Invoke-History: do not name a helper function `R`.