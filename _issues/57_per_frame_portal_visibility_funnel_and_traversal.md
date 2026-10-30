# 57 - Per-frame portal visibility: visit only visible parents, use the exact 2.5D funnel, stop leaving background holes

Status: open; implemented by job 21, which ended "done, needs review" (manual checks not run); see the Report in `.agents/jobs/_done/21_per_frame_visibility_funnel.md`. Re-verified 2026-10-28.

Priority: P2 (performance / robustness). Issue 21 (closed 2026-10-28, merged here) covered the general goal of fewer hot-loop allocations; this issue gives
the concrete algorithmic replacement.

Jobs: [21](../.agents/jobs/21_per_frame_visibility_funnel.md).

## Status update 2026-10-29

Re-checked at `0b468e1`: unchanged; `visiblePortalPaths.ts` line references below still hold. Stale references: the
16 px threshold is now at `createThreeApp.ts:2502` (mono), `:2573` (shared-root stereo) and `:2602` (split-root
stereo); `maxKeptPathsPerRoot` is at `createThreeApp.ts:788`. Job 21 decides that the terminal fill is the scene
background, which already equals the fog colour (`createThreeApp.ts:420-422`), and that zero allocation per *returned*
path is left to job 24 (per *examined* path it is zero).

## Status update 2026-10-28

Nothing in the proposal is implemented. `computeVisiblePortalPaths` and `computeIndependentVisiblePortalPaths`
(`src/render/three/visiblePortalPaths.ts`) still scan the whole kept table with near-plane projection and
Sutherland-Hodgman. Every evidence item below still holds; line numbers have been updated. The 16 px threshold now
appears in three places in `createThreeApp.ts`: the mono pass (`:2369`), the shared-root stereo pass (`:2440`) and the
split-root stereo pass (`:2469`). No benchmark, brute-force ray-walk property test or allocation counter exists.
Issue 21's unfinished steps 3 and 4 (hierarchical traversal, allocation) are the same work as steps 1 and 5 here.

## Summary

`computeVisiblePortalPaths` scans the entire static table every frame, for every eye. It projects each aperture with a
near-plane clip and a "near-coplanar" heuristic, then intersects screen polygons with Sutherland-Hodgman. In this world
every aperture is a vertical floor-to-ceiling quad and gluing preserves z, so the exact visible region of a path is a
cone bounded by at most 4 planes through the eye. It can be computed in O(1) per path, with no projection and no near
plane. Paths culled by the area threshold or the depth limit also leave pixels where nothing is drawn.

## Evidence

- `visiblePortalPaths.ts:195-225`: `for (const path of input.pathTable.paths)` runs over all kept paths, up to 50 000 per
  root (`createThreeApp.ts:767`), and pays a `Map.get` on each one to find out that its parent is invisible. In stereo
  (`:291`) this happens once per camera. The cost is O(table), whereas the work needed is O(visible x degree).
  `pathsByParentPathId` already exists and is never used here.
- `visiblePortalPaths.ts:615-630`: `createVisiblePath` rebuilds `rigidTransformToThreeMatrix(path.rootFromDestination)`
  for every visible path on every frame, although the transform is static per path. `portalEyeFrameTransforms.ts:48` (`transformVisiblePortalResultToRenderFrame`)
  then clones it again. Further per-path allocations: `projectRootSpacePointsToNdc` (`:378`, `:438`, `:691`), the hull
  (`:778`, `:809`), the Sutherland-Hodgman arrays (`:461`, `:647`) and `ndcRectForPolygon` (`:487-499`, four spreads).
- `visiblePortalPaths.ts:385`: `near` falls back to 0.01 because the XR culling cameras are plain `THREE.Camera`
  objects (`createThreeApp.ts:425`, `xrPlayerRig.ts:145-165`, `syncXrViewCullingCameras`) with no `near` field. The actual near plane in the
  WebXR projection matrix is different (0.03, `renderCameraClip.ts:11`). The mismatch errs on the conservative side,
  but it is accidental.
- `visiblePortalPaths.ts:407-435`: `projectNearCoplanarPortalToNdc` uses the distance to the *infinite* plane plus a
  hard-coded 5 cm. The near-plane clip can lose rays that cross the portal at depth below `near`. That is safe only
  because such points project outside the screen when lateral/|z| > 2.47, i.e. when the half-FOV is below 68°.
  Wide-FOV headsets violate this.
