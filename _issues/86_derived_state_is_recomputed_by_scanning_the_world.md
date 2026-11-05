# 86 - Derived state is recomputed by scanning the world, and nothing guards it

Status: open.

Priority: P1 (it stopped the batch of jobs 48-55, and it blocks jobs 52 to 55 and with them issue 84).

Jobs: [51](../.agents/jobs/51_geodesic_model_module_and_renames.md), [56](../.agents/jobs/56_bench_counters_and_ab_gate.md),
[57](../.agents/jobs/57_change_ring.md), [58](../.agents/jobs/58_derived_cache.md), [59](../.agents/jobs/59_arc_index.md),
[60](../.agents/jobs/60_materialized_state_is_a_function_of_real_state.md). Coordinator:
[00_coordinate_jobs_51_60](../.agents/jobs/00_coordinate_jobs_51_60.md). Design:
[014](../_docs/design/014-derived-state-and-caches.md).

## Problem

Design 013 stores real state once and derives the rest. The code derives by scanning: to answer "which arc ends are on this
anchor", it walks every arc, and it asks that question seven times per flow step. Nothing tells a developer this is happening,
and nothing stops it from growing.

Job 51 deleted the stored field `motionState` and asked `isTied` instead. That doubled the calls of `getObjectsOfKind` on arcs
(201,972 to 403,152 for the same bench run). The batch's timing gate then failed, the job was reverted, and jobs 52 to 55 were
skipped.

## Evidence

Numbers are in [014](../_docs/design/014-derived-state-and-caches.md) section 1 and notes K-20261104-43d0 and K-20261104-3abb.

- `getObjectsOfKind` is a spread, a `map` and a `filter`: linear in the kind, three arrays per call
  (`src/world-objects/runtimeObjectRegistry.ts`).
- 836 arc scans in one 120-step flow run.
- 238 of 239 arc updates in that run keep both anchors, so a cache that filters on anchors recomputes 3 times in 839 reads (prototype).
- `getAll().filter(...)` in `measureLengthTool.ts` and `protractorTool.ts` costs three more whole-world passes per flow step.
- The timing gate cannot see any of this. In a three-round A/B the 5 percent regression did not reproduce: flow+dependents was
  27.6 to 31.9 microseconds on the same code. The bench's flow scene has only two arcs.

## Related defects found in the review

Each is fixed by a job above.

- A write made after `engine.step` and before `endFrame` never reaches a derive tick: `endFrame` clears the journal and resets
  the cursors. The flow runs in exactly that gap (`createThreeApp.ts`). Job 52 as first written relied on those writes arriving.
- `tiedVertexCount` and `forEachTiedVertex` are specified as O(1) and allocation-free (013 13.1). Job 51's versions scan the arcs
  and allocate a map, and job 53's `isIdle` calls them every step.
- `geodesicNumber` is stored on segments and commented "optional cache", but it is read back as the truth. It is real state on a
  derived record.

## Done when

- Per-step code reaches arc ends through one cache, with no scan of the arc kind outside its `compute`.
- The bench gate compares exact counters, and names the kind that rose.
- Tick cursors survive `endFrame`.
- Every cache passes the oracle fuzz test, and stored segments equal a fresh realization of their arc.

## Outcome

## Closing evidence

Status note: job 55 is done in code; see the Report of .agents/jobs/55_destroy_policy.md (one manual check outstanding).
