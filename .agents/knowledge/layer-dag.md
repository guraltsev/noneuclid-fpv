# The layer order is a DAG, and `docs:check` enforces it

The key order of `layers` in `scripts/docs/lib.mjs` is the layer order, lowest first: `math, examples, cell-complex,
diagnostics, visibility, movement, world-assets, world-objects, authoring, glue, interaction, runtime, ui, render, root`.
A layer may import only layers before it. `npm run docs:check` fails on a layer edge the table does not allow, on `three` or
`@pmndrs/*` outside `render`/`root`, and on any import cycle (type-only imports count: they are real dependencies).
`tests/project/layering.test.ts` asserts the table is acyclic. `layering-baseline.json` is empty; never add to it.

Where things went, because the obvious home does not work:
- Tool ids and the debug-overlay item list are in `glue/toolIds.ts`, not `ui`: `glue` must not import `runtime`, and `ui` sits above `glue`.
- Deformation families (`cell-complex/worldGeometryDeformations.ts`, `deformations/`) are below `world-objects` because creatures and owners use `transformPoseWithCellMaps`; `TorusSkewDeformationState` is declared in the vocabulary file to avoid a 2-module cycle.
- `visibility/` is three-free: its path type is generic in the matrix (`matrixForPath`); `render/three/visiblePortalPaths.ts` is the Three adapter. Same for `interaction/aimTarget.ts` (takes an `AimRay`) and `render/three/aimTarget.ts`.
- Creatures: motion in `world-objects/creatures/*Behavior.ts`, meshes in `render/three/creatures/*View.ts`; the authoring file (`simpleGeoCreature.ts`) keeps only the spec and the registry record.

Breaking a type cycle that the registry causes: `runtimeObjectRegistry.ts` unions every object record, so a record's module
cannot import the registry. Records that need registry-using code live in `toolObjects.ts` (declarations only) and the base fields in
`runtimeObjectBase.ts`; the tools (`placedFlags`, `measureLengthTool`, `protractorTool`) import the registry and these.
A structural stand-in for the registry does not work when the tool passes it on to `geodesic/*` functions that need the real type.

Symptom of a new cycle: `docs:check` prints `FAIL import cycles` with the module list. Find the edge by printing the imports among
the cycle's members (`importCycles(scanProject())` from `scripts/docs/lib.mjs`).
