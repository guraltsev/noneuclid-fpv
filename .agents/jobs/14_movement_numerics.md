# Job 14 - Movement numerics: crossing at rest, pose drift, tolerances

Status: in progress.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [65](../../_issues/65_movement_numerics_boundary_hysteresis_and_pose_drift.md).

## Goal

The three acceptance checks of issue 65 pass:

1. A body placed at d = −1e-15 m from a portal side and moved by zero 100 times changes cell at most once (in every
   example world).
2. 10⁵ crossings of a reciprocal portal pair keep `|RᵀR − I| < 1e-12` and `|det R − 1| < 1e-12` (entrywise max).
3. `intersectSegmentWithPlane` returns `point` for a 1e-10 m segment that straddles the plane.

And every tolerance literal in `src/math`, `src/cell-complex` and `src/movement` has a name in `src/math/tolerances.ts`.

## Depends on

[Job 13](13_swept_collide_and_slide.md). After job 13 a zero horizontal displacement never walks, so check 1 should
already pass; this job adds the test that proves it and fixes the other two.

## Before you start

Line numbers are from commit `0d86165`; job 13 has changed `moveDynamicObject.ts`, so search by name there.

| File | What to look at |
| --- | --- |
| `src/math/tolerances.ts` | after jobs 12 and 13: `geometryTolerance`, `segmentWalkVertexTieMeters`, `cellContainmentToleranceMeters`, `segmentWalkOutgoingDotTolerance`, `collisionSkinMeters` |
| `src/math/intersections.ts` | `intersectSegmentWithPlane` (:30-62) |
| `src/math/rigidTransform3.ts` | `yawRigidTransform3` (:113-131) |
| `src/cell-complex/compilePortalTransforms.ts` | `derivePortalTransform` (:65-79), `orthonormalBasis` (:99-114) |
| `src/movement/portalCrossing.ts` | `crossDynamicObjectPortal` (:14-20) |
| `src/movement/moveDynamicObject.ts` | the final-pose step (job 13 step A4.9) |
| `src/movement/playerPose.ts` | `playerPoseFromDynamicObject` re-derives yaw with `atan2` (why the player is immune) |
| `src/world-objects/geodesicMarmot.ts`, `src/world-objects/simpleGeoCreature.ts` | they keep `state.localPose` across frames (they are not immune) |
| `tests/math/intersections.test.ts` | existing cases |

Baseline: `npm run typecheck`, `npm test`.

## Background

- **Crossing at rest.** Before job 13 the mover crossed whenever the end point had negative clearance, so a body at
  d ∈ (−1e-14, 0) could be "outside" in both cells and flip every frame (the dodecahedron did it twice in 100 calls).
  After job 13 a crossing needs a walk of positive length, and a zero horizontal displacement returns before walking.
  No hysteresis band is needed. Decision 1.
- **Rotation drift.** Every gluing rotation is a yaw (`MATHEMATICAL_MODEL.md` §3), so the exact rotation of any pose is
  `yawMat(atan2(R10, R00))`. Crossing composes `R ← R_g·R` without re-projection; measured on 2026-10-28: 10⁵
  alternating crossings of one icosahedron portal pair gave column-norm errors of about 6e-11. Part of that is that
  `R_g` itself is built from two separately normalized bases and is not exactly orthonormal.
- **Mixed-unit tolerances.** `intersectSegmentWithPlane` treats `|d_start − d_end| ≤ 1e-8` (meters) as parallel, so a
  straddling segment shorter than 1e-8 m returns `none`, or `coplanar` when both ends are within 1e-8 of the plane; and it
  compares the dimensionless `t` against the metric tolerance.

## Decisions

1. **No hysteresis band.** Decided: do not add the η band of issue 65; the job 13 rule (no walk, no crossing for a zero
   horizontal displacement; a crossing needs a strictly outgoing walk of positive length) is the fix. Add the
   acceptance test. If the test fails, add the band exactly as issue 65 describes (cross only when the walk's exit is
   more than 1e-9 m past the side; clamp the target clearance to ≥ 1e-9) and record it.
2. **Re-project after every crossing.** Decided: add `orthonormalizeYawRigidTransform3(transform)` to
   `src/math/rigidTransform3.ts`: `yaw = atan2(m10, m00)`, return `yawRigidTransform3(yaw, translation)`. It is only
   valid for transforms whose rotation is a yaw; say so in the JSDoc. Call it:
   - in `crossDynamicObjectPortal` on the composed pose;
   - in `moveDynamicObject` on the final pose when at least one crossing happened;
   - in `walkDevelopedSegment` and `collectDevelopedDisk` on each composed `cellFromStart` (cheap; keeps long walks exact).
   Why: exact for this model, and one function instead of Gram-Schmidt. Alternative: re-project only every N crossings;
   rejected as more state for no gain.
