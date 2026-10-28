# 19 - Stage 04 desktop scene foundation

Status: closed on 2026-05-25.

## Outcome

The first desktop-playable renderer foundation is in place.

The app boots in the browser, compiles a world, creates a Three.js scene, accepts desktop movement input, resets to spawn, and follows the current cell while reusing the stage-03 movement contract.

This does not close the full original stage-04 renderer scope. Remaining renderer mesh, debug-overlay, and render-contract test work moved into a follow-up open issue.

## Implemented changes

- [src/main.ts](../../../src/main.ts) loads a selected world, compiles it, builds app state, and starts the renderer.
- [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts) creates the scene, camera, renderer, lighting, animation loop, and current-cell visibility behavior.
- [src/render/three/desktopControls.ts](../../../src/render/three/desktopControls.ts) provides keyboard movement, mouse look, pointer lock, and reset input.
- [src/render/three/buildCellMesh.ts](../../../src/render/three/buildCellMesh.ts) builds the current floor mesh, outline, portal debug panels, and decoration attachment points.
- [src/movement/movePlayer.ts](../../../src/movement/movePlayer.ts) is already wired into the desktop frame loop so collisions and portal crossings use the shared runtime rules.

## Verification

### Automated

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run build`

All passed on 2026-05-25.

### Scope note

The current implementation satisfies the "desktop exploration exists" portion of stage 04, but not the full mesh/debug/test checklist from the original handoff document.

## Acceptance criteria status

- Desktop app boots and renders a playable scene: complete.
- Keyboard/mouse movement is wired through runtime movement rules: complete.
- Reset to spawn is implemented: complete.
- Current-cell visibility updates as the player moves: complete.
- Full stage-04 rendering mesh coverage, overlay state, and renderer-contract tests: moved to follow-up issue.
