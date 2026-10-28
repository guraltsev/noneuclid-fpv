# 16 - Finish stage 04 renderer meshes, debug overlay, and renderer contract tests

Status: closed on 2026-08-03.

## Outcome

The renderer meshes, debug surface, and renderer-contract coverage are in
place. Current debug state exposes cell, pose, yaw, XR status, movement result,
frame/WebGL statistics, per-eye portal counts, instance counts, and live
geometry-deformation state. An explicit world-id field remains optional P3
polish rather than a blocker.

## Closing evidence

The repository audit at `09dafe7` inspected the implemented debug/render state
and contract tests. Node/npm were unavailable in the audit environment, so the
test suite was not rerun as part of this documentation-only closure.

## Goal

Close the remaining gaps from the original stage-04 desktop-scene handoff now that the basic desktop-playable foundation exists.

This issue is intentionally narrower than the already-completed foundation work in [docs/issues/_closed/19_stage_04_desktop_scene_foundation.md](./19_stage_04_desktop_scene_foundation.md). It focuses only on the pieces that are still missing from the original renderer scope.

## Status

The renderer mesh work and renderer-contract coverage are now in place.

What remains is mostly the debug overlay/state surface from the original stage-04 checklist, plus any follow-on cleanup needed to keep that state useful for desktop and XR readiness checks.

## What is already done

The repository already has:

- browser app startup in [src/main.ts](../../../src/main.ts),
- a working Three.js app loop in [src/render/three/createThreeApp.ts](../../../src/render/three/createThreeApp.ts),
- desktop keyboard and mouse controls in [src/render/three/desktopControls.ts](../../../src/render/three/desktopControls.ts),
- world-aware player movement routed through the stage-03 runtime contract.

That work should remain in place. This issue is about finishing the renderer-side polish and testability that the original stage-04 checklist expected.

## Remaining gaps

The current renderer is still incomplete in a few specific places:

- [src/render/three/debugOverlay.ts](../../../src/render/three/debugOverlay.ts) still exposes a compact overlay focused on portal-path and instance state, not the richer desktop/XR readiness summary described below.
- [src/render/three/renderState.ts](../../../src/render/three/renderState.ts) still focuses on frame-level render state and portal-path diagnostics rather than the original stage-04 debug snapshot shape.
- The stage-04 debug surface could still be reshaped to surface world id, cell id, local position, yaw, last movement result, secure-context status, and WebXR availability more directly.

Because of those gaps, the original stage-04 renderer responsibilities are only partially complete.

## Required work

### 1. Finish cell mesh construction

Update [src/render/three/buildCellMesh.ts](../../../src/render/three/buildCellMesh.ts) so it produces renderable geometry for:

- floor,
- ceiling,
- solid side walls,
- portal side faces or portal frames,
- cell-local decorations.

Keep the visual style simple and readable. This is still stage 04, not recursive portal rendering.

This part is effectively done now: the cell mesh path already covers floor, ceiling, solid side walls, portal frames, and local decorations, and the contract tests exercise that shape.

### 2. Make portal-side metadata explicit

Return or expose enough metadata from `buildCellMesh(...)` that tests can verify which side faces are portals without walking huge Three.js graphs.

If [src/render/three/buildPortalMesh.ts](../../../src/render/three/buildPortalMesh.ts) remains part of the design, wire it into that path. If not, remove or replace the stub so the architecture is clearer.

### 3. Implement useful debug state and overlay behavior

Replace the placeholder renderer-local state with something that can represent at least:

- current world id if available,
- current cell id,
- local position,
- yaw,
- last movement result,
- whether the page is in a secure context,
- whether WebXR appears available when detectable.

The overlay may stay simple DOM or renderer-adjacent UI. It does not need to become an in-world VR panel.

### 4. Add renderer contract tests

Add tests under `tests/render-contract` that verify:

- debug state can be constructed from app state and movement results without needing a live renderer.

Keep the tests contract-level. Do not lock the implementation to large raw Three.js object dumps.

The mesh and portal-metadata contract tests already exist; what remains is coverage for the richer debug-state surface.

## Acceptance criteria

This issue is complete when:

- debug overlay state contains meaningful desktop/XR-readiness information,
- the renderer debug surface exposes the intended desktop/XR readiness details,
- renderer-contract tests cover the debug-state construction path,
- `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build` all pass.
