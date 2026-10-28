# 17 - Dynamic visible portal path debug mode

Status: closed on 2026-05-27.

## Outcome

The renderer now discovers camera-visible portal paths every frame, exposes live visibility stats in debug state, and echoes per-path live visibility through `window.noneuclidPortalDebug.ShowCellPath(...)`.

## Implemented changes

- [src/render/three/visiblePortalPaths.ts](../../../src/render/three/visiblePortalPaths.ts) implements the parent-driven visible-path discovery pass, accumulated aperture clipping, area budgeting, and summary reporting.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) recomputes visible paths per frame and wires live visibility into the debug helper and overlay.
- [src/render/three/debugOverlay.ts](../../../src/render/three/debugOverlay.ts) and [src/render/three/renderState.ts](../../../src/render/three/renderState.ts) surface the compact visible-path count in the top debug UI.
- [src/glue/debugOptions.ts](../../../src/glue/debugOptions.ts) defines `portal-visible-path-debug`.
- [tests/render-contract/visiblePortalPaths.test.ts](../../../tests/render-contract/visiblePortalPaths.test.ts) covers first-hop visibility, behind-camera rejection, parent-driven visibility, nested apertures, depth limits, budgets, duplicate destinations, and live `ShowCellPath(...)` reporting.

## Verification

- `npm.cmd test -- --run`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-27.
