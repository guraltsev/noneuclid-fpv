# Job 37 - Objects own their position; `placeAt` moves any positioned object

Status: done, needs review on 2026-10-29 (commits e0bb652, f484226, 0c8d93c).
Written on 2026-10-29 after a design discussion with the maintainer (decisions below are theirs). Resolves: no open issue.

This job runs **first** in the coordinated batch [00_coordinate_jobs_19_23_25_29_37](00_coordinate_jobs_19_23_25_29_37.md)
(order: 37, then 25-27, 28-29, 20-22, 19/23). It is the only job of **phase 1**. Make one commit per Part (A, B, C);
the Part C commit is the last code commit of phase 1 (the coordinator then adds the report/bookkeeping commit and the
phase commit). Job 28 later adds a registry version counter that every registry write path, including this job's
publishers, must bump: keep all writes inside the registry going through one private helper (see Part A step 1).

## Goal

1. Every object that has a position **you can move** (creatures, the marmot, static assets such as houses and bikes) is
   owned by one **owner** that holds its pose. The owner is the only authority on that pose.
2. The runtime object registry becomes a **published read model** for those objects: only their owner may change the
   pose in it. Any other write is **rejected** (throws).
3. Anything can be relocated from outside with one call, `objectHost.placeAt(id, cellId, localPose)`. `placeAt` is
   unaware of what the object is. It sends a placement command to the owner; the owner decides what to do (creatures
   also re-seed their leader).
4. Delete the unreachable "lost leader" branch of job 36 (`creatureLostMeters`), and write the test job 36 could not.

Not in this job: flags, tool objects, geodesic cannons and their derived objects (they keep writing to the registry as
today), and a particle system for bullets or stars (a separate job; many small objects must **not** go through the
registry, see Decision 6).

## Depends on

[Job 36](_done/36_creatures_detour_and_resume_geodesic.md) (creature leader). Independent of every other queued job.

## Before you start

Line numbers are **at commit 0b468e1**. They drift as you edit; search by name when they no longer match.

| File | What to look at (lines at 0b468e1) |
| --- | --- |
| `src/world-objects/runtimeObjectRegistry.ts` | header comment 1-6; `RuntimeWorldObjectBase` 55-86; `RuntimeCreatureObject` 92-94; `RuntimeStaticAssetObject` 100-103; `RuntimeWorldObject` union 109-120; `RuntimeObjectRegistry` interface 126-149; `createRuntimeObjectRegistry` 155-257 (`add` 179-186, `update` 187-199, `remove` 200-208, `moveToCell` 209-222, which calls `registry.update`); `runtimeObjectToDynamicObjectState` 263-269; `createRuntimeStaticAssetObject` 275-338 |
| `src/world-objects/simpleGeoCreature.ts` | `SimpleGeoCreatureRuntime` 77-93 (has `objectId`, not `id`); `creatureLeashMeters` 96; `creatureLostMeters` 97-98; `createSimpleGeoCreatureRuntime` 183-440 (`registry?.add(initialObject)` 207; `initialState`/`state` 208-209; `lastLateralOffsetMeters` 221; `seedLeaderOnCreature` 230-233; `update` 278-382 with the lost-leader branch 313-318 and `syncRegistryObject` call 379; `leaderForDebug` 383-385; `syncParent` 386-392; `transformGeometry` 397-422, publish at 419; `reset` 423-438, publish at 430); `createRuntimeCreatureObject` 452-471; `syncRegistryObject` 473-493 |
| `src/world-objects/geodesicMarmot.ts` | `GeodesicMarmotRuntime` 51-65; `createGeodesicMarmotRuntime` 102-210 (`registry?.add` 116; `update` 142-161, publish at 158; `transformGeometry` 173-197, publish at 194; `reset` 198-208, publish at 200); `syncRegistryObject` 243-263 |
| `src/render/three/createThreeApp.ts` | `const runtimeObjectRegistry = createRuntimeObjectRegistry()` 527; `cellMeshes` 780; `dynamicObjectRuntimes` 834; `runtimeObjectFootprintCache` 857-860 (the job 17 crash fix, see "Ordering hazard"); object creation loop 1153-1179 (marmot 1157-1164, creature 1166-1173, collidable assets 1175-1177); per-frame creature update 1449-1454; `commitWorldGeometrySnapshot` 1581-1621 (calls `transformRuntimeObjectsForGeometryCommit` at 1594, before the bundle swap at 1595); `transformRuntimeObjectsForGeometryCommit` 1655-1702 (runtime loop 1659-1661, asset removal loop 1663-1667, flags 1669-1688, cannons 1689-1697, `rebuildStaticAssetRegistryObjects` call 1700); `rebuildStaticAssetRegistryObjects` 1733-1741; `return {` of the public handle 1892; `dispose()` 1917, creature/marmot disposal 1965-1971; `rebuildCellMeshes` 2376; `resetRuntimeWorld` 3167-3175 |
| `src/render/three/buildCellMesh.ts`, `src/render/three/buildDecorationMesh.ts` | asset **visuals** are built from the spec, not the registry: `buildCellMesh.ts` 75-81, `buildDecorationMesh.ts` 36-60 (see "Facts checked at 0b468e1", item 1) |
| `src/runtime/deformations/torusSkewDeformation.ts` | `applyToSpec` 82-103 maps cell objects (assets) with the same lattice maps as `createDynamicObjectMaps` 104-106 |
| `tests/world-objects/simpleGeoCreature.test.ts` | `describe("leader and detour")` 286-558; `makeCreature` 290-329 (creates its own registry; returns `{ runtime, pose, leaderInCreatureFrame, lag, nearestColumn, world }`); `expectCoincide` 352-358; test `"6. a blocking body leashes ..."` 508-530; test `"8. reset and transformGeometry put the leader back on the creature"` 532-557 (hand-built `identityMap` at 543) |
| `tests/world-objects/runtimeObjectRegistry.test.ts` | exists; helpers `creature(id, cellId, extra)` 12-21 and `emitter(...)` 23-34; tests use plain (unowned) records |
| `tests/runtime/worldGeometryRuntimeTransforms.test.ts` | the deformation helpers to reuse: `createTorusSkewCellDeformationMaps(skewState(0), skewState(2))` (import from `src/runtime/deformations/torusSkewDeformation`), `skewState` 93-101, `stubAssets` 103-118, world `torus` (cell `"torus-room"`, 15 m x 15 m) from `src/authoring/exampleWorlds`. With skew 0 -> 2 a point `(0, 3, 0)` maps to `(0.4, 3, 0)` (test at 59-78) |
| `tests/render-contract/geodesicCreatureDebug.test.ts` | line 66 writes a creature's registry record directly (see "Writers that must change") |

