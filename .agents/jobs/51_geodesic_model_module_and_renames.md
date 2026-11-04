# Job 51 - Create the geodesic model module, with its renames and end nodes

Status: done, needs review on 2026-11-03.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 2, 5, 6).

## Goal

Piecewise geodesics become the `geodesicModel` module, with names from the mathematical model. A curve loses its stored
motion state. Carrying an emitter drags the end node of a tied curve instead of deleting the curve.

## Depends on

Job 50.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job51 -b job-51 <branch with job 50>`).
- Read design 013: sections 5.7, 9, 10, 13.1, and job 51 in section 15.
- Read the project notes "Carrying an emitter of a locked geodesic" and "Curve shortening is a flow"
  (`.agents/knowledge.d/notes/K-20261104-bb27.md`, `K-20261104-5d8e.md`).
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

Invariant: an arc's portal word must chain from its start anchor's cell to its end anchor's cell. `isGeodesicLocked` is
derived from the ends: both on emitters. `motionState` is stored. A tied curve's arcs run from an emitter to a shared free
vertex, so they are not locked, and today lifting that emitter deletes them.

## Decisions

- Terms: a curve's **end nodes** are arc ends on an emitter; its **interior vertices** are `geodesicModel/vertex` objects
  shared by two or more arc ends. The emitter drags end nodes. The flow never acts on one.
- An arc **follows its emitter** when it has an end on that emitter and connects emitters, or its other end is a shared
  vertex. New predicate `arcFollowsEmitter` in `lifecycle.ts`.
- The four places of the table in 13.1 change to `arcFollowsEmitter`. Tying, aim, rotate and the deformation policy keep
  `arcConnectsEmitters`: a curve still shortening at a geometry commit is deleted, as today.
- A plain shot geodesic (unshared free end) is still deleted on lift.
- Chord into a forbidden zone while dragging: a connecting arc is deleted, as today; a tied arc takes its **whole curve**
  (`arcsOfCurve`).
- Any other failed rebuild during the carry: the arc keeps its old path and gets the transient field `stale: true`; the
  next successful rebuild clears it. At release, a failed rebuild of a tied arc removes the whole curve.
- `previewVertexMove` and `previewVertexRemoval` refuse an id that is not a `geodesicModel/vertex` (undefined and `blocked`).
- The refusal code is `geodesicModel/notConnected`.
- Operations reach dependents as in 13.1: the `api` holds only the previews and `commitVertexMove`. `highlightEndpoint`,
  `removeVertex` and `removeCurve` are commands, the last two `moduleOnly`.
- `previewVertexRemoval` and `removeVertex` take no `remainingDriven`.
- "The vertex count never grows" must not appear in `geodesicModel/api.ts`.
- A kinked closed loop now shows as open, not moving. This is accepted.
- The implementation stays in `src/world-objects/geodesic/` in this wave; the module is a facade (12.1).

## Steps

1. **First commit, renames only** (section 10): the four kinds, their types, constructors and guards, id families,
   `_docs/MATHEMATICAL_MODEL.md`, the header of `objects.ts`. Done when
   `grep -rn "geodesic-interval\|free-geodesic-end\|\"geodesic-segment\"\|geodesic-intersection" src tests` is empty.
2. `world-objects/geodesic/vertices.ts` (13.1), moved out of `curveShortening.ts`; `curveShortening.ts` rewritten on it.
   Behaviour identical; the curve-shortening tests stay green unchanged.
3. Delete `motionState`. `isTied` replaces it for display (`segments.ts:301`); `isAimableFreeGeodesic` drops its check.
   Rename `isGeodesicLocked` to `arcConnectsEmitters` and `collectLockedIncidentGeodesicIdsForEmitter` to match. In
   `findEquivalentStableInterval`, "stable" becomes "connects emitters". The legacy flow keeps working until job 53: where
   it read `motionState`, it reads its pair's `vertexIds`. Test assertions on `motionState` change here, and each change is
   recorded under `### Deviations`. Done when `grep -rn "motionState\|isGeodesicLocked" src tests` is empty.
