---
order: 15
description: Agents must change these instructions through the fragments, never in the generated files.
---

## Changing these instructions

Do not edit `AGENTS.md` or `CLAUDE.md` directly. They are generated from `.agents/agents.md.d/`, and direct edits are
moved aside by the next build. If the instructions need to change, edit the fragments in `.agents/agents.md.d/` or
create new ones (format: [.agents/agents-md/agents-md-tool-design.md](.agents/agents-md/agents-md-tool-design.md) §4), then ask the user to run
`_scripts/agents-md build`. Do not run it yourself.
