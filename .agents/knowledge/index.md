# Knowledge index

Short notes on traps and non-obvious facts of this repository. Rules: `AGENTS.md`.

- [design-012-process.md](design-012-process.md): the engine design is iterated with the maintainer in `_docs/design/012-engine-api.md`; never mark a suggestion Agreed without them, check code claims first, explain with concrete examples.
- [math-to-code-thesis.md](math-to-code-thesis.md): this repository is a test case for, and a playground for refining, the maintainer's thesis that a coding design philosophy makes it possible to map mathematical ideas to code and visualisation; documentation is tiered with mathematics on top.
- [optional-features-localized.md](optional-features-localized.md): keep low-gain optimisations as opt-in plugins behind localized hooks rather than deleting them.
- [running-ad-hoc-typescript.md](running-ad-hoc-typescript.md): run a one-off TypeScript script with `npx vite-node`; there is no tsx; `vi`/`vi.mock` and monkey-patching `three`'s exports both fail outside a real Vitest worker.
- [path-table-memory.md](path-table-memory.md): unculled portal-path tables exceed memory at depth 10; depths that fit per world.
- [test-and-smoke-timing.md](test-and-smoke-timing.md): the old "`npm test` takes about a minute" note is stale since job 43; check `npm run test:report` for the current serial time. Multi-world smoke has a known load flake.
- [windows-shell.md](windows-shell.md): the Bash tool can return empty output with no error on this machine; CRLF working copies break "
" matching in Node edit scripts; use PowerShell; nested single-pair arrays flatten in PowerShell 5.1 and turn bulk replacements into character swaps; `git add -A` with several pathspecs stages nothing at all if even one matches no file.
- [parallel-fork-agents.md](parallel-fork-agents.md): parallel `fork` subagents share one working directory and git state; a long-running fork's own commit can silently absorb other concurrent forks' uncommitted edits.
- [headless-edge-end-to-end.md](headless-edge-end-to-end.md): recipe and flags to test the local server channel end to end with headless Edge.
- [relative-base-urls.md](relative-base-urls.md): the site uses a relative Vite base; always build URLs with publicUrl, never BASE_URL concatenation or root-absolute paths.
- [pages-publish-template.md](pages-publish-template.md): the Pages publisher is a drop-in kept in Documents/templates/git/.gittools/pages-publish (copy-paste folder); fix it there and re-copy into .gittools/pages-publish/.
- [vitest-workspace-and-hygiene-proofs.md](vitest-workspace-and-hygiene-proofs.md): Vitest 1.6 forbids `passWithNoTests` inside a workspace project (use the `--passWithNoTests` CLI flag); `git add -N` lets a git-ls-files-based check see an uncommitted scratch file.
- [hygiene-check-gotchas.md](hygiene-check-gotchas.md): H4 scans a test file's whole source text (even comments) for `*ForDebug`/`*ForTests` identifiers; H6's 90-char name limit measures the literal source text of a template literal, including the `${...}` expression itself.
- [scenario-runner-browser-limits.md](scenario-runner-browser-limits.md): the release-tier scenario runner's shared headless browser needs `--no-file-parallelism` (a workspace project's `fileParallelism` is ignored); restarting the app more than once in one page (`appCommands.release.test.ts`) flakes with a real CDP timeout (once in several runs at first, 3 of 3 isolated runs on 2026-11-01 even at the unchanged base commit), the same class as the known multi-world smoke flake.
- [layer-dag.md](layer-dag.md): the layer order in `scripts/docs/lib.mjs` is a strict DAG enforced by `docs:check` (layer edges, `three` only in `render`, no import cycles); where tool ids, deformations, creatures, visibility and aim picking live, and how a registry type cycle is broken.
- [geodesic-carry.md](geodesic-carry.md): the portal word of a locked geodesic must chain between its anchors' cells; emitters move only through `moveEmitterAlongRoute`; the nearest-image route needs a straight-segment check; a test with the player standing at the hand proves nothing.