Current signatures you will use:

```ts
// src/math/rigidTransform3.ts
export interface RigidTransform3 { readonly rotation: Mat3; readonly translation: Vec3; }
export function yawRigidTransform3(yawRadians: number, translation: Vec3): RigidTransform3;
export const identityRigidTransform3: RigidTransform3;

// src/runtime/worldGeometryDeformations.ts
export interface CellDeformationMap {
  readonly cellId: string;                       // the cell the mapped pose lands in
  mapPoint(point: Vec3): Vec3;
  mapDirection(direction: Vec3, atPoint?: Vec3): Vec3;
}
export interface RuntimePoseInCell { readonly cellId: string; readonly localPose: RigidTransform3; }
export function transformPoseWithCellMaps(
  pose: RuntimePoseInCell,
  mapsByCellId: ReadonlyMap<string, CellDeformationMap>,
): RuntimePoseInCell | undefined;               // undefined when there is no map for pose.cellId

// src/movement/depenetrateDynamicObject.ts
export function depenetrateDynamicObject(
  world: CompiledCellComplex, object: DynamicObjectState, options?: DepenetrationOptions,
): DepenetrationResult;                         // { kind: "unchanged" | "pushed" | "sampled" | "failed"; object }
                                                // on "failed", `object` is the input (use it unchanged)
// src/movement/dynamicObject.ts
export interface DynamicObjectState { readonly cellId: string; readonly localPose: RigidTransform3; readonly collision?: SimpleCollisionCylinder; }

// src/world-objects/runtimeObjectRegistry.ts
export function runtimeObjectToDynamicObjectState(object: RuntimeWorldObjectBase): DynamicObjectState;
export function createRuntimeStaticAssetObject(objectSpec: AssetObjectSpec, cellId: string): RuntimeStaticAssetObject;
export interface RuntimeObjectRegistry {
  add(object: RuntimeWorldObject): void;                 // throws if the id exists
  update(object: RuntimeWorldObject): void;              // throws if the id is unknown
  remove(id: string): void;                              // silent if absent
  moveToCell(id: string, cellId: string, localPose?: RigidTransform3): RuntimeWorldObject | undefined; // calls update
  get(id: string): RuntimeWorldObject | undefined;
  getObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  getCollidableObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  getPlayerBlockingObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  getInteractableObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  getTooltipObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  getAll(): readonly RuntimeWorldObject[];
}
// RuntimeWorldObjectBase fields: id, cellId, localPose, collision?, class?, do_not_collide_with?, aimStickyTarget?,
// portalRenderable, tooltip?, interactable?, displayHelpMessage?, autoDisplayHelpRangeMeters?, tutorialPages?, goalPages?.
// RuntimeCreatureObject adds kind: "geodesci-marmot" | "geo-mouse" | "geo-butterfly" (the "geodesci" spelling is intentional).
// RuntimeStaticAssetObject adds kind: "asset", assetPath.

// runtimes (unchanged signatures)
createSimpleGeoCreatureRuntime(objectSpec, startCellId, assets, registry?: RuntimeObjectRegistry): SimpleGeoCreatureRuntime;
createGeodesicMarmotRuntime(objectSpec, startCellId, _assets, registry?: RuntimeObjectRegistry): GeodesicMarmotRuntime;
// both: transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void
```

