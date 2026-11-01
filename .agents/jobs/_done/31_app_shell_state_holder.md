# Job 31 - Shell cleanups before the state holder

Status: done, needs review on 2026-11-01.
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

## Report

### Done
- `src/runtime/appState.ts`: removed `AppState.selectedTool` and its initialisation; nothing else read or set it.
- One portal sync. `createThreeApp.ts` now has `syncPortalInstances(renderRoots)`, which resets the per-frame portal state once, clears
  visibility (`clearPortalInstances`) when any root cell has no static cull table, and otherwise runs `syncMonoPortalFrame` (one root) or
  `syncStereoPortalFrame` (several roots). `syncPortalInstanceRender` and `syncStereoPortalInstanceRender` are gone, as is the duplicated
  empty-table block. `src/render/three/portalFrameRender.ts` holds `createMonoPortalRenderRoots`: a one-element root list rewritten in
  place, so the mono pass (desktop and one-eye XR) allocates no root object, list or matrix. Three call sites use a small
  `syncPlayerCellPortalInstances()`.
- Palette split. `vrPaletteLibraryAdapter.ts` (2,009 lines) and `scenePaletteLibraryAdapter.ts` are deleted. New under
  `src/render/three/palette/`: `scenePaletteAdapter.ts` (112 lines; `createScenePaletteAdapter`, the page dispatcher),
  `adapterTypes.ts` (`ScenePaletteAdapter`, `ScenePaletteAdapterOptions`), `tokens.ts`, `header.ts`, `widgets.ts` (288),
  `icons.ts` (about 230), `latticeDiagram.ts` (about 200), `pages/{main,geodesicActions,geometryComputer,help,signs,debugSettings}.ts`.
  The largest module is `widgets.ts`. The `Vr*` names and the `*Library*` aliases are gone; `scenePaletteController.ts` imports the new
  module. Verified by a line-multiset comparison of the old file against the new modules (ignoring imports, `export`, comments and the
  renames): the only differences are the intended ones below.
- Documents regenerated (`npm run docs:generate`); `_docs/ARCHITECTURE.md` and the job 50 issue index point at the new paths.

### Deviations
- `tests/render/scenePaletteLibraryAdapter.test.ts` moved (git mv) to `tests/render/scenePaletteAdapter.test.ts` and updated for the new
  import path and factory name; no assertion changed. `tests/ui/paletteDefinition.test.ts`: two comment references updated.
- Three extra modules beside the planned ones: `palette/tokens.ts` (colours), `palette/adapterTypes.ts` (option and handle types) and
  `palette/header.ts` (header row). Without them `icons` <-> `widgets` and `pages` <-> `scenePaletteAdapter` would be import cycles.
- The `settings` page was the fallthrough branch of `buildContent`; it is now `buildSettingsContent` in `pages/debugSettings.ts`
  (same body, `definition.content` renamed to `content`) and the dispatcher calls it.
- `syncPortalInstances` lives in `createThreeApp.ts`, not in `portalFrameRender.ts`: it reads and writes about fifteen closure variables
  of the shell, and moving it needs the state holder of job 46. `portalFrameRender.ts` holds only the reusable root list.
- A single root runs the old mono computation and several roots the old stereo computation. Running one root through the stereo path
  would have changed the mono debug state (eye states, stereo counts, clip data), which the job forbids.
- The job says the mono default allocated a `THREE.Matrix4` per call. It did not: the default used the shared
  `identityRenderFromRootMatrix`; the per-call allocation was the root object (and, in XR mono, nothing more). That is what is now reused.

### Uncertain
- Nothing in the unit tests exercises the XR mono path (`monoPortalRoots.set(eyeRoot...)`); the release scenarios cover desktop only.
  A headset run would confirm it.

### Not done
- Item 5 of the old job (startup static cull on the worker) is out of scope here (design 012 and job 24).

### Checks
- Baseline at `d2a15d5`: typecheck, `docs:check`, `npm test` (1035 tests) green; `npm run test:release` 10 of 11, only
  `appCommands.release.test.ts` "changeWorld switches to the requested world" failed (CDP timeout, the known one).
- After the changes: `npm run typecheck`, `npm test` (1035 tests), `npm run docs:check` green.
- `npm run test:release` after the changes: 10 of 11; only `appCommands.release.test.ts` failed, with the same `Runtime.evaluate (id 7)` CDP timeout
  (once in "reload restarts the app...", once in a rerun of the file). To tell this from my change I ran the file alone three times at the
  base commit `d2a15d5` in a throwaway worktree: it failed 3 of 3 with the same timeout, so it is the known failure, not caused by this job.
  The other four release files (torus deformation, creatures, object placement, app loading) pass. Recorded in
  `.agents/knowledge/scenario-runner-browser-limits.md`.
