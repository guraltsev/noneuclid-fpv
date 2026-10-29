# Job 06 - Stop curve shortening from stalling

Status: queued.
Resolves: issue [66](../../_issues/66_curve_shortening_stalls_at_high_frame_rate.md).

## Goal

Curve shortening must converge regardless of frame rate, and must not livelock near the fuse angle or stall on short
free loops. This is the interim fix for the gradient-descent solver; [job 26](26_exact_curve_shortening.md) later replaces it.

## Steps

1. Implement [issue 66](../../_issues/66_curve_shortening_stalls_at_high_frame_rate.md) §Proposed change: make the step independent of `deltaSeconds` (or run fixed sub-steps), and add
   hysteresis at the fuse threshold.
2. Fix the short free loop stall: loops whose length lies between `GEODESIC_MIN_LENGTH_METERS` and
   `4 * curveShorteningMinStepMeters` (`TODO(issue 66)` at `src/world-objects/geodesicCannon.ts:3727`).

## Verification

- The torus reproduction in [issue 66](../../_issues/66_curve_shortening_stalls_at_high_frame_rate.md) fuses at `deltaSeconds = 1/240` and `1/60` into the same loop (word `[right]`,
  length 15 m).
- A short free loop converges or is deleted, never stays `moving`.
