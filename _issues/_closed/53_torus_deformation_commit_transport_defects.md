# 53 - Torus deformation commits can trap the player and mis-transport headings

Status: closed on 2026-10-29.

Priority: P1 (correctness). Not covered by issue 41, whose deformation items are the hard-coded 15 m, `||` in
`normalizeState`, `JSON.stringify` equality and the mirrored marmot yaw.

Jobs: [07](../../.agents/jobs/_done/07_forward_heading_convention.md), [09](../../.agents/jobs/_done/09_deformation_commit_safety.md).

## Outcome

Fixed by jobs 07 and 09.

- Item 1 (trap): `src/movement/depenetrateDynamicObject.ts#depenetrateDynamicObject` runs after every commit for the
  player, placed flags, marmots and geo creatures (walls only for the latter). It pushes radially out of zones and
  along wall normals, crosses a portal if the anchor left the cell, and falls back to the nearest free grid sample.
- Item 2 (heading): job 07, see the status update below.
- Item 3 (frame): `validateTorusSkewBaseSpec` rejects a footprint that is not the centred parallelogram of its own
  (w, a, b) within 1e-6 m; such a world falls back to `static-world`.
- Item 4 (width step): `nextTorusSkewStep` moves (w, a, b) together along a straight segment, which stays in the convex
  allowed set.

## Closing evidence

- Trap and "following 1 cm move is not blocked": `tests/movement/depenetrateDynamicObject.test.ts`, "pushes the player
  out of the junction zone after the issue-53 trap commit"; also "returns the same object when nothing overlaps",
  "pushes a body sitting exactly on a vertex toward the cell centroid", "leaves no body blocked for legal rest poses
  near the corners", the two wall tests and "ignores zones when asked".
- Heading: `tests/runtime/torusSkewDeformation.test.ts`, "keeps a closed-geodesic forward vector closed under a full
  shear" (job 07).
- Frame: `tests/runtime/torusSkewDeformation.test.ts`, "rejects a torus footprint that is not centred", "rejects a
  rotated torus footprint", "still accepts the shipped torus worlds".
- Width: `tests/runtime/torusSkewDeformation.test.ts`, "steps width, skew and depth together and reaches a wider
  target", "stays in range on the boundary b = w/2 while the width changes";
  `tests/runtime/worldGeometrySession.test.ts`, "reaches a target with a different width without recording an error".

## Status update 2026-10-29 (job 09)

Items 1, 3 and 4 are fixed by job 09; the issue is closed.

## Status update 2026-10-28

All four defects are still present. Re-checked against the current code:

1. Trap: `transformPlayerForGeometryCommit` (`src/render/three/createThreeApp.ts:1529-1551`) still writes the mapped
   pose with no collision test, and nothing depenetrates bodies after a commit. The escape route is now narrower than
   described below: a portal crossing is refused when the crossed state overlaps a zone in the target cell
   (`src/movement/moveDynamicObject.ts:95-115`), and at the torus's single vertex class that is the same cylinder seen
   from the other side, so the player can be fully stuck.
2. Heading: `transformRigidPoseWithMap` (`src/runtime/worldGeometryDeformations.ts:156-165`) still maps
   `(m00, m10)`, the right vector. It is used for the player, placed flags, the geodesic cannon
   (`transformYawWithMap` in `src/render/three/runtimeSceneUtils.ts:146`), geo creatures
   (`simpleGeoCreature.ts:261`) and live marmots (`geodesicMarmot.ts:169-189`). Only the *authored spec* path for
   marmots (`transformPositionedObjectSpecWithMap`, `worldGeometryDeformations.ts:186-210`) transports the real
   walking direction. The test "maps a vertical-lattice heading into the skewed heading" in
   `tests/runtime/torusSkewDeformation.test.ts` asserts the right-vector behaviour and must change with the fix.