4. End nodes: `arcFollowsEmitter`, the four places, whole-curve removal, `stale` and `isStale`. This also fixes
   `carryEnd.ts:45-88`, which can regrow a tied arc.
5. `src/modules/geodesicModel/` (`api.ts`, `module.ts`, `index.ts`) over world-objects, in the experience, with the
   `GeodesicModelQueries` and `GeodesicModelApi` split of 13.1. Add the naming check of section 10 to `docs:check`.

## Tests and checks

- On a tied curve: lifting its emitter keeps it; carrying moves the end node and keeps each arc's class, through a portal
  too; a chord into a forbidden zone removes the whole curve. A plain shot geodesic is still deleted on lift.
- `tests/modules/geodesicModel.contract.test.ts`: moving a vertex keeps each arc's class (the word changes exactly by the
  crossings); length after equals `lengthAfterMeters`; a failed preview changes nothing (registry version unchanged); tie
  then removal round-trips the geometry within tolerance; a taut loop keeps its vertex (preview `loopTaut`); a collapsed
  merge deletes the curve and its vertex; every `queries` function leaves the registry version unchanged; `removeVertex` on a
  blocked vertex is refused and changes nothing; both previews refuse an emitter id.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not mix behaviour changes into the rename commit.
- Do not move the flow here; job 53 does that.
- Do not widen tying, aim, rotate or the deformation policy.

## Done when

- The greps above are empty, a tied curve survives a carry in the app, and all checks are green.

## Report

