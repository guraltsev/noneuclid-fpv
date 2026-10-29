# 71 - Runtime-object instance sync runs twice per frame, once against the wrong root table

Status: open; re-verified 2026-10-28.

Priority: P2 (performance, with a correctness defect in single-view XR and on portal-crossing frames).

Jobs: [28](../.agents/jobs/28_frame_snapshot_instance_sync.md).

## Status update 2026-10-28

Nothing in this issue has been fixed. Re-checked against the current `src/render/three/createThreeApp.ts` (3,555
lines); the line numbers in the evidence below are updated to it.

Done:
- Nothing. The only change is incidental: `playerRoverModel.collectRecords` now ignores its `options` argument
  (`playerRoverModel.ts:40-54`), so the rover no longer computes ghosts. `collectRuntimeObjectRenderRecords` still
  builds `createPlayerCollisionState(playerPose)` for it on every call (`createThreeApp.ts:2787`) and throws it away.

Remains:
- The second `syncRuntimeObjectPortalInstances()` call in `renderFrame` (`:1431`) is still there, after the
  `applyPortal*` calls (`:2551`, `:2563`).
- `collectRuntimeObjectRenderRecords` still runs twice per sync (`:2637` and inside `syncRuntimeObjectRenderSources`
  at `:2719`), so 4 times per frame.
- `getRuntimeObjectVisiblePaths` (`:2793-2811`) still joins `latestVisibleResult` against the table of
  `playerPose.cellId`. No root id is stored with the result.
- `syncSelectableHitboxDebug()` is still called on every sync (`:2649`).
- No registry version counter (`runtimeObjectRegistry.ts`), no counter test, no mono-XR re-root contract test.

## Summary

Every frame rebuilds all runtime-object render records (ghosts included) four times and writes every runtime-object
`InstancedMesh` twice. The second write uses `getRuntimeObjectVisiblePaths()`. In mono mode that function joins
`latestVisibleResult` against the cull table of `playerPose.cellId`, which is not always the root the result was
computed for. The same stale join feeds aim picking (issue 72).

## Evidence

- `createThreeApp.ts:2551` and `:2563`: `applyPortalVisibleResult` and `applyPortalVisiblePaths` already call
  `syncRuntimeObjectPortalInstances(paths, cameraPositions)`. `renderFrame` then calls it again with default
  arguments at `:1431`. The defaults are `getRuntimeObjectVisiblePaths()` and the main-camera position (`:2633-2634`).
  The second call overwrites the first.
- `syncRuntimeObjectPortalInstances` (`:2636-2637`) runs `syncRuntimeObjectRenderSources`, which calls
  `collectRuntimeObjectRenderRecords()` (`:2719`), and then calls `collectRuntimeObjectRenderRecords()` again (`:2637`).
  That makes 2 collections per sync and 4 per frame. Each collection:
  - calls `runtimeObjectRegistry.getAll()`, which copies the whole object array (`runtimeObjectRegistry.ts:247-249`);
  - allocates a `Matrix4` per object (`createThreeApp.ts:2761`);
  - filters *all* archetype keys by string prefix for *each* object (`:2763-2764`), which is O(objects x total
    archetype keys). 40 flags with about 6 meshes each gives 240 keys, so 9,600 `startsWith` calls per collection and
    about 38k per frame;
  - recomputes the portal ghosts for every object (`:2774`, see issue 73);
  - for the rover, builds a fresh player collision state (`:2787`), which `collectRecords` now ignores.
- `syncRuntimeObjectPortalInstances` also calls `syncSelectableHitboxDebug()` (`:2649`). With the
  `selectable-hitboxes` or `aim-collision-outlines` debug option on, that call disposes and rebuilds every hitbox
  mesh in every cell (`debugVisualization.ts:95-156`), so this happens twice per frame.
- **Wrong-root join.** `getRuntimeObjectVisiblePaths` (`createThreeApp.ts:2793-2803`) maps
  `latestVisibleResult.visiblePathById` through `tablesByRootCellId.get(playerPose.cellId)`. Path ids are local to the
  table of one root. Two cases break the join:
  1. Single-view XR (`portalCullingCameras.length <= 1`, `:1421-1429`) where `resolvePortalEyeRenderRoot` re-roots into the
     neighbour cell (`xrPortalEye.ts:53-80`) while the body is still in the source cell. Path id k of the neighbour
     table is then looked up in the source table, so objects are instanced on the wrong paths or not at all. This
     lasts every frame the head leans through a portal.
  2. Any frame on which the player crosses a portal. Aim, tooltip and tool dispatch (`:1307-1357`, `:1412-1413`) run
     after `playerPose` has moved to the new cell but before visibility is recomputed. They therefore join last
     frame's result, rooted in the old cell, against the new cell's table.
- The second call also drops the per-eye and `renderFromRoot` camera positions computed at `:2385` (mono) and `:2494-2496` (stereo), which the
  rover suppression (`playerRoverModel.ts:103`) relies on. The main camera happens to be close to the eyes, so the
  visible effect is small.

## Proposed change

1. Call `syncRuntimeObjectPortalInstances` exactly once per frame. Keep the calls inside `applyPortal*`. In the three
   "no table / no result" branches (`:2343-2358`, `:2407-2424`, `:2504-2517`), call it with `[]` and drop `:1431`.
2. Store the root cell id next to `latestVisibleResult`, or keep a `visiblePathsForObjects` list computed once in
   `applyPortal*`. Have `getRuntimeObjectVisiblePaths` return that cached list. It must not regroup against
   `playerPose.cellId`, and it must not rebuild per call (aim calls it 3-6 times per frame; see issue 75).
3. Collect records once per frame. Cache per object `{archetypeKeys, localMatrix, ghostRecords}` and invalidate
   it on registry `add/update/remove` (a version counter on the registry) and on geometry commit. Index archetype keys
   by object id when sources are registered, instead of prefix-filtering at `:2763-2764`.
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
