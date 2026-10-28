# 11 - Stage 03 hardening: dynamic-object movement, collision, portal crossing, and compiler guarantees

## Goal

Finish the world-rule layer that movement depends on before doing more renderer-first work.

The next implementation step is to make dynamic-object motion world-aware:

- movement must consult the compiled world,
- walls, floor, and ceiling must block motion,
- portal crossings must be explicit and reliable,
- forbidden zones near portal junctions must be enforced,
- the same portal and collision rules must apply to all dynamic positioned objects, not only the player,
- world compilation must validate the movement-critical assumptions that runtime code depends on.

This issue is the bridge between the current stage-03-shaped scaffold and a trustworthy movement contract.

This file is written as implementation guidance for a future LLM-assisted session. Prefer the concrete design rules in this issue over preserving the current player-first placeholder structure.

## Why this is the next step

The current repository already has:

- a staged roadmap in [docs/implementation-reading-order.md](../implementation-reading-order.md),
- a prism-cell compiler entrypoint in [src/cell-complex/compileCellComplex.ts](../../src/cell-complex/compileCellComplex.ts),
- starter worlds in [src/authoring/worldCatalog.ts](../../src/authoring/worldCatalog.ts),
- movement and portal modules in [src/movement](../../src/movement),
- a desktop renderer in [src/render/three/createThreeApp.ts](../../src/render/three/createThreeApp.ts).

But the world-rule implementation is still incomplete in the places that matter most:

- [src/movement/movePlayer.ts](../../src/movement/movePlayer.ts) currently applies displacement and camera rotation, but does not consult world geometry, collisions, portal boundaries, or forbidden zones.
- [src/movement/collision.ts](../../src/movement/collision.ts) is only a result interface and contains no collision logic.
- [src/movement/portalCrossing.ts](../../src/movement/portalCrossing.ts) changes `cellId` and transforms position, but does not yet define full crossing behavior or orientation transfer rules.
- [src/cell-complex/forbiddenZones.ts](../../src/cell-complex/forbiddenZones.ts) contains only type-level definitions.
- [src/cell-complex/compileCellComplex.ts](../../src/cell-complex/compileCellComplex.ts) and [src/cell-complex/prismCells.ts](../../src/cell-complex/prismCells.ts) compile world data only shallowly.
- [src/authoring/validateAuthoringSpec.ts](../../src/authoring/validateAuthoringSpec.ts) currently validates only that a world has at least one cell.
- [src/movement/playerPose.ts](../../src/movement/playerPose.ts) encodes player-specific state as the main spatial primitive, which is too narrow for thrown objects and future dynamic entities.

Because the renderer should consume world rules rather than define them, this work should come before further portal-view rendering work. That boundary is already documented in [docs/Development_guide.md](../Development_guide.md) and [docs/issues/_closed/04_repository_scaffold.md](./_closed/04_repository_scaffold.md).

## Design decisions from issue discussion

The following decisions are part of this issue and should be implemented unless a later design note explicitly changes them.

### 1. Dynamic objects, not only the player, use portal and collision rules

Do not build stage 03 around a player-only movement model.

Instead, define the world-rule layer so that any dynamic object can:

- exist in a current cell,
- have a local pose in that cell,
- attempt to move,
- collide with geometry,
- cross portals,
- be blocked by forbidden zones.

The player should become one consumer of this shared dynamic-object layer. A later thrown ball should be another.

### 2. Every dynamic object has a cell-local pose

The fundamental spatial state should be:

- `cellId`
- `localPose`

Use [src/math/rigidTransform3.ts](../../src/math/rigidTransform3.ts) and prefer `RigidTransform3` as the pose type rather than introducing a raw matrix type.

Interpretation:

- `cellId` identifies the current prism cell,
- `localPose` is a rigid transform in that cell's local coordinates,
- portal crossing updates both the `cellId` and the `localPose`.

Do not introduce a fake global world frame as the primary runtime coordinate system.

### 3. Player view state is not the same thing as dynamic-object spatial state

The current [src/movement/playerPose.ts](../../src/movement/playerPose.ts) combines:

- cell membership,
- position,
- body-facing yaw,
- camera pitch.

That is acceptable as a temporary placeholder, but it should not remain the foundational runtime abstraction.

Refactor toward:

- a shared dynamic-object pose/state layer,
- player-specific input/view state on top of it.

It is acceptable in stage 03 to keep player look pitch separate from the generic object pose if that simplifies implementation.

### 4. Stage-03 collision shape is `SimpleCollisionBox`

Introduce a first concrete collision shape for dynamic objects:

- `SimpleCollisionBox`

This issue does not require a full future collision hierarchy, but it should leave the code in a shape where later collision classes can be added cleanly.

Recommended stage-03 contract:

```ts
interface SimpleCollisionBox {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly offset?: Vec3;
}
```

Interpretation:

- `dx`, `dy`, and `dz` are full box sizes,
- `offset` defaults to `{ x: 0, y: 0, z: 0 }`,
- the box is attached to the object pose,
- collision uses pose translation plus `offset`,
- collision ignores pose rotation for now.

