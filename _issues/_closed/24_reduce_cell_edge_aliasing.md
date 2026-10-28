# 24 - Reduce aliasing at cell and portal edges

Status: closed on 2026-05-28.

## Outcome

Issue 24 is complete.

The renderer now has an explicit, centralized render-quality policy, portal clip uniforms use drawing-buffer pixels, the portal clip shader can smooth edge coverage conservatively, and the related contract tests pass.

## Implemented changes

- [src/render/three/renderQuality.ts](../../../src/render/three/renderQuality.ts) centralizes antialiasing policy, capped device pixel ratio, canvas sizing, and drawing-buffer viewport sizing.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) applies the render-quality policy, configures the renderer pixel ratio explicitly, and exposes render-quality state in debug dumps.
- [src/render/three/portalClipMaterial.ts](../../../src/render/three/portalClipMaterial.ts) keeps portal clip coordinates aligned to framebuffer pixels and adds a conservative edge-smoothing path with a hard-discard fallback.
- [tests/render-contract/renderQuality.test.ts](../../../tests/render-contract/renderQuality.test.ts) covers pixel-ratio capping and renderer sizing conventions.
- [tests/render-contract/portalClipMaterial.test.ts](../../../tests/render-contract/portalClipMaterial.test.ts) covers viewport-to-NDC behavior, shader patch contents, and the smoothing contract.

## Verification

- `npm.cmd test -- --run tests/render-contract/renderQuality.test.ts tests/render-contract/portalClipMaterial.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run build`
