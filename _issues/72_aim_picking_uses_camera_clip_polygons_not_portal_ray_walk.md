# 72 - Aim picking tests controller rays against head-camera clip polygons; replace with a portal ray walk

Status: open; implemented by job 16 on 2026-10-29, needs review (see the job report: _done/16_aim_picking_by_portal_ray_walk.md).

Priority: P1 (correctness in VR; also performance).

Jobs: [16](../.agents/jobs/16_aim_picking_by_portal_ray_walk.md).

## Status update 2026-10-29

Design decided in [job 16](../.agents/jobs/16_aim_picking_by_portal_ray_walk.md) (not implemented yet):

- The ray is walked with `walkDevelopedSegment` (job 12) in the horizontal plane; z is tracked along the 3-D ray.
  Floor, ceiling and the wall above a lower aperture stop it.
- The ray origin's cell is found by walking from the player's anchor to the origin (`locateDevelopedPoint`), so an XR
  controller held through a portal works.
- `ResolveAimTargetRequest` loses `visiblePortalPaths` and gains `rootCellId`; `AimTarget.portalPathId` becomes
  `hopCount`.
- One resolution per distinct ray per frame, keyed by the ray and a frame serial; tool actions invalidate the cache.

## Status update 2026-10-28

Nothing in this issue has been fixed. The aim picker is unchanged; line numbers in the evidence below are updated to
the current code.

Done:
- Partly addressed by reordering only: the frame now resolves one `activeAimRay` right after movement and the rig sync
  (`createThreeApp.ts:1308`), and tool dispatch uses it (`:1309-1357`). That ray is post-move, but the paths it is
  tested against are still last frame's.

Remains:
- `resolveAimTargetsFromRootThreeRay` still gates every path on `pathContainsNdcPoint(path, centerNdc)`
  (`aimTarget.ts:92`, `:145`, `:170`). There is no `resolveAimTargetsByRayWalk` and no shared segment-walk kernel
  (theme 1 of issue 50) in `src/math` or `src/cell-complex`.
- Object hits are still accepted for any `t > 1e-5` with no `[tStart, tExit]` window; walls and ceilings are not
  tested.
- Aim still reads `getRuntimeObjectVisiblePaths()` (`aimInteraction.ts:105`), with the root mismatch from issue 71.
- No per-frame cache: `resolveCurrentAimTarget` runs separately for tools, tooltip, help lens, cross marker,
  protractor feedback and cannon aim.
- None of the acceptance tests exist (`tests/render-contract/aimTarget.test.ts` covers proxy shapes and priorities
  only).

## Summary

`resolveAimTargets` decides which portal paths an aim ray continues through by checking whether NDC (0, 0), the
screen centre, lies inside each visible path's clip polygon. That test only makes sense for the desktop crosshair
ray. In XR the ray comes from the controller, but the clip polygons belong to the head/eye cameras, so the portal
gate tests where the user is *looking* instead of where they are *pointing*. Picking also depends on camera
visibility, runs several times per frame, and has no wall or ceiling occlusion.

## Evidence

- `aimInteraction.ts:121-126` (`syncAimRayCamera`) copies the controller pose into a pose-only `aimRayCamera`. `aimTarget.ts:92` and
  `:145` always pass `centerNdc`. `aimTarget.ts:170` keeps only paths with `pathContainsNdcPoint(path, {0,0})`. The
  polygons are the per-eye or union clip polygons in eye NDC (computed in `syncPortalInstanceRender` and `syncStereoPortalInstanceRender`, `createThreeApp.ts:2360`, `:2460`). Two failure scenarios
  in VR:
  - *Missed hit:* the user looks at a wall and points the controller sideways through a portal at a flag. The
    portal's clip polygon does not contain the view centre, so the path is skipped and the flag cannot be selected.
  - *Phantom hit:* the user looks through a portal and points the controller at a wall. The path passes the
    centre test, the controller ray is mapped by `rootFromDestination^-1` (`:214-216`), and it hits objects in the
    destination cell. Physically, the ray never passes through the aperture.
