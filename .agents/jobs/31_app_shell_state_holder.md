# Job 31 - Shell cleanups before the state holder

Status: queued.
Resolves: nothing fully. It does items 3, 4 and 6 of the old job 31 (former issue 77). The state holder and command path
(items 1 and 2) are now [job 46](46_shell_session_and_command_path.md); item 5 (startup static cull on the worker) is dropped
here, see Decisions.

## Goal

Three contained cleanups of the rendering shell that do not change behaviour and do not depend on any open design decision:

1. delete the unread `AppState.selectedTool` field;
2. replace the two near-identical portal-instance sync functions with one;
3. split the 2,000-line VR/scene palette adapter into small modules and drop its misleading alias.

## Depends on

Nothing. Job 46 depends on this job (it is easier once the palette code is split and the portal sync is one function).

## Before you start

- Work in your own git worktree and branch (`git worktree add ../noneuclid-job31 -b job-31 design/012-engine-api`), not in the
  maintainer's working directory: two agents sharing one working directory overwrite each other's edits and commits. Link
  `node_modules` into the worktree (a directory junction on Windows) or run `npm install` there.
- Read `.agents/knowledge/index.md` and the notes that match (`layer-dag.md`, `windows-shell.md`, `scenario-runner-browser-limits.md`).
- There is no pre-push hook gate any more. Run the checks yourself (see Tests and checks) before the first change, to learn the
  baseline. `tests/app/appCommands.release.test.ts` ("changeWorld switches to the requested world") already fails with a DevTools
  timeout on this machine at the base commit; it is not yours to fix and not evidence about your change.

## Background

- `src/runtime/appState.ts` (`AppState`, `createInitialAppState`): `selectedTool: "none" | "straight-ray" | "marker"` names tools
  that no longer exist and is never read; `RuntimeMenuState.selectedTool` is the real one.
- `src/render/three/createThreeApp.ts`: `syncPortalInstanceRender` and `syncStereoPortalInstanceRender` repeat the empty-table
  reset block; mono is the one-eye case. The mono default parameter allocates a `THREE.Matrix4` per call.
- `src/render/three/vrPaletteLibraryAdapter.ts` (about 2,000 lines) mixes page builders, a lattice diagram widget, about fifteen icon
  factories, generic widgets and disposal. It exports `ScenePaletteLibraryAdapter` as an alias of `VrPaletteLibraryAdapter` although it
  serves the desktop too; `scenePaletteLibraryAdapter.ts` (10 lines) re-exports the aliases.

## Decisions

- No behaviour change anywhere. A refactor that needs a behaviour change is stopped and reported, not made.
- Palette split target: `src/render/three/palette/pages/*.ts` (main, geodesicActions, geometryComputer, help, signs, debugSettings),
  `palette/latticeDiagram.ts`, `palette/icons.ts`, `palette/widgets.ts`, and one small `palette/scenePaletteAdapter.ts` that assembles
  them. The exported type is named `ScenePaletteAdapter`; the `Vr*` names and the alias disappear and every importer is updated.
- The single portal sync takes a list of render roots; mono passes a one-element list built from a reused root (no per-call allocation).
- Layering: everything stays in `render` (see `scripts/docs/lib.mjs`); `npm run docs:check` must stay green, including "import cycles".
- Item 5 of the old job (take the startup static cull from the geometry worker) is not part of this job: design 012 decides the
  static cull's future (an optional accelerator behind a hook, measured first) and job 24 reshapes path tables.

## Steps

1. Baseline: run the checks below and write the results into the Report.
2. Delete `AppState.selectedTool` and anything that sets it; run typecheck and the unit tests.
3. One portal sync function: add `src/render/three/portalFrameRender.ts` with `syncPortalInstances(renderRoots)`; make mono and stereo
   call it; delete the two old functions. Run the unit tests and the release tests (the stereo and portal scenarios live there).
4. Split the palette adapter in the order: widgets, icons, lattice diagram, pages one at a time, then the assembling module and the rename.
   After each piece run typecheck and `npx vitest run tests/render/scenePaletteLibraryAdapter.test.ts` and the other palette tests.
5. Regenerate the documents (`npm run docs:generate`), then run all checks.

## Tests and checks

- `npm run typecheck`
- `npm test`
- `npm run docs:check`
- `npm run test:release` (compare with the baseline; only `appCommands.release.test.ts` may differ from a clean run)
- Do not weaken or delete a test to get green. Moving a test with the code it covers is fine; record each such move in the Report.

## Do not

- Do not touch `geodesicCannonTools.ts`, the carry code, or `menuState` assignments (job 46 and job 47 own those).
- Do not rename or reorder anything in `createThreeApp.ts` beyond the portal sync and the removed field.
- Do not commit with failing checks, and do not push; leave the branch for the maintainer.

## Done when

- `AppState` has no `selectedTool`; there is one portal-instance sync function and no per-call `Matrix4` allocation in it.
- `vrPaletteLibraryAdapter.ts` is gone, no module under `palette/` is longer than about 600 lines, and `ScenePaletteAdapter` is the only name.
- All checks above pass (apart from the known `appCommands` timeout), and a `## Report` is appended (see `.agents/jobs/README.md`).
