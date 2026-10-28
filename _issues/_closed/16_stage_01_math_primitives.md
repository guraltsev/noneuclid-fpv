# 16 - Stage 01 math primitives

Status: closed on 2026-05-25.

## Outcome

The stage-01 math layer is implemented and remains independent of Three.js.

The repository now has the vector, transform, plane, polygon, tolerance, and intersection helpers that later compilation and movement code depend on.

## Implemented changes

- [src/math/vec3.ts](../../../src/math/vec3.ts) provides the base `Vec3` operations used throughout runtime code.
- [src/math/rigidTransform3.ts](../../../src/math/rigidTransform3.ts) provides rigid transforms, inversion, composition, and direction/point transforms.
- [src/math/planes.ts](../../../src/math/planes.ts), [src/math/polygons.ts](../../../src/math/polygons.ts), [src/math/intersections.ts](../../../src/math/intersections.ts), and [src/math/tolerances.ts](../../../src/math/tolerances.ts) provide the stage-01 geometry helpers.
- Later systems consume these helpers without pulling Three.js into `src/math`.

## Verification

### Automated

- [tests/math/vec3.test.ts](../../../tests/math/vec3.test.ts)
- [tests/math/rigidTransform3.test.ts](../../../tests/math/rigidTransform3.test.ts)
- [tests/math/polygons.test.ts](../../../tests/math/polygons.test.ts)
- [tests/math/planes.test.ts](../../../tests/math/planes.test.ts)
- [tests/math/intersections.test.ts](../../../tests/math/intersections.test.ts)

These tests cover vector arithmetic, dot/cross behavior, rigid-transform identity and inverse round trips, polygon classification, and segment/plane intersection behavior.

### Final checks

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-25.

## Acceptance criteria status

- Minimal math primitives exist: complete.
- The math layer is independent of Three.js: complete.
- Vector, transform, polygon, plane, and intersection behavior is covered by tests: complete.
