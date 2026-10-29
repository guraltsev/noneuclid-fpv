# Job 10 - Floor texture in lattice coordinates

Status: queued.
Resolves: issue [81](../../_issues/81_floor_texture_slides_under_objects_during_deformation.md).

## Goal

Floor UVs follow lattice coordinates, so the texture deforms with the cell like the objects do, and the tile size no
longer depends on the cell span ([issue 81](../../_issues/81_floor_texture_slides_under_objects_during_deformation.md)).

## Depends on

[job 09](09_deformation_commit_safety.md) (the lattice frame read from the footprint).

## Steps

Implement [issue 81](../../_issues/81_floor_texture_slides_under_objects_during_deformation.md) §Proposed change in `buildCellMesh.ts` (the `ShapeGeometry` UVs and `floorTextureRepeat`).

## Verification

The acceptance criteria of [issue 81](../../_issues/81_floor_texture_slides_under_objects_during_deformation.md); a render-contract test that a floor point and an object at the same lattice
coordinates keep the same UV after a commit.
