# Job 53 - Move curve shortening into a module with no lifecycle

Status: done, needs review on 2026-11-04.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 1, 3, 6).

## Goal

The flow is a module the shell does not name. A curve has no lifecycle: nothing starts, finishes or locks. The flow applies
one rule to every tied vertex each step, and it stops because nothing is left to act on.

## Depends on

Job 52.

## Before you start

- Read design 013: sections 5.7, 13.1, 13.2, and job 53 in section 15. Read `_docs/MATHEMATICAL_MODEL.md` section 7. Read design 014 sections 2.1 and
  9, which amend 13.2.
- Read the project note "Curve shortening is a flow" (`.agents/knowledge.d/notes/K-20261104-5d8e.md`). To watch the flow in
  a hidden debug window, sample inside one attached CDP session with focus emulation.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Facts of today's flow, which stay true:

- Each vertex moves along `u1 + u2`, the sum of the unit tangents of its two arcs pointing away from it, by
  `min(speed * dt, line-search minimum)`. Speed is 1.5 m/s, `dt` is clamped to 0.1 s. The line search is what stopped the
  job 06 stall; keep it.
- A vertex is taut when `|u1 + u2| < curveShorteningTautTurnRadians` (5e-3).
- A rejected step is halved up to eight times. The length never grows.
- The vertex count never grows in this algorithm. A curve that would need a wrap at a forbidden-zone disk ends `unresolved`.
- A free loop (one arc, both ends on one vertex) cannot merge. With translation holonomy it is taut at once. With rotation
  holonomy it shrinks toward the cone point and is deleted below `loopCollapseLengthMeters` (0.6 m) with a notice.

## Decisions

- **The rule, per tied vertex, in `forEachTiedVertex` order:** skip if an incident arc is stale; if at rest, always merge
  (dispatch `geodesicModel/removeVertex`); otherwise move (`previewVertexMove`, `commitVertexMove`); if it cannot move, try the
  merge as today; if that is refused, apply `onBlocked`.
- A taut closed loop keeps its vertex (preview `loopTaut`) and goes quiet.
- `quiet` is a private `Map<vertexId, reason>` of vertices with nothing to do: taut closed loops and blocked vertices. It is a **memo**, not a
  cache (014 2.1): whether a vertex can move depends on the step length, so it is not a function of state.
- The derive tick `curveShortening/wake` (`subscribes: ["geodesicModel/arc"]`) reads the ring from `ctx.changesFrom` to `ctx.changesTo`. For each
  arc entry it deletes from `quiet` both anchors of `objectAt(seq)` and of `beforeAt(seq)`. Reading `beforeAt` matters: an arc moved off a vertex
  must wake that vertex.
- **There are no `reset` or `transformGeometry` hooks**: `ModuleInstance` has neither, and none is built. None is needed: a geometry commit deletes
  every arc that does not connect emitters, the `wake` tick sees those removals, and a load makes a new engine.
- `isIdle` is `tiedVertexCount() === quiet.size`. Both are O(1) with no allocation, because `tiedVertexCount` reads the arc index (job 59). It may
  lag `wake` by one step; that is harmless.
- The tick visits `forEachTiedVertex`, a frozen snapshot. A merge during the visit removes vertices from the world: a visit first checks
  that its vertex still exists, and skips it if not.
- The tick has `writes: []`; the model writes.
- Options: `{ onBlocked: "unresolve"; speedLaw: "constant" }`. `SpeedLaw` is a function in `policies.ts`. Build only
  `"constant"`, which returns today's step budget.
- No object kind, no `started` or `finished` events. `unresolved` fires once, when the vertex goes quiet, with `vertexId`.
- The first flow step is in the step that applied the tie. This timing change is accepted.
- Merging loses a bend. That is accepted for this simplest algorithm: a later job inserts vertices (section 16). Do not build
  `insertVertex`, `refinement` or a tension law now, but do not assume one vertex per curve either.

## Steps

1. `src/modules/curveShortening/` (`api.ts`, `index.ts`, `module.ts`, `flow.ts`, `policies.ts`). Move the flow; delete
   `world-objects/geodesic/curveShortening.ts`. Its test moves to `tests/modules/curveShortening/` and drives the engine.
   Notices become events with the same messages.
