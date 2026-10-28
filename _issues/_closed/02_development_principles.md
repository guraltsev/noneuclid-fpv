# 02 - Development principles

## Code should read like an explained calculation

Prefer a direct narrative style. The reader should understand the role of each small block before reading every line inside it.

Use short comments before nontrivial blocks. A good comment explains what the next block establishes, preserves, constructs, or rejects.

Good comment style:

```ts
// Reject a portal that touches a forbidden junction too closely. The player
// must always cross through the interior of a portal face.
if (distanceToPortalJunction < forbiddenRadiusMeters) {
  return blockedByForbiddenZone(...);
}
```

Bad comment style:

```ts
// Check distance.
if (distance < radius) { ... }
```

## Avoid enterprise architecture

Do not introduce service classes, registries, managers, factories, dependency-injection containers, or generic plugin layers unless the current behavior truly requires them.

A class is justified only when it owns meaningful persistent state, invariants, or a natural object interface. Do not use classes as namespaces.

Keep one-off validation local. Split code into helpers only when the helper names a real concept, isolates a side effect, removes genuine repetition, or makes behavior independently testable.

## Keep math and runtime contracts visible

Mathematically meaningful logic must not hide inside renderer files.

Renderer files may be messy because graphics code is inherently glue-heavy. That mess must be skippable. A reader should understand cells, portals, movement, forbidden zones, and straight rays without opening a Three.js file.

## No theorem engine in the first implementation

Do not compute curvature effects. Do not compute holonomy, Gauss-Bonnet, Euler characteristic, or point-to-point geodesics as part of the core runtime.

The only allowed curvature-adjacent behavior in the first implementation is the forbidden-zone safety rule near portal junctions.

## Test public behavior, not implementation details

Tests should make refactoring safe. They must not freeze private function names, internal loop structure, renderer pass counts, or incidental object layout.

Good test:

```text
Moving through a portal transforms the player position and facing direction by the portal transform.
```

Bad test:

```text
compilePrismCells calls makePortalMap exactly once.
```

## Public documentation style

Public JSDoc should document contracts, intended use, observable behavior, guarantees, limitations, inputs, outputs, side effects, and intentional errors.

Do not use documentation as a source-code tour. If a function has a dense algorithm, put narration in block comments inside the function.

## Use stable names for concepts

The project should prefer domain names over framework names.

Use:

- `CellComplexSpec`,
- `PrismCellSpec`,
- `PortalSpec`,
- `PortalJunction`,
- `ForbiddenZone`,
- `PlayerBody`,
- `StraightRayTrace`,
- `Marker`,
- `MeasurementTool`.

Avoid vague names:

- `Manager`,
- `System`,
- `Controller` except for actual VR input controllers,
- `Service`,
- `Thing`,
- `Data`,
- `Util`.

## Prefer small public modules

Each public module should have one visible responsibility.

Examples:

```text
src/cell-complex/compileCellComplex.ts
src/movement/movePlayer.ts
src/tools/traceStraightRay.ts
src/render/three/buildCellMesh.ts
```

Do not put the whole game loop, compiler, movement, tools, and UI in one world class.

## Use tolerances explicitly

Geometry code should use named tolerances near the code that uses them. Do not put a large global tolerance catalog at the top of the project.

When a tolerance is part of a public contract, document it and test behavior around it.

## Closing note

Closed as a one-off development-principles setup issue.

The principles are now reflected in the initial source layout and naming
conventions. The implementation deliberately uses small public modules with
domain names, keeps meaningful math/runtime concepts outside `src/render/three`,
and avoids service/manager/plugin-style architecture.

## Evidence for closing

- Domain concepts were introduced as public types in `src/cell-complex/specs.ts`,
  `src/cell-complex/forbiddenZones.ts`, `src/movement/playerBody.ts`, and
  `src/tools/traceStraightRay.ts`.
- Rendering glue lives under `src/render/three`, while cell specs, prism
  compilation, movement, and tool contracts live outside the renderer.
- The first behavior test,
  `tests/cell-complex/compileCellComplex.test.ts`, checks observable compiled
  cell output rather than private helper calls.
- `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` passed after
  the scaffold was added.
