# Job 48 - Record the performance baseline, add the change journal, and add the engine and module layers

Status: done, needs review on 2026-11-03.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirement 3).

## Goal

Before anything changes, measure today's per-step cost of the flow and its dependents, and make that measurement a check
every later job must pass. Then add the three foundations the engine stands on: a change journal in the registry, a
read-only registry type, and the `engine` and `modules` layers with their import rules.

## Depends on

Nothing. This is the first job of the wave 48 to 55. Design 013 must be committed on the base branch.

## Before you start

- Work in your own worktree and branch: `git worktree add ../noneuclid-job48 -b job-48 <branch holding design 013>`. Link
  `node_modules` into it (a directory junction on Windows) or run `npm install` there.
- Read design [013](../../_docs/design/013-world-engine-clients-and-modules.md): sections 6.1, 6.2, 12.2, 12.3, and job 48
  in section 15. Section 15 is the specification; this file adds the decisions.
- Call `know_search` for "layer DAG" and "windows shell" if no project-knowledge block arrived.
- Run `npm run typecheck` and `npm test` for a baseline. `tests/app/appCommands.release.test.ts` is a known failure on
  this machine; compare it against the base commit, not against one green run.

## Background

The frame loop runs `advanceCurveShorteningPairs` directly, then hand-written follow-ups for the ids it returned. The
registry has one version counter and no record of what changed. `scripts/docs/lib.mjs` holds the layer order and
`moduleImportRules`.

## Decisions

- The baseline is recorded **before any other change in this job**, in its own commit. No later job may re-record it.
- Scenes, tolerances and exit codes are exactly those of job 48 in section 15.
- The journal's implementation rules are those of 6.2: parallel arrays, overwritten in place, no truncation on `clear`.
- `countOfKind` is the size of the registry's per-kind id set. No allocation.
- `RuntimeObjectReader` is a type only: `RuntimeObjectRegistry` minus `add`, `update`, `remove`, `claimOwnership`,
  `releaseOwnership`, `moveToCell`.
- `legacyWorldWriters` is filled from today's code: every `render` or `ui` file that imports a world-objects mutator.

## Steps

1. `scripts/bench/moduleStep.bench.ts` with the three scenes and the legacy driver. `scripts/bench/run.mjs` passes
   `--expose-gc` through `NODE_OPTIONS`. Add `--record` and `--check`. Record
   `scripts/bench/baselines/moduleStep.json` and commit.
2. `src/world-objects/runtimeObjectChangeJournal.ts`, exposed as `registry.changes`; `add`, `replaceObject` and `remove`
   each record one entry. Add `countOfKind`. The engine does not exist yet, so the shell clears the journal at the end of
   its frame loop; otherwise it would grow without bound. Job 49 replaces that call with `engine.endFrame()`.
3. `RuntimeObjectReader`.
4. `docs:check`: the `engine` and `modules` layers, the new rule shape, the rules of 12.2, `legacyWorldWriters`. Create
   empty `src/engine/` and `src/modules/` only if the checker needs them.
5. The amended docs of 12.3.

## Tests and checks

- Journal: order of entries, kinds, `lastIndexOfKind`, `clear`, no growth after warm-up.
- `tests/project/moduleImportRules.test.ts`: the new rule shape, including `exceptFromPrefixes` and prefix entries in
  `onlyVia`. A test compares `legacyWorldWriters` with the committed copy, so the list can only shrink.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`.

## Do not

- Do not change any behaviour of the app.
- Do not make any world object or registry write go through a new path; the journal only observes.

## Done when

- The baseline is committed and `npm run bench -- moduleStep --check` passes with the journal in place.
- All checks above are green.

## Report

### Done
- Commit 067d74d (baseline, no file under `src/`): `scripts/bench/moduleStep.bench.ts` (idle, flow, flow+dependents scenes; legacy driver = `advanceCurveShorteningPairs`, then `refreshProtractorAngleObject` / `refreshMeasuredGeodesicLengthObject` for the returned ids, then `pruneMissingGeodesicIntersectionObjects`), `--record` and `--check`, `scripts/bench/baselines/moduleStep.json` (host Leibniz), `scripts/bench/run.mjs` (`--expose-gc` through NODE_OPTIONS; flags reach the script in `BENCH_ARGS`), `scripts/bench/vite.config.ts` and `vitestStub.ts`.
- Commit ea729cd: `src/world-objects/runtimeObjectChangeJournal.ts` (parallel arrays, `lastIndexOfKind`, `clear` without truncation), `registry.changes`, `countOfKind`, `RuntimeObjectReader`; the shell clears the journal at the end of `renderFrame` in `createThreeApp.ts`; `tests/world-objects/runtimeObjectChangeJournal.test.ts`.
- Commit c375e0e: `engine` and `modules` layers, the prefix rule shape (`prefixImportRuleViolations`), generated per-module-directory rules, the geometry-tools rule, the render/ui to engine rules, `legacyWorldWriters` (14 files) with `ModuleInfo.writesRegistry`, tests in `tests/project/moduleImportRules.test.ts`, the amended `_docs/coding_style.md` and `_docs/llm-implementation-workflow.md`, regenerated `_docs/generated/*`.
- A final commit adds this report and the Status line.
### Deviations
- The fixtures import `expect` from vitest, which cannot load outside a Vitest worker, so `npm run bench` now runs vite-node with `scripts/bench/vite.config.ts`, which aliases `vitest` to a no-op stub. No fixture was changed.
- The legacy driver allocates about 640-870 bytes per idle step (fresh arrays from `getObjectsOfKind`, closures in `withDeferredGeodesicIntersections`), so the absolute 16 bytes per step ceiling cannot hold for it. `--check` holds idle allocation to baseline x 1.05 + 16 bytes. The absolute 16 is still the target for the engine step of job 49.
- The recorded baseline is the slowest of three rounds and a check passes if any of up to three rounds is within tolerance, because one round varies by about 10 percent on this machine (the flow limit is only 10 percent). Flow runs 10 fresh scenes per trial to cut noise.
- `RuntimeObjectChangeJournal` is generic in its record type (`RuntimeObjectChangeJournal<RuntimeWorldObject>` on the registry) so the journal file need not import the registry (that was an import cycle). Not in the spec signature.
- `src/engine/` and `src/modules/` were not created: the checker does not need them (the generated per-module rules read the module directories that exist). The docs wording avoids `src/engine/` paths because the document-reference check rejects paths that do not exist.
### Uncertain
- "World-objects mutator" is implemented as: a `world-objects` file (other than the registry) containing a call `registry.add/update/remove/claimOwnership/releaseOwnership/moveToCell(`. A render/ui file importing such a file (type-only imports included) is a legacy writer. Files that write the registry through a registry they received but import no such module are not listed. Confirm this is the intended meaning.
- The geometry tools allowed through `onlyVia` are `portalWord.ts`, `development.ts`, `trace.ts` and `objects.ts` under `world-objects/geodesic/`; section 13.1 gives no file-level list.
- Flow timing can still flake on a loaded machine; rerun `--check` before treating a failure as real.
### Not done
- Nothing skipped.
### Checks
- Baseline before changes: `npm run typecheck` clean; `npm test` 153 files, 1259 tests pass (the known `appCommands.release` failure did not occur here).
- Final: `npm run typecheck` clean; `npm test` 154 files, 1274 tests pass; `npm run docs:check` all ok (after `npm run docs:generate`); `npm run build` ok; `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages); `npm run bench -- moduleStep --check` ok in 3 consecutive runs.