- `visiblePortalPaths.ts:217`: if the area is below `minPortalScreenAreaPixels` (16, `createThreeApp.ts:2369`, `:2440`, `:2469`), the path
  and its whole subtree are dropped. Sibling clip polygons are disjoint, so no other instance covers those pixels, and
  they show the clear color. At grazing angles this appears as 1-2 px flickering lines along door jambs. The depth limit
  of 10 and the `maxVisiblePaths` cut produce the same kind of hole at terminal portals.
- `visiblePortalPaths.ts:602-613` (`projectRootSpacePointsToConservativeNdc`): the multi-camera conservative hull, `computeVisiblePortalPaths({cameras})`, has no
  production caller; stereo uses `computeIndependentVisiblePortalPaths`. It is also unsafe as a *clip* polygon. The
  developing map is not injective at cone points with angle sum > 2π, so an over-large clip polygon draws one developed
  copy over another rather than merely drawing extra fragments that fail the depth test.

## Proposed change

1. **Traversal.** Recurse from the root with an explicit stack over `pathsByParentPathId.get(parent.id)`, pushing only
   visible children. If the static table is retired (issue 60), recurse over `cell.portals` instead.
2. **Exact funnel (equal heights).** Let E be the eye in the root frame (plan point e, height z_e in (0, h)).
   - For portal i, developed endpoints A_i and B_i. Reject the path if E is not strictly on the inner side of p_i's
     developed line. This test is necessary, and it is exact together with what follows.
   - Plan sector S_i = {d : cross(A_i - e, d) >= 0 and cross(d, B_i - e) >= 0}, oriented so that the sector is less
     than π.
   - Visible directions W_p = S_1 ∩ ... ∩ S_k. Keep it as two boundary vectors (wL, wR) and update in O(1):
     wL <- the more clockwise-inner of wL and A_k - e, and similarly for wR. The path is empty when
     cross(wL, wR) <= 0.
   - Vertically, every ray inside W_p reaches p_k last and all ceilings have the same height h, so only p_k's top and
     bottom edges bind.
   - The exact visible cone is therefore the intersection of 4 half-spaces through E: the two vertical planes through E
     along wL and wR, the plane through E and p_k's top edge, and the plane through E and p_k's bottom edge.
   - No near plane and no projection are involved. The proof is the convex-cell ordering argument in issue 56.
     Unequal heights (issue 41) would need up to k top/bottom planes; fall back to the current polygon path in that case.
3. **Screen data only for ranking.** Project the four corner rays of the cone to get the area and rectangle used for
   sorting and for debugging. This is the only step that touches the projection matrix. For it, clip in homogeneous
   space against the four side planes |x| <= w and |y| <= w (Blinn-Newell), with no near plane.
4. **No holes.** Replace "area < 16 px ⇒ drop subtree" with "area < threshold ⇒ keep this path, do not recurse". Also
   give paths at the depth or budget limit a terminal fill: draw their clip region with a fog-colored full-screen
   instance, or set a flag that the fragment shader turns into fog. The cost is one extra instance per terminal path.
5. **Allocation.** Cache the Three.js `Matrix4` on the path, or in a parallel `Float32Array` indexed by path id. Keep
   per-frame state in preallocated typed arrays: wL/wR, 4 planes, area and parent index per stack slot. Delete the hull
   code, or rename it so that it cannot be used as a clip source.

## Acceptance criteria

- Per-frame CPU visibility is O(visible paths x degree). A benchmark on the default world at depth 10 shows the
  per-eye cost independent of the static table size.
- A property test compares random cameras (including within 1 cm of a portal, pitched and rolled, with half-FOV up to
  80°) against brute-force per-pixel ray walking through the cell complex. There are no false negatives, and the
  visible region matches to within 1 px.
- No clear-color pixels appear along grazing portals in a scripted grazing-angle walk. Use a screenshot diff or a
  readPixels count of the clear color.
- `visiblePortalPaths` allocates nothing per visible path in steady state (heap-snapshot test or allocation counter).

## Merged from issue 21 (2026-10-28)

Issue 21's unfinished steps are tracked here:

- Hierarchical traversal (its step 3): expand children based on *pre-budget* visibility, so deep paths do not vanish
  when the final sorted budget truncates their parents. Acceptance: the traversal produces the same visible set as the
  full-table scan, in contract tests for both mono and the shared-root stereo pass
  (`computeIndependentVisiblePortalPaths`).
- Allocation (its step 4): reuse scratch vectors and polygon buffers, clone matrices and polygons only after a path
  survives, and avoid transient maps in inner loops. Document scratch-buffer ownership in code comments. Current
  allocations: per-path `rigidTransformToThreeMatrix`, NDC projection arrays, Sutherland-Hodgman arrays, and a matrix
  `clone()` in `transformVisiblePortalResultToRenderFrame`.