### Done
- Commit `eccd27c` (renames only; `npm test` green on it with no assertion value changed): `geodesic-interval`, `free-geodesic-end`, `geodesic-segment`, `geodesic-intersection` became `geodesicModel/arc`, `geodesicModel/vertex`, `geodesicModel/segment`, `geodesicModel/crossing`; types `GeodesicArcObject`, `GeodesicVertexObject`, `GeodesicCrossingObject` with `createGeodesicArcObject`, `createGeodesicVertexObject`, `isGeodesicVertexObject`, `createGeodesicCrossingObject`; the crossing id prefix `geodesic-intersection:` became `geodesicModel/crossing:`; the `objects.ts` header and `_docs/MATHEMATICAL_MODEL.md` define arc, vertex, crossing ("formerly ..."). The grep of step 1 is empty.
- Commit `35befce` (steps 2-4): `world-objects/geodesic/vertices.ts` (`arcTangentsAtVertex`, `lengthOfArcs`, `previewVertexMove`, `commitVertexMove`, `previewVertexRemoval`, `removeVertex`, `tieAtNewVertex`); `curveShortening.ts` rewritten on it (the legacy flow; its tests are unchanged except for `motionState`). `motionState` deleted; `isTied`, `isStale`, `arcsAtVertex`, `arcsOfCurve`, `tiedVertexCount`, `forEachTiedVertex` in `endpoints.ts`; `isGeodesicLocked` is `arcConnectsEmitters`, `collectLockedIncidentGeodesicIdsForEmitter` is `collectConnectingArcIdsForEmitter`, new `arcFollowsEmitter` and `collectFollowingArcIdsForEmitter` in `lifecycle.ts`. The four places of the 13.1 table use `arcFollowsEmitter`; tying, aim, rotate and the deformation policy keep `arcConnectsEmitters`. A forbidden-zone chord and a failed rebuild at release remove the whole curve; any other failed rebuild during a carry sets the transient `stale: true`, cleared by the next successful rebuild (`commitRealizedTraces`); `carryEnd.ts` never regrows a tied arc. The legacy flow skips a vertex with a stale arc. `tests/world-objects/geodesic/tiedCarry.test.ts`: lift keeps a tied curve and still deletes a plain shot geodesic; carry moves the end node within a cell and through a portal (words and lengths checked independently); a forbidden-zone chord removes the whole curve; a stale mark, then removal at release.
- Commit `97190ef` (step 5): `src/modules/geodesicModel/` (`api.ts`, `module.ts`, `index.ts`), listed in `createDefaultWorldModules`; `moduleOwnedCoreKinds` in `engine/coreIds.ts` and `ComposeOptions.moduleOwnedCoreKinds`, so the module may declare the four kinds that still sit in the core union (composition rule 5); the naming check of section 10 in `docs:check` (`moduleNameViolations` in `scripts/docs/lib.mjs`, tests in `tests/project/moduleNames.test.ts`); `tests/modules/geodesicModel.contract.test.ts` (every item of the job's list, plus the carry module carrying a tied curve through the engine); one composition test for owned kinds.
- `legacyWorldWriters` is unchanged.

### Deviations
- Id families (`"geodesic"`, `curve-shortening:...`, `free-end:...`) are NOT renamed, by coordinator order (an earlier review: do not change id families of existing ids). The design table lists them for job 51. The crossing id prefix is renamed only because the job's grep forbids `geodesic-intersection` anywhere.
- `arcsAtVertex` lives in `endpoints.ts`, not `vertices.ts` (13.1): `isTied` and `arcsOfCurve` need it, and `segments.ts` (display state) needs `isTied`, so putting it in `vertices.ts` would make an import cycle. `vertices.ts` imports it.
- `GeodesicModelOptions { tieTool }`, the client part (`client.ts`) and `publicApi.geodesicModel` of 13.1 are not built: the tie tool id `geodesicModel/tie` and the client factory belong to job 54, so `geodesicModel/tieAndDetach` has no `requiresTool` yet (composition rule 12 would reject an undefined tool id, and `RuntimeToolId` has no such id).
- The tie command does not create the legacy `CurveShorteningPairObject`: a curve tied through the command does not flow until job 53 (the app's tie tool still calls `tieAndDetachGeodesicEndpoints`, which creates the pair).
- `findEquivalentStableInterval` became `findEquivalentConnectingArc` (private, in `vertices.ts`): "stable" is "connects emitters". It runs when the merged arc connects emitters, which is exactly when the old code ran it (`pair.vertexIds` holds one vertex, so `stillMoving` was always false at removal).
- `previewVertexMove` does not refuse a move that lengthens the arcs (the flow checks `lengthAfterMeters` against `before + tolerance` itself, same arithmetic as before). It also returns `undefined` when a listed arc end is not on the vertex.
- Test edits for `motionState`, in `tests/world-objects/geodesic/curveShortening.test.ts`, `tests/world-objects/geodesic/intersections.test.ts` and `tests/fixtures/world-objects/geodesic.ts`: the `motionState: "moving" | "stable"` constructor arguments are removed; assertions `toMatchObject({ motionState: "moving" })` became `expect(isTied(registry, id)).toBe(true)` (`g-lm`, `g-mr`, `g1`, the 30-tick case, the unresolved case), and `motionState: "stable"` became `isTied(...)` false (`g1` after the pair is gone, the slow and fast runs) or was dropped from a `toMatchObject` that still checks the anchors (loop, torus pair, seam merge). One assertion changed meaning: a flowing closed free loop `g-loop` had `motionState: "moving"` and `connectionState` containing `"moving"`; it now has `isTied` false and `connectionState` containing `"open"` (the accepted change of the job). The `isGeodesicLocked` and `collectLockedIncident...` identifiers in tests were renamed with no value change.
- Debug dumps: the `motionState` key of `dump_all_geodesics` intervals became `tied` (a boolean); the `locked` key keeps its name.

### Uncertain
- Non-identifier strings renamed by the rename commit `eccd27c` beyond the kind strings: in `src/render/three/geodesicCannonRenderer.ts` the crossing archetype prefix `geodesicIntersectionArchetypePrefix`, the balloon `root.name`, `balloon.name` and cache key now read `geodesicModel/crossing...`; the `writesCoreKinds` strings in `src/modules/carry/module.ts`. Segment archetype keys and mesh names (`geodesic-segment:...`) were left.
- Extra refusal codes `geodesicModel/unknownArc` and `geodesicModel/vertexBlocked`; the new export `withoutStale`; `arcsAtVertex` in `endpoints.ts`.
- User-visible changes: a tied curve now survives lifting its emitter (before it was deleted); carrying an emitter of a tied curve moves the end node and keeps the curve; a flowing closed loop displays `open` instead of `moving`; the debug dump key `motionState` is `tied`; balloon and object names changed as above; a tied curve made through the new command has no pair and does not flow until job 53.
- `_docs/MATHEMATICAL_MODEL.md` still uses "locked", "moving"/"stable" interval and "free vertex" prose in the curve-shortening sections; the job names only the renames for that document, so I did not rewrite them.
- The carry module still lists the geodesic kinds in `writesCoreKinds` and writes arcs through the world-objects facade, not through `geodesicModel` (the carry commit callback is not a dispatch). Moving it onto the module belongs to the emitter module (section 16).
- `tiedVertexCount` and `forEachTiedVertex` are O(arcs) per call and allocate a count map (design 13.1 asks O(1) and no allocation); a first version cached them per registry version, but that cache rescanned on every write and made the flow about 12% slower, so it was removed. `isTied` and `arcFollowsEmitter` scan the arcs without allocating.
- `collectConnectingArcIdsForEmitter` was deleted; `geodesicRebuildOutcomes.test.ts` uses `collectFollowingArcIdsForEmitter` (same ids in that scene, no assertion value changed).
- An arc that connects emitters is also marked `stale: true` when its live rebuild fails during a carry (it used to be kept silently); an existing test that compares such an arc after a failed live rebuild still passes, but a client doing a whole-object `toEqual` on it would see the field.
- The bench passed (`check: ok`) after waiting; the first run right after the full test suite failed on `flow` and `flow+dependents` (machine hot), as the coordinator predicted.

### Not done
- The manual check "a tied curve survives a carry in the app" was not done in a browser (no CDP session with focus emulation was set up). It is covered by `tests/world-objects/geodesic/tiedCarry.test.ts` and by the engine test with the carry module in `geodesicModel.contract.test.ts`; `npm run smoke -- --world cube,torus-moduli` and `npm run test:release` pass.
- `GeodesicModelOptions`, `client.ts`, the tie tool and `publicApi.geodesicModel` (job 54).

### Checks
- Bench repair (flow step, median of 7): job 50 `ee65c50` flow ~17.4 us, flow+dependents 31.7-32.4 us; job 51 before repair `a142b9d` flow 19.3-19.8 us, flow+dependents 34.5-36.1 us (check failed); after repair flow 15.8 us, flow+dependents 28.3 us, idle allocation 676 bytes/step (before repair 681; job 50 not measured by me). Cause: `isTied` (called from the segment display state on every commit) rebuilt a per-registry-version index and used `flatMap`; it is now an allocation-free scan, and the stale check in the flow is an index loop.
- Baseline before changes: `npm run typecheck` ok, `npm test` 158 files / 1332 tests ok.
- After the final change: `npm run typecheck` ok; `npm test` 161 files / 1360 tests ok; `npm run docs:check` ok (new "module names" check); `npm run build` ok; `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages); `npm run bench -- moduleStep --check` check: ok on the second run (flow 18.2 us/step, flow+dependents 31.0 us/step; the first run, right after the suite, failed on timing); `npm run test:release` 7 files / 15 tests ok.
- Greps: `grep -rn "geodesic-interval\|free-geodesic-end\|\"geodesic-segment\"\|geodesic-intersection" src tests` empty; `grep -rn "motionState\|isGeodesicLocked" src tests` empty; "The vertex count never grows" is not in `geodesicModel/api.ts`.