Import paths from `src/world-objects/`: `../math/rigidTransform3`, `../runtime/worldGeometryDeformations`,
`../cell-complex/compileCellComplex`, `../movement/depenetrateDynamicObject`, `../movement/dynamicObject`,
`./runtimeObjectRegistry` (the same imports `simpleGeoCreature.ts` 7-38 already uses).

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, and
`npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.

## Facts checked at 0b468e1

Read these before the Decisions; they correct or sharpen the text below without changing what was decided.

1. **Asset visuals do not read the registry.** Decision 10 says assets "still read pose and cell from the registry".
   At 0b468e1 only their collision, tooltip, interaction, aim and the debug collision wireframe
   (`staticObjectCollisionWireframes.ts` 29-35) come from the registry record. The visible model is built from the
   **spec** (`objectSpec.position`, `turnRadians`) inside the cell mesh (`buildCellMesh.ts` 75-81 ->
   `buildDecorationMesh`), and rebuilt from the new snapshot's spec on every `rebuildCellMeshes`. Consequence: after
   `placeAt` on an asset, its collision/tooltip move but its model stays where the spec puts it. Decision 10 forbids
   changing how assets are drawn, so **do not** change it here: test assets through the registry only. The follow-up
   is [job 38](38_draw_assets_from_registry.md) (assets drawn from their record), queued in phase 3 after job 28.
   Mention it in the Report under `### Done` ("asset models follow `placeAt` after job 38"); it is not an
   uncertainty of this job.
2. **Only collidable assets have a registry record.** `createThreeApp.ts` 1175 and 1736 add a record only when
   `objectSpec.kind === "asset" && objectSpec.collision`. Create a `PlainWorldObject` only for those; assets without
   collision have no record and no owner.
3. **There is no test 7 to replace.** In `simpleGeoCreature.test.ts` the "leader and detour" tests go from `"6. ..."`
   (508) to `"8. ..."` (532). Job 36 planned test 7 ("Lost leader: force a lag above 3 m ...", job 36 line 172) but did
   not write it (job 36 report: "The re-seed branch is unreachable through the public API"). "Replace the unreachable
   test 7" means: **add** the new tests between test 6 and test 8, named `"7a. ..."`, `"7b. ..."`, `"7c. ..."` (names
   below).
4. **`_docs/MATHEMATICAL_MODEL.md` §5 does not mention the lost rule.** The creature paragraph is the last paragraph of
   §5 (line 205, starting "**Creatures follow a leader on their geodesic.**"). The only mentions of the rule are the
   JSDoc of `creatureLostMeters` (`simpleGeoCreature.ts` 97) and the generated `_docs/generated/API_REFERENCE.md` 686
   (regenerated by `npm run docs:generate`). Decision 8's doc edit therefore means: add one sentence to that §5
   paragraph (Part C step 4), and delete the constant with its JSDoc.
5. **`ObjectHost` needs an iteration method for Decision 9.** Decision 4's `ObjectHost` cannot reach "every registered
   owner". Add `transformGeometry(mapByCellId, nextWorld?)` to `ObjectHost` (calls each registered owner's
   `transformGeometry` in registration order). This is the "through the host" of Decision 9.
6. **Runtimes have `objectId`, owners need `id`.** Add `readonly id` to both runtimes (same value as `objectId`; keep
   `objectId`, it is used by `createThreeApp.ts` 1161, 1170, 1450 and the debug tools).
7. **The `registry` argument is optional** in both runtime factories, and several tests create runtimes without one
   (`simpleGeoCreature.test.ts` 45, 63; `geodesicMarmot.test.ts` 17, 116). With no registry: skip `add`/`claim`; the
   publisher is a no-op; `place`, `reset` and `transformGeometry` still update the runtime's own state.

## Writers that must change

Every call at 0b468e1 that writes (`update`, `moveToCell`, `remove`, or re-`add`) a creature, marmot or collidable
asset id. After this job each of these would throw, so each must change as listed.

| Where (0b468e1) | What it does today | Change to |
| --- | --- | --- |
| `simpleGeoCreature.ts` `syncRegistryObject` 473-493, called at 379 (`update`), 419 (`transformGeometry`), 430 (`reset`) | `registry.update({...record, cellId, localPose, collision})` | the owner itself: delete `syncRegistryObject`; call the publisher returned by `claimOwnership` at the same three places and in the new `place` (Part B) |
| `geodesicMarmot.ts` `syncRegistryObject` 243-263, called at 158, 194, 200 | same | same, through the marmot's publisher (Part B) |
| `createThreeApp.ts` 1663-1667 in `transformRuntimeObjectsForGeometryCommit` | `runtimeObjectRegistry.remove(id)` for every `kind === "asset"` | delete the loop; `objectHost.transformGeometry(mapByCellId, snapshot.world)` maps assets through their `PlainWorldObject` (Part C) |
| `createThreeApp.ts` 1733-1741 `rebuildStaticAssetRegistryObjects`, called at 1700 | re-`add`s every collidable asset from the new spec (would throw "already exists" once the removal loop is gone) | delete the function and its call; at 0b468e1 it handles only collidable assets, which are all owned after Part C, so nothing unowned is left for it (Part C) |
| `createThreeApp.ts` 1659-1661 in `transformRuntimeObjectsForGeometryCommit` | `runtime.transformGeometry(...)` for every creature/marmot (not a registry write, but would map twice once the host also does it) | replace by the single `objectHost.transformGeometry(mapByCellId, snapshot.world)` call (Part C) |
| `tests/render-contract/geodesicCreatureDebug.test.ts` 66, test `"flags registry and parent mismatches"` | `registry.update({ ...object, cellId: "room-b" })` on the creature `"mouse"` to fake a stale record | insert `registry.releaseOwnership("mouse");` on the line before it (the test simulates a registry that disagrees with the runtime; releasing is the only legal way to do that now). Record this under `### Deviations` (Part B) |