3. **Portal rotation from one angle.** Decided: in `derivePortalTransform`, compute
   `θ = atan2(cross(t_S, −t_T), dot(t_S, −t_T))` with `t_S`, `t_T` the unit side tangents, and
   `R = yawRigidTransform3(θ).rotation`; keep `t = m_T − R·m_S`. Delete `orthonormalBasis`, `mat3FromColumns`,
   `multiplyMat3` and `transposeMat3` from that file if nothing else uses them (`multiplyMat3Vec3` may still be
   needed for `R·m_S`; or use `transformDirection3`). Why: an exact rotation by construction; the old two-basis method
   gives the same map up to rounding (check with the existing compile tests).
4. **Scale-aware segment-plane test.** Decided:
   - coplanar only if both `|d_start| ≤ tol` and `|d_end| ≤ tol` **and** the two signs do not differ (a strict sign
     change `d_start · d_end < 0` is always a crossing, however short);
   - parallel (`none`) only if `d_start · d_end > 0` and `|d_start − d_end| ≤ tol` (same side, no crossing);
   - otherwise `t = d_start / (d_start − d_end)`, accepted if `t ≥ −tol/len` and `t ≤ 1 + tol/len` with
     `len = max(|end − start|, 1e-300)`; clamp to [0, 1].
   Existing tests in `tests/math/intersections.test.ts` must still pass; if one encodes the old behaviour, record it.
5. **Named tolerances.** Decided: every numeric literal used as a tolerance in `src/math`, `src/cell-complex`,
   `src/movement` gets a named export in `src/math/tolerances.ts` with its unit in the JSDoc, or a local named
   `const` with a comment if it is specific to one function. Do not change any value in this job. Known literals:
   `1e-6` in `compilePortalTransforms.ts` `orthonormalBasis` (deleted by Decision 3), `1e-9` in
   `depenetrateDynamicObject.ts:93` and `:101`, the `1e-9` overlap slack in `collision.ts` (deleted by job 13 if
   `moveIncreasesCylinderOverlap` is gone), the `1e-7`/`1e-12`/`1e-15` literals job 12 used inside the kernel
   (`segmentWalk.ts`, `developedDisk.ts`). Search with
   `grep -rnE "1e-[0-9]+" src/math src/cell-complex src/movement` and list every hit and what you did in the report.
   `staticPortalPathCull.ts` is out of scope (jobs 20-22 rewrite it); list its literals but leave them.
6. **Collision invariant documented.** Decided: the JSDoc of `testCellCollision` states: "Comparisons are strict with
   no tolerance. The movers keep bodies `collisionSkinMeters` clear of every obstacle, so a body at rest after a move
   is never reported blocked."

## Steps

1. Add `orthonormalizeYawRigidTransform3` with tests in `tests/math/rigidTransform3.test.ts`: a yaw transform
   perturbed by 1e-9 in `m00` comes back with `RᵀR = I` within 1e-15; the yaw angle is preserved within 1e-12.
2. Use it in the three places of Decision 2. Run `tests/movement`, `tests/cell-complex`.
3. Rewrite `derivePortalTransform` (Decision 3). Run `tests/cell-complex` and the job 11 property test
   `compilePortalTransforms.property.test.ts`. For every portal of every example world, the new transform must map the
   side endpoints within 1e-9 of where the old one did (write this as a temporary check, run it, then delete it and
   record the largest difference).
4. Rewrite `intersectSegmentWithPlane` (Decision 4). Add tests: a 1e-10 m segment straddling the plane gives `point`
   with t = 0.5 ± 1e-6; a segment entirely 1e-9 m above the plane gives `none` or `coplanar` (record which); a long
   segment touching the plane at one end gives `point` with t = 0 or 1.
5. Name the tolerances (Decision 5) and update the JSDoc (Decision 6).
6. Acceptance tests in `tests/movement/movementNumerics.test.ts`:
   - For every example world, every portal side, and every d in {−1e-14, −3e-15, −1e-15, 0, 1e-15}: place a body
     (radius 0.1, zones ignored) with its anchor at the side midpoint plus d along the inward normal; call
     `moveDynamicObject` with zero displacement 100 times; count changes of `cellId`; assert ≤ 1 (expected 0).
   - Pose drift: take the first portal of `icosahedron` and its reciprocal; start from a pose with yaw 0.3 at the
     portal midpoint; alternate `crossDynamicObjectPortal` through the portal and its reciprocal 10⁵ times; assert
     `max |RᵀR − I| < 1e-12` and `|det R − 1| < 1e-12`. Also run it once against the code **before** step 2 and
     record the error you measure then (issue 65 reported about 6e-11).
7. Docs: `_docs/MATHEMATICAL_MODEL.md` §10 lists every named tolerance with its unit; §5 says that poses are
   re-projected to a pure yaw after every crossing.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`.

## Bookkeeping

Close issue 65 with the three measured results as closing evidence. Update issue 50's row 65.

## Do not

- Do not change tolerance **values** (except where Decision 4 changes how one is applied).
- Do not touch `staticPortalPathCull.ts`.
- Do not change creature or marmot code: the re-projection happens inside the movement layer.

## Done when

- The three issue 65 checks are tests that pass.
- `orthonormalizeYawRigidTransform3` exists and is used in the places of Decision 2.
- The report lists every tolerance literal found and what was done with it.
