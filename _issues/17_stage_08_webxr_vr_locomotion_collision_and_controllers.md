# 17 - Stage 08 WebXR VR locomotion, collision, and controllers

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: archive candidate after a current manual headset smoke check.

Priority: P2 for manual regression verification, not new architecture.

WebXR entry, session state, headset/player rig, controller input, room-scale
collision approval, reset, and desktop fallback are implemented. The issue's
current-state section predates that work. Its acceptance criterion requiring one
shared render root for both eyes was superseded by issue 21's true-stereo,
per-eye visibility model and must not be restored. Rewrite the closing note
around the current stereo architecture, record headset results, and archive.

## Goal

Implement a complete first WebXR VR path for the current Three.js app.

The result should let a student enter VR, look around naturally, move with room-scale and joystick locomotion, collide with authored world geometry, cross portals through the existing movement contract, reset cleanly, and still use the app on desktop when XR is unavailable.

This issue expands the narrower locomotion-readiness work in [15_vr_readiness_locomotion_and_collision.md](./_closed/15_vr_readiness_locomotion_and_collision.md) and implements the Stage 08 handoff in [docs/llm-handoff/18_stage_08_webxr_vr_controls.md](../llm-handoff/18_stage_08_webxr_vr_controls.md).

## Design Reference

Read [docs/design/010-webxr-vr-runtime.md](../design/010-webxr-vr-runtime.md) before implementing this issue.

That design is the source of truth for the intended WebXR architecture, player rig, locomotion model, controller input boundaries, comfort defaults, and testing strategy.

## Current State

The repository already has:

- a Vite/Three.js app,
- desktop controls in [src/render/three/desktopControls.ts](../../src/render/three/desktopControls.ts),
- the main renderer loop in [src/render/three/createThreeApp.ts](../../src/render/three/createThreeApp.ts),
- shared player movement through [src/movement/movePlayer.ts](../../src/movement/movePlayer.ts),
- compiled prism-cell collision, forbidden-zone, and portal traversal behavior,
- a Stage 08 handoff document for WebXR controls.

The important existing constraint is that `movePlayer(...)` is already the player movement contract. WebXR code should feed that contract rather than duplicating collision or portal logic.

## Scope

In scope:

- WebXR availability detection,
- secure-context messaging,
- `Enter VR` UI,
- session enter/exit/failure state,
- moving the renderer to `renderer.setAnimationLoop(...)`,
- desktop fallback preservation,
- XR headset pose integration,
- VR player rig,
- joystick locomotion,
- continuous controller rotation,
- reset from VR,
- room-scale physical movement routed through collision approval,
- collision and forbidden-zone blocking in VR,
- portal crossing in VR,
- first-pass mono XR render state shared by both headset eyes,
- contract tests for state and input mapping,
- manual headset acceptance checklist.

Out of scope:

- hand tracking,
- grabbing or pushing objects,
- physics interactions,
- multiplayer,
- native headset code,
- a separate VR collision engine,
- a separate VR portal traversal engine,
- controller tool selection or dispatch,
- controller ray tools,
- straight-ray or marker tools,
- in-world authoring UI,
- QR scanning inside the VR runtime.

## Required Files

Create or update these files as needed:

```text
src/render/three/xrSessionState.ts
src/render/three/xrEntryUi.ts
src/render/three/xrPlayerRig.ts
src/render/three/xrControls.ts
src/render/three/vrLocomotion.ts
src/render/three/vrComfort.ts
src/render/three/createThreeApp.ts
src/render/three/debugOverlay.ts
src/render/three/renderState.ts
tests/render-contract/xrSessionState.test.ts
tests/render-contract/vrLocomotion.test.ts
tests/render-contract/xrControls.test.ts
```

The exact split can vary, but keep pure input/state modules testable without a live WebXR device.

## Implementation Plan

### 1. Add XR session state

Implement a small model that can represent:

- `unknown`,
- `unsupported`,
- `insecure-context`,
- `available`,
- `entering`,
- `active`,
- `ended`,
- `failed`.

Required behavior:

- classify insecure contexts separately from unsupported browsers,
- expose readable labels for UI/debug overlays,
- update state when `navigator.xr?.isSessionSupported("immersive-vr")` resolves,
- handle promise rejection as a readable failure state,
- keep this module independent of Three.js scene objects.

### 2. Add entry UI and fallback messaging

Add a renderer-adjacent DOM entry component that:

- shows `Enter VR` only when immersive VR is available,
- explains when VR requires HTTPS or localhost,
- explains when immersive VR is unsupported,
- shows entering/failed states,
- hides or minimizes itself during active XR,
- leaves desktop controls usable.

