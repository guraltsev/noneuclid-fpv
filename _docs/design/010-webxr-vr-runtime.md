# 010 - WebXR VR Runtime

This document describes how the project should add WebXR VR support while preserving the existing desktop renderer and movement contracts.

The core rule is simple: VR is another input and view layer over the same compiled world. It must not become a second movement engine or a second collision engine.

## Goals

The first complete VR implementation should provide:

- WebXR session entry and exit through Three.js,
- readable availability, failure, and secure-context states,
- first-pass XR rendering with one shared eye/camera state for both headset eyes,
- physical headset motion inside a tracked space,
- controller joystick locomotion,
- continuous controller rotation,
- collision and portal traversal through the existing movement pipeline,
- easy reset from desktop and VR,
- desktop fallback with no headset dependency.

The experience should be good enough for a student to put on a headset, enter the same authored world, move through it safely, and cross portals without learning a separate VR-specific application.

## Non-goals

Do not include these in the first complete WebXR pass:

- hand tracking,
- grabbing or physics-based object manipulation,
- multiplayer,
- headset-specific native code,
- a VR-only collision system,
- a VR-only portal traversal model,
- controller tool selection or dispatch,
- controller ray tools,
- marker tools,
- in-world authoring UI,
- QR scanning inside the VR runtime,
- interpretation or theorem-generation logic.

Controller use in this stage means joystick locomotion, continuous rotation, and reset. It does not mean embodied hands or tool use.

## Architecture

The renderer should be split into small renderer-local modules:

```text
src/render/three/xrSessionState.ts
src/render/three/xrEntryUi.ts
src/render/three/xrPlayerRig.ts
src/render/three/xrControls.ts
src/render/three/vrLocomotion.ts
src/render/three/vrComfort.ts
```

The exact file names may change, but these responsibilities should remain separate:

- session state answers whether XR can start and what state the app is in,
- entry UI renders the `Enter VR` path and fallback messages,
- player rig maps between WebXR tracking space and the project `PlayerPose`,
- controls convert controller/gamepad state into movement, continuous rotation, and reset requests,
- locomotion turns input axes into `movePlayer` requests,
- comfort owns speeds, turn speed, dead zones, and later narrowed-view locomotion comfort settings.

Domain packages should not import Three.js or WebXR types. Renderer packages may adapt domain contracts to WebXR.

## Runtime Loop

The current desktop renderer manually drives frames with `requestAnimationFrame`. WebXR should move the renderer to Three.js `renderer.setAnimationLoop(...)` so desktop and XR can share one frame path.

The frame path should be organized around an input frame:

```ts
interface RuntimeInputFrame {
  readonly localDisplacement: Vec3;
  readonly yawDeltaRadians: number;
  readonly pitchDeltaRadians: number;
  readonly resetRequested: boolean;
  readonly source: "desktop" | "xr";
}
```

Desktop controls can keep producing their current shape and be adapted into this frame. XR controls should produce the same movement fields from controller axes and buttons.

The render loop should then:

1. read the active input source,
2. reset when requested,
3. call `movePlayer(...)` for artificial locomotion and continuous rotation,
4. integrate approved physical headset motion,
5. update dynamic objects,
6. render desktop or XR using the appropriate camera path.

Desktop rendering may keep using a single camera and one visible-portal computation.

The first XR implementation may also use one shared render camera/root cell for both eyes. This is intentionally conservative: it may look somewhat flat or imperfect near portals, but it lets the project test WebXR entry, movement, continuous rotation, collision, reset, and portal teleportation before taking on true stereo portal rendering.

## Player And Render Pose Model

WebXR supplies poses relative to an XR reference space. The project stores a `PlayerPose` in a current cell. The bridge between those two concepts should be explicit.

Use one authoritative player body pose and one first-pass XR render pose:

- `playerPose`: the project `PlayerPose` that represents the user's collision body in the current cell,
- `lastHeadLocalMeters`: the headset position relative to the reference origin on the previous accepted frame,
- `headLocalMeters`: the current headset position relative to the reference origin,
- `pendingPhysicalDelta`: the horizontal physical movement requested by room-scale motion,
- `xrRenderPose`: the mono render pose used for both eyes in the first WebXR pass.

`playerPose` is the only movement/collision state. Raw XR tracking positions are input samples used to derive movement deltas and the first-pass render pose. They must not become a second world-position system.

Physical headset motion should be treated as a movement request, not as free body teleportation. The collision body must not pass through walls, forbidden zones, floors, ceilings, or invalid portal boundaries.

