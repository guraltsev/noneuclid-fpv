# Job 30 - Incremental deformation rebuild pipeline

Status: queued.
Resolves: issue [55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md), issue [82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md).

## Goal

A deformation step costs a fraction of today's ~100 ms: rebuild only what changed, do not re-upload the floor
texture, and pipeline builds in the worker ([issue 55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md), [issue 82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md)).

## Depends on

[job 10](10_floor_texture_in_lattice_coordinates.md) (floor UVs) and [job 09](09_deformation_commit_safety.md).

## Steps

1. [issue 82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md) §Proposed change: update cell archetypes and decorations in place, keep one floor texture.
2. [issue 55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md) §Proposed change: pipelined worker builds, steps in metres rather than parameter units, `cancel()` that
   reaches the worker, the `Iso2` type (if job 12 did not add it), and removal of the duplicate Mat3 helpers.

## Verification

Acceptance criteria of [issue 55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md) and [issue 82](../../_issues/82_deformation_commit_rebuilds_whole_scene_and_reuploads_floor_texture.md).
