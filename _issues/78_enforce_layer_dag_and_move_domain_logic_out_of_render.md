# 78 - The layer rule is not a DAG: five import cycles and domain logic in render/three

Status: open; re-verified 2026-10-28.

Priority: P2 (architecture / tooling). Complements the frozen-baseline list in issue 41 ("Layering debt") with checker
gaps and a relocation plan.

Jobs: [32](../.agents/jobs/32_layer_dag.md).

## Status update 2026-10-28

Partly done. Re-checked the checker, the baseline and the import graph (module-level strongly connected components
computed from `scanProject()` in `scripts/docs/lib.mjs`).

Done:
- ~~`src/glue/vrComfortOptions.ts`~~ done: `VrComfortOptions` and `defaultVrComfortOptions` now live in
  `src/glue/vrComfortOptions.ts`. `runtime/runtimeMenuState.ts:12` and `glue/readLaunchOptions.ts:16` import from
  there, and `render/three/vrComfort.ts:10-12` re-exports them. `scripts/docs/layering-baseline.json` no longer has
  any `runtime -> render` or `glue -> render` edge.

Remains:
- `layers` (`scripts/docs/lib.mjs:23-50`) is still not a DAG: `runtime`/`ui` and `glue`/`runtime`/`ui` still permit
  each other, and `world-objects -> glue -> runtime -> world-objects` is a cycle of permissions. No test asserts
  acyclicity.
- No npm-import rule: `src/world-objects/geodesicMarmot.ts:6` and `simpleGeoCreature.ts:6` still import `three`.
- The baseline still lists 11 `world-objects -> render`/`runtime` edges, all from the two creature modules.
- All five import cycles listed below are still present, unchanged.
- No relocation has happened: `aimTarget.ts`, `visiblePortalPaths.ts`, `runtimeDiagnostics.ts`, `vrLocomotion.ts`,
  `xrSessionState.ts` and the others are still in `src/render/three` (still 83 files), and their tests are still in
  `tests/render-contract/`. `staticPortalPathCull.ts` (now 1,639 lines) still holds its private 2D kit and debug
  logging. There is no `src/math/vec2.ts` and no `src/ui/toolIds.ts`.

## Summary

The pure core is clean: `src/math` imports nothing, `cell-complex` imports only `math` (plus one baseline edge),
`movement` only `math`/`cell-complex`. But (a) the layer table in the docs checker is not acyclic and does not look at
npm imports, so `three` in `world-objects` is invisible to it; (b) there are five type-level import cycles; (c)
`src/render/three` (83 files) holds a large amount of renderer-independent logic, so "render" is really "everything the
shell needs".

## Evidence

- `scripts/docs/lib.mjs:23-50`: `runtime` may import `ui` and `glue`; `ui` may import `runtime`; `glue` may import
  `runtime` and `ui`; `world-objects` may import `glue`. These are mutual permissions, contradicting the linear order in
  `docs/ARCHITECTURE.md` ("math → cell-complex → movement → world-objects → runtime/ui/authoring → glue → render") and
  `docs/coding_style.md` ("glue -> browser APIs ...").
- npm imports are not layered: `src/world-objects/geodesicMarmot.ts:6` and `simpleGeoCreature.ts:6` `import * as THREE
  from "three"` with no baseline entry.
- Import cycles (strongly connected components, all broken only by `import type`):
  `world-objects/{geodesicCannon,runtimeObjectRegistry,placedFlags,measureLengthTool,protractorTool}`;
  `world-objects/{library,geodesicMarmot,simpleGeoCreature}` ↔ `render/three/{preloadWorldAssets,buildDecorationMesh,
  geodesicCannonRenderer,playerRoverModel,portalWallTexture}`; `runtime/runtimeMenuState` ↔ `glue/appConfig`;
  `runtime/worldGeometryDeformations` ↔ `runtime/deformations/torusSkewDeformation`;
  `render/three/geodesicCannonTools` ↔ `render/three/aimInteraction`.
- Renderer-independent modules in `render/three` (no `three` import): `vrLocomotion.ts` (143), `xrSessionState.ts`
  (148), `xrSessionRestart.ts`, `renderState.ts` (holds `RuntimeInputFrame`), `geodesicCarryPortalTransition.ts`,
  `geodesicCannonAimTarget.ts`, `runtimeObjectGhostRecords.ts`, `geometryComputerMenu.ts`, `runtimeDiagnostics.ts` (424,
  imported by `world-objects`).
- Modules using `three` only as a vector library: `visiblePortalPaths.ts` (839; `THREE.Vector*`/`Camera` for NDC
  projection, :22) and `aimTarget.ts` (1,164; ray/capsule/box/sphere intersection at :345-1100 over `Vec3`, `THREE.Matrix4`
  only for root-from-cell at :1107-1116).
- ~~`render/three/vrComfort.ts` mixes the `VrComfortOptions` data type with a vignette mesh; that is why
  `runtime/runtimeMenuState.ts:12` and `glue/readLaunchOptions.ts:16` are baseline violations.~~ done: the type moved to
  `src/glue/vrComfortOptions.ts`.
- `src/cell-complex/staticPortalPathCull.ts` (1,639) contains a private 2D geometry kit (`Vec2` :28, `clipConvexPolygonByHalfPlane`
  :1406, `polygonArea` :1378, `add2..orient2` :1490-1526) and debug logging (:624-690) beside the cull itself;
  `visiblePortalPaths.ts:461,647` has a second convex clipper.

## Fix

Tracked as job [32](../.agents/jobs/32_layer_dag.md). This issue is resolved when that job's acceptance criteria hold.

## Merged from issue 41 (2026-10-28)

- Eleven imports still break the intended layering, mostly `world-objects -> render` mesh builders and
  `world-objects -> runtime`. They are frozen in `scripts/docs/layering-baseline.json` and listed in
  `_docs/generated/ARCHITECTURE_REFERENCE.md`. Delete baseline entries as they are fixed; never add them.
