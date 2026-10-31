# Pages publishing tool lives in the templates folder

`.gittools/pages-publish/` (tool, installer, README, workflow template) is a copy of the copy-paste folder
`C:\Users\guraltsev\Documents\templates\git\.gittools\pages-publish\` (source of truth; its pytest suite is in
`templates\git\tests\pages-publish\`, outside the folder so copies stay clean). Fix bugs there, run
`python -m pytest tests/pages-publish` from `templates\git` (needs pytest), then re-copy `pages_publish.py`, `install.py`,
`README.md` and `workflow/` here. Never overwrite this repo's `config.toml` or `.github/workflows/pages-publish.yml` (it has
hand-added Node steps). All git tools of a repository share `.gittools/`, one subfolder each, no registry.
`Set-Content -Encoding utf8` in Windows PowerShell 5.1 writes a BOM; the tool reads TOML as utf-8-sig, but prefer
`[IO.File]::WriteAllText` for config files. In PowerShell, `R` is an alias of Invoke-History: do not name a helper function `R`.