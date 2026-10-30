# Architecture

NonEuclidean FPV lets a learner walk, in first person, through a *glued* space: convex prism rooms ("cells") whose
vertical walls are identified in pairs by rigid motions ("portals"), so that the space can be a cube, a torus, a
genus-2 surface, a polyhedron, and so on. The mathematics is stated in [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md);
this document explains how the program is organised around it.

Three documents, three jobs — and the second and third cannot drift:

| Document | Written | Answers |
| --- | --- | --- |
| [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md) | by hand, code references machine-checked | *What is computed, and why is it correct?* |
| this file | by hand, code references machine-checked | *How is the program organised and why?* |
| [generated/ARCHITECTURE_REFERENCE.md](generated/ARCHITECTURE_REFERENCE.md), [generated/API_REFERENCE.md](generated/API_REFERENCE.md) | generated from the source | *What modules and exports exist, who imports whom?* |

Inline documentation (the header comment of every module and a JSDoc on every export) is the ground truth for the
generated references; `npm run docs:check` fails when a module or export is undocumented, when a generated file is
stale, when a new layering violation appears, or when a `` `src/<dir>/<file>.ts#<symbol>` `` reference in these documents dangles.
See [Keeping the documentation true](#keeping-the-documentation-true).

## The pipeline at a glance

```text
 world script (src/examples/*.world.js)
        │  authoring: builder DSL, validation
        ▼
 CellComplexSpec ──compile──▶ CompiledCellComplex ──▶ portal-path tables ──▶ static visibility cull
 (data)           cell-complex   (cells, sides, portals g)   (developing maps)      (pruned tables)
        │                              │                                │
        │                              ▼                                ▼
        │                     movement / collision          visibility + instanced rendering
        │                     geodesic tracing (world-objects)  (render/three)
        ▼
 live deformation (runtime): re-compile a deformed spec in a worker and swap the snapshot between frames
```

1. **Authoring** (`src/authoring/worldBuilder.ts`, `src/authoring/compileWorldScript.ts`) turns a small script into a
   `CellComplexSpec` (`src/cell-complex/specs.ts#CellComplexSpec`): polygons, heights, portal pairs, objects.
   `src/cell-complex/validateCellComplexSpec.ts#validateCellComplexSpec` checks convexity, orientation and reciprocity.
   `src/authoring/worldCatalog.ts#loadWorldSpec` resolves a world id (`?world=...`) to a spec.
2. **Compilation** (`src/cell-complex/compileCellComplex.ts#compileCellComplex`) computes sides, inward normals, junction
   exclusion cylinders and the rigid gluing map of every portal. The result is immutable data.
3. **Path tables** (`src/cell-complex/portalPaths.ts#buildPortalPathTables`) enumerate developing maps for every root cell;
   `src/cell-complex/staticPortalPathCull.ts#buildStaticallyCulledPortalPathTables` prunes the impossible ones.
4. **Simulation** is purely functional geometry: `src/movement/movePlayer.ts#movePlayer` for bodies,
   `src/world-objects/geodesic/trace.ts#traceGeodesicSegment` and friends for rays. Nothing in these modules knows about
   Three.js, the DOM or WebXR.
5. **Presentation** (`src/render/three`) draws the current cell plus every visible destination cell through portals,
   adapts desktop/WebXR input to the runtime, and renders menus.

The geodesic emitter code lives in `src/world-objects/geodesic/`, one module per concern, listed lowest first (a module
imports only modules before it): `src/math/vec2.ts` (2-D helpers), `objects.ts` (object types, constants, constructors),
`portalWord.ts` (pure portal-word algebra), `development.ts` (cached inverse portal transforms), `trace.ts` (single-cell
and multi-cell ray tracing), `intersections.ts` (crossing markers), `endpoints.ts` (endpoint attachments and lifting),
`segments.ts` (derived segments), `lifecycle.ts` (locked queries and removal), `intervals.ts` (interval rebuilds and
previews), `sleeve.ts` (pure sleeve development, point funnel and taut string), `curveShortening.ts` (tie-and-detach and the
exact one-tick resolution of curve-shortening pairs), `legacyConnection.ts` (the retired
emitter-connection and straightening model; only `src/world-objects/geodesic/cannon.ts` and
`src/render/three/geodesicCannonTools.ts` may import it, enforced by `npm run docs:check`) and `cannon.ts` (shooting,
extending, connecting and placing cannons).

## Layers and the dependency rule

Dependencies point downward; lower layers never import higher ones.

```text
math → cell-complex → movement → world-objects → runtime/ui/authoring → glue → render → main
```

The exact allowed edges, the live dependency graph (Mermaid) and the list of *known violations* are in the
[generated reference](generated/ARCHITECTURE_REFERENCE.md#layer-dependency-graph). The rule that matters most: **`math`,
`cell-complex`, `movement` and (ideally) `world-objects` and `runtime` must be runnable and testable without a browser.**
The tests under `tests/` for those layers run in plain Node. Today a few edges break the rule (for example
`world-objects` reaching into `render` for mesh builders); they are frozen in `scripts/docs/layering-baseline.json`
and listed in the generated reference, and the check rejects new ones.

| Layer | Responsibility | Entry points |
| --- | --- | --- |
| `src/math` | vectors, rigid transforms, planes, polygons | `src/math/rigidTransform3.ts#composeRigidTransform3` |
| `src/cell-complex` | specs, compilation, portal paths, culling | `src/cell-complex/compileCellComplex.ts#compileCellComplex` |
| `src/movement` | collision, motion, portal crossing | `src/movement/movePlayer.ts#movePlayer` |
| `src/world-objects` | runtime objects and tools (flags, emitters, measurements, creatures) | `src/world-objects/runtimeObjectRegistry.ts#createRuntimeObjectRegistry` |
| `src/runtime` | menu state machine, commands, live geometry session | `src/runtime/worldGeometrySession.ts#createWorldGeometrySession` |
| `src/ui` | renderer-neutral palette/help/tooltips and input intents | `src/ui/paletteDefinition.ts#createPaletteDefinition` |
| `src/glue` | launch options, debug settings, app config, asset URLs | `src/glue/readLaunchOptions.ts#readLaunchOptions` |
| `src/render` | Three.js scene, portal rendering, desktop/XR input, palettes | `src/render/three/createThreeApp.ts#createThreeApp` |

## Startup

`src/main.ts` is deliberately small: read launch options from the URL, load the app config, then
(`restartApp`) load the world spec, compile it, preload assets (`src/render/three/preloadWorldAssets.ts#preloadWorldAssets`),
build the initial `AppState` (`src/appState.ts#createInitialAppState`) and call `createThreeApp`. Changing world, config
or debug options disposes the running app and starts a new one; a monotonically increasing run id discards a start that
was superseded while it was loading.

## Data ownership and immutability

- **Compiled geometry is immutable.** Cells, sides, portals and path tables are never mutated; changing geometry means
  compiling a new complex (below).
- **Runtime objects** live in a registry keyed by id and by cell
  (`src/world-objects/runtimeObjectRegistry.ts#RuntimeObjectRegistry`). Each object has a cell id and a local pose. The
  registry is the single source of truth for flags, geodesic intervals/emitters/free ends, measurements and protractor
  angles; renderers are *views* that are synchronised from it. Creatures, the marmot and collidable assets are written
  only by their **owners** (`src/world-objects/worldObjectOwner.ts#WorldObjectOwner`); for them the registry is a read
  model and any other write throws. `ObjectHost.placeAt` relocates any owned object by sending the placement command to
  its owner. Bulk particles (bullets, stars) never go through the registry.
- **Menu/tool state** is an immutable value updated by pure functions
  (`src/runtime/runtimeMenuState.ts#RuntimeMenuState`); the shell replaces its reference.
- **Player state** (`PlayerPose`) is replaced each frame by the result of `movePlayer`.

## Live geometry deformation

Some worlds can be *deformed while you stand in them* (for example a torus whose lattice is skewed). A deformation is a
point in a family (`src/runtime/worldGeometryDeformations.ts#WorldDeformationFamily`); the session
(`src/runtime/worldGeometrySession.ts#createWorldGeometrySession`) holds a *current* and a *target* state, builds the
deformed spec and recompiles it (including the static visibility cull) off the main thread in a worker, and exposes the
finished `WorldGeometrySnapshot`. The frame loop polls once at the start of each frame
(`commitReadyWorldGeometrySnapshot`) and, if a new snapshot exists, transports the player and every runtime object
across the change with per-cell maps (`src/runtime/worldGeometryDeformations.ts#CellDeformationMap`) before swapping the
world, so no frame ever renders a half-updated complex. Tool state that cannot be transported (active geodesic edits,
protractor selections) is cleared on commit.

## The application shell and the frame loop

`src/render/three/createThreeApp.ts#createThreeApp` is the only place that owns mutable cross-cutting state (player pose,
menu state, visible-portal results, tool state, XR session). Everything else is a pure module or a `create*(deps)`
factory that receives what it needs through an explicit `deps` object, with mutable state exposed as getters/setters so
a factory never holds a stale copy. Factories are created once, before the first `rebuildCellMeshes()`, in dependency
order. The factories are `aimInteraction`, `geodesicCannonTools`, `toolObjectRuntimes`, `geometryComputerMenu`,
`debugVisualization`, `geodesicDebugDumps`, `portalDebugRuntime`, `geodesicEmitterLabelController` and
`xrObjectTooltipController`.

Order of work in each frame (`renderFrame`):

1. Commit a finished geometry snapshot, if any.
2. Read input: the desktop or XR input frame (`RuntimeInputFrame`), including the reset request.
3. **Move the player** with `movePlayer` against the compiled world, then block against runtime-object colliders; in XR,
   additionally apply the *physical* head motion as a second move.
4. Resolve the active aim ray (camera centre ray or controller ray), update carried emitters, and dispatch the primary
   action to the selected tool (place flag, emit geodesic, measure, protractor, tie-and-detach, carry, rotate, aim, or the
   focused object's own interaction).
5. Advance the world: creature runtimes, curve-shortening pairs
   (`src/world-objects/geodesic/curveShortening.ts#advanceCurveShorteningPairs`), refresh dependent measurements and angles.
6. Place the camera(s); for XR also the per-eye culling cameras.
7. **Portal visibility and instances**: compute visible portal paths from the camera, update the instanced cell meshes
   (one draw per cell archetype, one instance per visible path) and the instanced runtime objects.
8. UI overlays: aim marker, labels, floating tooltips, palette, debug overlay.
9. `renderer.render`, then frame-timing bookkeeping.

## Rendering through portals

Rendering never builds a "world mesh". It draws each *cell* once as an instanced archetype and places one instance per
visible portal path using the path's `rootFromDestination` matrix; a fragment shader clips each instance to the screen
polygon through which that path is visible. Visibility is computed by
`src/render/three/visiblePortalPaths.ts#computeVisiblePortalPaths` as recursive convex clipping of portal apertures in
normalized device coordinates (details and the stereo variant are documented in that module and summarised in
[MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md)). Objects that straddle a portal or a vertex are drawn as "ghosts" in every cell copy their footprint reaches
(`src/render/three/runtimeObjectGhostRecords.ts#collectPortalGhostRuntimeObjectRenderRecords`).

## Input, tools and menus

Input from the mouse/keyboard (`src/render/three/desktopControls.ts`) and from WebXR controllers
(`src/render/three/xrControls.ts`) is reduced to one `RuntimeInputFrame` per tick. Menus are described once as
renderer-neutral data (`src/ui/paletteDefinition.ts#createPaletteDefinition`) and drawn by the in-scene palette
(`src/render/three/scenePaletteController.ts`) on desktop and in VR through the same code path
(`src/render/three/vrPaletteLibraryAdapter.ts` builds the VR widgets). Commands requested by the UI are plain data
(`src/runtime/runtimeCommands.ts`) dispatched by `src/runtime/appCommandDispatcher.ts#createAppCommandDispatcher`.

## Testing strategy

Tests mirror `src/` (see [testing.md](testing.md)). The geometry layers are covered by behavior tests that need no browser;
`tests/render-contract` checks renderer contracts with Three.js objects but no GPU; `tests/docs` enforces the
documentation rules above. There is no automated end-to-end test of the WebGL frame loop; the application shell is
checked by a manual/headless smoke run (see [DEVELOPMENT.md](DEVELOPMENT.md)).

## Keeping the documentation true

| Mechanism | What it guarantees |
| --- | --- |
| `scripts/docs/lib.mjs` | scans the code with the TypeScript compiler API (modules, headers, imports, exports, JSDoc) |
| `npm run docs:generate` | rewrites `_docs/generated/*` from the code |
| `npm run docs:check` / `tests/docs/documentation.test.ts` | fails on: a module without a header comment; an exported symbol without JSDoc; a stale generated file; a layering violation not in the baseline; a dangling `` `src/<dir>/<file>.ts#<symbol>` `` reference in the hand-written documents |
| `npm run docs:coverage [dir]` | lists what is still undocumented |

Rules for contributors: put the *why* and the *contract* in the code comment next to the code (header + JSDoc), put the
*mathematics that spans modules* in [MATHEMATICAL_MODEL.md](MATHEMATICAL_MODEL.md) with symbol references, and run
`npm run docs:generate` before committing. Never edit `_docs/generated/*` by hand.