Do not make this a large landing page. It should be a small runtime affordance.

### 3. Convert the render loop to `setAnimationLoop`

Update [src/render/three/createThreeApp.ts](../../src/render/three/createThreeApp.ts) so desktop and XR frames use a shared frame function.

Required behavior:

- call `renderer.setAnimationLoop(renderFrame)`,
- stop the loop with `renderer.setAnimationLoop(null)` during dispose,
- preserve resize behavior for desktop,
- preserve portal instance rendering,
- preserve one shared XR render root for both headset eyes in the first pass,
- preserve dynamic object updates,
- preserve diagnostics,
- avoid double-driving frames with both `requestAnimationFrame` and `setAnimationLoop`.

### 4. Create a shared input frame adapter

Introduce a shared frame shape for desktop and XR movement:

```ts
interface RuntimeInputFrame {
  readonly localDisplacement: Vec3;
  readonly yawDeltaRadians: number;
  readonly pitchDeltaRadians: number;
  readonly resetRequested: boolean;
  readonly source: "desktop" | "xr";
}
```

Desktop controls should adapt to this shape with no behavior change.

XR controls should fill the same movement fields from controller axes and button state.

### 5. Add VR comfort defaults

Add a small comfort/defaults module.

Start with:

- movement speed around 1.5 m/s,
- joystick dead zone around 0.18,
- conservative continuous turn speed,
- no jump,
- no forced camera bob,
- stable horizon,
- reset available.

Do not implement the narrowed-view comfort effect in this stage. Document it as the next comfort upgrade after the first working WebXR path.

Keep options centralized so headset testing can tune values without searching through controller code.

### 6. Add joystick locomotion

Map controller gamepad axes to locomotion requests.

Required behavior:

- dead-zone small stick noise,
- normalize diagonal movement,
- produce forward/back and strafe displacement,
- use the current yaw/player heading as the locomotion basis,
- return zero displacement when no useful axes exist,
- never throw when a controller lacks gamepad data.

The locomotion output must feed `movePlayer(...)`.

### 7. Add continuous rotation

Map left/right stick intent or equivalent input to smooth yaw changes.

Required behavior:

- dead-zone small stick noise,
- scale yaw delta by elapsed frame time,
- use a conservative default turn speed,
- avoid pitch or roll drift,
- do not change pitch,
- preserve stable horizon.

All artificial controller turning in this issue should be continuous rotation.

Document narrowed-view locomotion comfort as later work. It is a good candidate for reducing nausea during artificial movement, but it should not be part of this first implementation pass.

### 8. Add reset from VR

Map a controller button to the same reset behavior as desktop `R`.

Required behavior:

- reset returns to the default player pose for the app's starting cell,
- dynamic objects reset the same way they do today,
- reset works during active XR,
- desktop reset still works.

### 9. Add XR player rig

Create a renderer-local player rig that maps WebXR headset tracking to the project `PlayerPose`.

Required behavior:

- keep Three.js/WebXR types inside renderer code,
- track previous accepted headset local position,
- convert horizontal physical movement into a movement request,
- route accepted physical movement through collision checks,
- keep blocked physical moves from crossing walls or forbidden zones,
- keep view orientation controlled by the headset during active XR,
- keep desktop camera pose controlled by `PlayerPose` outside XR,
- keep `PlayerPose` as the only movement/collision state.

Do not let the headset camera freely drift through collision walls.

### 10. Add first-pass mono XR render state

Create renderer-local state for the shared XR render pose/root cell used by both headset eyes.

Required behavior:

- derive one mono XR render pose from the headset center and current `PlayerPose`,
- resolve that render pose against the current cell and portal boundary rules,
- compute visible portal paths once for that resolved render pose,
- render both headset eyes from that shared portal/cell render state,
- document that this may look flat or locally wrong when the user's head is exactly on a portal,
- keep true per-eye portal rendering out of this issue.

Do not attempt to determine separate left-eye and right-eye portal roots in this first pass.

### 11. Integrate physical room-scale movement

Room-scale movement should be treated as body movement, not only camera movement.

Required behavior:

- compute the horizontal delta between current and previous headset local poses,
- convert it into project world/cell coordinates,
- call `movePlayer(...)` with that displacement,
- update the current player pose from the result,
- record blocked/crossed-portal diagnostics,
- keep a conservative behavior when tracking data jumps unexpectedly.

If a large tracking jump appears, ignore or clamp it and prefer reset over a surprising teleport.

### 12. Preserve collision and forbidden-zone rules

Verify that VR movement respects:

- solid walls,
- floor,
- ceiling,
- player radius,
- player height,
- forbidden zones,
- portal boundary rules,
- portal transforms.