- *Hit interval not restricted.* After mapping, objects are tested for any `t > 1e-5` (`:236-285`), but only floor
  hits check cell containment (`:613`, `:667-670`). Object proxies extend beyond the cell: the collision cylinder,
  the cannon cylinder plus sphere (`:879-907`), and geodesic capsules of radius 0.187 m (`:112`). So a ray can hit:
  - the part of a destination-cell object that pokes back in front of the portal plane, which is a duplicate of
    the ghost or root hit;
  - an object overhang beyond a *wall* of the destination cell, i.e. in a region the path does not show.

  Walls and ceilings are never tested at all, so nothing occludes a hit except other proxies and the floor.
- *Visibility-dependent:* only paths that survive camera culling, the area threshold and the `maxVisiblePaths` budget
  are candidates (`aimInteraction.ts:105`). In XR a controller ray aimed outside the view frustum, or through a portal
  under 16 px of screen area, cannot reach the far side.
- *Stale paths:* aim runs at `createThreeApp.ts:1308-1357` (tools), `:1413-1414` (tooltip, help) and `:1436-1437`
  (cross marker, protractor). Visibility is recomputed at `:1421-1430`. Tools and tooltip therefore use the previous
  frame's paths, while the cross marker uses this frame's. On portal boundaries, the marker can show target A while
  the click acts on target B. See issue 71 for the crossing-frame root mismatch.
- *Metric:* distances are consistent. The root-frame distance (`:1116-1120`) equals the cell-local distance because
  the maps are rigid. This is not a defect; it is a ready-made invariant for the ray walk below.
- *Cost:* each call clones and inverts a `Matrix4` per candidate path and clones two `Vector3`s (`:214-216`). It
  calls `registry.getObjectsInCell`, which allocates 3 arrays (`runtimeObjectRegistry.ts:226-229`), and allocates
  hit objects per proxy. Full resolution runs 3-6 times per frame on identical input: tooltip `:3298`, help lens
  `:3474` and `:3496`, cross marker `:3341`, protractor `:3372`, cannon aim `geodesicCannonTools.ts:1161`, and tool clicks.

## Proposed change

Replace the NDC gate with a deterministic **portal ray walk** in cell-local coordinates (`resolveAimTargetsByRayWalk`):

1. Start in the root cell, which is the eye's render root (`XrPortalEyeRenderRoot`) for XR. Express the ray in
   that cell's local frame (`threePointToWorld`), with `tStart = 0` and accumulated rigid map `M = I`.
2. In the current convex cell, compute the exit parameter `tExit` = the smallest `t > tStart` over the side planes
   (`signedDistanceToSide` along the ray), the floor `z = 0` and the ceiling `z = height`.
3. Test object proxies in that cell, but accept only hits with `t` in `[tStart, tExit]`. This rejects overhangs in
   front of the entry portal and beyond the exit face. The floor is a hit at `tExit` when the exit face is the floor
   and the point is outside forbidden columns.
4. If the exit face is a wall or the ceiling, stop. If it is a portal side and the exit point lies within the
   aperture (side extent, `z < min(heights)`), map the ray through `portal.transformToTarget`, set
   `M = M * transformToTarget^-1`, set `tStart = tExit`, and continue. Stop at `maxDistanceMeters` or a hop limit
   such as `rootRenderPathMaxDepth`.
5. Report `rootPoint = M * localPoint` and `distanceMeters = t`. The ray parameter is metric because the maps are
   rigid. `portalPathId` becomes the hop word, or the matching static path id if callers still need one.

This is independent of camera visibility, correct for controller rays, gives wall and ceiling occlusion for free,
and costs O(hops x objects in visited cells), with no matrix inversions.

Also cache the result per frame, keyed by ray origin and direction (exact equality). Every caller in one frame then
shares one walk. Run aim after movement, using the post-move root.

## Acceptance criteria

- Unit test: a controller ray that passes through a portal aperture while the camera looks elsewhere hits the
  object behind the portal.
- Unit test: a controller ray that hits a wall next to a portal returns no destination-cell targets, even when the
  camera centre is inside that portal's clip polygon.
- Unit test: an object in the destination cell whose proxy straddles the entry portal is hit at most once per hop.
  An overhang beyond a destination wall is not hit.
- Desktop crosshair results match the current implementation on the existing aim tests, except where the old
  behavior was a phantom hit.
- At most one full aim resolution per frame per distinct ray. Verify with a counter in a test harness.
