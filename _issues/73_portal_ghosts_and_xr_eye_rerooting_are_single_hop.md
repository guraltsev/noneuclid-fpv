# 73 - Portal ghost records and XR eye re-rooting are single-hop

Status: open; re-verified 2026-10-28; fix designed 2026-10-29.

Priority: P2 (correctness, visible near cone vertices and portal corners).

Jobs: [17](../.agents/jobs/17_multi_hop_ghosts_and_eye_rerooting.md).

## Status update 2026-10-29

Design decided in [job 17](../.agents/jobs/17_multi_hop_ghosts_and_eye_rerooting.md) (not implemented yet):

- Ghosts come from the developed disk of [job 12](../.agents/jobs/12_segment_walk_kernel.md) instead of a vertex-link
  search. At a cone vertex the same cell can be reached in two copies; the explicit decision is: copies in the same cell
  whose centres are closer than 2·r **conflict**, and only the first one (breadth-first order) is kept. Prototype: the
  cube-vertex case gives one ghost each in `right` and `bottom`; the torus-corner case gives exactly 3 ghosts.
- Objects without collision use a render footprint radius computed from their source meshes.
- Depth-0 overhang: instances of one object that land on the same root placement are drawn once, keeping the lowest
  path depth (unclipped at depth 0). `omitRootVisiblePath` is not used for ghosts.
- Eye roots: walk from the player's anchor to the eye with `locateDevelopedPoint`.

## Status update 2026-10-28

Nothing in this issue has been fixed. Re-checked against the current code; the paths and line numbers in the evidence
below are updated (the ghost module is `src/render/three/runtimeObjectGhostRecords.ts`, now 99 lines).

Done:
- Nothing. The player rover no longer requests ghosts at all (`playerRoverModel.ts:40-54`: the `options` argument is
  ignored), which removes one caller but changes nothing for runtime objects.

Remains:
- `collectPortalGhostRuntimeObjectRenderRecords` still loops once over the sides of the object's own cell
  (`runtimeObjectGhostRecords.ts:70-96`), with no recursion and the `[-r, L+r]` projection box (`:80-83`).
- Objects without collision bounds still get no ghosts (`:55-60`).
- Ghost records still do not set `omitRootVisiblePath`, and depth-0 runtime instances are still drawn unclipped
  (`renderPortalInstances.ts:255-257`, `:273-277`). No overhang policy is documented.
- `resolveXrPortalEyeRenderRoot` still takes the first side in array order (`xrPortalEye.ts:53-73`); its doc
  comment still says chained crossings are unsupported (`:33`). No segment-walk kernel exists yet (issue 72).
- `tests/render-contract/runtimeObjectGhostRecords.test.ts` has 3 single-hop cases; none of the acceptance tests
  exist.

## Summary

Two render-side helpers assume that only one portal is involved at a time:

- `collectPortalGhostRuntimeObjectRenderRecords` emits one ghost per portal side the object touches. It emits no
  ghost of a ghost, so an object whose footprint contains a cell vertex is missing from every sector of the vertex
  link beyond the two adjacent cells.
- `resolveXrPortalEyeRenderRoot` re-roots an eye through the *first* portal side, in array order, whose plane the eye
  is behind. Near a corner where two portal sides meet, it can pick the wrong portal.

## Evidence

- `runtimeObjectGhostRecords.ts:70-96`: the loop runs over the sides of the object's own cell only. Each ghost is
  `transformToTarget * localPose` in `side.portal.targetCellId`. Nothing recurses from the target cell.
  - Scenario: a single-cell square torus of side L, with a marmot of radius 0.3 m at (0.1, 0.1). Its disk covers
    the four quadrants around the (single) vertex. Ghosts are emitted across x=0 and across y=0. The diagonal image
    (two hops) gets none. Through a depth-2 path that shows the diagonal sector, the marmot is cut along the images
    of both portal lines.
  - Cone vertices with total angle other than 2π and k cells in the link: an object containing the vertex is
    missing from k-3 sectors. It also has a self-overlapping image when the cone angle is below 2π. That case needs
    an explicit decision: clip by sector, or accept overlap.
- `runtimeObjectGhostRecords.ts:55-60`: objects without collision bounds get no ghosts at all, whatever their
  rendered extent. Any portal-renderable object without `collision` that is placed near a portal is cut at the
  aperture when seen from the other side.
- `runtimeObjectRenderRecords.ts:23` documents `omitRootVisiblePath` as "used for ghosts", but ghost records never
  set it (`runtimeObjectGhostRecords.ts:89-94`). Leaving it unset is correct when the viewer is in the ghost's cell.
  However, the true object at depth 0 is drawn unclipped (`renderPortalInstances.ts:273-277`, clip index -2), so its
  overhang past the portal plane coincides with the clipped depth-1 ghost. The two matrices
  `rootFromDest(path) * transformToTarget * localPose` and `localPose` differ only by rounding, so z-fighting is
  likely on the overhang. Verify on a headset.
- `xrPortalEye.ts:53-73` returns on the first side with `signedDistance < -1e-5` and the eye inside the side's
  extent. In a cell corner where portal sides A and B meet at less than 180°, a lean can put the eye behind both
  planes, and the chosen root depends on side order. The eye can also be behind A's plane but past its end
  (`projection > length`), having actually crossed B. The "within extent" test then rejects A and accepts B only if
  B is checked. When neither passes, the eye renders from the source root while it is outside the source cell.
  Chained crossings are explicitly unsupported (`:33`).

## Proposed change

1. **Ghosts by vertex-link closure.** For each object, compute its footprint radius r: the collision bounds, or the
   bounding radius of the rendered source meshes when there is no `collision`. Do a breadth-first search over
   `(cellId, M)` starting from `(object.cellId, I)`. From each node, cross any portal side whose plane lies within
   r + clearance of the object centre `M * c` *and* whose segment is within r of it (point-to-segment distance,
   not the current `[-r, L+r]` projection box). Emit a record per visited node except the start. Deduplicate
   visits by `(cellId, rounded M)`, and cap the hop count at the vertex-link size, which is computable from the
   compiled complex. This gives every sector of a vertex its image and handles self-glued cells.
2. Decide the depth-0 overhang policy: either clip the true object at depth 0 to its own cell (a side-plane clip in
   the shader for depth-0 runtime instances), or mark the coincident ghost so it is skipped. Document the choice on
   `omitRootVisiblePath`.
3. **Eye re-rooting by segment walk.** Walk the segment from the body's eye point (the player position at eye
   height in the source cell) to the eye position through portal sides. Use the same convex-cell exit computation
   as the ray walk in issue 72, chaining hops. The root is the cell that contains the eye, and `renderFromRoot` is
   the accumulated inverse map.

## Acceptance criteria

- Unit test (single-cell torus): an object at a corner yields exactly 3 ghost records, one per adjacent image
  including the diagonal, with matrices equal to the three developing-map translates.
- Unit test (a cone vertex with 3 cells): an object containing the vertex appears in every cell of the link exactly
  once.
- Unit test: an eye placed past a two-portal corner resolves to the same root and transform as the segment walk,
  independent of side order.
- Headset check: no z-fighting on an object straddling a portal when viewed head-on.


Status update 2026-10-29: implemented in [job 17](../.agents/jobs/_done/17_multi_hop_ghosts_and_eye_rerooting.md) (commit d96f09d); left open only for the headset check, see the job's Report.

