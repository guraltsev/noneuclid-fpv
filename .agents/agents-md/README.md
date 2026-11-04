# agents-md

Generates `AGENTS.md` and `CLAUDE.md` from the fragments in `.agents/agents.md.d/`, keeping any lines written into the
generated files by hand (they move to `custom.md` / `custom-claude.md`).

Install: copy this folder into `<repository>/.agents/`, then run

```sh
python .agents/agents-md/install.py
```

Use:

```sh
_scripts/agents-md build      # regenerate; --dry-run to preview
_scripts/agents-md check      # exit 1 when a build is needed
```

Standard library only, Python 3.11 or later. Design and fragment format: `.agents/agents-md/agents-md-tool-design.md` in the
template repository this drop-in comes from.
