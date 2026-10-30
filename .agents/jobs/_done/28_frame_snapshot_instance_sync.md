# Job 28 - Sync runtime-object instances once per frame against the rendered root

Status: done, needs review on 2026-10-29 (commit f63528d).
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [71](../../_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md).

## Goal

1. Each frame computes its portal-render values **once**, from one **frame snapshot** that records the root cell the
   visible paths were computed for (theme 7 of [issue 50](../../_issues/50_deep_code_audit_2026_10_09_index.md)).
2. Runtime-object instances are written **exactly once per frame**, from that snapshot, so they always use the root
   that is actually rendered (also in single-view XR when the eye is re-rooted through a portal) and the per-eye /
   `renderFromRoot` camera positions.
3. Render records are collected once per sync, not twice, and an unchanged object reuses its records (ghosts included).
4. The runtime object registry has a version counter; the selectable-hitbox debug meshes are rebuilt only when the
   registry version, the cell roots or the debug options change.

## Depends on

- [Job 37](37_object_owners_and_place_at.md) (objects own their position): it changes `runtimeObjectRegistry.ts`
  (`claimOwnership` publisher) and the setup code of `createThreeApp.ts`. The version counter of this job must count
  the publisher's writes (Decision 4).
- Jobs [25](25_split_geodesic_cannon_modules.md)-[27](27_geodesic_rebuild_performance.md) (geodesic chain): job 25
  splits `geodesicCannonTools.ts`, which holds one of the deps interfaces this job rewires (Step 6).
- Jobs [21](21_per_frame_visibility_funnel.md)-[23](23_stereo_split_root_correctness.md) run earlier and change
  `syncPortalInstanceRender` / `syncStereoPortalInstanceRender`. Build the snapshot at the place where those functions
  write the **cell** instances, wherever that ends up.

**Line numbers below are at commit `0b468e1`. The jobs above shift them; search by function name.**

## Before you start