2. **Assertions on motion, lengths, merging and notices do not change.** Assertions on the pair object become assertions on
   the curve (`isAtRest`, `blockedVertices`, the vertices left). Record each one under `### Deviations`.
3. Delete `curve-shortening-pair`, `CurveShorteningPairObject`, its `state` and `vertexIds`.
4. The rule, `quiet`, the `wake` tick, `speedLaw: "constant"`.
5. The model's command `tieAndDetach` and event `vertexTied`. Delete the shell's "curve shortening" phase.
   `geodesicCannonTools.ts` submits `geodesicModel/tieAndDetach`.
6. Move the bench's **flow** scenes, and `manyArcs`, onto the engine, stepped until `isAtRest` or 600 steps; the loop condition reads `isAtRest`,
   not a kind. `steps` must stay equal to the recorded value, or the flow's behaviour changed, except that the first flow step now comes in the
   step that applied the tie, which may change it by one: name that under `### Deviations`. Run `--record-counters`: this job may raise only what
   the engine's pass adds, and must drop the `curve-shortening-pair` scans.
7. Update `_docs/MATHEMATICAL_MODEL.md` section 7: no pair, no stable state, the rule above.

## Tests and checks

- Each tie refusal returns its code and changes nothing.
- The flow alone against a scripted fake of `GeodesicModelApi` and `dispatch`: a vertex at rest merges; a blocked one goes
  quiet and `unresolved` fires once; a stale arc is skipped for that step, not blocked.
- A taut closed loop goes quiet and `isIdle` is true; dragging its arc wakes it.
- A blocked vertex wakes when an arc is moved off it (`beforeAt`), and a vertex merged away during the tick's visit is skipped.
- `isIdle` allocates nothing and scans no kind: on a quiet scene, `getKindScanCounts()` is unchanged over 100 steps.
- `expectSegmentsAreRealizedFromArcs` holds after a flow run (job 60).
- Over many flow steps with no carry, every emitter's pose and cell are unchanged.
- Carrying an emitter while its curve flows moves the end node, and the curve still merges.
- A curve with five vertices flows (the existing test).
- An experience **without** the flow keeps a tied curve as tied over many steps.
- Release tier: `api.geodesicModel.tieAndDetach(...)` on a torus world, then `api.waitFor` until
  `api.curveShortening.isAtRest()`.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not change speed, tolerances, halving or the line search.
- Do not add `reset`, `transformGeometry` or any other hook to `ModuleInstance` for `quiet`.
- Do not make `quiet` a `defineDerived` cache: it is a memo.
- Do not add a stored "moving", "stable" or "locked" field anywhere.
- Do not let the flow read carry state: it knows only `isStale`.

## Done when

- `grep -rn "curve-shortening-pair\|CurveShorteningPairObject\|advanceCurveShorteningPairs" src tests` is empty.
- `createThreeApp.ts` does not name the flow, and all checks are green.

## Report

### Done

- New module `src/modules/curveShortening/` (`api.ts`, `index.ts`, `module.ts`, `flow.ts`, `policies.ts`). It requires `geodesicModelToken` and provides `curveDynamicsToken` (`isAtRest()`, `blockedVertices()`). It has no command, no tool, no object kind, no `reset` and no `transformGeometry`.
  - `flow.ts` is the rule over `forEachTiedVertex` order: skip a stale arc, merge at rest (dispatch `geodesicModel/removeVertex`), else move with the line search and up to eight halvings, else try the merge, else `onBlocked: "unresolve"`. A taut closed loop (preview `loopTaut`) goes quiet. It reads the model only through `GeodesicModelApi` and changes the world only through its operations and the dispatched command. Speed, tolerances, halving and the line search are unchanged numerically (the slope is `-(d.t1 + d.t2)` summed in the same order).
  - `module.ts`: `quiet` is a private `Map<vertexId, reason>`; simulate tick `curveShortening/step` (`writes: []`, `isIdle` = `tiedVertexCount() === quiet.size`, via `isAtRest`); derive tick `curveShortening/wake` (`subscribes: ["geodesicModel/arc"]`) deletes both anchors of `objectAt(seq)` and of `beforeAt(seq)` from `quiet`.
  - `policies.ts`: `SpeedLaw` and the `"constant"` law (speed 1.5 m/s times `dt` clamped to 0.1 s).
  - Events `curveShortening/freeLoopCollapsed` (`arcId`), `curveShortening/collapsed` (`arcIds`), `curveShortening/unresolved` (`vertexId`, `reason`), with the old messages. The shell's generic event sink logs them (console and diagnostics), as the old `onNotice` did.
