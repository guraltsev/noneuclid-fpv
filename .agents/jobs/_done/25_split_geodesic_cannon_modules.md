# Job 25 - Split geodesicCannon.ts into modules under src/world-objects/geodesic/

Status: done, needs review on 2026-10-29 (commits 6059f0e, 2f6aff5, 0f9b6ab, 3ee49cc, 99b93f4).
Former issue: 76 (converted to a job on 2026-10-28). Rewritten on 2026-10-29 against commit `0b468e1` for a less capable
implementing model. Resolves: no open issue (concrete plan for the geodesic half of [job 33](33_decompose_runtime_monoliths.md)).

## Goal

1. `src/world-objects/geodesicCannon.ts` (6,160 lines, 111 exports at `0b468e1`) is split, by **moving code without
   changing it**, into twelve modules under `src/world-objects/geodesic/` plus `src/math/vec2.ts`. No module exceeds
   about 1,100 lines.
2. Every caller imports from the new modules; `geodesicCannon.ts` is deleted at the end (Part E).
3. The retired emitter-connection / straightening model sits alone in `geodesic/legacyConnection.ts`, and
   `npm run docs:check` fails if any module other than the listed importers imports it. Job 26 deletes it.
4. `tests/world-objects/geodesicCannon.test.ts` (3,636 lines, 82 active + 8 skipped tests) is split into test files that
   mirror the modules. Every test keeps its name and body.

Behaviour does not change. After every Part the full suite is green with **no test edited** except import lines (Part D
moves tests between files; Part E rewrites import lines).

## Depends on

[Job 37](37_object_owners_and_place_at.md) lands first (it edits `runtimeObjectRegistry.ts` and `createThreeApp.ts`).
Batch order: 37, then **25**, then [26](26_exact_curve_shortening.md), then [27](27_geodesic_rebuild_performance.md).
Jobs 26 and 27 use the file names fixed here.

Line numbers below are at commit `0b468e1`. Job 37 and each earlier Part of this job shift them: **search by name**.

## Before you start

| File | Lines at `0b468e1` | What |
| --- | --- | --- |
| `src/world-objects/geodesicCannon.ts` | 1-6160 | header comment 1-74, imports 75-90, types 102-551, constants 553-603, then functions |
| `src/render/three/geodesicCannonTools.ts` | 1-1341 | imports 20 names from the facade (:26-51); not split in this job (Decision 9) |
| `tests/world-objects/geodesicCannon.test.ts` | 1-3636 | imports :1-56, tests :58-3265, helpers :3267-3636 |
| `scripts/docs/lib.mjs` | 16-51, 245-272 | `layers`, `layerViolations`, `newLayerViolations` (layer-level rules only) |
| `scripts/docs/checks.mjs` | 51-55, 96-108 | `checkLayering`, `runAllChecks` (also run by `tests/docs/documentation.test.ts`) |
| `scripts/docs/layering-baseline.json` | all | frozen **layer-level** violations; it cannot express a rule about one module |
| `_docs/MATHEMATICAL_MODEL.md` | 209-294, 439-442 | backticked `src/world-objects/geodesicCannon.ts#<symbol>` references |
| `_docs/ARCHITECTURE.md` | 46, 129 | two more such references |

Importers of the facade at `0b468e1` (all must be repointed in Part E):

- src: `world-objects/runtimeObjectRegistry.ts` (types only), `world-objects/protractorTool.ts`,
  `world-objects/measureLengthTool.ts`, `runtime/worldGeometryComputedObjects.ts`, `render/three/aimInteraction.ts`,
  `render/three/aimTarget.ts`, `render/three/appDebugHelpers.ts`, `render/three/carriedGeodesicCannon.ts`,
  `render/three/createThreeApp.ts` (:128), `render/three/geodesicCannonRenderer.ts`,
  `render/three/geodesicCannonTools.ts`, `render/three/geodesicCarryPortalTransition.ts`,
  `render/three/geodesicEmitterLabelController.ts`, `render/three/geodesicDebugDumps.ts`.
- tests: `world-objects/{runtimeObjectRegistry,protractorTool,measureLengthTool,geodesicTracingKernel,geodesicPortalWord.property,geodesicCannon}.test.ts`,
  `render-contract/{aimTarget,geodesicCannonRenderer,measureLengthRenderer,protractorAngleRenderer}.test.ts`,
  `runtime/worldGeometryComputedObjects.test.ts`.

Baseline: `npm run typecheck`, `npm test` (116 files, 883 passed, 8 skipped at the last batch), `npm run docs:check`.
Record the numbers; every Part must end with the same pass/skip counts (Part D adds no tests; Part A adds the vec2 tests
and Part C the import-rule test, so the count grows only by those).

## Background

### What the file holds

The reference graph of all 214 top-level declarations was computed at `0b468e1`. Grouped by concern (functions are
private unless marked E = exported today):

