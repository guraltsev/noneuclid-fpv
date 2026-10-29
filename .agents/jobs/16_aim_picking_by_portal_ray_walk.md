# Job 16 - Aim picking by portal ray walk

Status: in progress.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md).

## Goal

The aim ray (desktop crosshair or XR controller) picks what it actually hits:

- it continues through a portal only where it really passes through the aperture, whatever the camera sees;
- walls and ceilings stop it;
- each cell copy along the ray is tested once, only for hits inside that cell's parameter window;
- all callers in one frame share one resolution per distinct ray.

## Depends on

[Job 12](12_segment_walk_kernel.md). Independent of jobs 13-15.

## Before you start

Line numbers are from commit `0d86165`.

| File | Lines | What |
| --- | --- | --- |
| `src/render/three/aimTarget.ts` | 1-320, 588-700, 1098-1164 | `AimTarget`, `ResolveAimTargetRequest`, `resolveAimTargets`, `resolveAimTargetsFromRootThreeRay` (the NDC gate at :170), `buildCellRayFromRootThreeRay`, `resolveObjectAimTargets`, `resolveFloorAimTarget`, helpers |
| `src/render/three/aimInteraction.ts` | all (315) | `resolveCurrentAimTargets` (:94-109) builds a camera from the ray and passes `getRuntimeObjectVisiblePaths()` |
| `src/render/three/rootAimRay.ts` | 1-70 | `RootAimRay` (Three.js root frame), `createAimTargetCycleSignature` (uses `portalPathId`) |
| `src/render/three/worldAxes.ts` | 1-60 | world (x, y, z-up) ↔ Three (x, z, −y); the **root cell's frame is the Three.js world frame** |
| `src/render/three/xrPlayerRig.ts` | 219-225 | `resolveSharedXrRenderRootCellId(pose) = pose.cellId` |
| `src/render/three/createThreeApp.ts` | 1308-1440 | where `activeAimRay` is resolved and used; tooltip, help lens, cross marker, protractor, cannon aim |
| `src/cell-complex/segmentWalk.ts` | all | job 12 |
| `tests/render-contract/aimTarget.test.ts` | all (948) | uses `visiblePortalPaths: [visiblePath(rootPath)]` everywhere |
| `tests/render-contract/geodesicCannonAimTarget.test.ts`, `aimCrossMarker.test.ts` | all | other aim users |

Baseline: `npm run typecheck`, `npm test`.

## Background

