# Job 01 - Contain frame-loop errors and release everything on dispose

Status: done on 2026-10-28.
Resolves: issue [74](../../../_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md).

## Goal

One exception in a frame must not stop the render loop, and `dispose()` must release everything the app created.

## Steps

1. Wrap the body of `renderFrame` (`src/render/three/createThreeApp.ts`, about `:1208-1465`) in a per-frame try/catch.
   On error: log it (rate-limited, so a frame that fails every time does not flood the console), show it in the debug
   overlay, and keep the loop running. Do not swallow errors silently.
2. Make `dispose()` release creatures, tool runtimes, the rover and the geodesic render sources explicitly. Today some
   are freed only indirectly through their cell roots, without their textures.
3. Texture lifetimes (merged from issue 41): dispose the canvas textures `buildCellMesh.buildTextPlane` creates for
   portal debug labels, and the textures `preloadWorldAssets` loads.

## Verification

- Unit test: a frame callback that throws once is followed by a frame that renders; the error is reported once.
- Unit test: after `dispose()`, the disposed-resource counters (or spies on `dispose`) cover every family above.
- Acceptance criteria of [issue 74](../../../_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md).

## Result

All steps are done; issue 74 is closed with its evidence. Deviation: the per-family dispose check is a set of
unit tests on the helpers and the asset owner, not one test of `createThreeApp.dispose()`, which needs WebGL.
