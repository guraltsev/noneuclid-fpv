# Knowledge index

Short notes on traps and non-obvious facts of this repository. Rules: `AGENTS.md`.

- [design-012-process.md](design-012-process.md): the engine design is iterated with the maintainer in `_docs/design/012-engine-api.md`; never mark a suggestion Agreed without them, check code claims first, explain with concrete examples.
- [math-to-code-thesis.md](math-to-code-thesis.md): this repository is a test case for, and a playground for refining, the maintainer's thesis that a coding design philosophy makes it possible to map mathematical ideas to code and visualisation; documentation is tiered with mathematics on top.
- [optional-features-localized.md](optional-features-localized.md): keep low-gain optimisations as opt-in plugins behind localized hooks rather than deleting them.
- [running-ad-hoc-typescript.md](running-ad-hoc-typescript.md): run a one-off TypeScript script with `npx vite-node`; there is no tsx.
- [path-table-memory.md](path-table-memory.md): unculled portal-path tables exceed memory at depth 10; depths that fit per world.
- [test-and-smoke-timing.md](test-and-smoke-timing.md): `npm test` takes about a minute (one file ~55 s); multi-world smoke has a known load flake.
- [windows-shell.md](windows-shell.md): the Bash tool can return empty output with no error on this machine; use PowerShell.
