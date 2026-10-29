# Job 22 - GPU portal clipping with clip planes

Status: queued.
Resolves: issue [58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md).

## Goal

GPU clipping never silently drops a path, costs less per fragment, and keeps early-Z where possible ([issue 58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md)).

## Depends on

[job 21](21_per_frame_visibility_funnel.md) (the funnel gives the clip planes).

## Steps

[issue 58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md) §Proposed change: clip with planes instead of 8-vertex texture polygons, and handle overflow explicitly.

## Verification

Acceptance criteria of [issue 58](../../_issues/58_gpu_portal_clip_overflow_and_clip_planes.md).
