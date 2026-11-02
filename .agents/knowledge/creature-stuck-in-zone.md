# A creature's heading change swung its collision cylinder into a forbidden zone (fixed 2026-11-02)

Symptom: a mouse (cube world `front-runner`) stops after about a minute near a face corner and never moves again; `debug.dumpGeodesicCreatures` shows the same position for ever.
Root cause: a dynamic object's collision cylinder is offset from the pose origin (the mouse's by 0.35 m forward) and `getDynamicObjectCollisionBounds` rotates the offset with the pose, so
changing the heading MOVES the cylinder (origin moved 6 cm, cylinder 24 cm in one frame). `moveDynamicObject` checks the step, but the heading was set afterwards unchecked, so a creature running along a
face edge toward a corner turned its cylinder into the vertex's forbidden zone. From an overlapping pose `moveDynamicObject` rejects every step, even one leading out, and the leader waits at `creatureLeashMeters`.
Fix: `turnWithoutOverlap` in `simpleGeoCreatureBehavior.ts` tests the turned pose with `testCellCollision` and turns only as far as it stays clear; a fully blocked body is also pushed out with
`depenetrateDynamicObject` (same cell only) so no creature can stay stuck whatever the cause.
Trap for any new mover: any pose change that is not a collision-checked step (heading, `place`, geometry change) can leave the body overlapping. Guard: `tests/world-objects/simpleGeoCreatureStall.test.ts`
(legal every frame, no stall). Probe: step the behavior at 1/60 s in `npx vite-node` over the compiled worlds and call `testCellCollision` each frame.
