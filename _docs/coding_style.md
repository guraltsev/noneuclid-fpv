# Coding Style

The code should stay inspectable for a professional mathematician who is a
lower-intermediate programmer and uses LLM-assisted programming heavily.

## Style Goals

Prefer a direct narrative style. A reader should understand the role of each
small block before reading every line inside it.

Avoid enterprise architecture. Do not introduce service classes, registries,
managers, factories, dependency-injection containers, or generic plugin layers
unless the current behavior truly requires them.

A class is justified only when it owns meaningful persistent state, invariants,
or a natural object interface. Do not use classes as namespaces.

## Module Boundaries

Mathematically and physically meaningful code belongs in:

```text
src/math
src/cell-complex
src/movement
src/world-objects
```

Skippable glue belongs in:

```text
src/render/three
src/glue
```

A future reader should be able to understand cells, portals, movement,
forbidden zones, and straight rays without opening a Three.js file.

## Import Direction

Use this dependency direction:

```text
math -> no project imports
cell-complex -> math
movement -> math + cell-complex
tools -> math + cell-complex + movement public types
render/three -> math + cell-complex + movement + tools public outputs
classroom -> public app/tool state only
authoring -> cell-complex specs and validation
glue -> browser APIs, storage, URLs, deployment-specific helpers
```

Do not let `math`, `cell-complex`, `movement`, or `tools` import from
`render/three`.

## Names

Prefer stable domain names:

- `CellComplexSpec`
- `PrismCellSpec`
- `PortalSpec`
- `PortalJunction`
- `ForbiddenZone`
- `PlayerBody`
- `StraightRayTrace`
- `Marker`
- `MeasurementTool`

Avoid vague names:

- `Manager`
- `System`
- `Service`
- `Thing`
- `Data`
- `Util`

`Controller` is acceptable only for actual VR input controllers. A file named
`utils.ts` is allowed only as a temporary first-pass placeholder and should be
split during cleanup.

## Public Modules

Prefer small public modules named after behavior or concepts:

```text
src/cell-complex/compileCellComplex.ts
src/movement/movePlayer.ts
src/world-objects/geodesic/trace.ts
src/render/three/buildCellMesh.ts
```

Do not put the whole game loop, compiler, movement, tools, and UI in one world
class.

`src/main.ts` should stay small. It should select a world spec, compile it,
create initial app state, create the Three app, and connect controls/tools/debug
UI. It should not contain compiler logic, collision logic, ray logic, or portal
math.

## Geometry Rules

Use tolerances explicitly near the code that uses them. Do not put a large
global tolerance catalog at the top of the project. When a tolerance is part of
a public contract, document it and test behavior around it.

Do not compute curvature effects, holonomy, Gauss-Bonnet values, Euler
characteristic, or point-to-point geodesics in the first runtime. The only
curvature-adjacent first-pass behavior is the forbidden-zone and object-footprint
safety rule
near portal junctions.
