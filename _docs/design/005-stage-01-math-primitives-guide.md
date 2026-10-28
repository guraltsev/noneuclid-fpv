# 005 - Stage 01 Math Primitives Guide

## Purpose

Stage 01 should create a small Euclidean math layer that later stages can trust
for prism cells, portal transforms, movement collision, and straight ray traces.
It is not a rendering layer and should not import Three.js.

The main design pressure is consistency. The first implementation does not need
a full linear algebra package, but it does need one vector representation, one
plane convention, one polygon convention, and one transform convention.

## Coordinate Convention

Use the same local coordinate convention everywhere:

```text
x: right/east in a cell-local horizontal frame
y: vertical height
z: horizontal depth
floor: y = 0
ceiling: y = height
prism bases: x/z coordinates
```

The rendered camera may use Three.js conventions internally, but public runtime
geometry should use this convention. Conversion to renderer objects belongs in
the renderer boundary, not in `src/math`.

## Vector Representation

Use a plain object:

```ts
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
```

This is easier to read in tests and debug output than array indices. Avoid
mixing arrays and objects inside the math package. If authoring examples use
tuples later, convert them at the authoring or compiler boundary.

Useful operations for stage 01:

- `vec3(x, y, z)`
- `addVec3(a, b)`
- `subVec3(a, b)`
- `scaleVec3(v, scale)`
- `dotVec3(a, b)`
- `crossVec3(a, b)`
- `lengthVec3(v)`
- `normalizeVec3(v)`
- `distanceVec3(a, b)`
- `almostEqualVec3(a, b, tolerance?)`

`normalizeVec3` should throw on near-zero vectors. Silent division by a tiny
length will make collision and portal code hard to debug. If validation code
later needs a non-throwing path, add a separate helper such as
`tryNormalizeVec3`.

## Rigid Transforms

A `RigidTransform3` should represent a rotation plus translation:

```ts
export interface Mat3 {
  readonly m00: number; readonly m01: number; readonly m02: number;
  readonly m10: number; readonly m11: number; readonly m12: number;
  readonly m20: number; readonly m21: number; readonly m22: number;
}

export interface RigidTransform3 {
  readonly rotation: Mat3;
  readonly translation: Vec3;
}
```

Keep matrices inside `rigidTransform3.ts` unless another module truly needs
them. This avoids growing a general-purpose matrix library too early.

Stage 01 should distinguish points from directions at the function level:

- `transformPoint3(transform, point)` applies rotation and translation.
- `transformDirection3(transform, direction)` applies rotation only.

This distinction matters for portal traversal and ray traces. A ray direction
must rotate through a portal, but it must not inherit the portal translation.

Useful operations:

- identity transform
- transform point
- transform direction
- compose transforms
- invert transform
- construct a yaw rotation, if tests or movement need it

Composition should follow one documented order. Recommended convention:

```text
composeRigidTransform3(a, b) means apply b first, then a.
```

That matches function composition and makes nested portal traversal readable:
`composeRigidTransform3(next, accumulated)`.

Test this with transforms that do not commute. For example, compare a rotation
followed by a translation against a translation followed by a rotation.

## Planes

Use a normalized normal vector and signed offset:

```ts
export interface Plane {
  readonly normal: Vec3;
  readonly offset: number;
}
```

Interpretation:

```text
dot(normal, point) + offset = 0
```

For example:

```text
floor y = 0:   normal (0, 1, 0), offset 0
ceiling y = h: normal (0, -1, 0), offset h
```

Useful operations:

- `signedDistanceToPlane(plane, point)`
- `classifyPointToPlane(plane, point, tolerance?)`
- `planeFromPointAndNormal(point, normal)`

Do not hide whether the normal points inward or outward. Later cell compiler
code should choose that intentionally for collision.

## Polygons

Prism bases live in the `x/z` plane. Represent local 2D polygon vertices as
explicit `x/z` objects rather than `Vec3` values with dummy `y = 0`.

```ts
export interface Vec2xz {
  readonly x: number;
  readonly z: number;
}

export interface Polygon2xz {
  readonly vertices: readonly Vec2xz[];
}
```

Keep `Vec2xz` in `polygons.ts` during Stage 01. Split it out only if a later
stage develops enough floor-plane helpers to justify a separate module.

Stage 01 should support simple polygon behavior needed by prisms:

- reject fewer than three vertices,
- reject non-counterclockwise vertex order,
- compute signed area in the `x/z` plane,
- classify points as inside, outside, or boundary,
- optionally expose orientation if the compiler will need consistent face
  normals.

Authors must provide prism base vertices in counterclockwise order in the
`x/z` plane. The compiler should reject clockwise bases instead of silently
reversing them. This keeps face orientation explicit and avoids needing
orientation-reversing authoring behavior in the first implementation.

Use a classification result instead of a boolean:

```ts
export type PolygonPointClassification = "inside" | "outside" | "boundary";
```

Movement and portal code often need to treat boundary points differently from
strict interior points. A boolean `containsPoint` throws that information away.

## Segment-Plane Intersection

Represent the intersection of a finite segment with a plane in terms of segment
parameter `t`:

```ts
export type SegmentPlaneIntersection =
  | { kind: "none" }
  | { kind: "point"; t: number; point: Vec3 }
  | { kind: "coplanar" };
```

Interpretation:

```text
t = 0 at segment start
t = 1 at segment end
0 <= t <= 1 is on the finite segment
```

Endpoint hits should be valid point hits. Parallel non-coplanar segments should
return `none`. Coplanar segments should be explicit because they are ambiguous
for collision and ray traversal.

## Tolerances

Use one shared default only when multiple modules need the same tolerance:

```ts
export const geometryTolerance = 1e-8;
```

Prefer function parameters with a default:

```ts
function classifyPointToPlane(
  plane: Plane,
  point: Vec3,
  tolerance = geometryTolerance,
): PlanePointClassification
```

Avoid a large constants file. Stage 01 has numerical tolerance, not app
configuration.

## Module Boundaries

Recommended boundaries:

- `vec3.ts`: vector type and direct vector operations.
- `rigidTransform3.ts`: rotation matrix internals and rigid transform behavior.
- `planes.ts`: plane construction, signed distance, point classification.
- `polygons.ts`: `x/z` polygon types and point classification.
- `intersections.ts`: segment-plane intersection and later low-level
  intersection helpers.
- `tolerances.ts`: shared geometry tolerance only.

Do not import from movement, cell-complex, tools, render, or Three.js.

## Tests

Stage 01 tests should be small behavior tests:

- vector add, subtract, dot, cross, length, normalization;
- normalization throws on near-zero vectors;
- identity transform preserves points and directions;
- inverse transform round-trips a point and a direction;
- transform composition has the documented order;
- plane signed distance and boundary classification respect tolerance;
- polygon point classification covers inside, outside, edge, and vertex cases;
- polygon validation accepts counterclockwise bases and rejects clockwise bases;
- segment-plane intersection covers crossing, endpoint hit, parallel miss, and
  coplanar segment.

Prefer exact simple examples where possible. Use `toBeCloseTo` only for values
that genuinely pass through floating-point trig or normalization.

## Future Discussion

A later stage can consider an explicit orientation-reversing portal authoring
option if non-orientable examples become active. This is intentionally out of
scope for the first implementation.

## Non-Goals

Do not implement cells, collision, rendering, curvature calculations, geodesic
solvers, arbitrary matrices in world specs, or a general math toolkit in this
stage.