The first pass should apply room-scale horizontal translation through `movePlayer(...)`. If the headset reports an obviously invalid vertical pose or tracking jump, keep rendering comfortable but do not move the collision body through floor or ceiling.

## First-Pass Mono XR Rendering

The first WebXR implementation should not try to solve full per-eye portal rendering.

Use one resolved XR render pose/root cell for both eyes:

1. derive a mono XR render pose from the headset center and authoritative `playerPose`,
2. resolve that render pose against the current cell and portal boundary rules,
3. compute visible portal paths once for that resolved render pose,
4. render both headset eyes using that shared portal/cell render state.

This is a temporary simplification. It should be good enough to validate:

- entering and exiting WebXR,
- headset orientation,
- joystick locomotion,
- continuous rotation,
- collision,
- forbidden-zone blocking,
- reset,
- portal crossing/teleportation through `movePlayer(...)`.

Known limitation: if the user's head is exactly on a portal, the two physical eyes could belong to different cells, but the first-pass renderer will still show both eyes from the same resolved cell. That may look flat or locally wrong near the portal. Accept that limitation for the first implementation.

## Later Per-Eye Portal Rendering

After WebXR movement and collision are working, add true per-eye portal rendering.

The later conservative rendering rule should be:

1. determine the right-eye position in the current cell complex,
2. if the right eye has crossed a portal boundary, transform that eye render pose through the portal for rendering,
3. render the right eye from that resolved eye cell and pose,
4. determine the left-eye position in the current cell complex,
5. if the left eye has crossed a portal boundary, transform that eye render pose through the portal for rendering,
6. render the left eye from that resolved eye cell and pose.

That later per-eye portal transform is render-time only. It does not mean the player body has crossed unless `movePlayer(...)` moves the authoritative `playerPose` through the portal.

Be conservative about work in the later implementation:

- if both eyes resolve to the same cell and equivalent portal-side state, reuse the same visible path/culling result when it is safe,
- if the eyes resolve to different cells or different portal-side states, compute visibility separately for each eye,
- avoid running pruning algorithms and multiplying portal matrices twice when both eyes are clearly in the same cell with the same visible path root,
- never reuse one eye's culling result for the other eye when the eyes straddle a portal.

## Locomotion

VR locomotion should have conservative defaults:

- move speed: about 1.5 meters per second,
- joystick dead zone: about 0.18,
- continuous turn speed conservative enough for first-time VR users,
- no jump,
- no smooth camera bob,
- no forced camera animation,
- stable horizon,
- reset reachable from a controller button and desktop key.

Recommended controller mapping:

- left or right primary thumbstick forward/back: forward movement,
- same thumbstick left/right: strafe,
- off-hand thumbstick left/right or same stick with a clear mode: continuous rotation,
- grip or secondary button: reset or open a minimal reset affordance,
- browser/session exit remains controlled by the platform.

All artificial controller turning in this stage should be continuous rotation.

A narrowed-view comfort effect is a later improvement. It is known to reduce nausea for many users during artificial locomotion, but it should not block the first WebXR implementation.

The implementation should tolerate controller differences. WebXR gamepad profiles vary, so the code should prefer semantic behavior over hard-coded headset names:

- inspect connected `XRInputSource` objects,
- choose a primary pointing controller from `targetRayMode === "tracked-pointer"` when available,
- use gamepad axes only when present,
- keep missing axes harmless,
- keep desktop controls active outside XR.

## Collision And Forbidden Movement

All artificial locomotion and accepted room-scale body translation should route through the existing movement contract:

```ts
movePlayer({
  world,
  pose,
  body,
  localDisplacement,
  yawDeltaRadians,
  pitchDeltaRadians,
  coordinateFrame: "global",
});
```

VR must respect:

- solid side walls,
- floor and ceiling limits,
- player radius and height,
- forbidden zones,
- portal crossing transforms,
- portal boundary rejection,
- blocked movement reports.

If a room-scale physical move is blocked, the collision body should remain at the last valid pose. The headset may still show a small amount of natural lean relative to the body, but the app must prevent the rendered world from implying the user crossed a wall or forbidden zone.

If testing shows room-scale movement creates nausea or mismatch when blocked, prefer the conservative behavior: keep the world anchored to the valid body pose and let reset recover the user.

## Portal Crossing

Portal crossing in VR should be the same state transition as desktop. Crossing a portal changes the current cell and transforms the pose through the compiled portal transform. It should not reparent the entire renderer to a special VR portal scene.

Required portal behavior:

