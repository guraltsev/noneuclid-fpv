# Job 62 - Make the client write check measure writes

Status: in progress.
Resolves: issue [91](../../_issues/91_legacy_world_writers_list_does_not_measure_writes.md).

## Goal

Clients hold a registry they cannot write through, and the list of files that still need the writer is exact.

## Depends on

Nothing.

## Before you start

- Read issue 91 and 013 sections 6.1, 12.2 and 14. Re-check its per-file claims: they came from a read-only audit.

## Decisions

- Files in `render/`, `ui/` and `runtime/` receive `RuntimeObjectReader` by default. A file that still writes takes the new type
  `LegacyWorldWriter`, which is `RuntimeObjectRegistry` under a name that can be searched for.
- `legacyWorldWriters` becomes the list of files that name `LegacyWorldWriter` or call a world-objects mutator. `docs:check` fails on a
  file outside the list that does either, and on a listed file that does neither, so the list stays exact.
- `RuntimeObjectReader.changes` stops exposing `clear` and `retainFrom`: clients read the ring only.
- The list may only shrink; the existing test stays.

## Steps

1. The types, then pass the reader wherever a client only reads. Typecheck finds the writers.
2. The check in `scripts/docs/lib.mjs`, with tests in `tests/project/moduleImportRules.test.ts`, covering `runtime/`.
3. Record the file count and the count of write calls in the job's Report: later jobs compare with them.

## Tests and checks

Typecheck, tests, `docs:check`. No behaviour changes: no assertion changes.

## Do not

Do not move any write into a command here.

## Done when

The 8 files that only read are off the list, the two unlisted writers are on it, and `grep -rn "legacyWorldWriters" scripts` shows the check.

## Report

### Done

Commit 4b0f825, plus the commit that adds this Report.

**The counts later jobs compare with: 8 files, 24 direct write calls, 16 mutator uses.**

Method: `npm run docs:writers` (`node scripts/docs/cli.mjs writers`). It lists every write with its line and ends with the line
`8 file(s), 24 direct write call(s), 16 mutator use(s).` It lives in `scanClientWrites` in `scripts/docs/lib.mjs`, the same scan
`docs:check` uses, so the count and the gate cannot disagree. It builds a TypeScript program of `src/` and uses the type checker:

- A **direct write** is a use of `add`, `update`, `remove`, `claimOwnership`, `releaseOwnership` or `moveToCell` as declared on the
  interface `RuntimeObjectRegistry`, in a file under `render/`, `ui/` or `runtime/`. The variable's name does not matter and `Set.add`
  does not count.