Checked and **not** affected (they only touch non-owned kinds, filtered by `kind`, or only read): flag writes in
`createThreeApp.ts` (536, 546, 555, 1673, 1687, 3020, 3037); measurement/protractor writes (3100, 3239, 3252) and
`removeGeodesicRuntimeObjects` (3657-3666); every write in `geodesicCannon.ts`, `geodesicCannonTools.ts` (carry/drag
exists only for cannons), `toolObjectRuntimes.ts`, `worldGeometryComputedObjects.ts`; `placedFlags.ts` 292 (`add` of a
new flag). `moveToCell` has no caller in `src/`. `resetRuntimeWorld` (3167) goes through `runtime.reset`, i.e. the
owner. The debug tools `geodesicCreatureDebug.ts`, `geodesicDebugDumps.ts`, `debugVisualization.ts`,
`staticObjectCollisionWireframes.ts` and the aim code (`aimTarget.ts`, `aimInteraction.ts`) only read. Tests:
`runtimeObjectRegistry.test.ts` 50 (`moveToCell("mouse-a")`) and 60 (`remove("mouse-a")`) use plain records that are
never claimed, so they stay valid; the `registry.update` calls in `geodesicCannon.test.ts`, `protractorTool.test.ts`
and `worldGeometryComputedObjects.test.ts` touch cannons, segments and measurements only. If you find another writer,
fix it the same way and list it under `### Deviations`.

## Ordering hazard in `createThreeApp.ts`

Job 17 crashed the production bundle with a temporal-dead-zone error ("Cannot access 'Lm' before initialization")
because a `const` was declared below setup code that read it; typecheck and vitest stayed green (see
`.agents/jobs/_reports/batch_11_17_36.md`, "Cross-job problems"; fixed in 1fa9ebc by moving the declaration to line
857-860). For this job:

- Declare `const objectHost = createObjectHost();` on the line **directly after**
  `const runtimeObjectRegistry = createRuntimeObjectRegistry();` (527). That is above every reader: the object
  creation loop (1153-1179), the frame loop, and the hoisted functions `transformRuntimeObjectsForGeometryCommit`
  (1655) and `dispose` (1917), which may be called before any later line has run.
- Declare any array you keep for asset owners (for example `const staticAssetOwners: PlainWorldObject[] = [];`) next to
  `dynamicObjectRuntimes` (834), also above the creation loop.
- Never declare a new `const`/`let` near its first textual use further down, and never below `return {` (1892).
- The smoke run after Parts B and C is the only check that catches this.

## Background

Today the creature keeps its pose in a private `state` and copies it into the registry every tick
(`syncRegistryObject`). It never reads the registry back, so an outside change of its pose is silently overwritten.
Static assets have no runtime object: they are registry records rebuilt from specs on every geometry commit. Registry
writes come from ~100 places (mostly geodesic cannons and tools); this job does **not** touch those.

## Decisions

1. **Authority.** Decided: the owner is authoritative; the registry is a read model written only by the owner. Why:
   maintainer decision; also lets each owner choose its own representation.
2. **Rejection.** Decided: `registry.update`, `registry.moveToCell` and `registry.remove` called on an object that has
   an owner, not through that owner's publisher, **throw** `Error("Runtime object "<id>" is owned; use
   its owner.")` (in code: ``new Error(`Runtime object "${id}" is owned; use its owner.`)``). The check is one
   `Set.has` per `update`. Why: maintainer decision (reject if not a bottleneck; one set lookup is not).
3. **API shape.**

   ```ts
   interface RuntimeObjectRegistry {
     /** Marks `id` as owned and returns the only function allowed to replace it afterwards. */
     claimOwnership(id: string): (object: RuntimeWorldObject) => void;
     /** Removing an owned object requires its publisher too: `remove` throws for owned ids. */
     // existing methods unchanged otherwise
   }
   ```

   `claimOwnership` throws if the id is unknown or already claimed. The returned publisher replaces the stored object
   (same re-indexing as `update`) and throws if the object's id differs. `releaseOwnership(id)` makes the object
   unowned again (used on dispose). Do not add events to the registry.
4. **Owner interface** (new file `src/world-objects/worldObjectOwner.ts`):

   ```ts
   export interface WorldObjectOwner {
     readonly id: string;
     /** Placement command: relocate to `cellId` / `localPose` (cell-local, meters, radians). Owner-specific reaction. */
     place(cellId: string, localPose: RigidTransform3): void;
     /** Remap through a geometry change (same contract as today's `transformGeometry`). */
     transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
   }
   export interface ObjectHost {
     register(owner: WorldObjectOwner): void;
     unregister(id: string): void;
     /** Sends the command to the owner of `id`; returns false if there is none. No collision push-out here. */
     placeAt(id: string, cellId: string, localPose: RigidTransform3): boolean;
   }
   export function createObjectHost(): ObjectHost;
   ```

   `placeAt` does **no** collision resolution and knows nothing about leaders. A caller that wants a clear spot calls
   `depenetrateDynamicObject` itself first.
