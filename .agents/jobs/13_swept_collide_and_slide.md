# Job 13 - Swept collide-and-slide on the segment-walk kernel

Status: queued.
Resolves: issue [62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md), issue [61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md), issue [63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md).

## Goal

Replace single-wall push-out and the one-crossing-per-step rule with segment traversal plus swept collide-and-slide,
so bodies slide along walls, never leave a room through a corner, and never get lost past a vertex.

## Depends on

[job 12](12_segment_walk_kernel.md).

## Steps

1. [issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) §Proposed change: traverse the step segment with the kernel; collide and slide against walls, floor,
   ceiling and zones in every cell the swept body touches; allow several crossings per step; clamp `dt`
   (`createThreeApp.ts:1211`).
2. [issue 61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md): wall response by projecting the centre onto the cell inset by r (convex), so corners slide instead of
   stopping short.
3. [issue 63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md): the obstacle set includes the cells a straddling body overlaps (walls, objects, other bodies).
4. Decide the target-wall overlap item merged from issue 41 into [issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md).
5. Update the test that encodes one crossing per frame ("teleports ... only one most probable portal per frame").

## Verification

- The reproductions in [issue 61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md) and [issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) pass (corners reach (±0.75, ±0.75); the cube-vertex walk stays inside).
- A random-walk property test: no body ever ends outside every cell.
- Acceptance criteria of [issue 61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md), [issue 62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) and [issue 63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md).