3. Frame: `inferTorusSkewState` (`torusSkewDeformation.ts:242-258`), `torusLatticeFrame` (`:338-350`) and
   `validateTorusSkewBaseSpec` (`:200-237`) are unchanged; the footprint is still not checked against the frame.
4. Width step: `nextTorusSkewStep` (`:173-194`) still takes `widthMeters: target.widthMeters` at once (`:191`);
   the range check is now at `:304`, and a failed build sets `lastError` in `worldGeometrySession.ts:185-193`
   (builds now run through the worker client).

None of the acceptance criteria is met. Issue 81 (floor UVs) depends on the same lattice-coordinate convention.

## Status update 2026-10-29 (job 07)

Item 2 is fixed by job 07 (commit e768cd2): `transformRigidPoseWithMap` carries the forward vector R·e_y and rebuilds
yaw as atan2(-f'x, f'y); marmot specs carry their velocity the same way. Correction to the evidence above: the
geodesic cannon's yaws are direction angles along (cos, sin), so the old right-vector transport was correct for the
cannon; `transformYawWithMap` now carries that direction explicitly and its results are unchanged. Test:
"keeps a closed-geodesic forward vector closed under a full shear" in `tests/runtime/torusSkewDeformation.test.ts`.
Items 1, 3 and 4 remain open (job 09).

## Summary

A geometry commit applies the affine lattice map A = [u' v'][u v]⁻¹ to every pose. It does this with no collision
re-check and with the heading taken from the wrong column. A is the Teichmüller (extremal quasiconformal) map between
the two tori, which is the right choice for positions. It is not conformal, though, so three things break.

1. **Player trapped in a forbidden zone.** A contracts some directions; σ_min(A) = 0.22 for the full range of the
   family. A legal pose can land inside a junction cylinder, after which every non-crossing move is rejected.
2. **Heading taken from the right vector, not the forward vector.** Under a shear, a creature walking along a closed
   geodesic leaves its homology class.
3. **Base-spec frame assumed, not checked.** The lattice frame is hard-coded as centred and axis-aligned. The base
   footprint is never checked against it.

## Evidence

1. Trap. `src/render/three/createThreeApp.ts:1529-1551` (`transformPlayerForGeometryCommit`) writes the mapped
   position with no test. `src/movement/collision.ts:100-114` blocks any candidate that overlaps a zone; it does not
   check whether the move reduces the overlap. `moveDynamicObject` then reverts to the previous pose.
   - Concrete case in `torus-moduli`. Start with w = b = 15, a = 0. The player stands at corner v₁ = (7.5, −7.5)
     plus d = (−0.4, 0.2): distance 0.447 m, legal because it exceeds r_zone + r_player = 0.40.
   - Deform to a = 30, b = 7.5. Then A = [[1, 2], [0, 0.5]] and A·d = (0, 0.1). The player is 0.10 m from the vertex,
     inside the 0.15 m cylinder itself.
   - Distance to the vertex shrinks monotonically along the straight (a, b) path, so every intermediate commit is
     also unchecked.
   - The player can then only escape by a portal crossing, and a crossing is refused if the crossed state overlaps a
     zone in the target cell (`moveDynamicObject.ts:95-115`; corrected 2026-10-28, the audit said crossings skip zone
     tests).
   - The same applies to walls in any future family with walls.
2. Heading. `src/runtime/worldGeometryDeformations.ts:161` (`transformRigidPoseWithMap`) maps `(m00, m10)`, i.e. R·e_x, the body's *right* vector.
   Forward is R·e_y (`movePlayer.ts:136-140`; `simpleGeoCreature.ts:236` moves along body +y).
   - Example: a creature facing +x (yaw −π/2) has R·e_x = (0, −1).
   - Shear a: 0 → w gives A = [[1, 1], [0, 1]]. The right vector maps to (−1, −1)/√2, so the new forward is
     (1, −1)/√2, 45° off.
   - The geometrically consistent image is A·(1, 0) = (1, 0), which keeps the (1, 0) closed geodesic closed.
   - Players and `geo-mouse`/`geo-butterfly` (`simpleGeoCreature.ts:261`) go through this path. Authored marmot specs map their
     walking direction instead (`worldGeometryDeformations.ts#transformPositionedObjectSpecWithMap`), so the two paths
     disagree after the same commit.
