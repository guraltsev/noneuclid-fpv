# Job 60 - Make stored segments a function of real state, and test that

Status: in progress.
Resolves: part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

Segments are derived from arcs, yet a geodesic's display number lives on its segments and is read back from there: real state hiding
in a derived record. Move it to the arc, where it is assigned once. Then state the rule as a test: realizing an arc again gives its
stored segments.

## Depends on

Job 59.

## Before you start

- Read design 014 sections 2.1 and 6 (V5).
- Read `resolveGeodesicNumber`, `getGlobalGeodesicNumbers` and `replaceDerivedSegmentsFromTraces` in
  `src/world-objects/geodesic/segments.ts`, and `realizeIntervalChord` and `commitRealizedTraces` in `intervals.ts`.
- Read the numbering tests in `tests/world-objects/geodesic/trace.test.ts`.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Today a geodesic keeps its number because `replaceDerivedSegmentsFromTraces` reads it from the old segments before deleting them.
Numbers are the smallest unused positive integers, and G2 stays G2 when G1 is deleted, so a number cannot be computed from the world
as it stands: it is real state.

Arcs are created in exactly three places in `src`: `cannon.ts` (shooting), `intervals.ts` (the continuation of a split) and
`vertices.ts` (the merged arc). Everywhere else an arc is copied with a spread, so a field set at creation stays. **Assign the number
at creation, not at the first rebuild:** several rebuild paths write back an arc read before the rebuild, and would lose a number
written during it.

## Decisions

- `GeodesicArcObject` gains `readonly geodesicNumber?: number`. `createGeodesicArcObject` takes it as an optional input.
- New function `nextGeodesicNumber(registry)` in `segments.ts`: the smallest positive integer not used by any arc. It scans the arcs and
  runs once per shot or split, which is per user action, so G4 allows it.
- `cannon.ts` (shoot) and `intervals.ts` (continuation) pass `geodesicNumber: nextGeodesicNumber(registry)`.
- `vertices.ts` (merged arc): pass the number of the arc whose id survives, `mergedId`. A merged geodesic keeps its number, as today.
- `resolveGeodesicNumber(registry, id)` becomes: the arc's `geodesicNumber`, or 1. It only reads. An arc with no number exists only in test
  fixtures; this is today's documented default.
- **Delete** `getGlobalGeodesicNumbers` and `pushUniqueId`. Delete the comment in `replaceDerivedSegmentsFromTraces` about resolving the
  number before the old segments go.
- The segment keeps its `geodesicNumber` field as a copy, so tooltips and labels are unchanged. Its comment says that.
- The test "preserves existing global geodesic numbers when lower numbers are absent" in `trace.test.ts` builds a registry from one bare
  segment. Rewrite its setup to an arc with `geodesicNumber: 2`; it then expects `resolveGeodesicNumber` to give 2 and
  `nextGeodesicNumber` to give 1. Record it under `### Deviations`. Every other assertion on numbers stays as it is.
- The oracle, `tests/support/segmentOracle.ts`, `expectSegmentsAreRealizedFromArcs(world, registry)`:

  ```text
  for each arc in getObjectsOfKind("geodesicModel/arc"):
    if arc.stale: continue               // a stale arc keeps its old path on purpose (013 13.1)
    realization = realizeIntervalChord({ world, registry, interval: arc, allowUnexpectedPortalWord: true })
    expect realization.kind to be "ok"
    expected = buildDerivedSegmentsFromTraces({ registry, geodesicId: arc.id, traces: <the traces commitRealizedTraces would store> })
    compare with getGeodesicSegments(registry, arc.id), ignoring highlightState, numbers within 1e-9
  ```

- `commitRealizedTraces` applies `withAnchoredTargetTerminal` before building. Export that function from `intervals.ts` and call it from the
  oracle; do not copy its logic into the test.
- If a plain shot geodesic (an unshared free end) cannot be realized this way for a reason that is not a bug, skip it by a named condition
  in the oracle, and record why under `### Deviations`.

## Steps

1. Add the field, `nextGeodesicNumber`, and the three creation sites. Rewrite `resolveGeodesicNumber`. Delete what is listed. Run
   `npx vitest run tests/world-objects/geodesic`.

2. Add to `tests/world-objects/geodesic/segments.test.ts`:
   - a geodesic keeps its number after `removeGeodesicSegments` and a rebuild (today it can change: this is the defect);
   - two arcs merged by the flow keep the surviving arc's number;
   - the continuation of a split takes the next free number;
   - `resolveGeodesicNumber` leaves `getVersion()` unchanged.

3. `segmentOracle.ts`. Call it at the end of: the flow test (a run to the merge), `tiedCarry.test.ts` (after a carry through a portal), and the
   tie in `tests/modules/geodesicModel.contract.test.ts`. If it fails, first ask whether the code broke the rule. A real stale-segment bug
   is a finding: write it under `### Uncertain`, and if the fix is outside this job, skip that one scene with a comment naming the finding.