| Concern | Today at | Lines of code (without comments) |
| --- | --- | --- |
| Object types, constants, constructors, guards, small geometry helpers | 102-801, 1265-1292, 3151-3172, 6081-6145 | ~340 |
| Portal-word algebra (pure) | 911-920, 2281-2314, 2398-2430, 2566-2697 | ~140 |
| Cached inverse portal transforms (module-level `WeakMap`) | 988-998 | ~10 |
| Tracing (single cell, multi-cell walk, zone and emitter hits) | 347-368, 570-572, 1309-1662, 2699-2715, 6096-6131 | ~400 |
| Endpoint attachments and lifting | 810-866, 897-903, 936-1071, 1995-2005, 2593-2625, 2899-2909, 3174-3180, 4879-4909, 5600-5640, 5751-5774 | ~320 |
| Derived segments (lookup, building, lengths, numbers, emitter caches) | 875-894, 1076-1092, 1179-1181, 1944-1992, 2014-2037, 2383-2394, 2737-2836, 2893-2936, 4409-4439, 5484-5598, 6019-6079 | ~400 |
| Intersection markers (module-level `WeakMap` memory at :603) | 578-584, 603, 5433-5480, 5779-6015 | ~270 |
| Locked/connection queries and removal | 1102-1262 | ~120 |
| Interval rebuilds and previews | 1673-1935, 2050-2324, 2436-2564, 2720-2735, 2841-2891, 4642-4699 | ~760 |
| Emitter operations and cannon placement | 382-479, 648-684, 2949-3430, 5263-5421, 5533-5567 | ~710 |
| Curve shortening | 511-536, 590-601, 3492-3581, 3800-4401, 4442-4638, 6147-6149 | ~860 |
| Legacy connection / straightening | 499-527, 586-588, 1161-1167, 1220-1223, 3443-3476, 3586-3766, 4701-4876, 4912-5250, 5644-5747 | ~820 (+ the non-interval branch of `rebuildConnectedGeodesicBetweenEmitters`, :3340-3429) |
| 2-D/3-D helpers duplicating `src/math` | 6151-6160 (`distanceSquared`, `cross2`) | ~10 |

`src/math/vec2.ts` does not exist. 2-D helpers are duplicated privately in `geodesicCannon.ts` (`cross2`),
`cell-complex/staticPortalPathCull.ts:1494-1512` (`sub2`, `dot2`, `cross2`), `cell-complex/developedDisk.ts:73-79`
(`cross`, `sub`) and `movement/sweptCollision.ts:59` (`dot`); `distanceSquared` (3-D) is duplicated in
`world-objects/measureLengthTool.ts:214`, `render/three/runtimeSceneUtils.ts:146` (exported) and here. This job only
replaces the copies inside the geodesic code; the others are listed for [job 32](32_layer_dag.md)/[33](33_decompose_runtime_monoliths.md).

### How `docs:check` sees modules

`scripts/docs/lib.mjs#scanProject` records for every `src/**/*.ts` module its header comment, its resolved relative
imports (including `export ... from` statements) and its exported declarations. Consequences for this job:

- Every new module needs a leading `/** ... */` header of at least one sentence.
- Every exported declaration needs JSDoc. Helpers that are private today and become exported because another module
  needs them (listed per Part below) need a one-line JSDoc each; reuse the `//` comment above them if there is one.
- Re-exports (`export { a } from "./x"`) are **not** declarations. `checkDocReferences` resolves
  `` `src/world-objects/geodesicCannon.ts#traceGeodesicSegment` `` against declarations only, so **as soon as a symbol
  moves, its doc reference must point to the new file**, or `docs:check` fails.
- `layers` and `layering-baseline.json` work per **layer** (first path segment). They cannot say "nobody may import
  this one file". Part C adds a separate module-level rule (Decision 6).
- `tsconfig.json` has `noUnusedLocals` and `noUnusedParameters`: a private function that nothing uses any more fails
  `npm run typecheck`. Move a function together with everything that only it uses.

## Decisions

1. **Directory.** Decided: `src/world-objects/geodesic/` (singular). Jobs 26 and 27 use this name. Why: issue 70 and the
   old job 26 disagreed (`geodesics/`); one name, fixed here.

2. **Module list and contents.** Decided: exactly the assignment in the table under Steps (every one of the 214
   declarations is listed once). The assignment was checked with a script: there is **no runtime import cycle** between
   the new modules (the only two-way edge is `objects.ts` ↔ `portalWord.ts`, and `portalWord.ts` imports only types
   from `objects.ts`). The resulting dependency order, lowest first:
   `vec2` → `objects`, `portalWord`, `development` → `trace`, `intersections` → `endpoints` → `segments` →
   `lifecycle` → `intervals` → `curveShortening` → `legacyConnection` → `cannon`.
   Why: a cycle with a module-level `const` that reads an imported binding crashes the production bundle with a
   temporal-dead-zone error that vitest and typecheck do not show (batch report 11-17, job 17).

3. **Type placement.** Decided: registry object types and types shared by several modules stay in `objects.ts`; a
   request/input type used by one function moves with that function (listed per module). Why: keeps `objects.ts` the
   only module everyone needs.

4. **Facade during the move.** Decided: in Parts A-C `geodesicCannon.ts` keeps everything not yet moved and
   **re-exports every moved name that is exported today**, by name:
   `export { traceGeodesicSegment, type TraceGeodesicSegmentInput, ... } from "./geodesic/trace";`
   (inline `type` modifiers; the project uses `isolatedModules`). Do **not** use `export *`: helpers that become
   exported only for other geodesic modules must not appear in the facade. The facade's public name list stays exactly
   the 111 names of today until Part E. Part E repoints all importers and deletes the facade. Why: callers and tests do
   not change in the same commit as the moves, and the final state has no facade.

5. **Module-level state.** Decided: `geodesicIntersectionMemoryByRegistry` (:603, a `WeakMap` keyed by registry) moves
   **verbatim** to `intersections.ts`; `inversePortalTransforms` (:988, a `WeakMap` keyed by `CompiledPortal`) moves
   verbatim to `development.ts`. Neither becomes a registry field here. Why: both are already per-registry / per-world
   and correct; changing the registry interface collides with job 37, and job 27 reworks the intersection pass anyway.

