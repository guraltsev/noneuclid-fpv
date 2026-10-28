# 18 - Stage 03 movement, collision, portals, and forbidden zones

Status: closed on 2026-05-25.

## Outcome

The world-rule movement layer is implemented for both the player and shared dynamic objects.

Movement now consults compiled prism-cell geometry, blocks on walls/floor/ceiling, crosses valid portals, transforms orientation through portal seams, and rejects motion into portal-junction forbidden zones.

## Implemented changes

- [src/movement/dynamicObject.ts](../../../src/movement/dynamicObject.ts) defines the shared moving-object contract and `SimpleCollisionBox`.
- [src/movement/moveDynamicObject.ts](../../../src/movement/moveDynamicObject.ts) applies world-aware movement, collision checks, and portal crossing for generic dynamic objects.
- [src/movement/collision.ts](../../../src/movement/collision.ts) implements floor, ceiling, wall, and forbidden-zone collision checks plus boundary-crossing detection.
- [src/movement/portalCrossing.ts](../../../src/movement/portalCrossing.ts) applies compiled portal transforms to dynamic objects and player poses.
- [src/movement/movePlayer.ts](../../../src/movement/movePlayer.ts) routes player locomotion through the shared movement rules when a compiled world is provided.

## Verification

### Automated

- [tests/movement/moveDynamicObject.test.ts](../../../tests/movement/moveDynamicObject.test.ts) verifies:
  - generic objects move in open space,
  - walls, floor, and ceiling block motion,
  - centered portal crossings succeed,
  - orientation transfers through portal transforms,
  - forbidden zones block motion,
  - `SimpleCollisionBox` offset defaults and explicit offsets both behave correctly,
  - compiled `cube` and `tetrahedron` worlds are traversable through compiled portals.
- [tests/movement/movePlayer.test.ts](../../../tests/movement/movePlayer.test.ts) verifies that player movement uses the shared world-aware collision path when a compiled world is present.

### Final checks

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-25.

## Acceptance criteria status

- Player moves inside a prism: complete.
- Walls, floor, and ceiling block movement: complete.
- Centered portal crossings work: complete.
- Portal crossing transforms orientation consistently: complete.
- Forbidden zones are enforced: complete.
- Shared dynamic-object movement exists below player-specific controls: complete.
