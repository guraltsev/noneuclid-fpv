# 66 - Curve shortening stalls above 200 fps and can livelock near the fuse angle

Status: open as of 2026-10-08.

Priority: P1 (correctness; small fix). Independent of the redesign in issue 67, which removes the root cause.

## Summary

`advanceCurveShorteningPairs` uses "this tick's step is shorter than `curveShorteningMinStepMeters`" to mean
"one arc has become too short". The step is `speed * deltaSeconds`, so on a fast display every tick is "too short",
the absorb path refuses because the arcs are long, and the pair never moves. Separately, the fixed-size normalized
descent step does not converge, so the angle-only fuse test can miss forever on short arcs.

## Evidence

- `src/world-objects/geodesicCannon.ts:3688-3704`: `stepMeters = min(v*dt, 0.25*shortest)`; if
  `stepMeters < curveShorteningMinStepMeters` (0.002 m, `:584`) it calls `absorbShortCurveShorteningHalf` and
  `continue`s whatever that returns.
- `absorbShortCurveShorteningHalf` returns `undefined` without changes when no preferred id is given and the short arc
  is longer than `curveShorteningFuseStepToleranceMeters` = 0.165 m (`:4005-4014`).
- `src/render/three/createThreeApp.ts:1207,1369-1372` passes the raw `clock.getDelta()`.
- With the default `v = 0.4 m/s` (`:578`): `v*dt < 0.002` ⇔ `dt < 5 ms` ⇔ more than 200 fps. On a 240 Hz monitor
  `step = 0.00167 m`, so every tick takes the absorb branch, it is refused, and the pair stays still with the "moving"
  colour. The same happens at lower rates on any frame shorter than 5 ms (frame-time jitter on 165 Hz screens).
- Non-convergence: the update is `X <- X + s * (u_A+u_B)/|u_A+u_B|` with a fixed `s`. Near the chord ÃB̃ the
  direction is essentially the normal, so X oscillates across the chord with amplitude up to `s`. At distance `h`
  from the chord the corner deficit is `|π - turn| ≈ h (1/a + 1/b)` (a, b = arc lengths). The fuse test
  (`:3661`, tolerance 0.03 rad) is guaranteed to fire only if `(s/2)(1/a+1/b) < 0.03`. With `s = 0.4/60 = 6.7 mm`
  that needs `1/a+1/b < 9`. For a = b = 0.2 m this fails, and whether the pair fuses depends on the phase of the
  2-cycle, so it can livelock. For long arcs (a = b = 50 m) the same test fuses while X is still up to 0.75 m off
  the chord, which is a visible snap at fusion.

## Proposed change

1. Decide whether to absorb from geometry, not from the step: absorb when `min(a, b) < curveShorteningFuseStepToleranceMeters`.
   Compute `step = min(v*dt, 0.25*min(a,b), distToTarget)` with no lower bound. Optionally accumulate
   `dt` until `v*dt_acc >= minStep`.
2. Replace the angle test with a distance-to-optimum test: develop Ã and B̃ into X's frame (both arcs' words, as
   `liftGeodesicEndpointWithAnchors` already does), let `X*` = the projection of X onto segment [Ã, B̃]
   (clamped), and fuse when `|X - X*| <= ε_fuse` (e.g. 1 mm). Move along `(X* - X)/|X* - X|` with
   `step = min(v*dt, |X* - X|)`, so the step never overshoots and the sequence ends in finitely many ticks. Because
   L is convex in the developed frame and X* is a minimizer, L is non-increasing along X→X*, which also gives
   issue 32's monotonicity requirement analytically.

## Acceptance criteria

- Test: `advanceCurveShorteningPairs` with `deltaSeconds = 1/240` on a two-arc pair of 2 m arcs reaches
  `ready-to-fuse` (or fuses) within `ceil(distance/(v*dt)) + 2` ticks.
- Test: a = b = 0.2 m with a 60 Hz step fuses within a bounded number of ticks (no 2-cycle).
- Total length is non-increasing tick to tick, within 1e-9 m.