6. **Legacy import guard.** Decided: add a module-level import rule to the docs tooling (Part C):
   - `scripts/docs/lib.mjs`: new export `moduleImportRules` (array) and `moduleImportRuleViolations(modules)`.
     Two rule shapes:

     ```js
     { module: "world-objects/geodesic/legacyConnection.ts", allowedImporters: [ ... ], reason: "..." }
     { module: "world-objects/geodesic/portalWord.ts", mayImportOnly: ["math/", "cell-complex/", "world-objects/geodesic/objects.ts"], reason: "..." }
     ```

     `allowedImporters`: any module that imports `module` and is not in the list is a violation.
     `mayImportOnly`: any import of `module` whose path does not start with one of the prefixes (or equal a listed file)
     is a violation. Paths are `src`-relative with forward slashes, as `scanProject` reports them.
   - `scripts/docs/checks.mjs`: `checkModuleImportRules(modules)` returning messages
     `` src/<importer> imports src/<module>; <reason> `` / `` src/<module> imports src/<dep>; <reason> ``, added to
     `runAllChecks().results` as `"module import rules"` (so `tests/docs/documentation.test.ts` runs it too).
   - Initial rules: `legacyConnection.ts` with `allowedImporters: ["world-objects/geodesicCannon.ts", "world-objects/geodesic/cannon.ts"]`
     (Part E replaces the facade entry by `"render/three/geodesicCannonTools.ts"`), reason
     `"retired geodesic connection model; job 26 deletes it - do not add importers"`;
     `portalWord.ts` `mayImportOnly: ["math/", "cell-complex/", "world-objects/geodesic/objects.ts"]`;
     `development.ts` `mayImportOnly: ["math/", "cell-complex/"]`;
     `trace.ts` `mayImportOnly: ["math/", "cell-complex/", "movement/", "world-objects/geodesic/objects.ts", "world-objects/runtimeObjectRegistry.ts"]`
     (the registry **type** is needed by `findNearestEmitterHitOnTrace`, which lists emitters).
   Why: the layer table cannot express a per-file rule; a separate list keeps the layer baseline meaning unchanged and
   gives jobs 26/27 a place to add `sleeve.ts` and `perfCounters.ts`.

7. **Legacy deletion is not in this job.** Decided: this job only isolates the legacy code; **job 26 Part E deletes
   `legacyConnection.ts`** after job 26 Part D has written the carried-over end-to-end tests of issues 31/32. Why: the
   old stage 5 was gated on exactly those tests.

8. **Legacy branches inside mixed functions.** Decided: only one branch is extracted, verbatim, into a new function:
   the non-interval part of `rebuildConnectedGeodesicBetweenEmitters` (:3340-3429) becomes
   `export function rebuildLegacyConnectedGeodesic(request: RebuildConnectedGeodesicBetweenEmittersRequest): readonly GeodesicSegmentObject[]`
   in `legacyConnection.ts`, and the mixed function ends with `return rebuildLegacyConnectedGeodesic(request);`.
   The legacy branch of `connectGeodesicToEmitter` (:3258-3291) stays in `cannon.ts` and calls `markGeodesicConnected`
   (exported from `legacyConnection.ts`), because it also uses `rebuildUnlockedGeodesicToLength` from `cannon.ts` and
   moving it would create a cycle. The legacy fallbacks in `getGeodesicConnection`, `isGeodesicLocked` and
   `removeGeodesic` stay where they are (they are a few lines and job 26 removes or keeps them deliberately).

9. **Tool state machine (old stage 4) is out of scope.** Decided: `src/render/three/geodesicCannonTools.ts` is not moved
   or split here; only its import lines change in Part E. Why: it is a closure over 25 shell dependencies (menu state,
   pointer lock, XR presence, palette and portal-instance syncs, measurement refreshes); a pure
   `step(state, registry, input) -> { state, effects }` reducer is a redesign of the shell's state ownership, which is
   [job 31](31_app_shell_state_holder.md)'s subject. Doing it here would conflict with job 31 and with job 27's changes to
   the carry loop. The coordinator should add it to job 31 or 33.

10. **Doc references.** Decided: in each Part, rewrite every backticked `src/world-objects/geodesicCannon.ts#<symbol>` in
    `_docs/MATHEMATICAL_MODEL.md` and `_docs/ARCHITECTURE.md` whose symbol moved in that Part to the new path
    (`src/world-objects/geodesic/<module>.ts#<symbol>`). The un-anchored mention in `_docs/coding_style.md:91` is inside a
    code block and is not checked; in Part E replace it by `src/world-objects/geodesic/trace.ts`.

11. **Tests in Part D.** Decided: split by moving whole `it`/`describe` blocks without editing their bodies; shared
    helpers (:3267-3636) move to `tests/world-objects/geodesic/fixtures.ts` and are exported. All 8 skipped tests go to
    `legacyConnection.test.ts` so that job 26 can delete them as one file.

## Steps