Do not add a parallel collision approximation in controller or rig code.

### 13. Preserve portal crossing

Joystick and accepted physical movement should be able to cross portals through `movePlayer(...)`.

Required behavior:

- update current cell when crossing,
- call existing diagnostics for cell transitions,
- sync visible cell and portal render state after crossing,
- render both XR eyes from the shared first-pass XR render state,
- keep desktop portal behavior unchanged.

### 14. Postpone controller tools

Do not add controller tool selection, trigger-to-tool dispatch, controller ray tools, straight-ray firing, marker placement, or a renderer-local tool request contract in this issue.

Required behavior:

- keep controller handling focused on locomotion, continuous rotation, and reset,
- avoid adding `controllerToolRequests.ts` or equivalent in this stage,
- avoid adding selected-tool branching to XR controls,
- document controller tools as follow-up work after the desktop tool contract exists.

### 15. Add a later tool contract issue

Create a separate follow-up issue or contract for controller tool use.

That later work should decide:

- how selected tools are represented,
- how controller trigger/button edges become tool requests,
- how controller target rays map to cell-local origins and directions,
- how straight-ray, marker, and measurement tools execute outside renderer/controller code,
- how resulting tool visuals render in desktop and VR.

### 16. Update debug state and overlay

Expose:

- secure-context status,
- XR availability,
- XR session status,
- active input source,
- current cell id,
- player position,
- yaw,
- last movement blocked state,
- last blocking reason,
- last crossed portal id,
- XR shared render root cell.

In VR, keep debug text optional and unobtrusive. Use the desktop mirror and console for detailed inspection.

### 17. Add contract tests

Add tests for:

- XR session state labels and transitions,
- unsupported vs insecure context classification,
- locomotion axis dead zones,
- diagonal locomotion normalization,
- missing gamepad data,
- continuous rotation axis mapping,
- continuous rotation dead-zone behavior,
- reset button mapping,
- first-pass mono XR render-root selection,
- blocked physical movement preserving the last valid pose at the adapter level.

Do not require a live headset for automated tests.

### 18. Manual headset acceptance

Run these manual checks on an HTTPS build:

- page loads in headset browser,
- `Enter VR` appears,
- insecure-context messaging appears when applicable,
- entering VR succeeds,
- exiting VR returns to a usable desktop page,
- headset look changes view direction,
- physical movement changes viewpoint inside collision limits,
- joystick forward/back/strafe works,
- continuous rotation works without pitch or roll drift,
- walls block movement,
- forbidden zones block movement,
- portal crossing works by joystick,
- portal crossing works by accepted physical movement if practical,
- both eyes render from the same first-pass XR render state,
- reset works from VR,
- desktop controls still work after XR changes.

## Acceptance Criteria

This issue is complete when:

- WebXR availability and secure-context states are visible and testable,
- `Enter VR` starts an immersive VR session on supported devices,
- desktop fallback remains usable,
- the renderer uses a shared animation loop compatible with desktop and XR,
- headset pose drives the VR view,
- joystick locomotion moves through the same `movePlayer(...)` contract as desktop,
- physical room-scale body movement is collision-approved,
- walls, forbidden zones, floor, ceiling, and portal rules are respected,
- portal crossing works in VR,
- XR portal visibility/culling uses one shared render root for both eyes in this first pass,
- reset works in VR,
- contract tests cover session state and input mapping,
- manual headset checks are documented in the PR or follow-up notes,
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Risks

True stereo portal rendering is a larger follow-up. This issue deliberately uses one shared XR render root for both eyes so WebXR entry, movement, collision, and portal teleportation can be tested first.

WebXR gamepad mappings may differ across headsets. Keep mappings defensive and avoid headset-specific assumptions unless manual testing proves a narrow exception is needed.

Room-scale blocked movement can feel strange if the user's real body moved but the virtual body is blocked. Prefer conservative clamping and a reliable reset over visually crossing walls.

Secure-context restrictions may block local headset testing. Use GitHub Pages or another HTTPS deployment as the default acceptance path.

## Non-goals

- Do not remove desktop controls.
- Do not make WebXR required for app startup.
- Do not add hand tracking.
- Do not add grabbing.
- Do not add multiplayer.
- Do not add a second movement/collision engine.
- Do not add controller tool selection or dispatch in this issue.
- Do not move future tool algorithms into renderer/controller modules.

## Notes For Implementers

Keep each step small enough that desktop mode can be checked after it lands.

When in doubt, preserve the world contract over a richer VR gesture. The important promise is that a student explores the same non-Euclidean cell complex in desktop and VR, governed by the same movement, collision, and portal rules.
