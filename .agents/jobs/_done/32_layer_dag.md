# Job 32 - Make the layer rule a real DAG

Status: done, needs review on 2026-10-31.
Split from issue 78 on 2026-10-28: the defect stays in the issue, the design is here.
Resolves: issue [78](../../_issues/_closed/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md).

## Context

The defect, evidence and current state are in issue [78](../../_issues/_closed/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md).

## Proposed change

Target placement:

```text
src/math/vec2.ts, src/math/convexClip2.ts      2D kit + one convex clipper (from staticPortalPathCull + visiblePortalPaths)
src/cell-complex/staticCull/{index,aperture,tauSigma,projective,debug}.ts   split of staticPortalPathCull.ts
src/visibility/visiblePortalPaths.ts            NDC clipping on Vec3 + a 4x4 projection matrix type; three-free
src/interaction/aimTarget.ts                    ray-vs-object picking on RigidTransform3; render keeps a 20-line adapter
src/interaction/{inputFrame,vrLocomotion,xrSessionState,carryPortalTransition}.ts
src/glue/vrComfortOptions.ts                    VrComfortOptions + defaults (done; removed the 2 baseline edges)
src/diagnostics/runtimeDiagnostics.ts           (removes 3 world-objects baseline edges)
```

Creatures (`geodesicMarmot`, `simpleGeoCreature`): split into `world-objects/creatures/*Behavior.ts` (pure motion) and
`render/three/creatures/*View.ts` (meshes); removes the remaining `world-objects -> render` edges and both `three` imports.

Checker (`scripts/docs/lib.mjs`):
1. Rewrite `layers` as a strict order; drop mutual permissions (move `RuntimeToolId`/`RuntimeDebugOverlayItemId`, now
   in `runtimeMenuState.ts`, to a leaf `src/ui/toolIds.ts` so `glue/appConfig` stops importing `runtime`).
2. Add an npm-import rule: `three`, `@pmndrs/*` allowed only in `render` (and `root`).
3. Report module-level cycles (including type-only) and fail on new ones.

## Acceptance criteria

- `layers` in `scripts/docs/lib.mjs` is a DAG; a test asserts it.
- `layering-baseline.json` has no `world-objects -> render`, `runtime -> render`, `glue -> render` edges.
- No `from "three"` outside `src/render` and `src/main.ts`, enforced by `docs:check`.
- `aimTarget` and `visiblePortalPaths` tests move from `tests/render/` to plain-Node test dirs.
- Zero import cycles reported.

## Report

### Done
Not committed: the changes are in the working tree on `design/012-engine-api`.
- **Checker** (`scripts/docs/lib.mjs`, `checks.mjs`, `render.mjs`): `layers` is a strict order (key order = layer order, each `may` names only earlier layers, `"*"` only on `render` and `root`); new `layerOrder`, `layerMayImport`; `scanProject` records npm imports (`packages`); `packageImportRules` (three and `@pmndrs/*` only in `render`/`root`); `importCycles` (Tarjan, type-only imports included). `docs:check` has two new lines, "npm imports" and "import cycles", both with zero tolerance. `layering-baseline.json` is empty. `tests/project/layering.test.ts` asserts the table is a DAG, the two rules on fake graphs, and the real project.
- **New layers**: `diagnostics` (`debugLevels` from `glue`, `runtimeDiagnostics` from `render/three`), `visibility` (`portalFunnel`, `visiblePortalPaths`), `interaction` (`inputFrame` split from `renderState`, `vrLocomotion`, `xrSessionState`, `carryPortalTransition`, `aimTarget`).
- **Three-free cores with Three adapters** in the old places: `visibility/visiblePortalPaths` (camera = `VisibilityCamera`, placement matrix generic through `matrixForPath`; adapter `render/three/visiblePortalPaths.ts`) and `interaction/aimTarget` (ray = `AimRay`; adapter `render/three/aimTarget.ts`).
- **Creatures**: `world-objects/creatures/{geodesicMarmot,simpleGeoCreature}Behavior.ts` (pure motion, registry publishing) and `render/three/creatures/*View.ts` (meshes, wireframe, parenting). No `world-objects -> render` edge and no `three` import outside `render` remain.
- **Moved to break edges**: `glue/toolIds.ts` (tool ids, overlay items); deformation vocabulary and torus family to `cell-complex/`; `appState` and `serverChannel` to `runtime/`.
- **Cycles removed (5 -> 0)** besides the above: `world-objects/runtimeObjectBase.ts` and `toolObjects.ts` (record types split from the registry users), `geodesic/anchors.ts`, `reduceAdjacentInversePortalTraversals` moved to `geodesic/objects.ts`, `render/three/preparedWorldAssets.ts`, `FocusedRuntimeObject` moved to `rootAimRay.ts`.
- **Tests moved**: `vrLocomotion`, `xrSessionState`, `carryPortalTransition`, `aimTarget` to `tests/interaction/`; `portalFunnel`, `visiblePortalPaths` (+ property test) to `tests/visibility/`; the two deformation tests to `tests/cell-complex/`; `serverChannel` to `tests/runtime/`. New: `tests/render/aimInteraction.test.ts` (the cache case cut from the aimTarget test), `tests/support/visibilityHarness.ts`.
- Docs: `_docs/ARCHITECTURE.md` (order, new layers, rules), dangling `src/...` references fixed, generated references regenerated, `.agents/knowledge/layer-dag.md`.

### Deviations
- `toolIds` is in `src/glue/`, not `src/ui/`. With `ui` above `glue` (it imports `glue/appConfig`), `glue -> ui` would be an upward edge.
- The `staticPortalPathCull` split (`cell-complex/staticCull/*`) and `math/convexClip2.ts` were not done: the job's evidence is stale. Job 20 deleted the tau/sigma cull (`staticPortalPathCull.ts` is 575 lines with no private 2D kit) and `math/vec2.ts` already exists; the only convex clipper left is in `visibility/portalFunnel.ts`.
- The layer order is not the one in `docs/ARCHITECTURE.md` before this change (`glue` was after `runtime`/`ui`); it is `... authoring -> glue -> interaction -> runtime -> ui -> render`, because `runtime` imports `glue` types and `ui` imports both.
- The moved visibility tests run through `tests/support/visibilityHarness.ts`, which still builds Three cameras (test support may use `three`); the tests themselves compare rigid transforms, not Three matrices. The aimTarget test uses a pure `aimRayLookingAt` helper instead of a camera.
- The creature tests stay in `tests/world-objects/` and still exercise the view (they read `runtime.root`); only the imports changed.
- `PreparedWorldAssets` and `FocusedRuntimeObject` moves, and the `reduceAdjacentInversePortalTraversals` move, are beyond the job text; they were needed for "zero cycles".

### Uncertain
- Whether the maintainer wants the creature and visibility tests split into pure-behavior tests and view tests; today the behavior is tested through the view.
- The `interaction` layer sits below `runtime`; design 012 may want it elsewhere when the engine API lands.

### Not done
- The `staticCull` split and `convexClip2.ts` (see Deviations).
- Issue 78 stays open with a pointer to this report until the maintainer reviews.
- The full release tier was not run; only `creatures.release.test.ts` and `torusDeformation.release.test.ts` (both pass in headless Edge).

### Checks
- `npm run typecheck`: clean. `npm test`: 132 files, 1,016 tests pass. `npm run docs:check`: all eight lines ok. `npm run build`: ok.
- `npx vitest run --project release --no-file-parallelism tests/app/creatures.release.test.ts tests/app/torusDeformation.release.test.ts`: 3 tests pass.
