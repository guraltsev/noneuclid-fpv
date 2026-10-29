# Job 12 - Shared segment-walk kernel

Status: queued.
Resolves: issue [62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md).

## Goal

One routine that walks a segment through convex cells in the developed frame of its start: exact segment-edge tests,
a defined rule for passing exactly through a vertex, and the list of cells, portals and transforms crossed. This is
theme 1 of [issue 50](../../_issues/50_deep_code_audit_2026_10_09_index.md). Body motion ([job 13](13_swept_collide_and_slide.md)), geodesic tracing ([job 15](15_geodesic_tracing_on_kernel.md)), aim picking ([job 16](16_aim_picking_by_portal_ray_walk.md)) and ghosts and eye
re-rooting ([job 17](17_multi_hop_ghosts_and_eye_rerooting.md)) are migrated onto it in later jobs.

## Steps

1. Put the kernel in `src/cell-complex` (pure; imports only `math`). Optionally introduce the `Iso2` planar
   transform type from [issue 55](../../_issues/55_live_deformation_rebuild_cost_and_se2_transforms.md) here, since the kernel is its first heavy user.
2. Vertex ties: choose and document one rule (for example, a symbolic perturbation along the edge normal) so a
   segment through a vertex enters exactly one cell.
3. Use it first for the anchor-point exit guess in movement ([issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) item 1), behind the existing API.

## Verification

- Property tests (job 11): the walk agrees with a brute-force sampled walk on random segments in every catalog world,
  including segments through vertices and along edges.
- The cube-vertex reproduction in [issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) no longer loses the body.