Run `npx vitest run <file>` after each step as given, `npm run typecheck` after every move, and at the end of every Part:
`npm run typecheck`, `npm test`, `npm run docs:check` (run `npm run docs:generate` when it reports stale generated
files), `npm run build`, `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. **Commit once per
Part** (message `Job 25 part X: ...`, co-author line as the repository uses). Build and smoke run after **every** Part
because a module-evaluation-order error only shows in the bundle.

### How to move one declaration

1. Cut the declaration **with its leading comment / JSDoc** from `geodesicCannon.ts` and paste it into the new module,
   keeping the order in which the declarations appear today.
2. Add the imports the moved code needs (from `../../math/...`, `../../cell-complex/...`, `../../movement/...`,
   `../runtimeObjectRegistry`, and sibling `./<module>`). Use `import type` for type-only imports.
3. If the declaration was private and another module now needs it, add `export` and a one-line JSDoc.
4. In `geodesicCannon.ts`, import what the remaining code still uses from the new module, and add the name to the
   facade's re-export list if it is exported today.
5. Do not rename anything (except Decision 8's new function and `cross2`/`distanceSquared`, Part A step 1), do not
   reformat, do not change logic.

### Part A: math helpers, objects, portal words, development, tracing

1. Create `src/math/vec2.ts` (header: "Two-dimensional vector helpers on `Vec2xy` ({ x, y }, meters): sum, difference,
   scaling, dot and cross products, length. Pure; imports nothing but the `Vec2xy` type.") with:

   ```ts
   export function crossXY(ax: number, ay: number, bx: number, by: number): number   // ax*by - ay*bx
   export function addVec2(a: Vec2xy, b: Vec2xy): Vec2xy
   export function subVec2(a: Vec2xy, b: Vec2xy): Vec2xy
   export function scaleVec2(v: Vec2xy, s: number): Vec2xy
   export function dotVec2(a: Vec2xy, b: Vec2xy): number
   export function crossVec2(a: Vec2xy, b: Vec2xy): number
   export function lengthVec2(v: Vec2xy): number                                     // Math.hypot
   ```

   (`Vec2xy` is `src/math/polygons.ts#Vec2xy`; import it as a type.) Add
   `export function distanceSquaredVec3(a: Vec3, b: Vec3): number` to `src/math/vec3.ts`. Replace the private `cross2`
   (:6158) by `crossXY` and `distanceSquared` (:6151) by `distanceSquaredVec3` inside `geodesicCannon.ts` (same
   arguments, same formula) and delete the two private copies. New test `tests/math/vec2.test.ts`:
   `crossXY(1, 0, 0, 1) = 1`, `crossVec2({1,2},{3,4}) = -2`, `dotVec2({1,2},{3,4}) = 11`, `lengthVec2({3,4}) = 5`,
   `subVec2({3,4},{1,1}) = {2,3}`, `distanceSquaredVec3((1,2,3),(4,6,3)) = 25`.
2. Create `geodesic/objects.ts`. Move the **header comment 1-74 verbatim** to it, followed by one added sentence: "The
   geodesic code is split over the modules of `src/world-objects/geodesic/`; this module holds the object types,
   constants, constructors and small geometry helpers they share." Give `geodesicCannon.ts` the new header: "Facade that
   re-exports the geodesic modules of `src/world-objects/geodesic/` under their old names while they are being split
   (job 25); it will be deleted." Move the `objects` names of the table below.
3. Create `geodesic/portalWord.ts`, `geodesic/development.ts`, `geodesic/trace.ts`; move their names.
4. `npx vitest run tests/world-objects/geodesicCannon.test.ts tests/world-objects/geodesicTracingKernel.test.ts tests/world-objects/geodesicPortalWord.property.test.ts`.
5. Update the doc references of moved symbols (Decision 10), then the end-of-Part checks and commit.

### Part B: endpoints, segments, intersections, lifecycle

1. Create `geodesic/intersections.ts`, `geodesic/endpoints.ts`, `geodesic/segments.ts`, `geodesic/lifecycle.ts` (in
   this order) and move their names.
2. Run the same three test files, then `npx vitest run tests/world-objects tests/render-contract tests/runtime`.
3. Doc references, end-of-Part checks, commit.

### Part C: intervals, curve shortening, legacy, cannon; the import rule

1. Create `geodesic/intervals.ts`, `geodesic/curveShortening.ts`, then `geodesic/legacyConnection.ts`, then
   `geodesic/cannon.ts`, and move their names. While moving `rebuildConnectedGeodesicBetweenEmitters`, extract
   `rebuildLegacyConnectedGeodesic` (Decision 8). After this step `geodesicCannon.ts` contains only its header and
   re-export statements.
2. Add the module import rules (Decision 6). New test `tests/docs/moduleImportRules.test.ts` that imports
   `../../scripts/docs/lib.mjs` the way `tests/docs/documentation.test.ts` loads `checks.mjs` (through a variable path)
   and calls `moduleImportRuleViolations` with a hand-made `Map` of three fake modules:
   `a.ts` imports `world-objects/geodesic/legacyConnection.ts` (not allowed) → exactly 1 violation naming `a.ts`;
   `world-objects/geodesic/cannon.ts` imports it → no violation; `world-objects/geodesic/portalWord.ts` imports
   `world-objects/runtimeObjectRegistry.ts` → exactly 1 violation.
3. Run the geodesic test files, `npx vitest run tests/docs`, then the end-of-Part checks; commit.

### Part D: split the geodesic test file

Create `tests/world-objects/geodesic/` with these files (line numbers of the `it`/`describe` lines in
`tests/world-objects/geodesicCannon.test.ts` at `0b468e1`; search by test name):

| New file | Tests moved |
| --- | --- |
| `fixtures.ts` | all helpers :3267-3636 (`createKinkPairScenario` ... `createSymmetricPairScenario`), each `export`ed |
| `trace.test.ts` | :59 "traces an open one-meter horizontal segment" through :488 "extends open tails and refuses wall-hit tails", and :3252 "rejects zero directions" |
| `cannon.test.ts` | :511 through :720 (without the skipped :624), :1532 through :1658 (without the skipped :1603) |
| `carry.test.ts` | :799 through :1462 (without the skipped :839), and the describe "loop words under anchor portal crossings (job 05)" :1740-2012 |
| `curveShortening.test.ts` | :1691 and :2014 through the end of the describe "curve shortening at any frame rate (job 06)" (:2776) |
| `intersections.test.ts` | :2969, :2988, :3024 and :3057 through :3228 |
| `legacyConnection.test.ts` | the 8 skipped tests :624, :755, :839, :1603, :2778, :2823, :2862, :2914 |

Each new file gets the imports its tests use (from the new modules directly, not the facade) and its own
`describe("<module> ...")` wrapper. Delete `tests/world-objects/geodesicCannon.test.ts`. Check:
`npx vitest run tests/world-objects/geodesic` reports **82 passed and 8 skipped**, and the list of test names
(`--reporter=verbose`) equals the old file's list. Also move `geodesicTracingKernel.test.ts` and
`geodesicPortalWord.property.test.ts` into `tests/world-objects/geodesic/` (fix their relative imports only). End-of-Part
checks; commit.

