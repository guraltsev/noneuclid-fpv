# 78 - Make the layer rule a real DAG and move domain logic out of render/three

Status: open as of 2026-10-08.

Priority: P2 (architecture / tooling). Complements the frozen-baseline list in issue 41 ("Layering debt") with checker
gaps and a relocation plan.

## Summary

The pure core is clean: `src/math` imports nothing, `cell-complex` imports only `math` (plus one baseline edge),
`movement` only `math`/`cell-complex`. But (a) the layer table in the docs checker is not acyclic and does not look at
npm imports, so `three` in `world-objects` is invisible to it; (b) there are five type-level import cycles; (c)
`src/render/three` (83 files) holds a large amount of renderer-independent logic, so "render" is really "everything the
shell needs".

## Evidence

- `scripts/docs/lib.mjs:22-49`: `runtime` may import `ui` and `glue`; `ui` may import `runtime`; `glue` may import
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
- `render/three/vrComfort.ts` mixes the `VrComfortOptions` data type with a vignette mesh; that is why
  `runtime/runtimeMenuState.ts:12` and `glue/readLaunchOptions.ts:16` are baseline violations.
- `src/cell-complex/staticPortalPathCull.ts` (1,608) contains a private 2D geometry kit (`Vec2` :28, `clipConvexPolygonByHalfPlane`
  :1393, `polygonArea` :1365, `add2..orient2` :1477-1517) and debug logging (:612-683) beside the cull itself;
  `visiblePortalPaths.ts:461,647` has a second convex clipper.

## Proposed change

Target placement:

```text
src/math/vec2.ts, src/math/convexClip2.ts      2D kit + one convex clipper (from staticPortalPathCull + visiblePortalPaths)
src/cell-complex/staticCull/{index,aperture,tauSigma,projective,debug}.ts   split of staticPortalPathCull.ts
src/visibility/visiblePortalPaths.ts            NDC clipping on Vec3 + a 4x4 projection matrix type; three-free
src/interaction/aimTarget.ts                    ray-vs-object picking on RigidTransform3; render keeps a 20-line adapter
src/interaction/{inputFrame,vrLocomotion,xrSessionState,carryPortalTransition}.ts
src/glue/vrComfortOptions.ts                    VrComfortOptions + defaults (removes 2 baseline edges)
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
- `aimTarget` and `visiblePortalPaths` tests move from `tests/render-contract/` to plain-Node test dirs.
- Zero import cycles reported.