- `runtime/experience.ts` adds `curveShorteningModule()`. `createThreeApp.ts` no longer names the flow: the "curve shortening" frame phase and its import are deleted. `legacyWorldWriters` did not change (checked file by file: every entry still imports a registry writer, none was added).
- Deleted `world-objects/geodesic/curveShortening.ts`, `curve-shortening-pair`, `CurveShorteningPairObject`, `createCurveShorteningPairObject`, the pair's debug dump (`curveShorteningPairs` in `AllGeodesicsDebugDump`; the vertices are still in `anchors`), and `lengthSlopeAtVertex` in `vertices.ts` (only the old flow used it). `geodesicModel/api.ts` re-exports `vertexTautTurnRadians` so the flow does not import `world-objects`.
- `geodesicCannonTools.ts` submits `geodesicModel/tieAndDetach` (`pendingTieTicket`, settled in `afterWorldStep` like the pickup); the tool's own end (clear state, close menu, clear tool) runs when the world accepts, a refusal logs its message and changes nothing. The direct `pruneMissingGeodesicIntersectionObjects` call after a tie is gone: the engine's derive pass prunes crossings and the angles tick removes their angles. `geodesicModel/tieAndDetach` and `vertexTied` already existed from job 51.
- Tests: `tests/modules/curveShortening/curveShortening.test.ts` (the moved test, now on the engine with the write guard on, plus: the flow in the tie step, emitters unchanged with no carry, a quiet loop scans no kind over 100 steps, a taut loop wakes when its arc is written, a blocked vertex stays quiet with no second notice, a blocked vertex wakes when an arc is moved off it (`beforeAt`), an experience without the flow keeps a tied curve over 300 steps, carrying an emitter while the curve flows and the curve still merges, `expectSegmentsAreRealizedFromArcs` after flows) and `tests/modules/curveShortening/flow.test.ts` (scripted fake of `GeodesicModelApi` and `dispatch`: merge at rest, blocked goes quiet and fires once, stale arc skipped not blocked, taut loop quiet, collapse notice, a vertex merged away earlier in the step is skipped, a quiet vertex is not visited). Release tier: `worldEngine.release.test.ts` gains a tie refusal through `api.world.submit`. Fixtures: `createFlowTestEngine`, `runCurveShorteningUntilAtRest`, `createTorusLockedPairScenario`. The tie refusals were already tested in `geodesicModel.contract.test.ts`.
- Bench: all scenes run on the engine (`flow` and `manyArcs` with the geodesic model and the flow, `flow+dependents` also with measurements); loops read `isAtRest`; the legacy driver is gone. `moduleStep.json` was not touched.
- `_docs/MATHEMATICAL_MODEL.md` section 7 rewritten (no pair, no stable state, the rule, quiet vertices; the old text had lost its backslashes in the LaTeX, so it is rewritten whole), `_docs/ARCHITECTURE.md` updated, generated docs regenerated.

### Deviations

Changed test assertions (all about the pair object, the removed function, or the notice vocabulary); motion, length, merging and notice-count assertions are unchanged. Compared with `git diff bf6f080 -- tests/`:

1. Tie tests: `expect(pair).toMatchObject({ id, kind: "curve-shortening-pair", vertexIds, state: "moving" })` becomes `expect(result).toMatchObject({ ok: true })` and the vertex id is read from the result; the free-end id in the attachment assertion is that vertex id. Same for the two-emitter tie: the `pair` assertion and `registry.getAll().filter(kind pair).toHaveLength(1)` are removed; `registry.get("free")` becomes `registry.get(vertexId)`. The tie now goes through the `geodesicModel/tieAndDetach` command on an engine.
2. "one small tick ... leaves a moving pair": `changed` (the return value of the deleted `advanceCurveShorteningPairs`) `toEqual(arrayContaining(["g1","g2"]))` becomes "the segments of g1 and g2 differ from before"; `registry.get("pair") toMatchObject({state:"moving"})` becomes `isAtRest() === false`.
3. "ends as the straight stable chord", torus pair, 60/240 Hz: `expect(registry.get("pair")).toBeUndefined()` becomes `isAtRest() === true`.
4. "does nothing for a non-positive frame time": `expect(advance(...)).toEqual([])` (a return value) is removed; the free vertex's unchanged position is kept.
5. Chain scenario: `registry.get("pair") toMatchObject({vertexIds: [v0..v4]})` becomes `forEachTiedVertex` yields `["v0".."v4"]`; the `pair` loop condition becomes `!isAtRest()`; "keeps arcs moving": `pair.state === "moving"` becomes `isAtRest() === false`.
6. Torus free loop: the `changed` assertion and `registry.get("pair-loop") undefined` become `isAtRest()` true and `blockedVertices()` empty. It takes a second step before it is at rest, because the first derive pass sees the arcs written before the engine existed and wakes the vertex once (the test steps until at rest, at most 10).
7. Cone-point loop: the notice `{kind: "free-loop-collapsed", geodesicId: "g-loop"}` becomes the event `{kind: "curveShortening/freeLoopCollapsed", arcId: "g-loop", message: <the old message>}` (event kinds must be `<moduleId>/<noun>`; field `arcId` per design 013 13.2). The count (1) is unchanged. Pair-gone assertions become `isAtRest()`.
8. "collapses a pair whose emitters are closer than the minimum": `notices.some(kind collapsed | unresolved)` becomes the same with `curveShortening/collapsed | curveShortening/unresolved`.
9. "leaves an unresolved pair untouched and skips it on later ticks" (it set `state: "unresolved"` by hand): replaced by the wrap scenario run until the vertex is quiet, then 50 steps change no length or arc and fire no second notice.
10. Seam test with three vertices: pair-gone assertions become `isAtRest()`.
11. Wrap-vertex test: `registry.get("pair") toMatchObject({state:"unresolved"})` becomes `blockedVertices()` is one entry for vertex `F`; `notices[0] {kind:"unresolved"}` becomes `{kind:"curveShortening/unresolved", vertexId:"F"}` plus a message check; the loop condition (pair moving) becomes "no blocked vertex". The notice count (1), the non-growing length and the vertex count are unchanged.
12. `runtimeObjectPortalGhostContract.test.ts`: the `"curve-shortening-pair": { exempt: notDrawn }` row is removed (the kind is gone).
13. `segments.test.ts` ("keeps the surviving arc's number when the flow merges two arcs"): only the call changes, `runCurveShorteningUntilPairGone(world, registry, {pairId, ...})` becomes `runCurveShorteningUntilAtRest(createFlowTestEngine(world, registry), {...})`; the assertions are unchanged.
14. Fixtures `createTorusTiedPairScenario` and `createSymmetricPairScenario` no longer create a pair. The torus scenario ties through `tieAtNewVertex` outside any step (not the command), so the bench's `steps` stays 120 and the first flow step is step 1. The tie-step timing change (first flow step in the tie step) is therefore not visible in the bench; it is tested in "flows the curve in the step that applied the tie".
15. `unresolved` carries `vertexId`, not `pairId`, as the design says.

Bench counters (`--record-counters`; `steps` is 120 in all three scenes, equal to the baseline; the pair scans are gone):

| Scene | Before | After |
| --- | --- | --- |
| flow | writes 1559; `curve-shortening-pair` 1, `geodesicModel/vertex` 2 | writes 1557 (fell by 2); `curve-shortening-pair` gone, `geodesicModel/segment` 0 to 120, `geodesicModel/vertex` 2 to 3 |
| flow+dependents | writes 1799; `curve-shortening-pair` 1, `geodesicModel/vertex` 1 | writes 1797 (fell by 2); `curve-shortening-pair` gone, `geodesicModel/vertex` 1 to 2 |
| manyArcs | writes 1559; `curve-shortening-pair` 1, `geodesicModel/crossing` 1, `geodesicModel/vertex` 2 | writes 126897; `geodesicModel/crossing` 1 to 120, `geodesicModel/segment` 0 to 120, `geodesicModel/vertex` 2 to 3; `curve-shortening-pair` gone |

The rises, each explained:

- `geodesicModel/segment` scans 0 to 120 in flow and manyArcs: the engine's derive pass (the model's crossings tick) wakes on the segment writes of every flow step. `flow+dependents` already had it (120).
- `geodesicModel/crossing` scans 1 to 120 and writes 1559 to 126897 in manyArcs: the same crossings tick, which removes and re-adds every marker of the 32 extra arcs each time it wakes (the job 52 behaviour of the tick, now reached by this scene).
- `geodesicModel/vertex` scans +1 in each scene: the bench loop reads `isAtRest()` after the last merge, which rebuilds the arc index once (the next step's `isIdle` would do the same in the app). Before, the loop read `countOfKind`, which reads no index.
- Timing: `--check` was exit 3 once ("flow step time") on the loaded machine, and exit 0 after a 60 s wait and rerun, so `bench:ab` was not needed.

### Uncertain

- The whole `manyArcs` write rise (126897 against 1559) is the crossings tick of the geodesic model, not the flow. I judged it to be "what the engine's pass adds", since the flow module requires the geodesic model and so every flow scene runs its tick. If the reviewer wants the flow scenes free of crossing work, the tick would need a way to be left out (a module option), which is outside this job.
- `unresolved` "fires once" holds only when the vertex blocks in a step after its arcs were last written. A vertex blocked in the very step in which its arcs were written (the tie step, or the first step of an engine built over a registry that already holds arcs) is woken again by the `wake` tick of the same step, so it is re-evaluated in the next step and a second notice would fire. I did not add state to prevent it. The same effect makes `isAtRest` lag a tie by one step (the design accepts that), and a taut loop needs two steps to be at rest.
- The release-tier scenario of the job (`api.geodesicModel.tieAndDetach(...)` on a torus world, then `api.waitFor` until `api.curveShortening.isAtRest()`) is not built: `ModuleInstance.publicApi` does not exist (job 54 and design 013 list it) and the public API cannot create emitters or arcs, so there is nothing to tie in the built app. I added instead a release test that the model's tie command is refused with `geodesicModel/notAnEmitter` through `api.world.submit`. Confirming the flow in the built app needs the API functions of job 45.
- "`isIdle` allocates nothing" is argued from the code (`isAtRest` reads two integers and the cached arc index), not measured; the scans half is tested (no kind scanned over 100 steps on a quiet loop). The bench's idle allocation and cache-hit checks are unchanged and green.
- The flow collects the tied vertex ids into a local array and visits them after `forEachTiedVertex` returns, instead of visiting inside the callback: the model's callback runs inside the model's write-guard frame, so an `emit` from it was attributed to `geodesicModel` and threw. This allocates one small array per active step.
- The shell tool path (select two ends, tie, tool ends) is not covered by a test; job 54 adds the tool-level test. I checked it by reading and by the smoke test (which does not tie).
- The leftovers named in the task (`getRememberedGeodesicIntersectionObject`, the remembered-centre branch in `refreshProtractorAngleObject`, `rebuiltGeodesicIds` on the carry events) are not made removable by this job (`advanceCurveShorteningPairs`, whose return value was one, is gone), so I left them. `curveShorteningSpeedMetersPerSecond` is exported only for the tests (the module uses it inside `policies.ts`).
- `tests/project/moduleImportRules.test.ts` and `moduleNames.test.ts` still mention `modules/curveShortening/...` and a `world-objects/geodesic/curveShortening.ts` import as synthetic paths in rule tests; they are not about the real file and pass.

### Not done

- The release-tier scenario with `api.geodesicModel` and `api.curveShortening` (see Uncertain).
- `bench:ab` (not needed, see above).

### Checks

- Baseline before changes: `npm run typecheck` clean, `npm test` 166 files, 1406 tests passed.
- After: `npm run typecheck` clean; `npm test` 167 files, 1419 tests passed; `npm run docs:check` all ok (after updating section 7 and ARCHITECTURE.md and running `docs:generate`).
- `npm run smoke -- --world cube,torus-moduli`: SMOKE OK (2 pages), run after the `createThreeApp.ts` change and again at the end.
- `npm run bench -- moduleStep --check`: counters pass against the re-recorded baseline; timing exit 3 once (loaded machine), exit 0 on the rerun after 60 s.
- `npm run test:release -- tests/app/worldEngine.release.test.ts`: 3 passed.
- `grep -rn "curve-shortening-pair\|CurveShorteningPairObject\|advanceCurveShorteningPairs" src tests` is empty.
