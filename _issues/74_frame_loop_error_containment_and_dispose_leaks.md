# 74 - Frame loop has no error containment; dispose misses runtime objects

Status: open as of 2026-10-08.

Priority: P2 (robustness). In VR, a single throw freezes the headset image.

## Summary

Any exception thrown inside `renderFrame` stops the animation loop permanently. Separately, `dispose()` does not
release several runtime-object families. The XR-session part of dispose is already filed in issue 41 and is not
repeated here.

## Evidence

- `createThreeApp.ts:1204-1461` has no `try`. `renderer.setAnimationLoop(renderFrame)` (`:1779`) relies on
  three r0.164 `WebGLAnimation.onAnimationFrame` (`node_modules/three/src/renderers/webgl/WebGLAnimation.js:8-12`),
  which calls the loop and only *afterwards* requests the next frame. If the loop throws, the next frame is never
  requested. On desktop the canvas freezes. In an immersive session no further `XRSession.requestAnimationFrame`
  is issued, so the compositor keeps reprojecting the last frame: frozen world, head-locked artefacts, comfort risk.
  The user has no way out except the system menu.
- Plausible throw sites inside the loop:
  - `normalizeVec3` in `aimTarget.ts:1023`, `:1090` and `:1113` (only some call sites use the
    `normalizeVec3OrFallback` wrapper at `:1128-1134`);
  - geometry-commit mapping (`:1215`, `:1483+`);
  - `advanceCurveShorteningPairs` (`:1369`);
  - `movePlayer` on degenerate input;
  - `computeVisiblePortalPaths` on a malformed table after a deformation.
- `dispose()` (`:1789-1858`) never disposes:
  - `dynamicObjectRuntimes` (marmots and creatures; their geometries and the materials cloned in
    `buildDecorationMesh.ts:112-146`);
  - measured-length and protractor-angle runtimes;
  - the player rover model;
  - geodesic runtime render sources;
  - the cell-mesh `onBeforeRender` closures, which capture the app;
  - the warm-up state.

  Only placed flags (`:1817-1820`) are handled. Switching worlds through `requestAppRestart` therefore leaks GPU
  buffers and textures per restart.

## Proposed change

1. Wrap the body of `renderFrame` in `try/catch`. On error:
   - record it with `runtimeDiagnostics().recordDebugEvent` and log it once per distinct message;
   - still call `renderer.render(scene, camera)` when the failure happened before the draw, so XR keeps a live,
     head-tracked frame;
   - count consecutive failures. After N (for example 30), end the XR session (`session.end()`) and show the error
     in the desktop overlay instead of spinning.
2. Run each phase (objects, aim/UI, portal sync) through a small `runPhase(name, fn)` helper that catches and records
   errors separately. A failing tooltip then cannot block movement or rendering.
3. Add `dispose()` to every runtime family and call it from `dispose()` and from `rebuildGeometryDependentRuntime*`.
   Add a dev-only test that counts `renderer.info.memory.geometries` and `textures` before create and after dispose.

## Acceptance criteria

- Test: inject a throwing runtime into `dynamicObjectRuntimes`. The loop keeps scheduling frames and the error is
  recorded once.
- Test: in a mocked XR session, persistent failures end the session after the threshold.
- Test: create, dispose, create, dispose in the jsdom/WebGL stub leaves `renderer.info.memory` at baseline. With a
  real renderer this belongs in the browser smoke test (issue 36).