### Part E: repoint importers and delete the facade

1. Change every import from `world-objects/geodesicCannon` (list under "Before you start") to the module that now
   declares the name. Only import lines change.
2. Delete `src/world-objects/geodesicCannon.ts`. In `scripts/docs/lib.mjs#moduleImportRules` replace the allowed importer
   `"world-objects/geodesicCannon.ts"` by `"render/three/geodesicCannonTools.ts"` (the tools use
   `isGeodesicStraightening` and `hasStraighteningIncidentGeodesic`).
3. Fix remaining doc references and `_docs/coding_style.md:91` (Decision 10). Update `_docs/ARCHITECTURE.md`: one
   paragraph listing the modules of `src/world-objects/geodesic/` and their order (Decision 2).
4. `npm run typecheck`, `npm test`, `npm run docs:generate`, `npm run docs:check`, `npm run build`, smoke; commit.

### Module assignment (every top-level declaration of `geodesicCannon.ts` at `0b468e1`)

"E" = exported today (re-export from the facade in Parts A-C). "+export" = private today, must become exported (with
JSDoc) because another module needs it. Everything else stays private in its module.

| Module (Part) | Header (first sentence) | Names (line at `0b468e1`) |
| --- | --- | --- |
| `objects.ts` (A) | moved header 1-74 (step A2) | E: `GeodesicCannonObject` :102, `GeodesicEmitterConnection` :124, `GeodesicPortalTraversal` :138, `GeodesicCarryPortalTransition` :146, `GeodesicEndRole` :151, `GeodesicHalfRole` :158, `GeodesicEndpointAttachment` :161, `GeodesicEndpointSelection` :168, `FreeGeodesicEndObject` :177, `GeodesicIntervalObject` :193, `CurveShorteningPairObject` :212, `LiftedGeodesicEndpoint` :234, `GeodesicTraceBuildResult` :254, `GeodesicSegmentObject` :271, `GeodesicIntersectionObject` :300, `GeodesicSegmentTerminal` :319, `CreateGeodesicCannonOptions` :334, `TraceGeodesicSegmentResult` :371, `PlaceGeodesicCannonResult` :544, `geodesicRayBeamHeightMeters` :562, `geodesicRayBeamStartOffsetMeters` :564, `GEODESIC_MIN_LENGTH_METERS` :566, `minGeodesicSegmentLengthMeters` :576, `createGeodesicCannonObject` :614, `isGeodesicSegmentObject` :687, `isGeodesicIntersectionObject` :692, `isGeodesicCannonObject` :697, `isGeodesicIntervalObject` :702, `isFreeGeodesicEndObject` :707, `isCurveShorteningPairObject` :712, `createFreeGeodesicEndObject` :721, `createGeodesicIntervalObject` :742, `createCurveShorteningPairObject` :777, `getGeodesicSegmentEnd` :1265, `canExtendGeodesicSegment` :1270, `resolveGeodesicCannonAimYawRadians` :1281. +export: `defaultTraceLengthMeters` :568, `intersectionTolerance` :574, `emitterConnectionToleranceMeters` :580, `getGeodesicCannonEmitterPoint` :3151, `canObjectAttachGeodesics` :3159, `getAnchorBeamPoint` :3164, `getOppositeEndRole` :3170, `directionFromYaw` :6081, `normalizeHorizontalDirection` :6085, `sanitizeYaw` :6139. Private: `defaultCannonCollision` :556, `yawFromPose` :6134. |
| `portalWord.ts` (A) | "Portal-word algebra of geodesic intervals: reversal, free reduction, comparison, role-aware sub-words and the update of a word when an anchor crosses a portal; pure, no registry access." | E: `reverseGeodesicPortalWord` :911, `getPortalWordBetweenEndpointRoles` :2281, `applyAnchorCrossingTraversals` :2657. +export: `collectPortalWordFromTraces` :2398, `samePortalWord` :2419, `portalTraversalFromCarryTransition` :2566, `getPortalTraversalFromSource` :2577, `portalWordAfterAnchorCrossing` :2633, `reduceAdjacentInversePortalTraversals` :2674. Private: `portalTraversalsAreInverse` :2689. Imports from `objects.ts`: types only. |
| `development.ts` (A) | "Development of portal words: inverse portal transforms, cached per compiled portal (a compiled world is immutable, so a WeakMap keyed by portal is always valid); pure." | +export: `inversePortalTransform` :990. Private: `inversePortalTransforms` :988. |
| `trace.ts` (A) | "Tracing a horizontal geodesic ray through a compiled cell complex: the single-cell tracer, the multi-cell walk on the segment-walk kernel, and forbidden-zone (open-disk) and emitter hits." | E: `TraceGeodesicSegmentInput` :347, `TraceGeodesicSegmentWithEmittersInput` :362, `traceGeodesicSegment` :1309, `traceGeodesicSegmentWithEmitters` :1438, `findNearestEmitterHitOnTrace` :1471, `geodesicTerminalFromWalkPiece` :1533. +export: `traceGeodesicPathForConnectionMode` :1566, `traceTerminalToBuildTerminal` :2699. Private: `forbiddenZoneCircleToleranceMeters` :570, `maxGeodesicWalkCrossings` :572, `traceGeodesicSegmentForConnectionMode` :1516, `intersectRayWithForbiddenZone` :6096. |
| `intersections.ts` (B) | "Geodesic intersection markers: crossings of segments in the same cell, stable marker identities between updates, and the per-registry marker memory." | E: `updateGeodesicIntersectionObjects` :5433, `getRememberedGeodesicIntersectionObject` :5459, `pruneMissingGeodesicIntersectionObjects` :5467. Private: `vertexContinuityToleranceMeters` :578, `geodesicAnchorCrossingToleranceMeters` :582, `geodesicIntersectionBalloonHeightOffsetMeters` :584, `geodesicIntersectionMemoryByRegistry` :603, `findGeodesicIntersections` :5779, `crossingIsAtGeodesicAnchor` :5843, `assignGeodesicIntersectionIdentities` :5857, `findContinuityMatchedIntersection` :5877, `sameGeodesicPair` :5903, `distanceBetweenIntersectionTargets` :5907, `createGeodesicIntersectionId` :5913, `getGeodesicIntersectionMemory` :5923, `createGeodesicIntersectionObject` :5933, `intersectHorizontalSegments` :5963, `sanitizeIdPart` :6013. |
| `endpoints.ts` (B) | "Endpoint attachments of geodesic intervals: lookup by anchor, re-attachment, lifting the far endpoint into the source cell, word-against-cell-chain checks, and emitter cache cleanup." | E: `getGeodesicEndpointAttachmentsForAnchor` :810, `getGeodesicEndpoints` :821, `replaceGeodesicEndpointAttachment` :837, `getGeodesicPortalWord` :897, `liftGeodesicEndpoint` :936, `geodesicHasNonzeroLiftedDisplacement` :1058, `resolveGeodesicEndpointSelectionFromSegmentHit` :1995. +export: `liftGeodesicEndpointWithAnchors` :1001, `portalWordMatchesCurrentEndpointCells` :2593, `portalWordMatchesEndpointCellsWithAnchors` :2603, `isAimableFreeGeodesic` :2899, `removeUnusedFreeGeodesicEnds` :3174, `collectIncidentGeodesicIdsForEmitter` :4879, `removeGeodesicAssociations` :5600, `findSourceEmitterForGeodesic` :5751. Private: `removeGeodesicAssociationFromEmitter` :5610. |
| `segments.ts` (B) | "Derived geodesic segments: lookup by geodesic, building segments from traces with the start/end half split, lengths, tangents at anchors, display numbers and the emitter-side caches." | E: `removeGeodesicIntervalAndDerivedObjects` :875, `getGeodesicSegments` :1076, `getGeodesicTail` :1087, `resolveGeodesicNumber` :1179, `splitDerivedSegmentsIntoEndpointHalves` :1944, `resolveEndpointTangentAtAnchor` :2014, `collectGeodesicMenuRowsForEmitter` :2383, `collectGeodesicPortalWord` :4409. +export: `withAnchoredTargetTerminal` :2737, `withAnchoredTargetTerminalForAnchors` :2747, `replaceDerivedSegmentsFromTraces` :2771, `buildDerivedSegmentsFromTraces` :2786, `segmentToTrace` :2828, `getGeodesicTotalLengthMeters` :2893, `syncLegacyEmitterGeodesicFields` :2913, `createSegmentFromTrace` :5484, `createGeodesicSegmentTooltip` :5514, `canConnectGeodesicSegmentAtDistance` :5542, `distanceAlongSegment` :5570, `totalLengthThroughSegment` :5578, `totalGeodesicLengthFromSegments` :5588, `removeGeodesicSegments` :5593. Private: `resolveDerivedSegmentConnectionState` :2812, `getGlobalGeodesicNumbers` :6019, `pushUniqueId` :6072. |
| `lifecycle.ts` (B) | "Queries whether a geodesic is locked or connected, and removal of geodesics and cannons together with their derived objects." | E: `getGeodesicConnection` :1102, `isGeodesicLocked` :1145, `collectLockedIncidentGeodesicIdsForEmitter` :1170, `removeGeodesic` :1186, `removeUnlockedGeodesicsFromCannon` :1197, `removeGeodesicCannonAndSegments` :1231. |
| `intervals.ts` (C) | "Interval rebuilds: realizing an interval's lifted chord, aiming free geodesics, splitting at a segment hit, rebuilding locked intervals after a carried anchor moved, and side-effect-free previews." | E: `traceGeodesicFromLiftedChord` :1673, `aimFreeGeodesicFromEndpoint` :1734, `rebuildDerivedGeodesicSegments` :1852, `splitGeodesicIntervalAtSegmentHit` :2050, `rebuildLockedGeodesicFromEndpointsAndPortalWord` :2169, `updateLockedGeodesicPortalWordForCarriedAnchorTraversal` :2229, `updateLockedGeodesicPortalWordForCarriedAnchorTraversals` :2248, `updatePortalWordForMovedEndpoint` :2302, `previewRebuildGeodesicInterval` :2324. +export: `lockedIntervalRebuildHitsForbiddenZone` :1897, `previewGeodesicIntervalHitsForbiddenZone` :4642, `previewGeodesicIntervalIsDegenerate` :4679. Private: `resolveCarriedIntervalPortalWord` :2436, `resolveCarriedPortalTraversalFromAnchorMotion` :2489, `carriedTransitionMatchesAnchorMove` :2538, `traceTerminalToBuildTerminalForInterval` :2720, `rebuildContinuationFromCut` :2841. |
| `curveShortening.ts` (C) | "Curve shortening: tie-and-detach of two endpoint roles into a curve-shortening pair, and the per-tick advance, fusion and failure handling of pairs." | E: `TieAndDetachGeodesicEndpointsRequest` :511, `AdvanceCurveShorteningPairsRequest` :530, `curveShorteningDefaultSpeedMetersPerSecond` :590, `curveShorteningFuseAngleToleranceRadians` :592, `curveShorteningFuseStepToleranceMeters` :594, `curveShorteningMinStepMeters` :596, `curveShorteningLengthIncreaseToleranceMeters` :601, `tieAndDetachGeodesicEndpoints` :3492, `advanceCurveShorteningPairs` :3800, `fuseCurveShorteningPair` :4096. Private: `absorbShortCurveShorteningHalf` :4220, `findEquivalentStableInterval` :4345, `discardCurveShorteningPairInFavorOf` :4371, `getPairFreeRoleForInterval` :4390, `uniqueIntervals` :4442, `resolvePairIntervals` :4452, `endpointDirectionAwayFromAnchor` :4472, `totalLengthForGeodesicIds` :4485, `cleanupCurveShorteningFailure` :4497, `restoreGeodesicIntervalsAndSegments` :4514, `cleanupCurveShorteningPreviewFailure` :4538, `removeDegenerateFreeLoop` :4620, `radiansToDegrees` :6147. |
| `legacyConnection.ts` (C) | "Legacy: the retired emitter-connection and same-cell straightening model; only the importers listed in `scripts/docs/lib.mjs` (`moduleImportRules`) may import it, and job 26 deletes it." | E: `TieAndDetachIncidentGeodesicsRequest` :499, `AdvanceStraighteningGeodesicsRequest` :522, `geodesicStraighteningSpeedMetersPerSecond` :586, `isGeodesicStraightening` :1161, `hasStraighteningIncidentGeodesic` :1220, `tieAndDetachIncidentGeodesics` :3443, `advanceStraighteningGeodesics` :3666. New export: `rebuildLegacyConnectedGeodesic` (Decision 8). +export: `markGeodesicConnected` :5644. Private: `geodesicStraighteningToleranceMeters` :588, `tieAndDetachIncidentGeodesicsLegacy` :3586, `resolveCarriedConnectedGeodesicPlan` :4707, `getCarriedEmitter` :4762, `resolveExplicitCarriedEmitterPortalTransition` :4771, `getExistingGeodesicPortalTransform` :4797, `isDrawableEndpointPair` :4817, `replaceConnectedGeodesicSegments` :4827, `resolveDetachedEndpoint` :4912, `createStraighteningSegment` :4928, `markStraighteningGeodesic` :4961, `moveStraighteningVertex` :5023, `straighteningHalfHitsForbiddenZone` :5049, `straightSegmentHitsForbiddenZone` :5058, `lockStraightenedGeodesic` :5079, `findCoincidentConnectedGeodesic` :5123, `sameEmitterPair` :5161, `segmentConnectsEndpoints` :5175, `unfoldIncomingEmitterPointToSourceCell` :5196, `getExistingPortalTransformsTowardCell` :5224. |
| `cannon.ts` (C) | "Emitter (cannon) operations: shooting, extending and re-aiming geodesics, connecting a geodesic to an emitter, rebuilding locked geodesics between emitters, and placing cannons on the floor, on a geodesic or at a geodesic vertex." | E: `ShootGeodesicInput` :382, `ExtendGeodesicInput` :398, `RebuildGeodesicToLengthInput` :411, `PlaceGeodesicCannonAtFloorPointRequest` :429, `PlaceGeodesicCannonOnGeodesicRequest` :440, `PlaceGeodesicCannonAtGeodesicVertexRequest` :454, `ConnectGeodesicToEmitterRequest` :467, `RebuildConnectedGeodesicBetweenEmittersRequest` :479, `placeGeodesicCannonAtFloorPoint` :648, `shootGeodesic` :2949, `extendGeodesic` :3013, `rebuildGeodesicToLength` :3053, `connectGeodesicToEmitter` :3206, `rebuildConnectedGeodesicBetweenEmitters` :3304, `placeGeodesicCannonOnGeodesic` :5263, `placeGeodesicCannonAtGeodesicVertex` :5320. Private: `rebuildUnlockedGeodesicToLength` :3063, `resolveCannonSnappedToEmitter` :3098, `resolveEmitterYawForGeodesic` :3147, `resolveCannonForGeodesic` :3182, `canSplitGeodesicSegmentAtDistance` :5533, `findSegmentsPassingThroughVertex` :5548. |
| `src/math/vec2.ts` / `vec3.ts` (A) | step A1 | replace `cross2` :6158 and `distanceSquared` :6151 (deleted) |