3. Frame. `torusSkewDeformation.ts:242-258` (`inferTorusSkewState`) reads w = |v₁ − v₀| and (a, b) = v₃ − v₀.
   `torusLatticeFrame` (`:338-350`) then assumes u = (w, 0) and origin −(u + v)/2.
   - `validateTorusSkewBaseSpec` (`:200-237`) checks ids, portals and height, but not the footprint.
   - Failure: a torus authored on [0, 15]² is accepted. `applyToSpec` maps objects using a frame offset by
     (7.5, 7.5) m, so objects land outside the cell. The rebuilt footprint is re-centred, so the whole world jumps.
   - A rotated or non-parallelogram quad gives a meaningless A.
4. Width step. `nextTorusSkewStep` (`:186-194`) adopts the target width immediately but steps (a, b) partially.
   `normalizeTorusSkewState` can then throw on the range check `b ∈ [w'/2, 2w']` (`:304`). `scheduleNextBuild`
   catches it into `lastError` (`worldGeometrySession.ts:185-193` for failed or invalid builds, `:218-222` for a thrown step) and the target is never reached.

## Proposed change

1. After each commit, depenetrate every transported body (player, creatures, flags) in its cell.
   - For each overlapping zone, push radially to r_zone + r_body + 1e-6.
   - For each wall, push along nᵢ as in `resolveBlockedWallPosition`.
   - Iterate at most 4 times. If the pushed anchor leaves the cell through a portal, apply the crossing.
   - If it still fails, fall back to the nearest valid point found by sampling the lattice cell, rather than
     `resetPlayerToHome()`.
   - Alternative (simpler, and covers the torus): issue 52 §3 removes the cylinders at the torus's flat vertex.
2. Transport the frame, not a column.
   - f' = normalize(A·R·e_y). Rebuild yaw so that R'·e_y = f', i.e. yaw' = atan2(−f'_x, f'_y) in the
     rigid-transform convention.
   - Define this once as `transformRigidPoseWithMap` and use it for marmot velocities too: v' = |v|·f'.
   - Document in MATHEMATICAL_MODEL §9 that forward directions follow the Teichmüller map, so closed-geodesic classes
     (p, q) ∈ ℤ² are preserved.
3. Read the frame from the vertices, not the state.
   - o = v₀, u = v₁ − v₀, v = v₃ − v₀. Require |v₂ − (v₀ + u + v)| ≤ ε.
   - Express the family's parameters relative to that frame: τ = (u·v + i·u×v)/|u|², the same oriented shape for any
     rotation or offset.
   - Alternatively, make `validateTorusSkewBaseSpec` reject footprints that differ from
     `buildTorusParallelogramVertices(inferred)` by more than 1e-6.
4. In `nextTorusSkewStep`, keep w fixed (the family says it is fixed) or interpolate (w, a, b) jointly in scale-free
   coordinates (a/w, b/w).

## Acceptance criteria

- Unit test: the scenario in Evidence (1), run through `createTorusSkewCellDeformationMaps` plus the new
  depenetration step, leaves the player at least 0.40 m from every vertex. A following 1 cm move is not blocked.
- Unit test: a creature with forward (1, 0) still has forward (1, 0) after a = 0 → 15 at b = 15. A creature with
  forward ∝ (a, b) = v keeps forward ∝ v'.
- A torus base spec on [0, 15]² either deforms correctly (objects keep lattice coordinates) or is rejected by
  `canApplyToSpec`.
- Setting a target with a different width either reaches it or is rejected up front by `setTarget`. It must not end
  in `lastError` mid-path.
