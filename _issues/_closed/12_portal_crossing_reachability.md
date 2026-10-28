# 12 - Portal crossing reachability is too brittle

## Symptom

Portal travel exists in the world data and movement code, but in practice the player is hitting a solid wall instead of passing through a portal opening.

This usually shows up as:

- motion stopping at a portal face instead of transitioning to the neighboring cell,

## Direction

Treat this as a reachability problem in the stage-03 movement pipeline rather than a renderer issue.

The likely improvement path is to make portal traversal easier for runtime movement to recognize, while keeping the collision rules and world compilation authoritative.

The important outcome is not a particular algorithm, but a movement contract where portal openings are actually traversable in normal play and still remain constrained by the compiled world.

One boundary rule should stay absolute:

- if a cell wall does not have an associated portal, movement through that wall must be forbidden,
- leaving a cell's domain should be impossible except through a valid portal crossing,
- the world should never allow a generic "walk out of bounds" path that bypasses cell topology.

One candidate resolution strategy is:

- first check the tentative position against the cell domain,
- if the position is outside, determine which boundary was traversed,
- for convex cells this check and boundary lookup should be straightforward,
- if the crossed boundary has a portal, teleport across it,
- if the crossed boundary has no portal, resolve the object back to a valid in-bounds pose close to the wall and report the move as blocked.

One compilation assumption should also be explicit:

- compiled cells should carry an `_is_convex` marker or equivalent truthy flag,
- compilation should check that flag and reject non-convex cells with a readable error,
- non-convex cells are not supported for stage 03,
- future non-convex support can use a slightly more complex code path later,
- the current movement logic should rely on compilation-time validation rather than re-checking convexity at runtime.

## Relevant Code

- [src/movement/moveDynamicObject.ts](../../src/movement/moveDynamicObject.ts)
- [src/movement/collision.ts](../../src/movement/collision.ts)
- [src/movement/portalCrossing.ts](../../src/movement/portalCrossing.ts)
- [src/movement/movePlayer.ts](../../src/movement/movePlayer.ts)
- [src/cell-complex/compileCellComplex.ts](../../src/cell-complex/compileCellComplex.ts)
- [src/cell-complex/prismCells.ts](../../src/cell-complex/prismCells.ts)
- [src/cell-complex/forbiddenZones.ts](../../src/cell-complex/forbiddenZones.ts)
- [src/cell-complex/examples/twoPrismLoop.ts](../../src/cell-complex/examples/twoPrismLoop.ts)
- [src/authoring/validateAuthoringSpec.ts](../../src/authoring/validateAuthoringSpec.ts)
- [tests/movement/moveDynamicObject.test.ts](../../tests/movement/moveDynamicObject.test.ts)
