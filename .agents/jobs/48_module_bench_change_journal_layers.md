# Job 48 - Record the performance baseline, add the change journal, and add the engine and module layers

Status: in progress.
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
