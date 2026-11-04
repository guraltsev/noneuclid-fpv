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
## Report

### Done
- `src/world-objects/runtimeObjectRegistry.ts`: kind-scan counters (one `Map` increment per `getObjectsOfKind`; `"*"` per `getAll` rebuild) and `getKindScanCounts()` on `RuntimeObjectRegistry` (kept in `RuntimeObjectReader`). `debug.kindScans()` added in `appDebugHelpers.ts` (interface, callbacks, both installed objects) and passed from both `installGeneralDebugHelpers` call sites in `createThreeApp.ts`. Two tests in `tests/world-objects/runtimeObjectRegistry.test.ts`.
- `createManyArcsFlowScenario(extraArcs)` in `tests/fixtures/world-objects/geodesic.ts`.
- `scripts/bench/moduleStep.bench.ts`: `measureCounters`, counter table, `--record-counters`, counter comparison first, exit codes 1 / 3 / 0, many-arcs timing printed with no limit; the driver loop uses `countOfKind`. Recorded `scripts/bench/baselines/moduleStepCounters.json` (flow: 120 steps, 1559 writes, `geodesicModel/arc` 122 scans; flow+dependents: 1918 writes, `geodesicModel/arc` 836; manyArcs: 127420 writes). `moduleStep.json` untouched.
- `scripts/bench/abCompare.mjs` and `"bench:ab"` in `package.json`.
- Generated docs regenerated (`ARCHITECTURE_REFERENCE.md`). Commit c1f2771 (the Report commit follows it).
### Deviations
- None from the Decisions. The baseline arc scan count is 122, not the 121 of the job's sample JSON (the sample was illustrative).
### Uncertain
- Timing in `--check` still flakes: the final `--check` on this unchanged code exited 3 (flow and flow+dependents over limit); counters passed. The exit 3 path works as designed. A better idea (not done): widen or drop the timing limit now that counters gate.
- `bench:ab` pauses 20 s before every run except the first (so 5 pauses). `--check` skips the timing rounds when counters fail.
- manyArcs has 127420 writes per run because the crossing objects of 32 crossing arcs are rewritten at every step; it makes the scene about 1.5 ms/step. Fine for counting, but it is the slowest part of the bench.
### Not done
- Nothing skipped. Job 51 settlement: see Checks (exit 0, no rerun needed).
### Checks
- Baseline before changes: typecheck and tests green.
- Two consecutive `--record-counters` runs produced byte-identical files.
- Gate proof: scratch `registry.getObjectsOfKind("geodesicModel/arc")` at the top of `legacyStep`; `--check` exited 1 printing:
  `flow: geodesicModel/arc scans 242 > 122`
  `flow+dependents: geodesicModel/arc scans 956 > 836`
  `manyArcs: geodesicModel/arc scans 242 > 122`
  `check: FAILED (counters)`. The scratch line was removed afterwards.
- `npm run typecheck` ok; `npm test` 162 files, 1364 tests passed; `npm run docs:check` ok (after `docs:generate`); `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages).
- `npm run bench -- moduleStep --check` (final): exit 3, `check: FAILED (flow+dependents step time, flow step time)` then `check: timing over limit; settle it with npm run bench:ab -- <start commit>`; counters ok. An earlier run also exited 3 (flow+dependents 34.69 us over its limit).
- `npm run bench:ab -- ee65c50` (first run, exit 0, so no rerun):
```
> noneuclid-fpv@0.0.0 bench:ab
> node scripts/bench/abCompare.mjs ee65c50

round 1 base: flow 19.36 us/step, flow+dependents 37.39 us/step
round 1 head: flow 17.31 us/step, flow+dependents 33.24 us/step
round 2 base: flow 17.18 us/step, flow+dependents 33.01 us/step
round 2 head: flow 19.37 us/step, flow+dependents 37.02 us/step
round 3 base: flow 19.27 us/step, flow+dependents 32.1 us/step
round 3 head: flow 18.34 us/step, flow+dependents 33.88 us/step

median base ee65c50: flow 19.27, flow+dependents 33.01 us/step
median head:           flow 18.34, flow+dependents 33.88 us/step
bench:ab: ok
exit 0
```
