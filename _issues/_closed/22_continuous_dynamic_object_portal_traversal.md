# 22 - Make dynamic-object portal traversal continuous

Status: closed on 2026-05-28.

## Outcome

Issue 22 is complete.

Autonomous dynamic objects, including geodesic marmots, now use anchor-based portal traversal so the cell switch happens when the traversal center crosses the portal plane rather than when the bounds exit first.

## Implemented changes

- [src/movement/moveDynamicObject.ts](../../../src/movement/moveDynamicObject.ts) supports explicit anchor/bounds portal-crossing modes and exposes the autonomous dynamic-object anchor policy.
- [src/world-objects/geodesciMarmot.ts](../../../src/world-objects/geodesciMarmot.ts) uses the anchor-based autonomous movement policy.
- [tests/movement/moveDynamicObject.test.ts](../../../tests/movement/moveDynamicObject.test.ts) covers before-center and after-center crossing behavior plus invalid-crossing rejection.
- [tests/world-objects/geodesciMarmot.test.ts](../../../tests/world-objects/geodesciMarmot.test.ts) covers the marmot runtime behavior.

## Verification

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`