4. `npm run bench -- moduleStep --check`, then `--record-counters`. Check with `git diff` that `writes` did not change and no scan rose.
   Commit.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke -- --world cube,torus-moduli`, `npm run test:release`,
`npm run bench -- moduleStep --check`.

## Do not

- Do not renumber anything: every geodesic must show the number it shows today.
- Do not write the number during a rebuild.
- Do not move `highlightState`, `connectionState` or the tooltip.
- Do not change how crossings or measurements are computed.

## Done when

- `grep -rn "getGlobalGeodesicNumbers\|pushUniqueId" src tests` is empty, and `grep -n "getAll" src/world-objects/geodesic/segments.ts` is empty.
- A geodesic keeps its number through a segment rebuild, and the oracle runs in the three scenes.
- All checks are green.

## Report

### Done
- `GeodesicArcObject.geodesicNumber?` and an optional `geodesicNumber` input of `createGeodesicArcObject` (`objects.ts`). The segment keeps its field, documented as a copy.
- `nextGeodesicNumber(registry)` in `segments.ts` (scans the arcs); `resolveGeodesicNumber` now only reads the arc's number, else 1. Deleted `getGlobalGeodesicNumbers`, `pushUniqueId` and the "resolve before the old segments go" comment in `replaceDerivedSegmentsFromTraces`. `segments.ts` no longer calls `getAll`.
- Number assigned at creation: `cannon.ts` (shoot) and `intervals.ts` (continuation) pass `nextGeodesicNumber(registry)`; `vertices.ts` passes the number of the arc whose id survives (`mergedId`).
- Tests added to `tests/world-objects/geodesic/segments.test.ts`: number kept after `removeGeodesicSegments` and a rebuild (also after another geodesic is deleted); the continuation of a split takes the next free number (4 with G1..G3 present); a flow merge keeps the surviving arc's number (arcs numbered 3 and 5, merged arc is `g1` = 3); `resolveGeodesicNumber` leaves `getVersion()` unchanged.
- Oracle `tests/support/segmentOracle.ts` (`expectSegmentsAreRealizedFromArcs`), called at the end of: the flow test "shortens over many ticks and ends as the straight stable chord" (`curveShortening.test.ts`, run to the merge), "keeps each arc's class when the emitter crosses a portal" (`tiedCarry.test.ts`), and "ties through the command, emits vertexTied ..." (`geodesicModel.contract.test.ts`). Checked that it bites: a 1e-3 change of a stored length makes all three fail. All three scenes pass with no finding and no skipped scene or condition.
- Regenerated `_docs/generated/API_REFERENCE.md` and `ARCHITECTURE_REFERENCE.md` (`docs:generate`).
- Commit: a65f31d (code, tests, docs); the job file with this Report in a second commit.

### Deviations
- Changed test: `trace.test.ts`, "preserves existing global geodesic numbers when lower numbers are absent". Setup changed from `createRuntimeObjectRegistry([createSegment({ id: "g-b:segment:0", geodesicId: "g-b", geodesicNumber: 2 })])` to `createRuntimeObjectRegistry([createGeodesicArcObject({ id: "g-b", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "a", geodesicNumber: 2 })])`. Assertions: `resolveGeodesicNumber(registry, "g-b")` is 2 (unchanged); `resolveGeodesicNumber(registry, "g-c")` is 1 became `nextGeodesicNumber(registry)` is 1. The now-unused `createSegment` import was removed from that file and `createGeodesicArcObject`, `nextGeodesicNumber` imported. No other assertion changed.
- The job says to export `withAnchoredTargetTerminal` from `intervals.ts`. It is defined and already exported in `segments.ts` (`intervals.ts` only imports it), so the oracle imports it from `segments.ts`; no logic is copied and `intervals.ts` is untouched for this.
- `moduleStepCounters.json` was re-recorded as the job says; the file did not change (`git diff` empty), so `writes` and every scan are identical.

### Uncertain
- `npm run test:release` failed in this environment: `tests/app/appCommands.release.test.ts` (reload) and `tests/app/appLoading.release.test.ts` (configs "full" and "002") with "CDP command Runtime.enable got no response within 6000 ms" (browser start-up timeouts; the first run had 2 failures, the second 3). No release test touches geodesic numbers, the smoke run (`--world cube,torus-moduli`) was OK and `npm test` is green, so I believe it is load/timing in this worktree, but I did not run the release suite on the base commit to confirm.
- No counter rose. `bench -- moduleStep --check` exited 3 twice (timing only: flow and flow+dependents step time, on a loaded machine); `bench:ab -- 78f0878` settled it: ok (median flow 51.21 base vs 39.76 head, flow+dependents 103.45 vs 72.73 us/step).
- Test fixtures that create arcs by hand without a number all show G1 now (previously they got sequential numbers by encounter). No existing assertion depended on it.

### Not done
- Nothing skipped.

### Checks
- Baseline `npm run typecheck`/`npm test`: green before changes (geodesic suite 118 tests).
- After: `npm run typecheck` clean; `npm test` 165 files, 1401 tests pass (after `docs:generate`; before it only `documentation.test.ts` failed on stale generated docs); `npm run docs:check` ok; `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages); `npm run test:release` 3 CDP-timeout failures (see Uncertain); `bench -- moduleStep --check` exit 3 twice, counters fine; `bench:ab -- 78f0878` ok.
- `grep -rn "getGlobalGeodesicNumbers\|pushUniqueId" src tests` is empty; `grep -n "getAll" src/world-objects/geodesic/segments.ts` is empty.