5. **Default owner.** Decided: `PlainWorldObject` (same file or `plainWorldObject.ts`) holds `{ cellId, localPose }`,
   `place` adopts them and publishes, `transformGeometry` maps the pose with `transformPoseWithCellMaps` and, when
   `nextWorld` is given, pushes it out of obstacles with `depenetrateDynamicObject` (the same rule flags use in
   `transformRuntimeObjectsForGeometryCommit`); an unmappable pose removes nothing and leaves the pose unchanged, as
   creatures do. Static assets use it. Why: houses and bikes need no logic.
6. **Many small objects.** Decided: bullets, stars and other bulk fragments never go through the registry or this
   interface per particle (per-tick immutable replacement allocates too much). Write this in the header comment of
   `runtimeObjectRegistry.ts` and `worldObjectOwner.ts`. A particle system is a separate future job.
7. **Creatures and the marmot.** Decided: both implement `WorldObjectOwner`. They claim ownership at creation and
   publish through the returned function instead of `registry.update`. Creature `place`: adopt the cell and pose, run
   `seedLeaderOnCreature`, reset the oscillation lag (`lastLateralOffsetMeters = 0`; keep the oscillation phases),
   publish, apply the pose to `root`, refresh the wireframe. Marmot `place`: adopt, publish, apply.
8. **Delete the lost-leader rule.** Decided: remove `creatureLostMeters` and the `if (lagBefore > creatureLostMeters)`
   branch. Every path that can displace a creature (`place`, `reset`, `transformGeometry`) re-seeds the leader, and the
   registry can no longer move it. Keep `creatureLeashMeters`. Update the doc comment and `_docs/MATHEMATICAL_MODEL.md`
   §5 where the lost rule is mentioned (see "Facts checked", item 4: §5 does not mention it; add the re-seed sentence
   instead).
9. **Geometry commits.** Decided: `transformRuntimeObjectsForGeometryCommit` calls `transformGeometry` on every
   registered owner (creatures, marmot and now assets) through the host, replacing the loop over
   `dynamicObjectRuntimes` for these kinds, and `rebuildStaticAssetRegistryObjects` stops deleting and re-adding assets.
   Flags and cannons keep their current code there.
