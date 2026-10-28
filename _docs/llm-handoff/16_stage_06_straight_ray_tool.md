# 16 - Stage 06: Straight ray tool

## Goal

Implement the first exploration tool: shoot a locally straight ray through cells and portals.

This is not a point-to-point geodesic solver.

## Files to create

```text
src/tools/traceStraightRay.ts
src/tools/rayToolState.ts
src/render/three/drawStraightRayTrace.ts
tests/tools/traceStraightRay.test.ts
```

## Public behavior

A ray trace starts with:

- current cell id,
- local start position,
- local direction,
- maximum distance,
- maximum portal crossings.

The trace returns:

- ordered local segments,
- crossed portal ids,
- stop reason.

Possible stop reasons:

- hit wall,
- hit floor or ceiling if vertical aiming is allowed,
- hit forbidden zone,
- reached maximum distance,
- reached maximum portal crossings,
- numeric failure.

## Direction handling

Inside a cell, the ray is a straight Euclidean segment.

When the ray crosses a portal, transform the position and direction by the compiled portal transform and continue in the target cell.

## Forbidden zone handling

A ray should not pass through a forbidden zone. If the ray would enter a forbidden zone, stop the trace at or before the zone boundary.

This is still not a curvature computation. It is a safety/robustness rule matching the movement rule.

## UI behavior

Desktop:

- click or keypress fires ray from camera center,
- ray remains visible until cleared or replaced,
- debug overlay shows stop reason.

VR later:

- controller trigger fires ray from controller target ray,
- ray path is drawn through portals.

## Tests to write

Required tests:

- ray travels straight in one cell,
- ray hits a wall and stops,
- ray crosses a portal and continues in target cell,
- ray direction transforms through a rotated portal,
- ray stops at max distance,
- ray stops at max portal crossings,
- ray stops before forbidden zone,
- ray trace records each segment's cell id.

## Naming rule

Use names like:

- `traceStraightRay`,
- `StraightRayTrace`,
- `RaySegment`,
- `drawStraightRayTrace`.

Do not use names like:

- `solveGeodesic`,
- `GeodesicSolution`,
- `shortestPath`,
- `globalGeodesic`.

A later stage may implement point-to-point geodesic algorithms with a different contract.

## Exit criteria

A student can aim and shoot a visible ray that behaves consistently across portals.

## Do not do in this stage

Do not solve for a path between two selected points.

Do not compute curvature.

Do not infer theorem statements from ray behavior.
