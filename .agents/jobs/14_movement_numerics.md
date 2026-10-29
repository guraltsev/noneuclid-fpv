# Job 14 - Movement numerics: boundary hysteresis, pose drift, tolerances

Status: queued.
Resolves: issue [65](../../_issues/65_movement_numerics_boundary_hysteresis_and_pose_drift.md).

## Goal

Fix the three numeric problems in [issue 65](../../_issues/65_movement_numerics_boundary_hysteresis_and_pose_drift.md): boundary ping-pong, pose drift over many crossings, and mixed-unit
tolerances.

## Depends on

[job 13](13_swept_collide_and_slide.md) (most boundary flipping goes away with segment traversal; re-measure first).

## Steps

[issue 65](../../_issues/65_movement_numerics_boundary_hysteresis_and_pose_drift.md) §Proposed change: crossing hysteresis, re-orthonormalising poses after crossings, and named constants in
`tolerances.ts` (including the 1e-6 wall skin).

## Verification

The three acceptance checks in [issue 65](../../_issues/65_movement_numerics_boundary_hysteresis_and_pose_drift.md) (at most one cell change in every world, rotation error ≤ 1e-12 after 10⁵
crossings, `intersectSegmentWithPlane` returns `point` for a 1e-10 m straddling segment).