10. **Rendering of assets.** Decided: nothing changes in how assets are drawn. They still read pose and cell from the
    registry. Only the writer changes. (At 0b468e1 the asset *models* are drawn from the spec, not the registry; see
    "Facts checked", item 1. Keep drawing unchanged in this job; [job 38](38_draw_assets_from_registry.md) moves asset
    drawing onto the registry.)

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck`.

### Part A: registry ownership and the host

1. In `runtimeObjectRegistry.ts` (inside `createRuntimeObjectRegistry`, 155-257):
   - add `const ownedIds = new Set<string>();`;
   - move the body of `update` (187-199, after its "missing" check) into a private
     `function replaceObject(previous: RuntimeWorldObject, next: RuntimeWorldObject): void` (re-index if the cell
     changed, then `objectsById.set`). `update`, `moveToCell` (via `update`) and every publisher call it; it is the one
     write path job 28 will add its version bump to;
   - `update(object)`: if `ownedIds.has(object.id)` throw the Decision 2 error, else as today;
   - `moveToCell(id, ...)`: if `ownedIds.has(id)` throw the same error **before** building `next` (today it calls
     `registry.update`, which would throw too, but throw first so the message names the id even when the call fails
     early);
   - `remove(id)`: if `ownedIds.has(id)` throw the same error;
   - `claimOwnership(id)`: throw ``new Error(`Cannot claim missing runtime object "${id}".`)`` if unknown,
     ``new Error(`Runtime object "${id}" is already owned.`)`` if claimed; else add to `ownedIds` and return
     `(object) => { if (object.id !== id) throw new Error(`Publisher for "${id}" cannot write "${object.id}".`); replaceObject(objectsById.get(id)!, object); }`.
     After `releaseOwnership(id)` a stale publisher still works only while the id is unowned; keep it simple (no
     generation counter);
   - `releaseOwnership(id)`: `ownedIds.delete(id)` (no-op if not owned);
   - `add` is unchanged: it already throws for any existing id, so an owner must `add` and then `claimOwnership`.
   Add both methods to the `RuntimeObjectRegistry` interface (126-149) with JSDoc, and extend the header comment (1-6)
   with "registry is a read model for owned objects" and the Decision 6 sentence.
2. Create `src/world-objects/worldObjectOwner.ts` with a header comment (Decision 6 sentence included), the interfaces
   of Decision 4, plus on `ObjectHost`:
   `transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void`
   ("Facts checked", item 5). `createObjectHost()` keeps a `Map<string, WorldObjectOwner>`; `register` throws
   ``new Error(`Object owner "${owner.id}" is already registered.`)`` for a duplicate id; `unregister` is silent if
   absent; `placeAt` returns `false` for an unknown id, else calls `owner.place(cellId, localPose)` and returns `true`.
   Add `PlainWorldObject` (Decision 5) as
   `export function createPlainWorldObject(registry: RuntimeObjectRegistry, initial: RuntimeWorldObject): PlainWorldObject`
   where `PlainWorldObject extends WorldObjectOwner` and adds `dispose(): void` (releases ownership; does not remove
   the record). The factory `add`s `initial` if `registry.get(initial.id)` is undefined, then claims it. It keeps the
   latest published record and publishes `{ ...latest, cellId, localPose }`. `transformGeometry`: map with
   `transformPoseWithCellMaps(latest, mapByCellId)`; if `undefined`, return; if `nextWorld`, use
   `depenetrateDynamicObject(nextWorld, runtimeObjectToDynamicObjectState({ ...latest, cellId, localPose })).object`
   (exactly the flag code at `createThreeApp.ts` 1678-1686); publish. JSDoc on every export (`npm run docs:check`).
3. Tests (add to `tests/world-objects/runtimeObjectRegistry.test.ts`, which exists, and create
   `tests/world-objects/worldObjectOwner.test.ts`):
   - an owned id: `update`, `moveToCell`, `remove` throw (match `/is owned; use its owner/`); the publisher works (new
     cell shows in `getObjectsInCell`, old cell is empty); a publisher given another id throws;
   - claiming an unknown or already claimed id throws; `releaseOwnership` restores normal writes;
   - `placeAt` on an unknown id returns false; on a `PlainWorldObject` it returns true and the registry shows the new
     cell and pose;
   - `PlainWorldObject.transformGeometry` maps a pose through a translation map (write the expected numbers by hand),
     e.g. map `{ cellId: "cell-b", mapPoint: (p) => ({ x: p.x + 2, y: p.y - 1, z: p.z }), mapDirection: (d) => d }`
     for `"cell-a"`, start pose `yawRigidTransform3(0.5, { x: 1, y: 1, z: 0 })`: expect cell `"cell-b"`, translation
     `(3, 0, 0)`, yaw 0.5; and with no map for the cell the pose and cell are unchanged.
4. Commit (stage only the files you changed): `Job 37 Part A: registry ownership and object host`.

### Part B: creatures and the marmot

1. Migrate `simpleGeoCreature.ts`:
   - make `SimpleGeoCreatureRuntime` extend `WorldObjectOwner` (adds `id` and `place`); return `id: objectSpec.id`;
   - after `registry?.add(initialObject)` (207) do
     `const publish = registry ? registry.claimOwnership(objectSpec.id) : () => {};` and keep a local
     `let record = initialObject;`. Replace each `syncRegistryObject(registry, objectSpec.id, state)` (379, 419, 430)
     by `publishState()`, which does `record = { ...record, cellId: state.cellId, localPose: state.localPose, collision: state.collision }; publish(record);`.
     Delete `syncRegistryObject` (473-493);
   - add `place(cellId, localPose)`: `state = { ...state, cellId, localPose }; seedLeaderOnCreature(); lastLateralOffsetMeters = 0; publishState(); applyObjectPose(root, state.localPose); refreshCollisionWireframe();`
     (Decision 7). Do not change `initialState` (`reset` still returns to the authored, deformation-mapped start) and
     do not reparent `root` (the frame loop calls `syncParent` every frame, `createThreeApp.ts` 1452);
   - delete `creatureLostMeters` with its JSDoc (97-98) and the branch at 313-318, leaving
     `if (lagBefore < creatureLeashMeters && stepMeters > 0) { advanceLeader(world, stepMeters); }`;
   - keep `leaderForDebug`.
   Do the same for `geodesicMarmot.ts` (`GeodesicMarmotRuntime` extends `WorldObjectOwner`; claim after 116; replace
   158, 194, 200; delete `syncRegistryObject` 243-263; `place`: adopt, publish, apply pose, refresh wireframe).
   Update the factories' JSDoc (simpleGeoCreature 179-182, geodesicMarmot 98-101): "claims ownership of its registry
   record".
2. In `createThreeApp.ts`: declare `objectHost` right after line 527 (see "Ordering hazard"). In the creation loop
   (1157-1173) call `objectHost.register(runtime)` after each `dynamicObjectRuntimes.push(runtime)`. In `dispose`
   (before `dynamicObjectRuntimes.length = 0`, 1971) call `objectHost.unregister(runtime.id)` and
   `runtimeObjectRegistry.releaseOwnership(runtime.id)` for each runtime. Leave the commit loop (1659-1661) as it is
   until Part C.
3. Tests in `simpleGeoCreature.test.ts`, `describe("leader and detour")`. Extend `makeCreature` (290-329) to also
   return `registry` (adding a field weakens nothing). Add, between test 6 (ends 530) and test 8 (532):
   - `"7a. host.placeAt re-seeds the leader and the creature walks the geodesic from the placed pose"`: cube, creature
     at `("front", 0, 0, -90)`; run 30 ticks; `host.placeAt("m", "front", yawRigidTransform3(0.3, { x: 0, y: -5, z: 0 }))`
     (5 m from the start, same cell; register the runtime with `createObjectHost()` first). Expect the registry pose to
     equal the placed pose, `leaderForDebug().creatureFromLeader` to be the identity (translation `{0,0,0}`, rotation
     `m00` 1 and `m10` 0 within `1e-12`), and the next 100 ticks to match a fresh `makeCreature` started at
     `(0, -5)` with heading 0.3 rad (`turn` in degrees: `0.3 * 180 / Math.PI`) tick by tick (translation within `1e-9`);
   - `"7b. host.placeAt into another cell moves the registry record and the three.js parent"`: place into a second cube
     face (`world.cells.find((cell) => cell.id !== "front")!.id`); expect `registry.get("m")!.cellId` and
     `runtime.cellId` to be that cell, `getObjectsInCell("front")` not to contain `"m"`, and after
     `runtime.syncParent(cellRoots)` (a `Map` of one `THREE.Group` per cell id) `runtime.root.parent` to be that cell's
     group;
   - `"7c. a direct registry.update of a creature throws and leaves its pose unchanged"`: `expect(() => registry.update({ ...record, localPose: yawRigidTransform3(0, { x: 3, y: 3, z: 0 }) })).toThrow(/is owned/)`;
     registry pose and `runtime.root.position` unchanged;
   - the existing creature tests (1-6, 8, and every other test in the file) pass unchanged.
   Also fix `tests/render-contract/geodesicCreatureDebug.test.ts` 66 as listed in "Writers that must change". Add one
   marmot test to `tests/world-objects/geodesicMarmot.test.ts`: with a registry, `place` moves the record and
   `registry.update` on the marmot id throws.
4. `npm run build` then `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` (catches a
   temporal-dead-zone error typecheck and vitest cannot see).
5. Commit: `Job 37 Part B: creatures and marmot own their pose`.

### Part C: static assets and geometry commits

1. In `createThreeApp.ts`:
   - creation loop 1175-1177: replace `runtimeObjectRegistry.add(createRuntimeStaticAssetObject(objectSpec, cell.id))`
     by `const owner = createPlainWorldObject(runtimeObjectRegistry, createRuntimeStaticAssetObject(objectSpec, cell.id)); objectHost.register(owner); staticAssetOwners.push(owner);`
     (declare `staticAssetOwners` next to `dynamicObjectRuntimes`, 834);
   - `transformRuntimeObjectsForGeometryCommit` (1655-1702): replace the runtime loop 1659-1661 by
     `objectHost.transformGeometry(mapByCellId, snapshot.world);`, delete the asset removal loop 1663-1667, delete the
     `rebuildStaticAssetRegistryObjects(snapshot)` call (1700) and the function (1733-1741). Keep the flag/cannon loop
     and `rebuildGeometryDependentRuntimeObjectsAfterCommit` unchanged;
   - `dispose`: for each asset owner `objectHost.unregister(owner.id); owner.dispose();`, then clear the array;
   - update the JSDoc of `commitWorldGeometrySnapshot` (1571-1580): "collidable assets are rebuilt from the new spec"
     becomes "collidable assets are mapped by their owners".
2. Tests (add to `tests/runtime/worldGeometryRuntimeTransforms.test.ts`, reusing its `skewState`, `torus` and
   `createTorusSkewCellDeformationMaps`):
   - a `PlainWorldObject` for the torus bench survives `host.transformGeometry(maps)` (skew 0 -> 2, no `nextWorld`).
     Get the spec as the existing test does (lines 28-34: `torus.cells[0].visuals?.objects?.find((o) => o.id === "torus-bench")`,
     narrowed to `kind === "asset"`), build the record with `createRuntimeStaticAssetObject(bench, "torus-room")`.
     The bench is at `(3.1, -2.4, 0)`; the map adds `2 * y / 15` to x, so expect the record still present with
     translation `(2.78, -2.4, 0)` (within `1e-9`), equal to the bench position in
     `createTorusSkewDeformationFamily().applyToSpec(torus, skewState(2))`;
   - an asset moved by `host.placeAt("torus-bench", "torus-room", yawRigidTransform3(0, { x: 0, y: 3, z: 0 }))` keeps
     the placement after the commit: translation `(0.4, 3, 0)`, not the spec position.
3. Run `npm run build` then `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. **Run the smoke
   after Part B and again after Part C**: a runtime-only error (such as a temporal-dead-zone from declaring a `const`
   after the setup code that reads it) is invisible to typecheck and vitest.
