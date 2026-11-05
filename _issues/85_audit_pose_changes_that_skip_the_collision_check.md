# 85 - Audit every pose change that is not a collision-checked step

Status: open. An audit; each defect it finds gets its own job.

Priority: P2 (one such defect froze a creature for good; others may exist, none is known).

Jobs: none yet.

## Status update 2026-11-05

- From closed issue 63: `turnWithoutOverlap` and `depenetrateDynamicObject` use own-cell `testCellCollision`, so they miss a body in a
  neighbouring cell. Only `moveDynamicObject` sees neighbours.
- Test this before answering the design question below: `sweptCollision` says an overlapped obstacle is hit at \(s = 0\) only when
  moving closer, while this issue says every step is rejected.

## Problem

A body's collision cylinder is offset from its pose origin and the offset turns with the pose (`getDynamicObjectCollisionBounds`).
So a change of heading moves the cylinder, even when the origin stays put. `moveDynamicObject` tests a step, but a creature's
heading was set after the step with no test, and a creature running along a face edge turned its cylinder into the forbidden zone
of a cube corner. From an overlapping pose `moveDynamicObject` rejects every step, even one leading out, so the mouse froze for
good (fixed 2026-11-02: `turnWithoutOverlap` plus a `depenetrateDynamicObject` backstop in `simpleGeoCreatureBehavior.ts`; note
the project-knowledge note on `creature-stuck-in-zone`).

The same shape may exist elsewhere: any code that writes a pose without going through a collision-checked step.

## Scope

Look for pose writes that skip `testCellCollision` / `moveDynamicObject`, and for a mover that cannot leave an overlapping pose:

- the player's movement and turning (yaw changes with an offset or non-round collision shape) and the rover;
- `place` / `WorldObjectOwner` placement commands, carry and drop (`handCarry`, `moveEmitterAlongRoute`), `placeObjectAt`;
- reset and initial placement (`reset`, authored positions next to a zone or wall), geometry-change remaps (`transformGeometry`);
- other autonomous objects and any future behavior module (see issue 84).

For each path decide: is the result checked, is it pushed out, or can it overlap? Then either fix it or record why it cannot.

## Done when

- Every pose write is listed with its verdict, in this issue or a knowledge note.
- Each path that can leave a body overlapping is fixed or has its own issue.
- A test steps each kind of mover long enough, in each bundled world, and asserts `testCellCollision` is clear on every frame
  (the creature test `tests/world-objects/simpleGeoCreatureStall.test.ts` is the model).
- Open design question: should `moveDynamicObject` itself let a body leave an overlapping pose (accept a step that does not
  deepen the overlap), so that no caller needs a backstop?
