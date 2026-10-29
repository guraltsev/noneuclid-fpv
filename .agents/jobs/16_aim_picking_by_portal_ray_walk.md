# Job 16 - Aim picking by portal ray walk

Status: queued.
Resolves: issue [72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md).

## Goal

VR aim picks what the controller ray actually hits, through portals, with walls and ceilings occluding, instead of
gating on the head camera's clip polygons ([issue 72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md)).

## Depends on

[job 12](12_segment_walk_kernel.md).

## Steps

[issue 72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md) §Proposed change: walk the ray with the kernel, keep the `[tStart, tExit]` window per cell, test objects
only in the walked cells, and cache the walk once per frame.

## Verification

Acceptance criteria of [issue 72](../../_issues/72_aim_picking_uses_camera_clip_polygons_not_portal_ray_walk.md).