### 5. Collision is intentionally simple in stage 03

Do not implement rotated-box collision in this issue.

For stage 03:

- every dynamic object may still have a full `RigidTransform3` pose,
- but `SimpleCollisionBox` collision should remain axis-aligned in cell-local coordinates,
- collision should use the translation component of the pose only,
- collision should ignore the rotation component of the pose for performance and simplicity.

This is an intentional approximation, not a bug.

### 6. Portal crossing acts on object pose, not player-only fields

Portal crossing should be defined at the shared dynamic-object layer.

The core rule should be:

- detect that a moving object crosses a portal opening,
- compose the portal transform with the object's local pose,
- switch the object's `cellId` to the target cell,
- continue evaluation in the target cell when appropriate.

Do not hard-code crossing behavior around `PlayerPose` alone.

## Relevant project guidance

- [docs/Development_guide.md](../Development_guide.md)
- [docs/testing.md](../testing.md)
- [docs/coding_style.md](../coding_style.md)
- [docs/design/002-cell-complex-first.md](../design/002-cell-complex-first.md)
- [docs/design/003-no-curvature-engine.md](../design/003-no-curvature-engine.md)
- [docs/design/004-domain-model.md](../design/004-domain-model.md)
- [docs/design/008-runtime-contracts.md](../design/008-runtime-contracts.md)
- [docs/testing.md](../testing-strategy.md)
- [docs/llm-handoff/12_stage_02_prism_cell_compiler.md](../llm-handoff/12_stage_02_prism_cell_compiler.md)
- [docs/llm-handoff/13_stage_03_movement_collision_portals.md](../llm-handoff/13_stage_03_movement_collision_portals.md)
- [docs/acceptance-checklists.md](../acceptance-checklists.md)

## Relevant current code

### Compilation and authoring

- [src/cell-complex/specs.ts](../../src/cell-complex/specs.ts)
- [src/cell-complex/prismCells.ts](../../src/cell-complex/prismCells.ts)
- [src/cell-complex/compileCellComplex.ts](../../src/cell-complex/compileCellComplex.ts)
- [src/cell-complex/portalTransforms.ts](../../src/cell-complex/portalTransforms.ts)
- [src/cell-complex/forbiddenZones.ts](../../src/cell-complex/forbiddenZones.ts)
- [src/authoring/worldCatalog.ts](../../src/authoring/worldCatalog.ts)
- [src/authoring/worldSpecs.ts](../../src/authoring/worldSpecs.ts)
- [src/authoring/validateAuthoringSpec.ts](../../src/authoring/validateAuthoringSpec.ts)
- [src/cell-complex/examples/twoPrismLoop.ts](../../src/cell-complex/examples/twoPrismLoop.ts)
- [src/cell-complex/examples/cube.ts](../../src/cell-complex/examples/cube.ts)
- [src/cell-complex/examples/tetrahedron.ts](../../src/cell-complex/examples/tetrahedron.ts)
- [src/cell-complex/examples/torus.ts](../../src/cell-complex/examples/torus.ts)

### Movement and runtime state

- [src/appState.ts](../../src/appState.ts)
- [src/movement/playerPose.ts](../../src/movement/playerPose.ts)
- [src/movement/playerBody.ts](../../src/movement/playerBody.ts)
- [src/movement/movePlayer.ts](../../src/movement/movePlayer.ts)
- [src/movement/collision.ts](../../src/movement/collision.ts)
- [src/movement/portalCrossing.ts](../../src/movement/portalCrossing.ts)
- [src/math/rigidTransform3.ts](../../src/math/rigidTransform3.ts)

### Current renderer consumer

- [src/main.ts](../../src/main.ts)
- [src/render/three/createThreeApp.ts](../../src/render/three/createThreeApp.ts)
- [src/render/three/desktopControls.ts](../../src/render/three/desktopControls.ts)
- [src/render/three/debugOverlay.ts](../../src/render/three/debugOverlay.ts)

### Current tests

- [tests/cell-complex/compileCellComplex.test.ts](../../tests/cell-complex/compileCellComplex.test.ts)
- [tests/cell-complex/describeGeometry.test.ts](../../tests/cell-complex/describeGeometry.test.ts)
- [tests/movement/movePlayer.test.ts](../../tests/movement/movePlayer.test.ts)
- [tests/geometrySelection.test.ts](../../tests/geometrySelection.test.ts)

## LLM implementation instructions

Follow these instructions in order.

### 1. Introduce a generic dynamic-object spatial contract

Before expanding collision logic, introduce a shared movement abstraction that is not player-specific.

Target direction:

- a dynamic object has a `cellId`,
- a dynamic object has a `localPose: RigidTransform3`,
- a dynamic object may have collision data,
- a dynamic object may have object-specific state layered on top.

The exact type names may vary, but the abstraction must be generic enough for:

- the player,
- a future thrown ball,
- other future moving objects.

Do not make the player the only supported moving-thing abstraction.

