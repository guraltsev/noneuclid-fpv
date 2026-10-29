# Job 17 - Multi-hop portal ghosts and XR eye re-rooting

Status: done, needs review on 2026-10-29.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [73](../../_issues/73_portal_ghosts_and_xr_eye_rerooting_are_single_hop.md) and the "Ghosts" item of
issue [63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md).

## Goal

1. Ghost render records come from the developed disk around the object (job 12), so an object near a vertex shows in
   every sector of the vertex, not only in the cells one portal away.
2. Objects without collision bounds get ghosts too, sized by their rendered meshes.
3. The real object and a ghost that land on the same place on screen are drawn once (no z-fighting).
4. The XR eye render root is found by walking from the player to the eye, not by the first side in array order.

## Depends on

[Job 12](12_segment_walk_kernel.md). Independent of jobs 13-16.

## Before you start

Line numbers are from commit `0d86165`.

| File | Lines | What |
| --- | --- | --- |
| `src/render/three/runtimeObjectGhostRecords.ts` | all (99) | `collectPortalGhostRuntimeObjectRenderRecords`, `defaultPortalGhostActivationClearanceMeters = 0.02` |
| `src/render/three/runtimeObjectRenderRecords.ts` | 1-60 | `RuntimeObjectRenderRecord` (`omitRootVisiblePath` documented "used for ghosts" but never set), `RuntimeObjectRenderSourceMesh` |
| `src/render/three/renderPortalInstances.ts` | 225-290 | `updateRuntimeObjectRenderArchetypeInstances`: one instance per (record, visible path of the record's cell); depth-0 paths are unclipped |
| `src/render/three/createThreeApp.ts` | 2427-2433, 2864-2900 | `resolvePortalEyeRenderRoot`, `collectRuntimeObjectRenderRecords` |
| `src/render/three/playerRoverModel.ts` | 40-110 | the rover's records (sets `omitRootVisiblePath`; does not request ghosts) |
| `src/render/three/xrPortalEye.ts` | all (98) | `resolveXrPortalEyeRenderRoot`, `transformCameraThroughPortal` |
| `src/render/three/worldAxes.ts` | 50-90 | `rigidTransformToThreeMatrix` |
| `src/cell-complex/developedDisk.ts`, `src/cell-complex/segmentWalk.ts` | all | job 12 |
| `tests/render-contract/runtimeObjectGhostRecords.test.ts`, `runtimeObjectPortalInstances.test.ts` | all | existing single-hop tests and instance tests |

Baseline: `npm run typecheck`, `npm test`.

## Background

- A ghost record says "draw this archetype in cell D at `localMatrix`". The instancer draws it once per visible path
  ending in D. For an object of cell C straddling the portal Câ†’D, the ghost in D seen through that portal lands at the
  same root-frame place as the real object drawn at depth 0. Both are drawn; the depth-0 copy is unclipped, so on the
  overhang the two copies coincide up to rounding and z-fight (issue 73 item 2).
- The developed disk of job 12 lists every cell copy that the disk of radius Ï around a point reaches, each with its
  transform `cellFromStart` and the wedge of directions that reach it. Around a flat vertex (total angle 2Ï€, every
  torus corner) the copies tile the disk with no overlap. Around a cone vertex (cube: 3Ï€/2; genus-2 octagon: 6Ï€) the
  same cell can appear in two copies with different transforms. Each covers a different wedge, but a whole mesh drawn
  at each copy's pose would overlap itself in that cell. Meshes cannot be clipped to a wedge without new shader work.
- Checked numbers (job 12 prototype, run on 2026-10-29 with the rule of Decision 2):
  - `cube`, object radius 0.3 at 0.1 m from a vertex of `front`, Ï = 0.32: 5 nodes (`front`, `bottom`, `right`, and
    second copies of `right` and `bottom` reached around the other side of the vertex). After Decision 2: one ghost in
    `bottom` and one in `right`.
  - `torusModuli`, radius 0.3 at (7.3, 7.3): 5 nodes (the cell, two side translates, and the diagonal translate twice,
    once through each wedge, at the **same** place). After Decision 2: 3 ghosts at (âˆ’7.7, 7.3), (7.3, âˆ’7.7) and
    (âˆ’7.7, âˆ’7.7).

## Decisions

1. **Ghosts from the developed disk.** Decided: `collectPortalGhostRuntimeObjectRenderRecords` builds
   `collectDevelopedDisk({ world, cellId: object.cellId, center: c, radiusMeters: r + activationClearance })` and emits one
   record per node except the root, with `localMatrix = rigidTransformToThreeMatrix(compose(node.cellFromStart, object.localPose))`
   and `cellId = node.cellId`. c is the horizontal centre of the collision bounds, or the anchor when there are none.
2. **Conflict rule at cone vertices.** Decided: two nodes in the **same cell** conflict when the ghost centres
   (`node.cellFromStart(c)`) are closer than 2Â·r in that cell's frame. Process the nodes in the order
   `collectDevelopedDisk` returns them (breadth-first, so depth never decreases); keep a node only if it conflicts with
   no node kept before it. The root node (the real object) is always kept first and emits no record. This also merges
   the two nodes of one flat copy that is reached through two wedges (the torus diagonal). Why: this gives each sector of a
   cone vertex exactly one image (issue 73 acceptance), and keeps all translates on a flat torus, whose copies are 15 m
   apart. It is the "clip by sector, or accept overlap" choice issue 73 asked for: **neither**: overlapping duplicates
   are dropped, which can leave a small part of an object containing a cone point undrawn in one sector. Record this in
   `_docs/MATHEMATICAL_MODEL.md` Â§8.
3. **Footprint radius.** Decided: r = the collision radius when the object has collision bounds; otherwise the
   horizontal render footprint: the largest horizontal distance (Three x and z) from the object root to any corner of
   any source mesh's bounding box, expressed in the object root's frame. Compute it once per object prefix where the
   render sources are collected, in a new exported helper
   `computeRenderSourceFootprintRadius(sources: readonly RuntimeObjectRenderSourceMesh[]): number` in
   `runtimeObjectRenderRecords.ts`, and pass it to the ghost function as `footprintRadiusMeters`. If an object has
   neither (no sources yet), emit no ghosts, as today.
4. **No double drawing.** Decided: in `updateRuntimeObjectRenderArchetypeInstances`, before writing instances for an
   archetype, compute for each candidate instance (record, path) a placement key: `objectId`, the composed matrix's
   translation (elements 12, 13, 14) and its first column (elements 0, 1, 2), each rounded to 1e-4. For each key keep
   only the candidate with the smallest `path.depth` (ties: the first). Then write the kept instances. Why: the copy at
   the lowest depth has the loosest clip (depth 0 is unclipped), so the overhang keeps its correct, unclipped look and
   the coincident ghost disappears. `omitRootVisiblePath` keeps its current meaning (the rover); update its doc comment:
   remove "used for ghosts".
5. **Eye root by walk.** Decided: `resolveXrPortalEyeRenderRoot` gains `anchorPoint: Vec3` (the player's position in
   the source cell, world axes) and uses `locateDevelopedPoint(world, sourceCellId, anchor_xy, eye_xy)`. Status `end`
   with a different cell (or the same cell with a non-identity transform, a self-glued cell) re-roots: `rootCellId` =
   the located cell, camera = clone with `matrixWorld` premultiplied by `rigidTransformToThreeMatrix(cellFromStart)`,
   `renderFromRootMatrix` = that matrix inverted. Status `wall`, `start-outside` or any failure: no re-root (today's
   fallback). Keep today's height test (eye z within [âˆ’1e-5, source height + 1e-5]); outside it, no re-root.
   Why: issue 73 proposed change 3; the walk crosses every portal in order and does not depend on side order.

## Steps

1. Rewrite `collectPortalGhostRuntimeObjectRenderRecords` (Decisions 1-3). The request gains
   `footprintRadiusMeters?: number`. Keep the exported name and `defaultPortalGhostActivationClearanceMeters`.
   Update the module header comment.
2. Add `computeRenderSourceFootprintRadius` and pass the radius from `collectRuntimeObjectRenderRecords` in
   `createThreeApp.ts` (compute it once per prefix and cache it in a `Map<string, number>` next to
   `runtimeObjectRenderSourcesByKey`; clear the cache wherever that map is rebuilt).
3. Instance dedupe in `renderPortalInstances.ts` (Decision 4).
4. Rewrite `resolveXrPortalEyeRenderRoot` (Decision 5); `createThreeApp.ts` passes
   `anchorPoint: playerPose.position`. Delete `transformCameraThroughPortal` if unused, or make it take a
   `RigidTransform3`.
5. Docs: `_docs/MATHEMATICAL_MODEL.md` Â§8 gets a short paragraph on ghosts (Decisions 1, 2, 4) and on eye roots
   (Decision 5).

## Tests

In `tests/render-contract/runtimeObjectGhostRecords.test.ts` (keep the three existing single-hop tests; if one fails,
check whether the new answer is the correct multi-hop one and record it):

1. Issue 73 acceptance, flat torus: `torusModuli` (one 15 Ã— 15 cell centred on the origin), object with collision
   radius 0.3 at (7.3, 7.3): exactly 3 ghost records, all in `torus-room`; their translations are the object's
   translated by (âˆ’15, 0), (0, âˆ’15) and (âˆ’15, âˆ’15) (in world axes, read back from the Three matrix with
   `threePointToWorld`), each within 1e-9.
2. Issue 73 acceptance, cone vertex: `cube`, object of radius 0.3 at 0.1 m from a vertex of `front` (on the line to the
   cell's vertex average): the records' cell ids are exactly the two other cells at that vertex, once each (the real
   object covers `front`).
3. An object without collision but with `footprintRadiusMeters: 0.4` near a portal gets a ghost; with no radius it gets
   none.
4. An object 2 m from every side gets no ghosts.

In `tests/render-contract/runtimeObjectPortalInstances.test.ts`:

5. A record at depth 0 and a ghost record whose composed matrix through a depth-1 path equals it: one instance is
   written, with the unclipped index.
6. Two records of the same object at different places: both written.

`computeRenderSourceFootprintRadius`: a unit box mesh at the root gives âˆš2/2 Â· 1 = 0.7071 within 1e-9 (half-diagonal of
the 1 Ã— 1 footprint).

In a new `tests/render-contract/xrPortalEye.test.ts`:

7. Issue 73 acceptance: a square cell whose east and north sides are portals to two neighbours; anchor at (0.8, 0.8),
   eye at (1.1, 1.05) (past the corner, behind both side lines). Build the same world twice with the base vertex list
   rotated by one place (so the side order differs). Both give the same `rootCellId` and the same
   `renderFromRootMatrix` within 1e-9, and both equal what `locateDevelopedPoint` returns.
8. The eye inside the cell: no re-root, identity matrix, the same camera object.
9. The eye behind a wall: no re-root.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`; smoke test once (`npm run smoke -- --world cube,torus-moduli`).

Headset check (issue 73 acceptance; record as not done if no headset): stand next to an object that straddles a portal
and look at it head-on; no flicker on the overhang.

## Bookkeeping

Close issue 73 (the headset check may stay open as a one-line note if it was not run: then set the job to
"done, needs review" per the README). In issue 63 (closed by job 13), add a dated line pointing to this job for the
ghost item.

## Do not

- Do not change the player rover's records.
- Do not add shader clipping for depth-0 instances.
- Do not change stereo split roots (job 23) beyond passing the anchor.

## Done when

- Ghosts come from `collectDevelopedDisk`; the `[-r, L+r]` projection window is gone.
- Instances are deduplicated by placement; the eye root uses `locateDevelopedPoint`.
- Tests 1-9 pass.

## Report

### Done
Commit d96f09d. `runtimeObjectGhostRecords.ts` rewritten: ghosts from `collectDevelopedDisk` (radius r + 0.02), conflict rule of Decision 2, footprint radius from collision or `footprintRadiusMeters`. Added `computeRenderSourceFootprintRadius` in `runtimeObjectRenderRecords.ts` (doc of `omitRootVisiblePath` fixed); `createThreeApp.ts` passes the radius (cached per archetype-key prefix, revalidated by the identity and count of the cached sources) and `anchorPoint: playerPose.position`. `renderPortalInstances.ts`: placement dedupe (two passes, lowest depth, ties first). `xrPortalEye.ts`: re-root by `locateDevelopedPoint`; `transformCameraThroughPortal` replaced by a `RigidTransform3` version. Docs: MATHEMATICAL_MODEL section 8, ARCHITECTURE, regenerated references. Tests 1-9 plus the footprint test: ghost tests and footprint in `runtimeObjectGhostRecords.test.ts`, instance tests in `runtimeObjectPortalInstances.test.ts`, new `xrPortalEye.test.ts`.

### Deviations
- `runtimeObjectPortalInstances.test.ts` "reports overflow...": the depth-1 path now has a distinct translation; with identical identity matrices the new dedupe correctly collapses it to one instance and no overflow.
- `vrLocomotion.test.ts`: the two existing `resolveXrPortalEyeRenderRoot` calls now pass the required `anchorPoint`.
- Test 7 uses a chain world (the eye's walk goes east, then north through a second portal from the east neighbour) so the walk ends in a real cell (`en`) rather than a wall; both side orders give `en`.

### Uncertain
- Headset check (no z-fighting on the overhang, head-on) not run.
- The `requested` overflow count now counts deduplicated instances only.
- Dedupe key ignores archetype (it runs per archetype), so two identical-placement records of one object in one archetype collapse to one.
- The first `npm run smoke -- --world cube,torus-moduli` run reported torus-moduli "loading screen still present after 60000 ms"; a rerun of torus-moduli alone passed. Looks like a cold-start flake, not confirmed.

### Not done
- Headset check (no headset). Issue 73 left open with a pointer.

### Checks
Baseline `npm run typecheck` and `npm test` green (865 passed). Final: typecheck clean, `npm test` 875 passed / 8 skipped, `npm run docs:check` ok (after `docs:generate`), smoke cube OK, torus-moduli OK on rerun (see Uncertain).