- A **mutator** is a top-level function, variable or class of a `world-objects/` module (not the registry's own file) whose code holds
  a direct write or uses another mutator, closures included. A **mutator use** is a reference to one in a client file, called or passed
  as a value.

| File | Direct writes | Mutator uses | Names `LegacyWorldWriter` |
| --- | --- | --- | --- |
| `render/three/createThreeApp.ts` | 2 | 1 | no |
| `render/three/creatures/geodesicMarmotView.ts` | 0 | 1 | yes |
| `render/three/creatures/simpleGeoCreatureView.ts` | 0 | 1 | yes |
| `render/three/geodesicCannonTools.ts` | 2 | 9 | yes |
| `render/three/geometryCommit.ts` | 4 | 0 | yes |
| `render/three/runtimeObjectActions.ts` | 7 | 1 | yes |
| `render/three/toolObjectRuntimes.ts` | 6 | 0 | yes |
| `runtime/worldGeometryComputedObjects.ts` | 3 | 3 | yes |

The types:

- `world-objects/runtimeObjectChangeJournal.ts`: new `RuntimeObjectChangeReader`; `RuntimeObjectChangeJournal` extends it with `clear`
  and `retainFrom`.
- `world-objects/runtimeObjectRegistry.ts`: `RuntimeObjectReader.changes` is the read side; new type `LegacyWorldWriter`.
- 10 client files take `RuntimeObjectReader`: `aimFeedback`, `aimInteraction`, `carriedGeodesicCannon`, `debugVisualization`,
  `geodesicCannonRenderer`, `geodesicCreatureDebug`, `geodesicDebugDumps`, `geodesicEmitterLabelController`, `geodesicEmitterLabels`,
  `runtimeObjectInstanceSync`.
- 7 client files take `LegacyWorldWriter`: every row of the table except `createThreeApp.ts`.
- No client file names `RuntimeObjectRegistry` now (`createThreeApp.ts` calls `createRuntimeObjectRegistry`).

The check:

- `legacyWorldWriterViolations` in `scripts/docs/lib.mjs`, run as "legacy world writers" by `checkLegacyWorldWriters` in
  `scripts/docs/checks.mjs`. It replaces the import rule, `ModuleInfo.writesRegistry` and `registryWritePattern`, which are deleted.
- The list went from 14 files to 8: the 8 that only read are off and `toolObjectRuntimes.ts` and `worldGeometryComputedObjects.ts` are on.
- Tried on the real tree: dropping `runtime/worldGeometryComputedObjects.ts` from the list, and adding `carriedGeodesicCannon.ts` to it,
  each gives exactly one violation.

Issue 91's per-file claims, rechecked: all hold. The five read-only files and the three that take constants from `placedFlags.ts` use no
mutator, the two unlisted files write, and `geometryCommit.ts` writes through the registry it is handed.

Tests: `tests/project/moduleImportRules.test.ts` scans a small source tree written to a temporary directory (a read, a renamed variable,
transitive mutators, a re-export, a closure, a value, a file that only names the type, `runtime/`, a non-client) and checks both failure
directions. `tests/world-objects/runtimeObjectChangeJournal.test.ts` pins the reader type with `@ts-expect-error`.

### Deviations

- Step 1 also touched files outside the clients, because a client holding a reader cannot call a function that asks for the writer:
  all of `interaction/aimTarget.ts`, and 14 read functions in `world-objects/` (`endpoints.ts`, `lifecycle.ts`, `segments.ts`,
  `protractorTool.ts`) now take `RuntimeObjectReader`.
- Existing tests changed. The job asks for tests of the check but does not name these changes:
  - "reports a client importing a world-objects mutator unless it is a legacy writer" tested the deleted import rule and is replaced.
  - The shrink test stays, but its committed copy is now the 8 files. That copy had to change because two files were added.
  - `tests/project/documentation.test.ts` gets a 60 s timeout, since the check now builds a TypeScript program. No assertion changed.
- Added beyond the steps: `npm run docs:writers` and its `writers` command (the coordinator asked for a repeatable method), and a row for
  it in `_docs/ARCHITECTURE.md`.
- `Status` stays `in progress`: the standing brief leaves closing the job to the coordinator.

### Uncertain

- "Call a world-objects mutator" is read as including the registry's own write methods. Otherwise `geometryCommit.ts` and
  `toolObjectRuntimes.ts` would be caught only by naming the type. Confirm this reading.
- Better idea, not done because the Decisions do not ask for it: also fail a client that names `RuntimeObjectRegistry`. Today a new client
  can name it and hand it on without being flagged; only a write or a mutator use in that file is caught.
- `createThreeApp.ts` does not name `LegacyWorldWriter`: it creates the registry and is listed for its 2 direct writes and 1 mutator use.
  Once those go, the check will require it off the list although it still holds the writer to give to the engine and the other writers.
- What the scan cannot see:
  - a write through a destructured method (`const { add } = registry`);
  - a method of an object a mutator returned, for example what a creature behaviour does after it is created;
  - a write through a function of `modules/` or `interaction/`, since the Decisions say world-objects mutator. By reading the imports,
    no client uses one today: clients take types and constants from `modules/carry/api`, and `runtime/experience.ts` composes modules.
- A top-level factory counts as a mutator if any closure inside it writes, even a closure the caller never runs.
- 013 sections 12.2 and 14 still describe the old rule (render and ui files that import a mutator; "type-only imports count"). The brief
  forbids editing 013, so the maintainer needs to update them.
- Timing: the bench check exits 3, see `### Checks`. The JavaScript is unchanged, so this job cannot be the cause, but only `bench:ab`
  would settle it.

### Not done

- Issue 91 is left open and the queue table untouched: the coordinator closes them.
- No Quest 2 or desktop manual check was run, and none is claimed. All 24 changed `src` files compile to identical JavaScript, so none is
  specific to this job.

### Checks

Baseline before any change: `npm run typecheck` exit 0; `npm test` exit 0 (172 files, 1505 tests); `npm run docs:check` passed.

At 4b0f825:

- `npm run typecheck` exit 0.
- `npm test` exit 0 (172 files, 1513 tests).
- `npm run docs:check` exit 0, including "legacy world writers"; `npm run docs:generate` was run first.
- `npm run build` exit 0, then `npm run smoke` exit 0 (`SMOKE OK cube`). Run once at the end: `createThreeApp.ts` was not changed.
- `npm run bench -- moduleStep --check` exit 3: no counter rose, only timing is over its limit (`flow` 20.21 us/step,
  `flow+dependents` 42.27 us/step). `manyArcs` writes are 126897, as in job 61. Run alone, right after smoke.
- HEAD against the tree, with esbuild `transformSync` on each file: 24 of 24 changed `src` files emit identical JavaScript, so the job
  changes no behaviour.
- `grep -rn "legacyWorldWriters" scripts` shows the list and the check in `scripts/docs/lib.mjs`.
