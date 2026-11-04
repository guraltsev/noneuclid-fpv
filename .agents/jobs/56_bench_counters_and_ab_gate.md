# Job 56 - Make the performance gate exact: scan counters, a many-arcs scene and an A/B tool

Status: in progress.
Resolves: part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

The batch stopped on a timing failure that does not reproduce. Replace the clock with something that cannot flake: count the
scans and writes each bench scene makes, and fail on any increase, naming the kind. Keep timing as an alarm, and add a tool that
settles a timing alarm properly.

## Depends on

Job 51.

## Before you start

- Read design 014 sections 1.1, 5 and D12.
- Read `scripts/bench/moduleStep.bench.ts` and `scripts/bench/run.mjs` in full.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

`--check` exits 1 on any timing limit. On unchanged code, flow+dependents ranges from 27.6 to 31.9 microseconds on this machine,
and its limit is about 32.2. The flow scenes hold two arcs, so a scan of "all arcs" costs almost nothing in them.

Project rule: code reached only by tests is stale and must not exist. Counters must therefore be reachable from the debug API, as
`playerPose` is (`src/render/three/appDebugHelpers.ts`).

## Decisions

- The registry counts a **kind scan** each time it walks a kind to build a list. Today that is every `getObjectsOfKind` call. Key
  it by kind. `getAll` counts under the key `"*"` each time it rebuilds its array, not when it returns the cached one.
- New registry method `getKindScanCounts(): Readonly<Record<string, number>>`. It returns a fresh object (debug use only). Add it to
  `RuntimeObjectRegistry`; it stays in `RuntimeObjectReader`.
- Debug API: `debug.kindScans()` returns that object. Add it next to `playerPose`, in the interface, the callbacks and both
  installed objects in `appDebugHelpers.ts`, and pass it from `createThreeApp.ts`.
- Counter baseline: `scripts/bench/baselines/moduleStepCounters.json`. Unlike the timing baseline it is exact, host-independent and
  committed. Shape:

  ```json
  { "flow": { "steps": 120, "writes": 1559, "scans": { "geodesicModel/arc": 121 } }, "flow+dependents": {}, "manyArcs": {} }
  ```

- `--check` compares counters first. For each scene: `steps` must be **equal** (a change means the flow's behaviour changed); `writes`
  and each scan count must be **less than or equal**. Print each failure as `flow+dependents: geodesicModel/arc scans 836 > 120`. A
  scan key missing from the baseline counts as a baseline of 0.
- Exit codes of `--check`: **1** when a counter failed, **3** when only timing failed, **0** otherwise. An exit 3 prints
  `check: timing over limit; settle it with npm run bench:ab -- <start commit>`. Keep the existing rule that a run on another host
  only warns for timing. Counters always apply, on any host.
- New flag `--record-counters` writes the counter file. The timing baseline stays as it is: never re-record it.
- A job may run `--record-counters` only when every number fell or stayed, or when its own Decisions name the rise. This job records
  the first version.
- Many-arcs scene: the tied pair of `createTorusTiedPairScenario` plus 32 extra plain arcs that do not flow. Its timing is printed but
  has no limit; only its counters are gated.
- `npm run bench:ab -- <commit>` is a new script `scripts/bench/abCompare.mjs`. It is a developer tool like `run.mjs`.

## Steps

1. Add the counters to `src/world-objects/runtimeObjectRegistry.ts`, and `debug.kindScans()`. Test in
   `tests/world-objects/runtimeObjectRegistry.test.ts`: `getObjectsOfKind` counts one scan under its kind; a repeated `getAll` with no
   write between counts once.

2. Add `createManyArcsFlowScenario(extraArcs)` to `tests/fixtures/world-objects/geodesic.ts`, built on
   `createTorusTiedPairScenario`. Add emitter pairs with one arc each, and call `rebuildConnectedGeodesicBetweenEmitters` for each, as
   that fixture does. Arcs may cross; the scene is for counting.

3. In `moduleStep.bench.ts`, add `measureCounters(scene)`: run one flow to the end, as `timeFlow` does, and read `steps`, the writes
   (`registry.changes.length`; these scenes have no engine, so it is never cleared; take the difference from before the run) and the
   difference of `getKindScanCounts()` from before the run. Do this for `flow`, `flow+dependents` and `manyArcs`, and print a table.
   The driver's own loop condition scans `curve-shortening-pair`: use `registry.countOfKind` there, so the bench does not count itself.

4. Add `--record-counters`, the comparison, and the exit codes. Run the counters twice and check they are identical: if not, find out
   why before going on. Run `npm run bench -- moduleStep --record-counters` and commit the file.

5. Write `scripts/bench/abCompare.mjs` and add `"bench:ab": "node scripts/bench/abCompare.mjs"` to `package.json`:
   - argument: a commit; the working tree must be clean, or it exits 2;
   - `git worktree add --detach <temp dir> <commit>` (use `os.tmpdir()`), and link `node_modules` (a junction on Windows,
     `fs.symlinkSync(target, path, "junction")`);
   - three rounds, alternating base and HEAD, each `npm run bench -- moduleStep`, with a 20 second pause between runs;
   - parse the lines matching `^flow\s+([\d.]+) us/step` and `^flow\+dependents\s+([\d.]+) us/step` (the counter table must not match);
     print the three values and the median of each;
   - exit 1 when the HEAD median of either scene is above base median x 1.10, else 0;
   - always `git worktree remove --force` the temp worktree, in a `finally`.

6. **Settle job 51.** Run `npm run bench:ab -- ee65c50`. Record the output under `### Checks`. If it exits 1, rerun it once and record both. A
   timing result alone does not fail this job: the coordinator's rule decides what happens next.

## Tests and checks

- Runtime: the two registry tests of step 1.
- Prove the gate: add one scratch `registry.getObjectsOfKind("geodesicModel/arc")` inside the flow, see `--check` exit 1 and name the
  kind, then remove it. Record the printed line under `### Checks`.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke -- --world cube,torus-moduli`,
  `npm run bench -- moduleStep --check`.

## Do not

- Do not change the flow, the timing limits or `moduleStep.json`.
- Do not count inside the hot path with anything but one integer increment on a `Map` entry.

## Done when

- `moduleStepCounters.json` is committed, and `--check` exits 1 naming a kind when a scan is added.
- `npm run bench:ab -- ee65c50` has run, and its result is in the Report.
- All checks are green.
