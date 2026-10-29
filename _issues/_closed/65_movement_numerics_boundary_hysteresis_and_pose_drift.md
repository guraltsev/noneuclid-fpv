# 65 - Movement numerics: boundary ping-pong, pose drift and mixed-unit tolerances

Status: closed on 2026-10-29.

Priority: P3 (robustness). Small items, grouped.

Jobs: [14](../../.agents/jobs/_done/14_movement_numerics.md).

## Outcome

Fixed by job 14. No hysteresis band was needed: after job 13 a zero horizontal step returns before any walk. Poses and
every composed `cellFromStart` are re-projected to a pure yaw (`orthonormalizeYawRigidTransform3`), the gluing
rotation is built from one angle, `intersectSegmentWithPlane` is scale-aware, and every tolerance literal in
`src/math`, `src/cell-complex` and `src/movement` (except `staticPortalPathCull.ts`) is named.

## Closing evidence

- `tests/movement/movementNumerics.test.ts`: a body at d in {-1e-14, -3e-15, -1e-15, 0, 1e-15} from every portal side of
  every example world changes cell 0 times in 100 zero moves (limit 1); 10^5 crossings of an icosahedron reciprocal pair
  give max |R^T R - I| = 1.1e-16 and |det R - 1| = 1.1e-16 (5.1e-11 and 4.8e-11 before the change).
- `tests/math/intersections.test.ts`: a 1e-10 m straddling segment returns `point` with t = 0.5 within 1e-6.
- Commits f82bf95 and the job 14 bookkeeping commit.
## Status update 2026-10-29

Design decided in [job 14](../../.agents/jobs/_done/14_movement_numerics.md) (not implemented yet):

- No hysteresis band: after [job 13](../../.agents/jobs/_done/13_swept_collide_and_slide.md) a zero horizontal displacement
  returns before any walk, and a crossing needs a strictly outgoing walk of positive length. The band is the fallback
  only if the acceptance test still fails.
- Rotations are re-projected to a pure yaw (`orthonormalizeYawRigidTransform3`) after every crossing and inside the
  walk and atlas; `derivePortalTransform` builds `R_g` from one angle.
- `intersectSegmentWithPlane`: a strict sign change is always a crossing; `t` is compared against `tol / length`.
- `collisionSkinMeters` is added by job 13; job 14 names the other literals.

## Status update 2026-10-28

Nothing is done. Re-checked against the current code with a throwaway vitest file (line numbers in the body below are
corrected):

- Hysteresis: crossing still triggers on any negative clearance (`findMostProbablePortalExit`,
  `src/movement/moveDynamicObject.ts:209`). Placing a body at `d âˆˆ {-1e-14, -3e-15, -1e-15, 0, 1e-15}` from every portal
  midpoint and moving by zero 100 times: cube, tetrahedron and icosahedron change cell at most once, but the
  dodecahedron changes cell twice for at least one placement, so the acceptance criterion "at most once" still fails.
- Pose drift: `crossDynamicObjectPortal` (`src/movement/portalCrossing.ts:13-19`) still composes without re-projection,
  and `derivePortalTransform` (`src/cell-complex/compilePortalTransforms.ts:67-79`) still builds `R_g` from two
  orthonormal bases. 10^5 alternating crossings of one reciprocal icosahedron portal pair give column-norm errors of
  about 6e-11, above the 1e-12 target.
- Tolerances: `intersectSegmentWithPlane` (`src/math/intersections.ts:39-51`) is unchanged; a 1e-10 m segment straddling
  the plane returns `{ kind: "coplanar" }` (both end distances are within 1e-8), not `point`. The wall skin is still the
  literal `1e-6` at `moveDynamicObject.ts:265`; `src/math/tolerances.ts` has no `collisionSkinMeters`.
- `testCellCollision` comparisons are still strict with no skin (`src/movement/collision.ts:92-128`); the doc comment
  now says "Comparisons are strict with no tolerance", but the invariant `r + 1e-6` is not documented there.

## Summary and evidence

- **No hysteresis at portal sides.** Crossing triggers on `d_i(q) < 0` with no tolerance
  (`src/movement/moveDynamicObject.ts:209`). After crossing, the target clearance is `d' = -d + O(ÎµÂ·|t_g|)`, with
  `|t_g| â‰ˆ 15-60 m` in bundled worlds, so the error is about 1e-14 m. A body that ends with `d âˆˆ (-1e-14, 0)` can be
  "outside" in both frames. It then changes cell on every call *with zero displacement* (an idle creature, or the XR
  physical move, which runs every frame). The render root flips each frame.
- **Pose rotation is never re-projected.** `crossDynamicObjectPortal` (`src/movement/portalCrossing.ts:13-19`) composes
  `R â† R_g R` on every crossing. Creature and marmot poses keep the composed matrix indefinitely, so orthonormality error
  grows linearly (about 1e-16 per crossing, benign today). The compiled `R_g` is built from separately normalized tangent
  and normal vectors (`src/cell-complex/compilePortalTransforms.ts:67-79`), so it is not exactly orthonormal either. The
  player is immune only because `playerPoseFromDynamicObject` re-derives yaw with `atan2` on every move
  (`src/movement/playerPose.ts:58`).
- **Absolute and dimensionless tolerances mixed** (the same class as the issue 41 culling item):
  `src/math/intersections.ts:45` treats `|d_start - d_end| <= 1e-8 m` as "parallel", so a straddling segment shorter than
  1e-8 m reports `none`. Line 51 compares the *dimensionless* `t` against the metric `tolerance`. The wall skin `1e-6`
  (`moveDynamicObject.ts:265`) is a fourth, unrelated constant, not taken from `src/math/tolerances.ts`.
- **Strict comparisons with no skin** in `testCellCollision` (`collision.ts:92-128`). A body pushed to exactly `r + 1e-6`
  from wall A is accepted. Floating error in re-deriving the center through `transformDirection3` (an offset of
  `(0, 0, h/2)`) is far below 1e-6, so this is fine today, but it should be documented as the invariant.

## Proposed change

- Use the segment rule of issue 62 (a crossing requires a strict sign change along a nonzero segment). A body at rest
  never crosses. If anchor tests are kept, add a hysteresis band: cross only when `d < -Î·` with `Î· = 1e-9 m`, and after
  crossing clamp `d' >= +Î·` in the target.
- After each crossing, re-project the rotation onto `SO(2) Ã— {1}`:
  `yaw = atan2(R10, R00); R â† yawMat(yaw)`. All gluings are z-rotations (`MATHEMATICAL_MODEL.md` Â§3), so this is exact,
  not an approximation. Also build `R_g` in `derivePortalTransform` from a single angle `atan2` instead of two bases.
- In `intersectSegmentWithPlane`, test parallelism by `|d_start - d_end| <= tol Â· max(1, |end - start|)` or by the sign of
  `d_start Â· d_end`, and compare `t` against `tol / |end - start|`. Move the wall skin into `tolerances.ts` as
  `collisionSkinMeters`.

## Acceptance criteria

- Property test: 10^5 random crossings of a reciprocal portal pair keep `|R^T R - I| < 1e-12` and `|det R - 1| < 1e-12`.
- A body placed at `d = -1e-15` from a portal side, moved by zero for 100 calls, changes cell at most once.
- `intersectSegmentWithPlane` returns `point` for a 1e-10 m segment that straddles the plane.