| File | Lines at `0b468e1` | What to look at |
| --- | --- | --- |
| `src/render/three/createThreeApp.ts` | 1-59 | module header; "Frame loop" list (update it in Step 8) |
| | 852-919 | shell state: `runtimeObjectRenderRoot`, `runtimeObjectRenderSourcesByKey`, `runtimeObjectFootprintCache` (:860, see the TDZ note), `latestVisibleResult` (:882), `portalEyeRenderStates`, `portalInstanceRenderState`, `visibleCellId` |
| | 957-1005, 1065-1101 | `createDebugVisualization`, `createToolObjectRuntimes`, `createGeodesicCannonTools`: both factories get `syncRuntimeObjectPortalInstances` and `syncSelectableHitboxDebug` as deps |
| | 1103-1106, 1153-1183 | initial build (`rebuildCellMeshes`, `syncPortalInstanceRender`), world objects, the setup sync at :1181 |
| | 1243-1254, 1283-1559 | `renderFrame` (`aimFrameSerial += 1` at :1245), `renderFrameUnguarded`; hitbox call :1481; portal pass :1511-1520; **second sync :1522**; UI phase :1527-1534; render :1538 |
| | 1581-1621 | `commitWorldGeometrySnapshot` (sync at :1608-1612) |
| | 1830-1866 | `applyDebugSettings` (sync :1862-1863, then `renderer.render` :1865) |
| | 2376-2445 | `rebuildCellMeshes` |
| | 2447-2651 | `resolvePortalEyeRenderRoot`, `syncPortalInstanceRender` (no-table branch :2476-2491), `syncStereoPortalInstanceRender` (no-table :2540-2557, empty result :2637-2650) |
| | 2669-2734 | `applyPortalVisibleResult` (:2679 join, :2684 sync), `applyPortalVisiblePaths` (:2696 sync), `createPortalInstanceRenderStateFromVisibleResult` (:2715 second join) |
| | 2765-2963 | `syncRuntimeObjectPortalInstances`, `runtimeObjectCameraPosition`, `syncRuntimeObjectRenderSources`, `runtimeObjectFootprintRadius`, `collectRuntimeObjectRenderRecords`, `getRuntimeObjectVisiblePaths` |
| | 557, 682, 2284, 3022, 3067, 3107, 3230, 3241-3242, 3254-3255, 3664-3665 | event-driven `syncRuntimeObjectPortalInstances()` / `syncSelectableHitboxDebug()` calls |
| `src/render/three/renderPortalInstances.ts` | 123-186, 237-324 | `groupVisiblePortalPathsByDestinationCell`, `buildVisiblePathsByDestinationCell`, `flattenVisiblePortalPathGroups`, `updateRuntimeObjectRenderArchetypeInstances` (do not change its behaviour) |
| `src/render/three/runtimeObjectRenderArchetypes.ts` | all (153) | archetype build/dispose, grouping, capacity |
| `src/render/three/runtimeObjectRenderRecords.ts` | all (112) | records, `collectRuntimeObjectRenderSourceMeshes`, `computeRenderSourceFootprintRadius` |
| `src/render/three/runtimeObjectGhostRecords.ts` | all | `collectPortalGhostRuntimeObjectRenderRecords` (job 17) |
| `src/render/three/playerRoverModel.ts` | 33-109 | `collectRecords` ignores its `options` |
| `src/render/three/geodesicCannonRenderer.ts` | 59-160 | `collectGeodesicRuntimeRenderRecords` |
| `src/render/three/debugVisualization.ts` | all (160) | `syncSelectableHitboxDebug` disposes and rebuilds everything |
| `src/render/three/toolObjectRuntimes.ts` | 58-61, 176-189 | deps; `invalidateRuntimeObjectRenderState` deletes sources and archetypes directly |
| `src/render/three/geodesicCannonTools.ts` | 155-157, 835-879 | deps; `updateCarriedGeodesicCannonPose` syncs **every frame** while carrying |
| `src/world-objects/runtimeObjectRegistry.ts` | 122-257 | interface and `createRuntimeObjectRegistry` (after job 37 also `claimOwnership`) |
| `tests/render-contract/runtimeObjectPortalInstances.test.ts` | 329-354 | `createArchetype`, `readMatrix` helpers to copy |
| `tests/render-contract/runtimeObjectGhostRecords.test.ts` | top | `twoRoomsWithPortal()` world helper to copy |
| `tests/world-objects/runtimeObjectRegistry.test.ts` | all | registry tests to extend |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`,
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

## Background

### What happens today (verified at `0b468e1`)

One desktop frame, in order:

1. Tool dispatch (`renderFrameUnguarded` :1386-1441). Tools call `syncRuntimeObjectPortalInstances()` through their
   deps; while a cannon is carried this happens **every frame** (`geodesicCannonTools.ts:877`). These calls use
   `getRuntimeObjectVisiblePaths()`, i.e. **last frame's** visible result joined against the table of the **current**
   `playerPose.cellId`.
2. Portal pass (:1511-1520). `applyPortalVisibleResult` (mono, :2684) or `applyPortalVisiblePaths` (stereo, :2696)
   sync the objects with the correct paths and per-eye camera positions.
3. :1522 syncs **again** with default arguments, overwriting step 2: paths from `getRuntimeObjectVisiblePaths()`,
   camera position from the main camera.

So the instance buffers are written 2 times per frame (3 or more while carrying a cannon or using a tool). Each sync
collects all records twice (`:2770` and inside `syncRuntimeObjectRenderSources` at `:2852`), allocates a `Matrix4` per
object (`:2909`), filters all archetype keys by string prefix for every object (`:2911-2912`), recomputes every
object's ghosts (`:2922-2927`), builds an unused player collision state for the rover (`:2936`), and disposes and
rebuilds every selectable-hitbox debug mesh when that debug option is on (`:2782`).

### Which issue 71 claims still hold

| Claim | At `0b468e1` |
| --- | --- |
| Second sync in `renderFrame` | **Holds** (:1522). |
| Records collected twice per sync | **Holds** (:2770, :2852). |
| `getRuntimeObjectVisiblePaths` joins against `playerPose.cellId` | **Holds** (:2942-2963, join at :2949). Visible effect remains only in **single-view XR with a re-rooted eye** (`portalCullingCameras.length <= 1`, :1513-1519): the final sync joins a result rooted in the neighbour cell against the source cell's table. On desktop the final sync runs after this frame's visibility, rooted in `playerPose.cellId`, so it is correct. |
| Aim joins stale paths on a portal-crossing frame | **Fixed by job 16**: aim walks the ray and no longer reads visible paths. Only the tool-phase instance syncs still join stale paths; step 3 overwrites them, so the cost is wasted work, not wrong output. |
| Aim calls `getRuntimeObjectVisiblePaths` 3-6 times per frame | **Fixed by job 16.** |
| Second call drops per-eye / `renderFromRoot` camera positions | **Holds** (default argument at :2767). |
| `syncSelectableHitboxDebug` on every sync | **Holds** (:2782; plus :1481 after curve shortening). |
| Ghosts recomputed per object per collection | **Holds**; since job 17 they come from `collectDevelopedDisk`, which is more expensive. |
| Rover collision state built and ignored | **Holds** (:2936; `playerRoverModel.ts:89` ignores `options`). |
| No registry version counter, no counter test, no mono-XR re-root test | **Holds.** |

`buildVisiblePathsByDestinationCell` also runs twice per mono frame (:2679 and again at :2715 for the debug state);
the snapshot removes the second run (issue 75 item 2).

### Temporal dead zone (read this)

`createThreeApp` is one long closure. Setup code runs **top to bottom**: `rebuildCellMeshes()` at :1104 and
`syncPortalInstanceRender()` at :1106 run long before the closure's later lines. A `const` or `let` declared further
down (for example next to the function that uses it) is in its temporal dead zone when setup calls that function, and
the production bundle crashes with "Cannot access 'X' before initialization". Typecheck and vitest do **not** catch it;
only `npm run build` + `npm run smoke` do (job 17 shipped exactly this bug, fixed in `1fa9ebc`). Every new `const` or
`let` in this job goes **before line 1103** (next to `latestVisibleResult` at :882 or `visibleCellId` at :920), never
next to its use.

## Decisions

1. **Frame snapshot.** Decided: a new module `src/render/three/frameRenderSnapshot.ts`:

   ```ts
   /** Portal-render values of one frame, computed once where the cell instances are written. */
   export interface FrameRenderSnapshot {
     /** `aimFrameSerial` of the frame (or of the setup / settings call) that built it. */
     readonly serial: number;
     /** Root cell the visible paths were computed for: the rendered root (eye 0's root in stereo). */
     readonly rootCellId: string;
     /** Visible paths per destination cell, as written to the cell archetypes (mono: table join; stereo: grouped union). */
     readonly visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
     /** The same paths flattened, de-duplicated by path id and sorted by id. */
     readonly objectPaths: readonly VisiblePortalPath[];
     /** `objectPaths` grouped by destination cell (input order kept): what runtime-object instancing reads. */
     readonly objectPathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
     /** Clip rows by path id for this frame (the live `portalClipData.clipIndexByPathId` map). */
     readonly clipIndexByPathId: ReadonlyMap<number, number>;
     /** Viewer positions in the render frame, one per eye (rover suppression). */
     readonly cameraPositions: readonly THREE.Vector3[];
   }
   export function createFrameRenderSnapshot(input: {
     serial: number; rootCellId: string;
     visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>;
     clipIndexByPathId: ReadonlyMap<number, number>; cameraPositions: readonly THREE.Vector3[];
   }): FrameRenderSnapshot;   // computes objectPaths = flattenVisiblePortalPathGroups(map) and
                              // objectPathsByDestinationCell = groupVisiblePortalPathsByDestinationCell(objectPaths)
   export function createEmptyFrameRenderSnapshot(serial: number, rootCellId: string): FrameRenderSnapshot;
   ```

   Why the two maps: today the cells use the table-joined map and the objects use the flattened, sorted, regrouped
   list (`:2684` then `:2772`). Keeping both keeps today's instance order bit for bit; issue 71 asks for correctness,
   not a new order.
2. **Who builds it, who reads it.** Decided:
   - Built in exactly three places, where the cell instances are written today: `syncPortalInstanceRender` (mono,
     replacing `applyPortalVisibleResult`), `syncStereoPortalInstanceRender` (replacing `applyPortalVisiblePaths`) and
     the "no table / no result" branches (`createEmptyFrameRenderSnapshot`). It is stored in a new shell variable
     `let latestFrameSnapshot: FrameRenderSnapshot | undefined` declared next to `latestVisibleResult` (:882).
   - Read by: the cell instances (`updatePortalVisiblePathInstances(snapshot.visiblePathsByDestinationCell)`), the
     debug state (`createPortalInstanceRenderStateFromVisibleResult` takes the snapshot's map instead of rebuilding it
     at :2715; this also fixes the stereo debug state, which today joins remapped ids against eye 0's table), and the
     runtime-object instance sync (Decision 3).
   - `getRuntimeObjectVisiblePaths` is **deleted**. Nothing may join visible paths against `playerPose.cellId`.
   - `latestVisibleResult` stays (debug overlay, XR debug state).
3. **Instance sync module.** Decided: move `syncRuntimeObjectPortalInstances`, `syncRuntimeObjectRenderSources`,
   `runtimeObjectFootprintRadius` and `collectRuntimeObjectRenderRecords` out of `createThreeApp.ts` into a new module
   `src/render/three/runtimeObjectInstanceSync.ts`, so the "once per sync" and "rendered root" rules can be unit-tested
   (there is no test harness for `createThreeApp`; vitest runs in `node` without a DOM or WebGL).

   ```ts
   export interface RuntimeObjectInstanceSyncDeps {
     readonly registry: RuntimeObjectRegistry;
     readonly runtimeObjectRootsById: ReadonlyMap<string, THREE.Object3D>;
     readonly renderSourcesByKey: Map<string, RuntimeObjectRenderSourceMesh>;        // shared with toolObjectRuntimes
     readonly renderArchetypesByKey: Map<string, RuntimeObjectRenderArchetype>;      // shared with toolObjectRuntimes
     readonly renderRoot: THREE.Object3D;                                            // runtimeObjectRenderRoot
     readonly geodesicRenderSources: readonly RuntimeObjectRenderSourceMesh[];
     readonly geodesicArchetypeKeys: readonly string[];
     readonly playerRoverRenderModel: PlayerRoverRenderModel | undefined;
     readonly maxVisiblePaths: number;
     readonly diagnostics: RuntimeObjectRenderArchetypeDiagnostics;
     getWorld(): CompiledCellComplex;
     getPlayerPose(): PlayerPose;
     /** Builds a new archetype; createThreeApp passes a closure that calls buildRuntimeObjectRenderArchetype with
      *  portalClipMaterialState and installs the onBeforeRender hook of :2875-2878. */
     buildArchetype(source: RuntimeObjectRenderSourceMesh, capacity: number): RuntimeObjectRenderArchetype;
   }
   export interface RuntimeObjectInstanceSync {
     /** Brings sources and archetypes up to date, collects records once and writes every archetype's instances from
      *  `snapshot.objectPathsByDestinationCell`, `snapshot.clipIndexByPathId` and `snapshot.cameraPositions`. */
     sync(snapshot: FrameRenderSnapshot): void;
     /** Counters for tests and diagnostics; never reset. */
     readonly stats: { readonly syncs: number; readonly recordCollections: number; readonly ghostComputations: number };
   }
   export function createRuntimeObjectInstanceSync(deps: RuntimeObjectInstanceSyncDeps): RuntimeObjectInstanceSync;
   ```

   `sync` does, in this order: (a) sync sources (today's `syncRuntimeObjectRenderSources` up to :2850, i.e. without
   its own record collection) and rebuild the prefix index (Decision 5); (b) `records = collectRecords()` **once**
   (`stats.recordCollections += 1`); (c) `grouped = groupRuntimeObjectRenderRecordsByArchetype(records)`; (d) create
   or grow archetypes from `grouped` (today's :2853-2881); (e) `diagnostics.reset()` and
   `updateRuntimeObjectRenderArchetypeInstances([...archetypes], grouped, snapshot.objectPathsByDestinationCell,
   diagnostics, snapshot.clipIndexByPathId, { cameraPositions: snapshot.cameraPositions })`; (f) `stats.syncs += 1`.
   It does **not** touch hitbox debug. The footprint cache (`runtimeObjectFootprintCache`) moves into the module
   (this also removes the TDZ hazard of :860).
4. **Registry version counter.** Decided: add to `RuntimeObjectRegistry`:

   ```ts
   /** Number of successful content changes since creation; starts at 0. Equal versions mean equal contents. */
   getVersion(): number;
   ```

   Increment by exactly 1 in: `add`; `update`; `remove` **only when the id existed**; `moveToCell` (it calls `update`,
   so it counts once; do not add a second increment); and **job 37's `claimOwnership` publisher**. Put the increment
   in the one internal "replace object" helper that both `update` and the publisher use; if job 37 implemented the
   publisher without such a helper, add the increment inside the publisher too. `claimOwnership` and
   `releaseOwnership` do not change contents and do **not** increment. A throwing call (unknown id, owned id) does not
   increment. Why: hitbox debug (this job) and the per-frame skips of job 29 compare versions; a publisher write that
   did not bump would leave creatures' and the marmot's hitboxes stale.
5. **Archetype keys by prefix.** Decided: in step (a) the module rebuilds
   `archetypeKeysByPrefix: Map<string, string[]>` once per sync from `renderSourcesByKey.keys()`, using
   `prefix = key.slice(0, key.lastIndexOf(":mesh:"))` (keys are `<prefix>:mesh:<index>`,
   `runtimeObjectRenderRecords.ts:32`). `collectRecords` reads `archetypeKeysByPrefix.get(runtimeObjectArchetypeKeyPrefix(object)) ?? []`
   instead of filtering all keys per object (:2911-2912). Rebuilding the index per sync is O(keys), not
   O(objects x keys). Do not try to maintain it incrementally: `toolObjectRuntimes.invalidateRuntimeObjectRenderState`
   deletes keys from the shared map directly.
6. **Per-object record cache.** Decided: the module keeps
   `recordCacheByObjectId: Map<string, { object: RuntimeWorldObject; world: CompiledCellComplex; archetypeKeys: readonly string[]; records: readonly RuntimeObjectRenderRecord[] }>`.
   For each registry object, reuse `cached.records` when `cached.object === object` (registry objects are immutable
   values, replaced on every change), `cached.world === deps.getWorld()`, and `cached.archetypeKeys` has the same
   strings in the same order as the current keys for its prefix. Otherwise rebuild (base records plus ghosts, as
   today at :2909-2928; `stats.ghostComputations += 1` when `collectPortalGhostRuntimeObjectRenderRecords` is called)
   and store. Geodesic objects use the same cache with `geodesicArchetypeKeys`. After the loop, delete cache entries
   whose id was not seen. The rover is not cached (its pose changes every frame). Why: issue 71 proposed change 3;
   identity is exact and cheaper than a version check (creatures change every frame, flags and cannons rarely).
7. **Rover options.** Decided: stop passing `{ ghostWorld, collision }` to `playerRoverRenderModel.collectRecords`
   (:2934-2937). Remove the unused `options` parameter and `PlayerRoverRenderRecordOptions` from
   `playerRoverModel.ts` if nothing else uses them (grep first).
8. **Exactly one sync per frame.** Decided: `runtimeObjectInstanceSync.sync(...)` has exactly **three** call sites in
   `createThreeApp.ts`:
   - the frame, once, where :1522 is today: `runtimeObjectInstanceSync.sync(currentFrameSnapshot())`;
   - setup, where :1181 is today (the warm-up render at :1201 needs instances);
   - `applyDebugSettings`, where :1862 is today (it calls `renderer.render` itself at :1865).

   `currentFrameSnapshot()` returns `latestFrameSnapshot ?? createEmptyFrameRenderSnapshot(aimFrameSerial, playerPose.cellId)`.
   `applyPortalVisibleResult` and `applyPortalVisiblePaths` no longer sync objects (delete or inline them).
   `commitWorldGeometrySnapshot` keeps `syncPortalInstanceRender()` (cell instances of the new world) but drops its
   object sync (:1609) and hitbox call (:1612): it runs at frame start and the same frame syncs later. Why: one write
   per frame is the acceptance criterion; the setup and settings calls are outside the frame loop.
9. **Event-driven sync requests.** Decided: every other caller **requests** instead of syncing. Add to the shell:

   ```ts
   let runtimeObjectInstanceSyncRequested = false;   // declared before line 1103
   let selectableHitboxDebugSyncRequested = false;   // declared before line 1103
   function requestRuntimeObjectInstanceSync(): void { runtimeObjectInstanceSyncRequested = true; }
   function requestSelectableHitboxDebugSync(): void { selectableHitboxDebugSyncRequested = true; }
   ```

   Pass them to `createToolObjectRuntimes` and `createGeodesicCannonTools` **under the existing dep names**
   (`syncRuntimeObjectPortalInstances: requestRuntimeObjectInstanceSync`, `syncSelectableHitboxDebug:
   requestSelectableHitboxDebugSync`) and update the two deps' doc comments to say "requests a sync; the frame performs
   it". Do not rename the deps in `toolObjectRuntimes.ts` or `geodesicCannonTools.ts` (job 25 splits the latter; keep the
   diff small). Replace the local calls at :557, :682, :2284, :3022, :3241, :3254, :3664 with
   `requestRuntimeObjectInstanceSync()` and :1481, :3067, :3107, :3230, :3242, :3255, :3665 with
   `requestSelectableHitboxDebugSync()`. The frame clears both flags after its sync. The instance sync runs every frame
   anyway; the flag is kept so job 29 can skip unchanged frames.
10. **When hitbox debug rebuilds.** Decided: `createDebugVisualization` gains

    ```ts
    /** Rebuilds the selectable-hitbox and aim-outline groups only when `forced` is true or the registry version,
     *  the cell-roots generation, the world, the debug level or the debug options (by reference) differ from the last
     *  rebuild. Returns whether it rebuilt. */
    syncSelectableHitboxDebugIfChanged(input: { registryVersion: number; cellRootsGeneration: number; forced: boolean }): boolean;
    ```

    It stores the last key; the unconditional `syncSelectableHitboxDebug` stays and also updates the stored key.
    `createThreeApp` adds `let cellRootsGeneration = 0` (before line 1103) and increments it at the **start** of
    `rebuildCellMeshes` (the old groups hang under the cell roots that function disposes). The frame calls
    `syncSelectableHitboxDebugIfChanged({ registryVersion: runtimeObjectRegistry.getVersion(), cellRootsGeneration,
    forced: selectableHitboxDebugSyncRequested })` right after the instance sync; setup calls it after the setup sync;
    `applyDebugSettings` keeps the unconditional `syncSelectableHitboxDebug()`. Known limit (write it in the JSDoc):
    worlds with moving creatures bump the version every frame, so with the debug option on the hitboxes still rebuild
    once per frame (down from twice); with the option off a rebuild only clears empty maps.
11. **Order of operations in `renderFrameUnguarded` after this job:**

    ```text
    0. timing; commitReadyWorldGeometrySnapshot()      // may call syncPortalInstanceRender(): sets latestFrameSnapshot,
                                                        // writes cell instances, no object sync
    1. input
    2. movement (playerPose may change cell)
    3. rig / camera pose; activeAimRay; carried cannon; tool dispatch; invalidateAimCache; context menu
         -> tools only REQUEST syncs (Decision 9)
    4. objects: creatures, flags' parents, curve shortening, measured lengths
         -> straightened geodesics REQUEST a hitbox sync (was :1481)
    5. visibility: updateVisibleCell, culling cameras, tooltips / help lens
    6. portal pass: syncStereoPortalInstanceRender(...) or syncPortalInstanceRender(...)
         -> computes visible paths, clip data, cell instances, debug state and latestFrameSnapshot (built once)
    7. runtimeObjectInstanceSync.sync(currentFrameSnapshot())       // the only object sync of the frame
       syncSelectableHitboxDebugIfChanged({ registryVersion, cellRootsGeneration, forced: selectableHitboxDebugSyncRequested })
       runtimeObjectInstanceSyncRequested = false; selectableHitboxDebugSyncRequested = false
    8. UI phase (unchanged)
    9. renderer.render(scene, camera); timings
    ```

    `frameAfterPortalMs` is taken after step 7, as today after :1522, so `portalMs` keeps its meaning.
12. **Camera positions.** Decided: mono: `[runtimeObjectCameraPosition(renderRoot.camera, renderRoot.renderFromRootMatrix)]`
    (today's :2518); stereo: one per eye (today's :2627-2629). They are stored in the snapshot, so the final sync no
    longer falls back to the main camera. (`runtimeObjectCameraPosition` still allocates; job 29 removes that.)

## Steps

Run `npx vitest run <file>` after each step as named, then `npm run typecheck`.

1. **Registry version** (Decision 4). Add `getVersion` to the interface (JSDoc required) and implementation; update the
   header comment ("Invariants: ... `getVersion` increases by one per content change"). Tests in
   `tests/world-objects/runtimeObjectRegistry.test.ts` (new `describe("version")`):
   - a new registry has version 0; `add` -> 1; `update` -> 2; `moveToCell` -> 3 (exactly one bump);
     `remove` of an existing id -> 4; `remove` of a missing id -> still 4; `update` of a missing id throws and leaves 4;
     `get`, `getAll`, `getObjectsInCell` leave it unchanged;
   - an initial list of 3 objects gives version 3;
   - job 37's publisher: `const publish = registry.claimOwnership(id)` leaves the version unchanged; `publish(next)`
     bumps it by 1; `releaseOwnership(id)` leaves it unchanged; a rejected `update` on an owned id leaves it unchanged.

   Run `npx vitest run tests/world-objects/runtimeObjectRegistry.test.ts`.
2. **Snapshot module** (Decision 1). Create `frameRenderSnapshot.ts` with a header comment and JSDoc on every export.
   New test file `tests/render-contract/frameRenderSnapshot.test.ts`:
   - from a map `{ "room-b": [path 3 (depth 1), path 1 (depth 0)], "room-a": [path 2] }`: `objectPaths` ids are
     `[1, 2, 3]`; `objectPathsByDestinationCell.get("room-b")` ids are `[1, 3]`; `visiblePathsByDestinationCell` is the
     input map (`toBe`);
   - the empty snapshot has no paths and keeps `rootCellId`.

   Build paths with `createRootVisiblePortalPath(cellId)` spread with `pathId`/`depth`, as in
   `runtimeObjectPortalInstances.test.ts`. Run that file.
3. **Instance sync module** (Decisions 3, 5, 6, 7). Create `runtimeObjectInstanceSync.ts` by **moving** the four
   functions; keep their logic except for the changes the decisions list. Do not change
   `updateRuntimeObjectRenderArchetypeInstances`. Remove the moved code and `runtimeObjectFootprintCache` from
   `createThreeApp.ts` in Step 4, not here (the shell still compiles with both until then).
   New test file `tests/render-contract/runtimeObjectInstanceSync.test.ts`. Setup shared by the tests:
   - `world = compileCellComplex(twoRoomsWithPortal())` (copy the helper from `runtimeObjectGhostRecords.test.ts`);
   - a registry with one creature object `{ id: "mouse-1", kind: "geo-mouse", cellId: "room-b",
     localPose: yawRigidTransform3(0, centreOfRoomB), portalRenderable: true }`, where `centreOfRoomB` is the average
     of room-b's base vertices at z = 0 (at the centre it has no ghosts); `runtimeObjectRootsById` maps it to a `THREE.Group` holding one `THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2))`;
   - `buildArchetype` = `(source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined)`;
     `playerRoverRenderModel: undefined`; `geodesicRenderSources: []`; `maxVisiblePaths: 4`.

   Tests:
   1. **One collection per sync:** three `sync(snapshot)` calls give `stats.syncs === 3` and `stats.recordCollections === 3`.
   2. **Record cache:** two syncs without registry changes: `stats.ghostComputations === 1`. After
      `registry.update({ ...mouse, localPose: <moved 0.1 m> })` and a third sync: `2`.
   3. **Rendered root:** a snapshot rooted in `room-b` whose `room-b` group holds a depth-0 path (identity matrix,
      `pathId` 0) and whose `room-a` group holds a depth-1 path (`pathId` 5, translation `(3, 0, 0)`): the mouse archetype
      gets exactly one instance, its clip index is `unclippedPortalClipIndex`, and its matrix equals
      `rigidTransformToThreeMatrix(mouse.localPose)` (read it back as in `readMatrix`). This is the "portal-crossing
      frame" criterion: the module uses only the snapshot's root and paths, never a player cell.
   4. **Mono XR re-root (issue 71 acceptance):** build snapshot A rooted in `room-b` with the depth-0 path at identity,
      and snapshot B with the same path premultiplied by a `renderFromRoot` matrix `R` (e.g.
      `new THREE.Matrix4().makeRotationY(0.3).setPosition(1, 0, -2)`) and camera position `R` applied to A's. Sync A,
      read instance 0 into `mA`; sync B, read `mB`. `mB` equals `R * mA` element-wise within 1e-6.
   5. **Camera positions are used:** a record with `suppressWithinCameraDistanceMeters` exists only for the rover, so
      test with a stub `playerRoverRenderModel` whose `collectSources()` returns one source (prefix
      `player-avatar:rover`) and `collectRecords()` returns one record at the origin with
      `suppressWithinCameraDistanceMeters: 2` and `omitRootVisiblePath: true`, on a depth-1 path at identity: with
      `cameraPositions: [new THREE.Vector3(0, 0, 0)]` the rover archetype count is 0; with `[new THREE.Vector3(10, 0, 0)]` it is 1.
   6. **Prefix index:** with two objects whose ids share a prefix (`mouse-1` and `mouse-10`), each gets only its own
      archetype keys (records of `mouse-1` never use a `geo-mouse:mouse-10:mesh:*` key).

   Run `npx vitest run tests/render-contract/runtimeObjectInstanceSync.test.ts tests/render-contract/runtimeObjectPortalInstances.test.ts`.
4. **Wire the shell** (Decisions 2, 8, 11, 12). In `createThreeApp.ts`:
   - Declare `let latestFrameSnapshot` next to `latestVisibleResult` (:882) and create
     `const runtimeObjectInstanceSync = createRuntimeObjectInstanceSync({...})` right after `portalClipMaterialState`
     (:875-879), i.e. **before line 1103**. Its `buildArchetype` closure uses `portalClipMaterialState` and
     `activatePortalRenderStateForCamera` (a function declaration, so it is hoisted).
   - In `syncPortalInstanceRender`: after `latestVisibleResult` is set, build the table-joined map **once**
     (`buildVisiblePathsByDestinationCell(table.pathsByDestinationCellId, latestVisibleResult.visiblePathById)`), call
     `portalClipData.update(latestVisibleResult.paths)`, `updatePortalVisiblePathInstances(map)`, set
     `latestFrameSnapshot = createFrameRenderSnapshot({ serial: aimFrameSerial, rootCellId: renderRoot.rootCellId,
     visiblePathsByDestinationCell: map, clipIndexByPathId: portalClipData.clipIndexByPathId, cameraPositions: [...] })`
     and build `portalInstanceRenderState` from `latestFrameSnapshot.visiblePathsByDestinationCell` (change
     `createPortalInstanceRenderStateFromVisibleResult` to take the map instead of rebuilding it).
   - In `syncStereoPortalInstanceRender`: `map = groupVisiblePortalPathsByDestinationCell(unionVisiblePaths)` after
     `portalClipData.updateStereo(...)`; `updatePortalVisiblePathInstances(map)`; snapshot with
     `rootCellId: portalEyeRenderStates[0]?.rootCellId ?? playerPose.cellId` and the per-eye camera positions; debug
     state from `map`.
   - In the three no-table / no-result branches: `latestFrameSnapshot = createEmptyFrameRenderSnapshot(aimFrameSerial, <root cell id of that branch>)`.
   - Delete `applyPortalVisibleResult`, `applyPortalVisiblePaths` (or keep them without the object sync if that is
     smaller), `getRuntimeObjectVisiblePaths`, the moved functions and `runtimeObjectFootprintCache`.
   - Replace :1522 with step 7 of Decision 11; replace :1181 with `runtimeObjectInstanceSync.sync(currentFrameSnapshot())`
     followed by `syncSelectableHitboxDebugIfChanged({ ..., forced: true })`; in `applyDebugSettings` replace :1862
     with the sync (keep :1863); in `commitWorldGeometrySnapshot` remove :1609 and :1612.

   Run `npm run typecheck` and `npx vitest run tests/render-contract`.
5. **Hitbox gate** (Decision 10). Implement `syncSelectableHitboxDebugIfChanged` in `debugVisualization.ts` and
   `cellRootsGeneration` in the shell. New test file `tests/render-contract/debugVisualization.test.ts` with deps:
   a real registry holding one object with an `interactable` (so `buildSelectableHitboxDebugMesh` returns a mesh; read
   `debugHitboxMeshes.ts` to pick an object that yields one), `dynamicObjectRuntimes: []`, `cellMeshes` with a
   `THREE.Group` per cell of `twoRoomsWithPortal()`, debug level and options that make `hasActiveDebugOption(..., "selectable-hitboxes")`
   true (read `src/glue/debugOptions.ts`):
   1. first call with `{ registryVersion: v, cellRootsGeneration: 0, forced: false }` returns `true` and the cell
      group has one child; keep a reference to that child;
   2. a second identical call returns `false` and the child is the **same object** (`toBe`), i.e. nothing was disposed;
   3. after `registry.update(...)` (version + 1) it returns `true` and the child is a new object;
   4. `forced: true` with an unchanged key returns `true`;
   5. a new `cellRootsGeneration` returns `true`.

   Run that file.
6. **Requests** (Decision 9). Add the request flags and functions (before line 1103), pass them under the existing dep
   names, replace the local calls listed in Decision 9. After this step,
   `grep -n "syncRuntimeObjectPortalInstances\|getRuntimeObjectVisiblePaths" src/render/three/createThreeApp.ts` shows
   only the two dep-object keys, and `grep -n "runtimeObjectInstanceSync.sync(" src/render/three/createThreeApp.ts`
   shows exactly three lines. Run `npm run typecheck` and `npm test`.
7. **Rover options** (Decision 7). Run `npx vitest run tests/render-contract`.
8. **Docs.** Update the `createThreeApp.ts` module header "Frame loop" items 3-4 (snapshot; one object sync), the
   `State ownership` paragraph (`latestFrameSnapshot`), `_docs/ARCHITECTURE.md` "Order of work in each frame" (:119),
   and the header comments of the two new modules. Run `npm run docs:check`; if it reports stale generated documents,
   run `npm run docs:generate`.
9. **Final checks.** `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, then
   `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. A temporal-dead-zone crash shows only here
   (`Cannot access 'X' before initialization`); if you see it, move the named declaration above line 1103.

## Tests and checks

- New: `tests/render-contract/frameRenderSnapshot.test.ts`, `tests/render-contract/runtimeObjectInstanceSync.test.ts`
  (tests 1-6), `tests/render-contract/debugVisualization.test.ts` (tests 1-5); extended:
  `tests/world-objects/runtimeObjectRegistry.test.ts` (version).
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, smoke on the four worlds: all pass.
- Manual check (record as not run if no browser): `?config=full&world=cube&debugLevel=basic&debugOverlay=1&debugOverlayItems=fps`
  (if the overlay does not appear, enable it in the menu: settings > debug > overlay > FPS). Place 40 flags with the
  place-flag tool in the start cell, stand still for 10 s, and write down the `objects` and `portal` values of the
  `frame ms:` line, on the parent commit and after this job (issue 71 asks for the before/after numbers).
- Headset check (record as not run if no headset): single-view XR, lean the head through a portal next to a flag; the
  flag stays in place (no jump or disappearance).

## Bookkeeping

When the job is done: close issue 71 (move to `_issues/_closed/` with Outcome and Closing evidence: the commit, the
new tests, the manual numbers or "not run"). If the headset check was not run, set the job to "done, needs review" and
leave issue 71 open with a one-line pointer, as the README says.

## Do not

- Do not change `updateRuntimeObjectRenderArchetypeInstances`, the ghost rule, the dedupe or any instance order
  (that is job 29's territory).
- Do not join visible paths against `playerPose.cellId` anywhere.
- Do not call `runtimeObjectInstanceSync.sync` from tools, menus or `applyPortal*`; tools request.
- Do not rename the `syncRuntimeObjectPortalInstances` / `syncSelectableHitboxDebug` deps in `toolObjectRuntimes.ts` or
  `geodesicCannonTools.ts`.
- Do not declare new shell state after line 1103 of `createThreeApp.ts` (temporal dead zone).
- Do not cache registry query arrays or add allocation work here; that is job 29.

## Done when

- [ ] `getRuntimeObjectVisiblePaths` is gone; the frame builds one `FrameRenderSnapshot` and syncs objects once from it.
- [ ] `runtimeObjectInstanceSync.sync(` appears exactly three times in `createThreeApp.ts` (frame, setup, `applyDebugSettings`).
- [ ] Records are collected once per sync; unchanged objects reuse their records; archetype keys come from the prefix index.
- [ ] `registry.getVersion()` exists and counts `add`, `update`, `remove`, `moveToCell` and job 37's publisher once each.
- [ ] Hitbox debug rebuilds only through `syncSelectableHitboxDebugIfChanged` in the frame (or the unconditional call in `applyDebugSettings`).
- [ ] All new tests pass; `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build` and the smoke on four worlds pass.
- [ ] Issue 71 closed (or left open with a pointer, see Bookkeeping); report written per [README](README.md).


## Report

### Done
Commit `f63528d` (Job 28: single commit, the job has no parts).
- `src/world-objects/runtimeObjectRegistry.ts`: `getVersion()`; the counter is bumped in `add`, `remove` (existing id only) and inside `replaceObject`, the one write path used by `update`, `moveToCell` (via `update`, once) and job 37's owner publisher. Claim/release and throwing calls do not bump.
- New `src/render/three/frameRenderSnapshot.ts` (`FrameRenderSnapshot`, `createFrameRenderSnapshot`, `createEmptyFrameRenderSnapshot`).
- New `src/render/three/runtimeObjectInstanceSync.ts`: moved sources sync, record collection and footprint cache out of `createThreeApp.ts`; records collected once per sync, prefix index per sync, per-object record cache (object identity + world + keys), `stats` counters, rover no longer gets the unused options.
- `createThreeApp.ts`: `latestFrameSnapshot` built in `syncPortalInstanceRender` / `syncStereoPortalInstanceRender` and the empty branches; `getRuntimeObjectVisiblePaths`, `applyPortalVisibleResult`, `applyPortalVisiblePaths`, `syncRuntimeObjectPortalInstances`, `syncRuntimeObjectRenderSources`, `collectRuntimeObjectRenderRecords`, `runtimeObjectFootprintRadius` removed. `runtimeObjectInstanceSync.sync(` has exactly 3 call sites (setup, frame, `applyDebugSettings`). Tools/menus/frame code request syncs through `requestRuntimeObjectInstanceSync` / `requestSelectableHitboxDebugSync` (passed under the old dep names; dep doc comments updated in `toolObjectRuntimes.ts` and `geodesicCannonTools.ts`). `cellRootsGeneration` is bumped at the start of `rebuildCellMeshes`. All new `let`/`const` are declared before the setup calls. `commitWorldGeometrySnapshot` no longer syncs objects or hitboxes. Module header, `_docs/ARCHITECTURE.md` and generated docs updated.
- `debugVisualization.ts`: `syncSelectableHitboxDebugIfChanged`.
- `playerRoverModel.ts`: removed `options` and `PlayerRoverRenderRecordOptions`.
- Tests: `tests/render-contract/frameRenderSnapshot.test.ts` (2), `runtimeObjectInstanceSync.test.ts` (6, covering Tests 1-6 of Step 3 incl. mono-XR re-root), `debugVisualization.test.ts` (1 test with the 5 checks), `tests/world-objects/runtimeObjectRegistry.test.ts` (new `describe("version")`, 3 tests).

Issues the Done-when says to close: issue 71 (`_issues/71_runtime_object_instance_sync_runs_twice_with_stale_root.md`), but see Not done (headset/manual checks), so it should stay open with a pointer unless the coordinator accepts that.

### Deviations
- `tests/render-contract/playerRoverModel.test.ts`: dropped the third `collectRecords` argument (and the then-unused world/imports), because Decision 7 removes the parameter; assertions unchanged.
- `void runtimeObjectInstanceSyncRequested;` in the frame: the flag is otherwise write-only and `noUnusedLocals` rejects that; it is kept for job 29 as the job says.
- The unconditional `syncSelectableHitboxDebug` clears the stored key (it has no registry version to store), so the next gated call rebuilds once more instead of "updating the stored key".
- The stereo debug state is now built from the union-grouped map (as the job intends), not eye 0's table join.

### Uncertain
- Behaviour in a live browser with debug hitboxes on and in XR is covered only by unit tests plus the smoke run; the mono-XR re-root fix is verified in `runtimeObjectInstanceSync.test.ts` only.
- Geodesic objects use the same per-object record cache; their records are pure functions of the object, so this should be safe.

### Not done
### Manual checks not run
- Frame-time numbers (no browser): open `?config=full&world=cube&debugLevel=basic&debugOverlay=1&debugOverlayItems=fps`, place 40 flags with the place-flag tool in the start cell, stand still 10 s, note `objects` and `portal` from the `frame ms:` line; repeat on parent commit `0673b75`.
- Headset check: single-view XR, lean the head through a portal next to a flag; the flag must stay in place.

### Checks
- `npm run typecheck`: pass.
- `npm test`: 128 files, 938 tests pass (first run failed only on stale generated docs; `npm run docs:generate` fixed it).
- `npm run docs:check`: pass after `docs:generate`.
- `npm run build`: pass (chunk size warning only).
- `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`: SMOKE OK (4 pages), no TDZ crash.