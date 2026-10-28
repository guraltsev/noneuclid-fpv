# 65 - Movement numerics: boundary ping-pong, pose drift and mixed-unit tolerances

Status: open as of 2026-10-08.

Priority: P3 (robustness). Small items, grouped.

## Summary and evidence

- **No hysteresis at portal sides.** Crossing triggers on `d_i(q) < 0` with no tolerance
  (`src/movement/moveDynamicObject.ts:180`). After crossing, the target clearance is `d' = -d + O(ε·|t_g|)`, with
  `|t_g| ≈ 15-60 m` in bundled worlds, so the error is about 1e-14 m. A body that ends with `d ∈ (-1e-14, 0)` can be
  "outside" in both frames. It then changes cell on every call *with zero displacement* (an idle creature, or the XR
  physical move, which runs every frame). The render root flips each frame.
- **Pose rotation is never re-projected.** `crossDynamicObjectPortal` (`src/movement/portalCrossing.ts:14-19`) composes
  `R ← R_g R` on every crossing. Creature and marmot poses keep the composed matrix indefinitely, so orthonormality error
  grows linearly (about 1e-16 per crossing, benign today). The compiled `R_g` is built from separately normalized tangent
  and normal vectors (`src/cell-complex/compilePortalTransforms.ts:65-79`), so it is not exactly orthonormal either. The
  player is immune only because `playerPoseFromDynamicObject` re-derives yaw with `atan2` on every move
  (`src/movement/playerPose.ts:56`).
- **Absolute and dimensionless tolerances mixed** (the same class as the issue 41 culling item):
  `src/math/intersections.ts:44` treats `|d_start - d_end| <= 1e-8 m` as "parallel", so a straddling segment shorter than
  1e-8 m reports `none`. Line 50 compares the *dimensionless* `t` against the metric `tolerance`. The wall skin `1e-6`
  (`moveDynamicObject.ts:236`) is a fourth, unrelated constant, not taken from `src/math/tolerances.ts`.
- **Strict comparisons with no skin** in `testCellCollision` (`collision.ts:92-128`). A body pushed to exactly `r + 1e-6`
  from wall A is accepted. Floating error in re-deriving the center through `transformDirection3` (an offset of
  `(0, 0, h/2)`) is far below 1e-6, so this is fine today, but it should be documented as the invariant.

## Proposed change

- Use the segment rule of issue 62 (a crossing requires a strict sign change along a nonzero segment). A body at rest
  never crosses. If anchor tests are kept, add a hysteresis band: cross only when `d < -η` with `η = 1e-9 m`, and after
  crossing clamp `d' >= +η` in the target.
- After each crossing, re-project the rotation onto `SO(2) × {1}`:
  `yaw = atan2(R10, R00); R ← yawMat(yaw)`. All gluings are z-rotations (`MATHEMATICAL_MODEL.md` §3), so this is exact,
  not an approximation. Also build `R_g` in `derivePortalTransform` from a single angle `atan2` instead of two bases.
- In `intersectSegmentWithPlane`, test parallelism by `|d_start - d_end| <= tol · max(1, |end - start|)` or by the sign of
  `d_start · d_end`, and compare `t` against `tol / |end - start|`. Move the wall skin into `tolerances.ts` as
  `collisionSkinMeters`.

## Acceptance criteria

- Property test: 10^5 random crossings of a reciprocal portal pair keep `|R^T R - I| < 1e-12` and `|det R - 1| < 1e-12`.
- A body placed at `d = -1e-15` from a portal side, moved by zero for 100 calls, changes cell at most once.
- `intersectSegmentWithPlane` returns `point` for a 1e-10 m segment that straddles the plane.