- **Root frame.** Rendering places the root cell (the player's cell, also in XR: `resolveSharedXrRenderRootCellId`) at
  the Three.js origin. So an aim ray in the Three root frame, converted with `threePointToWorld` /
  `threeDirectionToWorld`, is a ray in the root cell's local world frame (x, y, z-up).
- **The ray may start outside the root cell.** In XR the controller can be held through a portal. The player's anchor
  (`playerPose.position`) is always inside the root cell, so `locateDevelopedPoint(world, rootCellId, anchor_xy,
  origin_xy)` (job 12) gives the origin's real cell and the transform from the root frame to it.
- **3-D ray, 2-D walk.** Walls are vertical and gluings preserve z. Let `u` be the unit 3-D direction, `h = (u.x, u.y)`
  and `s = |h|`. A horizontal walk of length `s·T` along `h/s` covers the 3-D ray parameter t ∈ [0, T], with
  `t = t_h / s`. z along the ray is `o.z + u.z·t` in every cell. If s < 1e-6 the ray is vertical: no walk, only the
  origin cell.

## Decisions

1. **New core, same entry points.** Decided: implement `resolveAimTargetsByRayWalk(request)` in `aimTarget.ts` and make
   `resolveAimTarget` / `resolveAimTargets` call it. The request changes:
   `visiblePortalPaths` is **removed** and replaced by `rootCellId: string` and optional `rootAnchorPoint?: Vec3` (world
   axes, root frame; defaults to the ray origin). `camera` stays (the ray is still read from it).
   Why: the NDC gate is the defect; keeping a dead parameter would invite reuse.
2. **`portalPathId` becomes `hopCount`.** Decided: rename the `AimTarget` field to `hopCount: number` (portal crossings
   between the origin cell and the hit cell). Update `createAimTargetCycleSignature` and `logVerboseAimClick` to use it.
   Why: there is no visible-path id any more; the hop count distinguishes two copies of one object along the ray, which
   is what the cycle signature needs.
3. **Hit window per cell.** Decided: in the piece for cell k, accept object hits with 3-D distance
   t ∈ [tEnterₖ − 1e-6, tExitₖ + 1e-6], where the window is the piece's horizontal window divided by s, cut short by
   the floor or ceiling (below). Proxies that poke across the entry portal are therefore hit only in the cell copy where
   the ray actually is (issue 72: "hit at most once per hop").
4. **Floor, ceiling and too-low apertures.** Decided, per piece: `t_floor = −o.z/u.z` if u.z < 0; `t_ceiling =
   (h_k − o.z)/u.z` if u.z > 0 (h_k = cell k's height; o.z is the same in every cell). If either lies inside the window,
   the window ends there and the walk stops after this cell; a floor stop adds the floor target (outside forbidden
   columns, as today). At a portal exit, if the ray's z at `tExit` is above the target cell's height or above h_k,
   stop (the ray hits the wall above the lower aperture). At a wall exit, stop. Walls and ceilings are not targets.
5. **Maximum distance.** Decided: walk once to `maxEmitterDistanceMeters` (200 m) with `maxCrossings: 64`; accept
   ordinary objects and the floor only up to `maxDistanceMeters` (24 m) and cannons up to 200 m, as today.
6. **Distances and root points.** Decided: `distanceMeters` is the 3-D ray parameter t of the surface hit (the maps are
   rigid, so this equals today's root-frame distance). `rootPoint` / `rootNormal` map the cell-local point / normal back
   with `invertRigidTransform3(cellFromRoot)`, where `cellFromRoot = compose(piece.cellFromStart, originFromRoot)`.
   `localEyePosition` is the ray origin mapped into cell k.
7. **Per-frame cache.** Decided: `createAimInteraction` keeps one cache entry
   `{ key, targets }` where `key` is the ray's six numbers (origin and direction, exact equality) plus the ignored
   geodesic id plus a frame counter supplied by `createThreeApp` (`deps.getFrameSerial()`, incremented once per
   `renderFrame`). A call with the same key returns the cached targets. Why: issue 72 asks for at most one resolution
   per distinct ray per frame; the frame serial invalidates it when the registry changes between frames. Within a frame,
   a registry change between two aim calls (a click that creates an object) must clear the cache: call
   `aimInteraction.invalidateAimCache()` from the tool dispatch after any action that returns `true`
   (`primaryActionConsumed`).
8. **Aim after movement.** Decided: no change; `activeAimRay` is already resolved after movement and the rig sync
   (`createThreeApp.ts:1308`). The walk does not use visible paths, so the stale-path problem of issue 72 disappears.

## Steps

1. In `aimTarget.ts`, write `resolveAimTargetsByRayWalk`:

   ```text
   origin = threePointToWorld(rootOriginThree); u = normalize(threeDirectionToWorld(rootDirectionThree))
   anchor = request.rootAnchorPoint ?? origin
   loc = locateDevelopedPoint(world, rootCellId, xy(anchor), xy(origin))      // origin's cell
   if loc.status is not "end": return []                                      // e.g. origin behind a wall
   originFromRoot = loc.cellFromStart; originCellId = loc.cellId
   o = transformPoint3(originFromRoot, origin); d = transformDirection3(originFromRoot, u)
   s = hypot(d.x, d.y)
   pieces = s < 1e-6
     ? [{ cellId: originCellId, cellFromStart: identity, tEnter: 0, tExit: 0, exit: { kind: "end" } }]   // vertical ray
     : walkDevelopedSegment({ world, cellId: originCellId, start: xy(o), direction: (d.x/s, d.y/s),
                              lengthMeters: maxEmitterDistance·s, maxCrossings: 64 }).pieces
   for (k, piece) in pieces:
     window = [piece.tEnter / s, piece.tExit / s]  (vertical ray: [0, maxEmitterDistance])
     apply Decision 4 (may shorten the window and set stopAfterThisCell)
     ray in cell k: origin_k = cellFromStart(o), direction_k = R·d    (3-D, z unchanged)
     test objects of cell k as today (reuse resolveObjectAimTargets' proxy tests), keep hits with t in the window
     add the floor target when the window ends on the floor
     hopCount = k
     stop if stopAfterThisCell or the piece's exit is a wall
   sort with compareAimTargets (unchanged)
   ```

   Refactor `resolveObjectAimTargets` and `resolveFloorAimTarget` to take a plain cell-local ray
   `{ origin, direction }`, a `cellFromRoot: RigidTransform3` (for root points) and the window, instead of `CellRay`
   with a Three matrix. Delete `buildCellRayFromRootThreeRay`, `pathContainsNdcPoint`, `centerNdc`,
   `transformCellPointToRoot`/`transformCellDirectionToRoot` (replace with `transformPoint3`/`transformDirection3` of
   the inverse) and `rootDistance` (use t).
2. Change `ResolveAimTargetRequest` (Decision 1) and `AimTarget` (Decision 2). Fix the compile errors in
   `aimInteraction.ts`, `rootAimRay.ts`, `geodesicCannonTools.ts` and `createThreeApp.ts`: pass
   `rootCellId: deps.getPlayerPose().cellId` (add the getter to `AimInteractionDeps`; `createThreeApp` has
   `playerPose`) and `rootAnchorPoint` = the player's position raised to eye height (`DEFAULT_PLAYER_EYE_HEIGHT_METERS`).
   Remove `getRuntimeObjectVisiblePaths` from `AimInteractionDeps` if nothing else in that module uses it.
3. Add the cache (Decision 7).
4. Update the tests in `tests/render-contract/aimTarget.test.ts`: replace every `visiblePortalPaths: [visiblePath(rootPath)]`
   with `rootCellId: rootPath.destinationCellId` (a mechanical change). The two tests that aim **through** a portal
   ("resolves a floor point in a visible destination cell" :152 and "does not resolve floor aiming inside a forbidden
   zone" :175) relied on the clip polygon; set them up so the camera ray geometrically passes through the portal
   aperture, and keep their expectations. List every test whose expectation changed under `### Deviations`; per issue
   72 the only allowed changes are former phantom hits.

## Tests

New `describe("ray walk")` in `tests/render-contract/aimTarget.test.ts`, using `twoRoomsWithPortal`-style specs (copy
the helper; room height 2):

1. A ray from (0, −0.5, 1.45) in `room-a` through the east portal hits an object standing at (0, 0, 0.5) in `room-b`
   (issue 72 "controller ray through a portal while the camera looks elsewhere": there is no camera gate any more, so
   a plain ray suffices). `hopCount` is 1; `rootPoint` is the object's position in room-a's frame (x ≈ 2).
2. A ray toward a **wall** next to the portal (room-a whose north side is a wall and east side is a portal): no
   target in `room-b` is returned (issue 72 phantom hit).
3. An object in `room-b` whose cylinder straddles the portal back into `room-a` (centre 0.1 m inside `room-b`,
   radius 0.3): exactly one hit with this object id (issue 72 "at most once per hop").
4. An object in `room-b` whose cylinder pokes past `room-b`'s far wall: a ray that would hit only the overhang (beyond
   the wall) returns no hit for it.
5. A ray that rises through the portal above the target cell's height (room-b height 1.0, ray z = 1.2 at the portal):
   no targets in `room-b`.
6. Vertical ray straight down: the floor target in the origin cell.
7. Origin outside the root cell (XR hand through a portal): origin (1.2, 0, 1.4) in `room-a`'s frame, anchor
   (0.8, 0, 1.4), ray pointing straight down. The floor target is in `room-b` at local (−0.8, 0, 0), its `rootPoint` is
   (1.2, 0, 0), and `hopCount` is 0 (counted from the origin's own cell).
8. Cache: wrap `resolveAimTargetsByRayWalk` in a counter through the aim interaction (or count `walkDevelopedSegment`
   calls with `vi.spyOn` on the module namespace if that works with ESM; otherwise count by injecting the resolver
   into `createAimInteraction` deps). Three calls with the same ray in one frame resolve once; a new frame serial
   resolves again (issue 72 acceptance).

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`; browser smoke test once (`npm run smoke -- --world cube`).
Manual check (record if not run): in `?config=full`, aim at a flag through a portal; aim at a wall beside a portal and
see no flag behind it get highlighted.

## Bookkeeping

Close issue 72. In issue 71, add a dated line: "Aim no longer reads visible paths (job 16); only the instance-sync part
of this issue remains."

## Do not

- Do not change the proxy shapes, priorities or sticky targets (`compareAimTargets`, `isBetterAimTarget`, the
  intersection helpers).
- Do not change visibility, clip polygons or the instance sync.
- Do not make walls or the ceiling aim targets.

## Done when

- No code path in `aimTarget.ts` reads clip polygons or `VisiblePortalPath`.
- Tests 1-8 pass; changed old tests are listed.
- Issue 72 is closed.