4. Docs: in `_docs/MATHEMATICAL_MODEL.md` §5, append to the creature paragraph (line 205, after "Once past the zone it
   rejoins the leader and the same geodesic.") one sentence: "Whenever the creature is displaced from outside (a
   placement through `objectHost.placeAt`, a reset or a deformation commit) the leader is re-seeded on it, so the lag
   is always bounded by the leash." In `_docs/ARCHITECTURE.md` edit the "Runtime objects" bullet (89-92): creatures,
   the marmot and collidable assets are written only by their **owners** (`src/world-objects/worldObjectOwner.ts#WorldObjectOwner`);
   for them the registry is a read model and other writes throw; `ObjectHost.placeAt` relocates any owned object; bulk
   particles never go through the registry. Then `npm run docs:generate` (drops `creatureLostMeters` from
   `_docs/generated/API_REFERENCE.md`). Headers and JSDoc are required on every new export (`npm run docs:check`).
5. Commit: `Job 37 Part C: static assets owned; geometry commits through the host`. This is the last code commit of
   phase 1 of the batch; the Report and bookkeeping follow as the coordinator describes.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, and the smoke command above all pass.

## Do not

- Do not change how flags, tools or geodesic cannons write to the registry.
- Do not put collision resolution, leaders or any object-kind knowledge in `placeAt` or the host.
- Do not add per-particle objects to the registry.
- Do not change how assets are drawn (`buildCellMesh.ts`, `buildDecorationMesh.ts`).
- Do not weaken existing creature tests; record any change under `### Deviations`.

## Done when

- Only owners can change the pose of creatures, the marmot and static assets; other writes throw.
- `objectHost.placeAt` moves any of them and a creature re-seeds its leader.
- The lost-leader rule is gone and the replacement tests (7a-7c) pass.
- Smoke passes on all four worlds after Parts B and C.
- Three commits `Job 37 Part A/B/C: ...` exist.
- Report written per [README](README.md), noting under `### Done` that asset models follow `placeAt` only after
  [job 38](38_draw_assets_from_registry.md).


## Report

### Done
Three commits: `e0bb652` Part A, `f484226` Part B, `0c8d93c` Part C.
- Part A: `runtimeObjectRegistry.ts` gets `ownedIds`, a private `replaceObject` (the single write path, for job 28's version bump), `claimOwnership`/`releaseOwnership`; `update`, `moveToCell`, `remove` throw `Runtime object "<id>" is owned; use its owner.` for owned ids. New `src/world-objects/worldObjectOwner.ts` (`WorldObjectOwner`, `ObjectHost` with `register`/`unregister`/`placeAt`/`transformGeometry`, `createObjectHost`, `PlainWorldObject`, `createPlainWorldObject`). Tests in `runtimeObjectRegistry.test.ts` and new `worldObjectOwner.test.ts`.
- Part B: `simpleGeoCreature.ts` and `geodesicMarmot.ts` implement `WorldObjectOwner` (`id`, `place`), claim ownership, publish via `publishState`; `syncRegistryObject` and `creatureLostMeters` with the lost-leader branch deleted. `createThreeApp.ts`: `objectHost` declared right after the registry (line 528), runtimes registered, unregistered/released in `dispose`. Tests 7a-7c, a marmot ownership test, and the `geodesicCreatureDebug.test.ts` fix.
- Part C: collidable assets get a `PlainWorldObject` owner (`staticAssetOwners`, declared next to `dynamicObjectRuntimes`); `transformRuntimeObjectsForGeometryCommit` now calls `objectHost.transformGeometry(mapByCellId, snapshot.world)`; the asset removal loop and `rebuildStaticAssetRegistryObjects` are gone; `dispose` releases asset owners. Test in `worldGeometryRuntimeTransforms.test.ts` (bench maps to x = 2.78; a `placeAt` placement survives the commit as (0.4, 3)). Docs: `MATHEMATICAL_MODEL.md` §5 sentence, `ARCHITECTURE.md` Runtime objects bullet, regenerated `_docs/generated`.
- Asset models follow `placeAt` only after [job 38](38_draw_assets_from_registry.md) (they are drawn from the spec, not the registry).
### Deviations
- `tests/render-contract/geodesicCreatureDebug.test.ts`: added `registry.releaseOwnership("mouse");` before the direct `registry.update` (as the job prescribes).
- `scripts/docs/layering-baseline.json`: added the edge `world-objects/worldObjectOwner.ts -> runtime/worldGeometryDeformations.ts`. `docs:check` rejects the new import (world-objects may not import runtime), but the job requires `transformPoseWithCellMaps` and `CellDeformationMap` there, exactly as `simpleGeoCreature.ts` and `geodesicMarmot.ts` already do (both baselined). Moving those two helpers down a layer is the real fix (job 32).
- Removed the now-unused `DynamicObjectState` import from `geodesicMarmot.ts`.
### Uncertain
- Static assets are now mapped by their `PlainWorldObject` owner on a geometry commit (pose through the cell maps plus depenetration) instead of being rebuilt from the deformed spec as before. For the torus skew the two agree (checked in the test); for a deformation whose spec mapping differs from the dynamic-object maps, assets could differ slightly from the spec position until job 38.
### Not done
Nothing.
### Checks
Baseline `npm run typecheck` and `npm test` (883 passed) green. After Part A: typecheck, targeted tests, docs:check green. After Part B: build, smoke on cube, icosahedron, torus-moduli, genus-2-torus passed. Final after Part C: typecheck, `npm test` (117 files, 894 passed, 8 skipped), `docs:check`, `npm run build`, and smoke on all four worlds all passed, first attempt. One intermediate `npm test` run failed only because the generated docs were stale; fixed with `npm run docs:generate`.