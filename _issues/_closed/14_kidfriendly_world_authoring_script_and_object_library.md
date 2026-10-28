# 14 - Kidfriendly world authoring script and object library

Status: closed on 2026-05-25.

## Outcome

Example worlds can now be authored in a small procedural world-script format instead of large TypeScript object literals.

The author-facing path now supports:

- `PolygonFace(...)` for prism-cell shells,
- `Portal(...)` for reciprocal edge gluing,
- `OnFace(...)` for object placement,
- named object constructors from a small classroom-friendly library.

Runtime compilation, movement, and rendering still consume the ordinary validated `CellComplexSpec` and compiled cell-complex contracts. No script-specific branches were added to the runtime movement pipeline.

## Implemented changes

### Script compiler and builder

- [src/authoring/compileWorldScript.ts](../../src/authoring/compileWorldScript.ts) executes trusted local `.world.js` scripts against a narrow authoring scope and returns a `CellComplexSpec`.
- [src/authoring/worldBuilder.ts](../../src/authoring/worldBuilder.ts) implements the typed builder behind the script globals.
- The builder:
  - creates prism cells from `PolygonFace(...)`,
  - converts author-facing edge pairs like `[1, 2]` and `[0, 3]` into side indexes,
  - creates both directed portal specs from one `Portal(...)` call,
  - attaches only validated library-created objects through `OnFace(...)`.

### Object library

- [src/world-objects/library.ts](../../src/world-objects/library.ts) now owns the beginner-facing object constructors.
- Static wrappers centralize asset paths and defaults for:
  - `house`,
  - `clock`,
  - `campfire`,
  - `tree`,
  - `rocks`,
  - `emergency_button`.
- `geodesic_marmot(...)` wraps the existing dynamic marmot spec creation and preserves its movement-critical collision box and velocity data.
- Static decorative objects remain non-collidable by default.

### Example-world migration

- [src/authoring/exampleWorlds.ts](../../src/authoring/exampleWorlds.ts) now compiles raw world-script sources into example `CellComplexSpec` values.
- The example worlds are authored as `.world.js` files in [src/examples](../../src/examples):
  - [cube.world.js](../../src/examples/cube.world.js)
  - [tetrahedron.world.js](../../src/examples/tetrahedron.world.js)
  - [torus.world.js](../../src/examples/torus.world.js)
  - [twoPrismLoop.world.js](../../src/examples/twoPrismLoop.world.js)
- The cube example now matches the intended procedural authoring style with named faces, one portal call per undirected edge pairing, named classroom objects, and face-local placement.

## Verification

### Automated

- [tests/world-objects/library.test.ts](../../tests/world-objects/library.test.ts) verifies:
  - static wrapper asset paths and ids,
  - non-collidable static defaults,
  - tree per-axis scaling behavior,
  - geodesic marmot velocity and collision normalization.
- [tests/authoring/worldBuilder.test.ts](../../tests/authoring/worldBuilder.test.ts) verifies:
  - `PolygonFace(...)` cell creation,
  - reciprocal portal creation,
  - author-edge to side-index conversion,
  - readable invalid-edge and duplicate-portal failures,
  - face-local object attachment.
- [tests/authoring/compileWorldScript.test.ts](../../tests/authoring/compileWorldScript.test.ts) verifies:
  - minimal script compilation,
  - cube world compilation through the existing runtime compiler,
  - readable script-level authoring errors.
- Existing regression coverage remained in place for:
  - [tests/cell-complex/compileCellComplex.test.ts](../../tests/cell-complex/compileCellComplex.test.ts)
  - [tests/cell-complex/describeGeometry.test.ts](../../tests/cell-complex/describeGeometry.test.ts)
  - [tests/movement/moveDynamicObject.test.ts](../../tests/movement/moveDynamicObject.test.ts)

### Final checks

- `npm test`
- `npm run build`

Both passed on 2026-05-25.

## Acceptance criteria status

- `cube` can be authored in the procedural script style: complete.
- The script compiler emits an ordinary `CellComplexSpec`: complete.
- Existing runtime compilation and movement code do not need script-specific branches: complete.
- `Portal(...)` automatically creates reciprocal portal specs: complete.
- Author-facing edges use vertex pairs rather than side indexes: complete.
- Object wrappers exist for house, clock, campfire, tree, rocks, emergency button, and geodesic marmot: complete.
- Object wrappers own asset paths and collision defaults: complete.
- Static object wrappers have no collision by default: complete.
- Geodesic marmot keeps its dynamic collision box: complete.
- Tests cover wrappers, edge conversion, reciprocal portal creation, and script compilation: complete.

## Follow-on note

This closes the classroom-friendly authoring introduction, but it does not force the next stage to be more authoring work. If the next priority is VR readiness, the remaining gap is in the rendering/control stages rather than the authoring/compiler pipeline.
