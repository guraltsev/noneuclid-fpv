# 71 - Runtime-object instance sync runs twice per frame, once against the wrong root table

Status: open as of 2026-10-08.

Priority: P2 (performance, with a correctness defect in single-view XR and on portal-crossing frames).

## Summary

Every frame rebuilds all runtime-object render records (ghosts included) four times and writes every runtime-object
`InstancedMesh` twice. The second write uses `getRuntimeObjectVisiblePaths()`. In mono mode that function joins
`latestVisibleResult` against the cull table of `playerPose.cellId`, which is not always the root the result was
computed for. The same stale join feeds aim picking (issue 72).

## Evidence

- `createThreeApp.ts:2494` and `:2506`: `applyPortalVisibleResult` and `applyPortalVisiblePaths` already call
  `syncRuntimeObjectPortalInstances(paths, cameraPositions)`. `renderFrame` then calls it again with default
  arguments at `:1427`. The defaults are `getRuntimeObjectVisiblePaths()` and the main-camera position (`:2576-2577`).
  The second call overwrites the first.
- `syncRuntimeObjectPortalInstances` (`:2579-2580`) runs `syncRuntimeObjectRenderSources`, which calls
  `collectRuntimeObjectRenderRecords()` (`:2662`), and then calls `collectRuntimeObjectRenderRecords()` again (`:2580`).
  That makes 2 collections per sync and 4 per frame. Each collection:
  - calls `runtimeObjectRegistry.getAll()`, which copies the whole object array (`runtimeObjectRegistry.ts:247-249`);
  - allocates a `Matrix4` per object (`createThreeApp.ts:2704`);
  - filters *all* archetype keys by string prefix for *each* object (`:2706-2707`), which is O(objects x total
    archetype keys). 40 flags with about 6 meshes each gives 240 keys, so 9,600 `startsWith` calls per collection and
    about 38k per frame;
  - recomputes the portal ghosts for every object (`:2717`, see issue 73);
  - for the rover, builds a fresh player collision state (`:2730`).
- `syncRuntimeObjectPortalInstances` also calls `syncSelectableHitboxDebug()` (`:2592`). With the
  `selectable-hitboxes` or `aim-collision-outlines` debug option on, that call disposes and rebuilds every hitbox
  mesh in every cell (`debugVisualization.ts:95-125`), so this happens twice per frame.
- **Wrong-root join.** `getRuntimeObjectVisiblePaths` (`createThreeApp.ts:2742-2745`) maps
  `latestVisibleResult.visiblePathById` through `tablesByRootCellId.get(playerPose.cellId)`. Path ids are local to the
  table of one root. Two cases break the join:
  1. Single-view XR (`xrEyeCameras.length <= 1`, `:1404`) where `resolvePortalEyeRenderRoot` re-roots into the
     neighbour cell (`xrPortalEye.ts:53-73`) while the body is still in the source cell. Path id k of the neighbour
     table is then looked up in the source table, so objects are instanced on the wrong paths or not at all. This
     lasts every frame the head leans through a portal.
  2. Any frame on which the player crosses a portal. Aim, tooltip and tool dispatch (`:1304-1354`, `:1409`) run
     after `playerPose` has moved to the new cell but before visibility is recomputed. They therefore join last
     frame's result, rooted in the old cell, against the new cell's table.
- The second call also drops the per-eye and `renderFromRoot` camera positions computed at `:2437-2439`, which the
  rover suppression (`playerRoverModel.ts:102-103`) relies on. The main camera happens to be close to the eyes, so the
  visible effect is small.

## Proposed change

1. Call `syncRuntimeObjectPortalInstances` exactly once per frame. Keep the calls inside `applyPortal*`. In the three
   "no table / no result" branches (`:2286-2300`, `:2350-2367`, `:2447-2459`), call it with `[]` and drop `:1427`.
2. Store the root cell id next to `latestVisibleResult`, or keep a `visiblePathsForObjects` list computed once in
   `applyPortal*`. Have `getRuntimeObjectVisiblePaths` return that cached list. It must not regroup against
   `playerPose.cellId`, and it must not rebuild per call (aim calls it 3-6 times per frame; see issue 75).
3. Collect records once per frame. Cache per object `{archetypeKeys, localMatrix, ghostRecords}` and invalidate
   it on registry `add/update/remove` (a version counter on the registry) and on geometry commit. Index archetype keys
   by object id when sources are registered, instead of prefix-filtering at `:2706`.
4. Rebuild selectable-hitbox debug meshes only when the registry version or the debug options change.

## Acceptance criteria

- A counter test shows `collectRuntimeObjectRenderRecords` running at most once per frame, and
  `updateRuntimeObjectRenderArchetypeInstances` running once per frame.
- A contract test re-roots a mono XR eye into a neighbour cell. Runtime-object instances for that frame must match
  a desktop render rooted in the neighbour cell, transformed by `renderFromRoot`.
- On a frame where the player crosses a portal, aim targets resolve against paths rooted in the cell those paths
  were computed for. Test with a portal-crossing step followed by `resolveCurrentAimTarget`.
- With 40 placed flags, the `objectsMs + portalMs` debug timings drop measurably. Record before/after numbers in
  the PR.