`legacyConnection.ts` imports `RebuildConnectedGeodesicBetweenEmittersRequest` as a **type** from `cannon.ts`
(type-only, so no runtime cycle). If typecheck shows that a name is needed by a module that comes **earlier** in the
order of Decision 2 than the module it is assigned to, stop and record it under `### Uncertain`; do not create a runtime
cycle to work around it.

## Tests and checks

- New: `tests/math/vec2.test.ts` (Part A), `tests/docs/moduleImportRules.test.ts` (Part C).
- Existing tests: unchanged except import lines (Parts D, E) and their location (Part D).
- After every Part: `npm run typecheck`, `npm test` (same pass/skip numbers as the baseline plus the new tests),
  `npm run docs:check` (after `npm run docs:generate` if stale), `npm run build`,
  `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.
- Manual browser check (record if not run): in `?config=full`, place two cannons, shoot a geodesic, carry a cannon through
  a portal, tie-and-detach a loop. Behaviour must be as before.

## Do not

- Do not change any logic, constant value, error message, id format or comment wording (except the facade header, the
  one added sentence in `objects.ts`, and the new JSDoc lines).
- Do not use `export *` in the facade; do not let the facade export a name that is not exported today.
- Do not split or move `geodesicCannonTools.ts`, and do not start the tool reducer (Decision 9).
- Do not delete legacy code (job 26) and do not change the intersection algorithm or the registry (job 27).
- Do not touch the other duplicated 2-D helpers outside the geodesic code (`staticPortalPathCull.ts`, `developedDisk.ts`,
  `sweptCollision.ts`, `measureLengthTool.ts`, `runtimeSceneUtils.ts`).
- Do not add entries to `scripts/docs/layering-baseline.json`.

## Done when

- [ ] `src/world-objects/geodesicCannon.ts` no longer exists; the 12 modules of the table exist; none is longer than about
      1,100 lines (`legacyConnection.ts` and `curveShortening.ts` are the largest).
- [ ] `src/math/vec2.ts` exists with tests; no private `cross2` or `distanceSquared` remains in the geodesic modules.
- [ ] `npm run docs:check` contains the `"module import rules"` check; importing `legacyConnection.ts` from any module
      other than `geodesic/cannon.ts` and `render/three/geodesicCannonTools.ts` fails it.
- [ ] `tests/world-objects/geodesicCannon.test.ts` is replaced by `tests/world-objects/geodesic/*.test.ts` with the same
      82 passing and 8 skipped tests.
- [ ] Five commits (Parts A-E), each with typecheck, test, docs:check, build and smoke green.
- [ ] `_docs` references point to the new files; `_docs/ARCHITECTURE.md` lists the modules.
- [ ] Report written per [README](README.md); the job moves to `_done/`. No issue to close. Under `### Not done`, mention
      the tool reducer (Decision 9) so the coordinator can place it in job 31 or 33.

## Report

### Done
Five commits, one per Part: A `6059f0e`, B `2f6aff5`, C `0f9b6ab`, D `3ee49cc`, E `99b93f4`.

- A: `src/math/vec2.ts` (+ `distanceSquaredVec3` in `src/math/vec3.ts`, `tests/math/vec2.test.ts`, 4 tests); private `cross2` and
  `distanceSquared` replaced; modules `objects`, `portalWord`, `development`, `trace`.
- B: `intersections`, `endpoints`, `segments`, `lifecycle`.
- C: `intervals`, `curveShortening`, `legacyConnection`, `cannon`; `rebuildLegacyConnectedGeodesic` extracted verbatim into
  `legacyConnection.ts` (Decision 8); `moduleImportRules` / `moduleImportRuleViolations` in `scripts/docs/lib.mjs`,
  `checkModuleImportRules` ("module import rules") in `scripts/docs/checks.mjs`, `tests/docs/moduleImportRules.test.ts` (2 tests).
- D: `tests/world-objects/geodesicCannon.test.ts` split into `tests/world-objects/geodesic/{trace,cannon,carry,curveShortening,intersections,legacyConnection}.test.ts`
  plus `fixtures.ts`; `geodesicTracingKernel.test.ts` and `geodesicPortalWord.property.test.ts` moved there. The JSON reporter lists of
  test names (status, nesting, title) are identical before and after: 82 passed, 8 skipped (all 8 in `legacyConnection.test.ts`).
- E: 24 importers repointed (only import lines), `geodesicCannon.ts` deleted, the legacy importer rule now allows
  `render/three/geodesicCannonTools.ts` and `world-objects/geodesic/cannon.ts`; `_docs/ARCHITECTURE.md` has a paragraph on the modules;
  `_docs/coding_style.md` line 91 points to `geodesic/trace.ts`; doc references (`MATHEMATICAL_MODEL.md`, `ARCHITECTURE.md`) were rewritten per Part.
- Moves were done by a script (TypeScript AST) that cuts each declaration with its leading comments and computes the imports; no logic edited.
  The module dependency graph (runtime imports) has no cycle; the only `objects -> portalWord` runtime edge is the one Decision 2 expects
  (`portalWord` imports only types from `objects`).
- Module sizes (lines): objects 625, portalWord 183, development 20, trace 481, intersections 327, endpoints 412, segments 518, lifecycle 163,
  intervals 935, curveShortening 1034, legacyConnection 1045, cannon 794.

### Deviations
- Job 37 had already landed, so baseline counts were 117 files / 894 passed / 8 skipped (job text says 116/883). End state: 123 passed + 1
  skipped file (`legacyConnection.test.ts`, all tests skipped), 900 passed, 8 skipped (894 + 4 vec2 + 2 import-rule tests).
- Each new test file wraps its tests in `describe("geodesic cannon world objects: <module>", ...)` instead of the old single
  `describe("geodesic cannon world objects", ...)` (the job asks for one wrapper per file); test names and bodies are unchanged.
- `defaultTraceLengthMeters`, `intersectionTolerance`, `emitterConnectionToleranceMeters` and `sanitizeYaw` became exported (they are in the
  job's "+export" list); `sanitizeYaw` had only a `//` comment, so I added a JSDoc line from it.
- One extra comment edit: the header of `src/render/three/geodesicCannonTools.ts` named the deleted module `world-objects/geodesicCannon`; it now says `world-objects/geodesic/`.
- New files use LF line endings (the old `geodesicCannon.ts` had mixed CRLF/LF).

### Uncertain
- The manual browser check (`?config=full`: place two cannons, shoot, carry through a portal, tie-and-detach a loop) was not run; the automated
  smoke test for the four worlds passes after every Part.
- The `mayImportOnly` rule for `trace.ts` lists `movement/` as allowed although `trace.ts` does not import it today (as the job specified).

### Not done
- The tool state machine (old stage 4: a pure `step(state, registry, input) -> { state, effects }` reducer for
  `src/render/three/geodesicCannonTools.ts`, Decision 9) is out of scope; the coordinator should place it in job 31 or 33.
- Other duplicated 2-D helpers (`staticPortalPathCull.ts`, `developedDisk.ts`, `sweptCollision.ts`, `measureLengthTool.ts`, `runtimeSceneUtils.ts`) are left for jobs 32/33.
- Older open issues under `_issues/` still cite line numbers in `geodesicCannon.ts` (not checked by `docs:check`); not updated.

### Checks
Baseline: `npm run typecheck` ok, `npm test` 117 files, 894 passed, 8 skipped, `npm run docs:check` ok.
After every Part (A-E): `npm run typecheck` ok; `npm test` ok (A 898/8, B 898/8, C 900/8, D and E 900/8 passed/skipped); `npm run docs:check` ok
(after `npm run docs:generate`; from Part C includes "module import rules"); `npm run build` ok; `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`
"SMOKE OK (4 page(s))" every time (no flake seen). No push.