### 2. Keep player-specific state layered above the shared spatial contract

`movePlayer(...)` may remain as a public entrypoint for controls, but it should stop being the deepest place where motion rules live.

Target architecture:

- generic dynamic-object movement/collision/crossing logic in shared movement modules,
- player-specific control and camera behavior layered above it.

If helpful, split the current player state into:

- generic object pose/state,
- player body dimensions,
- player-only look pitch or view state.

### 3. Harden compilation and validation for movement-critical guarantees

Extend the compile/validate path so runtime movement code can trust the world.

Minimum required validations:

- reject duplicate cell ids,
- reject duplicate portal ids within a cell,
- validate portal `sideIndex` bounds against prism side count,
- validate that every `targetCellId` exists,
- validate that every `targetPortalId` exists in the target cell,
- validate that portal pairings are reciprocal where the stage-03 contract requires reciprocity,
- compute forbidden-zone data from portal-junction structure rather than leaving it as a placeholder type.

Minimum useful compiled outputs:

- portal lookup data,
- side geometry usable by collision code,
- forbidden-zone data,
- enough cell-local data that movement code does not inspect authoring specs directly.

This is still prism-cell-first work, not the later authoring compiler and QR import work from [docs/llm-handoff/20_stage_10_authoring_compiler_and_qr.md](../llm-handoff/20_stage_10_authoring_compiler_and_qr.md).

### 4. Replace kinematic movement with world-aware dynamic-object motion

Evolve the movement layer so it operates on the compiled world and returns enough information for both gameplay logic and debug UI.

Minimum result information:

- attempted displacement,
- whether motion was blocked,
- blocking reason,
- whether a portal crossing occurred,
- resulting object state after zero or more stage-03-allowed transitions.

`movePlayer(...)` may wrap this generic logic, but the generic logic should be reusable for non-player dynamic objects.

The movement contract should remain auditable without opening renderer files.

### 5. Implement `SimpleCollisionBox` collision

Support:

- a `SimpleCollisionBox` attached to dynamic objects,
- optional `offset`, defaulting to zero,
- axis-aligned box behavior in cell-local coordinates,
- pose translation contributing to box placement,
- pose rotation ignored by the collision algorithm in stage 03,
- wall blocking on non-portal sides,
- floor blocking,
- ceiling blocking,
- portal opening traversal when crossing through a valid portal face,
- forbidden-zone rejection near portal junctions.

Keep the implementation behavior-focused and compatible with the project's "no curvature engine" boundary in [docs/design/003-no-curvature-engine.md](../design/003-no-curvature-engine.md).

### 6. Define portal crossing semantics clearly

Make crossing behavior explicit:

- crossing is a local boundary transition, not a separate locomotion mode,
- pose transforms through the portal's rigid transform,
- orientation transforms consistently with the portal mapping when the object uses orientation,
- the same crossing logic applies to the player and future moving objects,
- movement tests should cover crossing centered portals and rejection near portal junctions.

### 7. Add behavior tests before extending rendering

Add tests that prove:

- invalid world specs fail with readable errors,
- valid paired portals compile into reliable runtime lookups,
- generic dynamic objects can move inside a prism until blocked by geometry,
- a player uses the same shared collision/crossing rules,
- a dynamic object crosses a valid portal,
- a dynamic object cannot enter a forbidden zone,
- orientation transfer across portals behaves as documented,
- `SimpleCollisionBox` offset defaults to zero and works when explicitly provided.

## Acceptance criteria

This issue is complete when the repository satisfies the stage-03 items in [docs/acceptance-checklists.md](../acceptance-checklists.md):

- player moves inside a prism,
- player collides with walls, floor, and ceiling,
- player crosses centered portals,
- player orientation transforms across portals,
- player cannot enter forbidden zones.

And also when:

- dynamic objects, not only the player, have a shared cell-local pose model,
- portal crossing applies to all dynamic objects that move,
- `SimpleCollisionBox` exists as the stage-03 collision shape,
- the stage-03 collision algorithm uses axis-aligned box logic and ignores pose rotation,
- `compileCellComplex(...)` produces movement-useful runtime data rather than shallow field copies alone,
- `validateAuthoringSpec(...)` reports readable movement-relevant errors,
- movement tests cover blocking and crossing behavior rather than only free-space displacement,
- renderer code continues to consume these contracts rather than reimplement them.

## Non-goals for this issue

- Do not add recursive portal viewing yet.
- Do not add straight-ray tracing yet.
- Do not add markers, traces, or measurements yet.
- Do not add QR or JSON import tooling yet.
- Do not add general non-prism volume cells yet.
- Do not implement rotated-box collision yet.
- Do not introduce theorem-engine, curvature, holonomy, or geodesic-solving features.

## Verification notes

At the time this issue was written:

- `npm.cmd run typecheck` passed,
- `npm.cmd run build` passed,
- `npm.cmd test` reported all current tests passing,
- but `vitest run` crashed after reporting success with a Node/V8 fatal error, so test-runner stability may need a separate follow-up while this issue is in progress.
