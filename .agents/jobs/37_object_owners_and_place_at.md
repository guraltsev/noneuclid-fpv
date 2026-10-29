# Job 37 - Objects own their position; `placeAt` moves any positioned object

Status: queued.
Written on 2026-10-29 after a design discussion with the maintainer (decisions below are theirs). Resolves: no open issue.

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

Search by name; line numbers drift.

| File | What to look at |
| --- | --- |
| `src/world-objects/runtimeObjectRegistry.ts` | `RuntimeObjectRegistry`, `update`, `moveToCell`, `createRuntimeStaticAssetObject` |
| `src/world-objects/simpleGeoCreature.ts` | `createSimpleGeoCreatureRuntime`, `state`, `initialState`, `syncRegistryObject`, `seedLeaderOnCreature`, the `creatureLostMeters` check in `update`, `reset`, `transformGeometry`, `leaderForDebug` |
| `src/world-objects/geodesicMarmot.ts` | `createGeodesicMarmotRuntime`, its own `syncRegistryObject` |
| `src/render/three/createThreeApp.ts` | creature/marmot runtime creation (`dynamicObjectRuntimes`), `createRuntimeStaticAssetObject` calls, `transformRuntimeObjectsForGeometryCommit`, `rebuildStaticAssetRegistryObjects` |
| `tests/world-objects/simpleGeoCreature.test.ts`, `tests/world-objects/runtimeObjectRegistry.test.ts` (if present) | existing helpers |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`.

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
   its owner.")`. The check is one `Set.has` per `update`. Why: maintainer decision (reject if not a bottleneck; one set
   lookup is not).
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
   §5 where the lost rule is mentioned.
9. **Geometry commits.** Decided: `transformRuntimeObjectsForGeometryCommit` calls `transformGeometry` on every
   registered owner (creatures, marmot and now assets) through the host, replacing the loop over
   `dynamicObjectRuntimes` for these kinds, and `rebuildStaticAssetRegistryObjects` stops deleting and re-adding assets.
   Flags and cannons keep their current code there.
10. **Rendering of assets.** Decided: nothing changes in how assets are drawn. They still read pose and cell from the
    registry. Only the writer changes.

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck`.

### Part A: registry ownership and the host

1. In `runtimeObjectRegistry.ts` add `claimOwnership`, `releaseOwnership` and the throwing checks of Decisions 2-3. Keep
   `add` working for owned ids only before the claim (the owner adds, then claims).
2. Create `worldObjectOwner.ts` with the interfaces and `createObjectHost` (Decision 4) and `PlainWorldObject`
   (Decision 5).
3. Tests (`tests/world-objects/runtimeObjectRegistry.test.ts` and new `worldObjectOwner.test.ts`):
   - an owned id: `update`, `moveToCell`, `remove` throw; the publisher works; a publisher given another id throws;
   - claiming an unknown or already claimed id throws; `releaseOwnership` restores normal writes;
   - `placeAt` on an unknown id returns false; on a `PlainWorldObject` the registry shows the new cell and pose;
   - `PlainWorldObject.transformGeometry` maps a pose through a translation map (write the expected numbers by hand).

### Part B: creatures and the marmot

1. Migrate `simpleGeoCreature.ts`: claim ownership, publish through the claimed function, implement `place`
   (Decision 7). Drop `syncRegistryObject`. Delete the lost rule (Decision 8). Keep `leaderForDebug` for the existing
   tests. Do the same for `geodesicMarmot.ts`.
2. In `createThreeApp.ts` register every creature and marmot with the host and unregister on dispose.
3. Tests in `simpleGeoCreature.test.ts` (replace the unreachable test 7 of job 36 with these):
   - `host.placeAt` 5 m away in the same cell: the creature's pose is the placed pose; the leader is on the creature
     (`leaderForDebug().creatureFromLeader` is identity); the next 100 ticks walk the geodesic from the new pose and
     heading, equal to a fresh creature started there;
   - `host.placeAt` into a different cell through the registry: `cellId` and the three.js parent follow after
     `syncParent`;
   - `registry.update` with a different pose for a creature id **throws**, and the creature's pose is unchanged;
   - the existing creature tests pass unchanged.

### Part C: static assets and geometry commits

1. In `createThreeApp.ts` create a `PlainWorldObject` per static asset registry record (where
   `createRuntimeStaticAssetObject` is called), register it with the host, and have `transformRuntimeObjectsForGeometryCommit`
   call `transformGeometry` on all owners (Decision 9). Remove the asset deletion/re-adding loop; keep rebuild for
   anything that is not owned.
2. Tests: a `PlainWorldObject` for an asset survives a deformation commit with its pose mapped (use an existing
   deformation helper from `tests/runtime/`); placed-by-`placeAt` assets keep their placement after the commit.
3. Run `npm run build` then `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. **Run the smoke
   after Part B and again after Part C**: a runtime-only error (such as a temporal-dead-zone from declaring a `const`
   after the setup code that reads it) is invisible to typecheck and vitest.
4. Update `_docs/MATHEMATICAL_MODEL.md` §5 (creatures), `_docs/ARCHITECTURE.md` (owners and host, registry as read model),
   run `npm run docs:generate`. Headers and JSDoc are required on every new export (`npm run docs:check`).

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build`, and the smoke command above all pass.

## Do not

- Do not change how flags, tools or geodesic cannons write to the registry.
- Do not put collision resolution, leaders or any object-kind knowledge in `placeAt` or the host.
- Do not add per-particle objects to the registry.
- Do not weaken existing creature tests; record any change under `### Deviations`.

## Done when

- Only owners can change the pose of creatures, the marmot and static assets; other writes throw.
- `objectHost.placeAt` moves any of them and a creature re-seeds its leader.
- The lost-leader rule is gone and the replacement tests pass.
- Smoke passes on all four worlds after Parts B and C.
- Report written per [README](README.md).