- joystick locomotion can cross portals,
- accepted room-scale physical motion can cross portals,
- first-pass XR uses one shared resolved render pose for both eyes,
- later per-eye portal rendering resolves each eye independently,
- recursive or instanced portal rendering may use a simpler VR path if stereo artifacts appear.

The renderer should treat movement and collision correctness as higher priority than true stereo portal visuals in the first pass. If a mono debug effect cannot be made reliable in VR, disable that effect in XR and keep the underlying movement correct.

## Later Controller Tools

Controller tool use is intentionally postponed.

Do not implement selected tool dispatch, trigger-to-tool behavior, controller ray tools, marker placement, or straight-ray firing in the first WebXR pass. The current app does not have a complete tool contract, so this stage should not invent one inside the renderer.

Later work should add a separate controller-tool contract that defines:

- how a selected tool is represented in app state,
- how controller trigger/button edges become tool requests,
- how controller target rays are converted to cell-local origins and directions,
- how straight-ray, marker, and measurement tools execute outside renderer/controller modules,
- how resulting tool visuals are rendered in desktop and VR.

That later contract may add `controllerRays.ts`, `controllerToolRequests.ts`, and their tests. Those files should not be required for the first VR movement implementation.

## Session State And Entry UI

The app should model XR session state without requiring a headset in tests:

```ts
type XrSessionStatus =
  | "unknown"
  | "unsupported"
  | "insecure-context"
  | "available"
  | "entering"
  | "active"
  | "ended"
  | "failed";
```

The entry UI should:

- show `Enter VR` when immersive VR is available,
- show secure-context guidance when blocked by HTTP,
- show unavailable messaging when the browser or device does not support immersive VR,
- show entering/failed states readably,
- stay out of the way during desktop use,
- not cover the VR mirror with long debug text.

Use GitHub Pages or another HTTPS deployment as the default headset testing path. Localhost may work for development, but classroom LAN testing should assume secure-context problems until proven otherwise.

## Debug And Diagnostics

Desktop debug state should include:

- XR availability status,
- secure-context status,
- XR session status,
- active input source,
- current cell id,
- player position,
- yaw,
- last movement result,
- last blocked reason,
- last crossed portal id.

In VR, debug text should be optional and minimal. Prefer the desktop mirror and browser console for detailed diagnostics.

The existing `window.noneuclidPortalDebug` helpers can remain desktop-first. Do not force them into an in-world VR panel in this stage.

## Testing Strategy

Automated tests should focus on pure contracts and adapters:

- XR session state transitions,
- secure-context/availability classification,
- controller gamepad axes to locomotion frame,
- continuous rotation axis mapping,
- reset request mapping,
- room-scale delta to movement request,
- first-pass mono XR render-pose resolution,
- blocked movement preserving last valid body pose,
- desktop input still adapting to the shared frame.

Do not try to fully emulate a headset in unit tests. Manual headset checks are required.

Manual checks:

- HTTPS build loads on a headset browser,
- `Enter VR` appears on a supported headset,
- unavailable and insecure-context states are readable,
- entering and exiting VR does not break desktop mode,
- headset look direction controls view,
- room-scale movement updates the viewpoint within collision limits,
- joystick locomotion moves through the world,
- continuous rotation works without pitch or roll drift,
- walls block movement,
- forbidden zones block movement,
- portal crossing works,
- both eyes render from the same first-pass XR render state,
- reset works from VR,
- desktop fallback still works.

## Implementation Phases

Phase 1 should introduce session state, entry UI, `setAnimationLoop`, and desktop fallback preservation.

Phase 2 should introduce the VR player rig and basic headset camera alignment without artificial locomotion.

Phase 3 should add joystick locomotion, continuous rotation, reset, and movement through `movePlayer(...)`.

Phase 4 should add room-scale movement approval through collision, including blocked-move behavior.

Phase 5 should harden controller mappings across tested headsets and document any profile-specific findings.

Phase 6 should harden debugging, tests, documentation, and manual headset acceptance.

Later rendering phases should add true per-eye portal rendering after movement, collision, and teleportation are working.

Later tool phases should add controller rays, selected tool dispatch, and tool request contracts after the desktop tool model exists.

Each phase should leave desktop mode working.

## Open Decisions

The implementation may decide these based on headset testing:

- whether one or both thumbsticks should move by default,
- whether reset should be grip, secondary button, or a small DOM/XR affordance,
- whether room-scale blocked movement should hard clamp or allow small view-only lean,
- whether the first-pass mono XR portal visual is good enough for classroom testing before true per-eye rendering,
- when to add the narrowed-view comfort effect after the first working VR implementation.

Prefer classroom reliability over broad configurability for the first pass.
