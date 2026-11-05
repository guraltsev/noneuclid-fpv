# Batch report: jobs 51-60 (derived state, then the geodesic and flow modules)

Coordinator: [00_coordinate_jobs_51_60](../00_coordinate_jobs_51_60.md).
Continues: [batch_48_55](batch_48_55.md).
Branch: batch-48-55. Batch start: 5d7b803. Batch end: (open).

## Start state
Worktree `../noneuclid-batch-48-55`, branch batch-48-55. The queued files (design 014, issue 86, jobs 51-60) were uncommitted and
were committed as 5d7b803 "Queue jobs 51 to 60 on design 014". Tree clean afterwards.
Baseline: typecheck ok; `npm test` 158 files / 1332 tests passed (the job text said 155 files; 158 counts the process files too);
docs:check ok; smoke cube,torus-moduli ok; test:release 7 files / 15 tests all passed (appCommands.release did not fail at the start);
test:report: unit 155 files / 1206 tests, process 3 / 18, release 7 / 11, hygiene 0.

## Summary
| Job | Result | Commits | Review |
| --- | --- | --- | --- |
| 51 | needs review (timing red, permitted) | 2a52924, 64e14f1, 207bbd5, close | fresh agent; no blocking finding. Fixed two stale comments (api.ts:43, endpoints.ts:290). Code reached only by tests (module api/commands/queries) is by design until job 54. |

## Indicators
| Indicator | Start | After each job (51, 56, 57, 58, 59, 60, 52, 53, 54, 55) |
| --- | --- | --- |
| Test files / tests (unit, process, release) | 155/1206, 3/18, 7/11 | |

## Manual checks for the maintainer
- Job 59: run the app with the `derived-verify` debug option, carry an emitter, shoot a geodesic, tie two ends, let the flow run to the merge; no "differs from compute" error must appear in the console.

## Questions for the maintainer

## Job 51 notes
Start 3938cdd. Bench `--check` red on timing in three runs (flow 19.4-23.4, flow+dependents 36.9-41.7 us/step); job 56's A/B settles it. Tests after: 162 files / 1362 tests. Full Report in `_done/51_...md`.

## Job 56 notes
Start ddf4350; commits c1f2771, cea3e52. Review: fresh agent, no finding on 1-9; item 10: bench exits early after --record-counters, many-arcs timing runs in every timing round (slower --check). Counter baseline: 122 arc scans in flow (job sample said 121).
`bench:ab -- ee65c50` exit 0 (medians base flow 19.27 / flow+dep 33.01; head 18.34 / 33.88 us/step): job 51's timing is cleared, no regression.
`--check` itself still exits 3 on timing alone (flow+dependents ~37 us); by rule not red. Scratch-scan proof: exit 1, "geodesicModel/arc scans 242 > 122". Counter runs byte-identical.
One full `test:release` run had a single failed test (not identified; output lost); reruns of appCommands.release and of the whole release tier passed 15/15. Treated as the known flake.
Tests after: 162 files / 1364 tests.

## Job 57 notes
Start 71cb857; commits d0818cd, f13817f, close. Tests after: 163 files / 1374 tests. `writes` counters unchanged (1559, 1918, 127420); bare engine alloc 6.5-12.3 B/step (limit 16).
Changed assertions (all in tests/engine/worldEngine.test.ts, allowed by step 5): three wake-test cursors `[[0,2]]`->`[[1,2]]` (x2) and `[[0,2],[2,3]]`->`[[1,2],[2,3]]`; "starts every cursor again after endFrame..." renamed "keeps each cursor across endFrame", `[[0,1],[0,1]]`->`[[0,1],[1,2]]`. runtimeObjectChangeJournal.test.ts unchanged.
`--check` exit 3 (timing only); `bench:ab -- 71cb857` exit 0 (flow 19.88 base / 19.78 head; flow+dep 39.96 / 39.00).
Review (fresh agent): no decision violated. Fixed finding 9: removed unread `retainFromSeq` from ChangeRingStore. Left: `capacity`, `beforeAt`, `defaultChangeRingCapacity` export are test-reached (job-decided). Weak test: no test puts a cursor older than the ring tail (no clamp by design; relies on retention) - for the maintainer.

## Job 58 notes
Start cd24b8d; commits 3bf3997, 20d9e9d, repair + close. Tests after: 164 files / 1389 tests.
Counters re-recorded (all fell or stayed, `writes` unchanged): arc scans flow+dependents 836 -> 120 (flow 122 -> 121); curve-shortening-pair 120 -> 1; measured-geodesic-length 242 -> 1 (flow) / 121 (flow+dep); protractor-angle 242 -> 1 / 240; crossing scans gone in flow. Cache-hit allocation 0.000-0.136 B/read. Fuzz harness fails on a wrong `relevant` (test exists, passes).
Timing: `--check` exit 3; `bench:ab -- cd24b8d` exit 0 (flow 17.22 base / 16.72 head; flow+dep 33.81 / 33.50).
Release tier: one `appLoading.release` failure (config "001") in the first full run; passed alone and in a second full run (15/15). Second unreproducible release failure in the batch (job 56 too); both under load, treated as flake.
Review (fresh agent): fixed in one repair round: (a) a throwing compute on a cache that already had a value left `hasValue` true with a current cursor, so the next read returned the stale value; now `hasValue=false` on throw, test added; (b) mis-indented `derivedStats` line. Not fixed (maintainer): global (not per-cache) verify countdown; duplicate-id throw not asked for; no test of the debug option wiring; `defineDerived` has no production caller until job 59 (job-justified).

## Job 59 notes
Start 8ef58b9; commit 3752f2c + close. Tests after: 165 files / 1397 tests. `git diff 8ef58b9 -- tests/` shows only added lines.
Counters (scans per flow run, before -> after): geodesicModel/arc flow 121 -> 3, flow+dependents 120 -> 2, manyArcs 121 -> 3 (limit 6); `"*"` in flow+dependents 120 -> 0; writes unchanged.
**Counter rise, flagged:** geodesicModel/vertex 1 -> 2 in flow and manyArcs. The job text does not name it. Cause: the one vertex pass each index compute makes (required by the Decisions, for tied-vertex order), and the flow computes the index twice (before and after the merge). The review confirmed it is not avoidable within the Decisions. Treated as a pass because a revert would give up 118 arc scans for one vertex scan; the coordinator's "rise = red" rule was applied by judgement, not by the letter. Maintainer: approve, or change the Decisions (compute `tiedVertexIds` lazily).
Timing: `--check` exit 3; `bench:ab -- 8ef58b9` exit 0 (flow 17.89 base / 18.23 head; flow+dep 35.36 / 32.36).
Review (fresh agent): no decision violated. `computeArcIndex` is exported for the oracle fuzz test only (kept: the oracle needs a plain compute). V3 test asserts reads > 50 not > 100 (82 measured); recorded as a Deviation. Latent: the index stores the arcs' own attachment objects; an update that kept the anchor but changed `geodesicId` would go stale (nothing does this today).
