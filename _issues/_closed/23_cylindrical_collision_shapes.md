# 23 - Cylindrical collision shapes

Status: closed on 2026-08-03.

## Outcome

The runtime collision-shape union resolves to `SimpleCollisionCylinder`, and
player/object movement, forbidden zones, placement checks, and debug wireframes
use cylinder bounds. Movement and collision tests cover the public behavior.

## Closing evidence

The repository audit at `09dafe7` inspected the collision types, movement path,
forbidden-zone compiler, debug renderers, and tests. Node/npm were unavailable,
so tests were not rerun for this documentation-only closure.

## Goal

Replace axis-parallel collision boxes with vertical collision cylinders.

The collision model should stay simple enough for students and future contributors to inspect, while avoiding the sticky square-corner behavior that made forbidden portal junctions feel unintuitive.

## Design

Dynamic objects use:

```ts
interface SimpleCollisionCylinder {
  readonly radius: number;
  readonly height: number;
  readonly offset?: Vec3;
}
```

The cylinder axis is vertical in cell-local coordinates. Object rotation still rotates `offset`, but it does not change the cylinder radius or height.

Forbidden portal junctions are also vertical cylinders. Their height may be infinite because they are horizontal keep-out regions through the whole prism.

## Runtime Rules

- floor and ceiling collision use the cylinder vertical interval,
- wall collision uses the cylinder radius as side support,
- forbidden-zone collision uses circle/cylinder overlap,
- swept forbidden-zone checks use a swept circle in the horizontal plane,
- portal reachability and boundary crossing use the same cylinder bounds helper,
- object-object placement collision uses cylinder-vs-cylinder overlap.

## Acceptance Criteria

- `SimpleCollisionBox` and axis-parallel derived collision boxes are removed from runtime collision.
- Player movement, dynamic object movement, placed flag placement, and debug wireframes use cylinders.
- Forbidden-zone collision columns are compiled as cylinders.
- Tests cover cylinder bounds, strict cylinder overlap, wall blocking, forbidden-zone blocking, portal reachability, portal crossing, and placed-object collision.
