# Job 32 - Make the layer rule a real DAG

Status: queued.
Split from issue 78 on 2026-10-28: the defect stays in the issue, the design is here.
Resolves: issue [78](../../_issues/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md).

## Context

The defect, evidence and current state are in issue [78](../../_issues/78_enforce_layer_dag_and_move_domain_logic_out_of_render.md).

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
- `aimTarget` and `visiblePortalPaths` tests move from `tests/render-contract/` to plain-Node test dirs.
- Zero import cycles reported.
