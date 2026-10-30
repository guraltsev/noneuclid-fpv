# 011 - VR Hand Tools Palette

> **Status: historical design record.** The palette shipped as a shared
> in-scene UI (`src/ui/paletteDefinition.ts`, `src/render/three/scenePalette*.ts`,
> `src/render/three/vrPalette*.ts`). The DOM palette, `desktopPaletteInput`,
> `vrPaletteController`, `xrPointers`, `src/tools/*`, and
> `renderLaunchControls` modules named below were removed as dead code; the
> file lists in this document describe the original plan, not the current tree.

This document designs the next interaction layer after the first WebXR locomotion pass.

The goal is to let a student summon a shared menu in both normal FPS mode and immersive VR, see a placeholder tool area for future geometry tools, and open a settings cog for world selection, reload, and a debug overlay toggle. This is a design and blueprint only. It does not require immediate implementation.

## Current State

The current app already has the right lower layers for this work:

- `src/render/three/createThreeApp.ts` owns the frame loop, Three.js scene, XR session entry, debug overlay, portal render state, dynamic object updates, and player movement calls.
- `src/render/three/xrControls.ts` maps XR gamepad input to locomotion, continuous turn, and reset.
- `src/render/three/desktopControls.ts` maps keyboard/mouse input to FPS movement, mouse look, pointer lock, and reset.
- `src/render/three/xrPlayerRig.ts` maps WebXR headset tracking to the project `PlayerPose`.
- `src/render/three/renderState.ts` defines the shared frame/debug state shape.
- `src/appState.ts` already has `selectedTool: "none" | "straight-ray" | "marker"`, but it is not yet a full runtime tool model.
- `src/glue/debugSettings.ts`, `src/glue/debugOptions.ts`, and `src/authoring/worldCatalog.ts` already define desktop world/debug configuration patterns.

The important architectural rule from the WebXR runtime design still applies: renderer/input code may adapt WebXR data, but movement, collision, portal traversal, geometry tracing, and tool algorithms should live outside controller or UI modules.

## Product Shape

The first useful study interface should expose the same menu structure in desktop FPS and VR, while using interaction patterns that feel natural in each mode.

Normal FPS mode:

1. Right mouse button opens a tool palette.
2. The app releases or suspends pointer-lock look while the palette is open.
3. The normal mouse pointer appears.
4. The palette appears at the center of the screen, near the FPS reticle.
5. The default menu content is an empty rectangular tool area.
6. The upper-left cog opens settings.
7. The upper-right `X` closes the menu.
8. The user clicks menu entries and cog/settings actions.
9. Closing the palette returns to FPS mouse-look mode.

VR mode:

The palette should feel like a compact wrist or palm palette, not a floating desktop modal.

Recommended first experience:

1. The user enters VR normally.
2. A stable summon gesture opens a small palette near the non-dominant hand.
3. The dominant hand points or pinches/selects.
4. The default menu content is the same empty rectangular tool area.
5. The upper-left cog opens settings.
6. The upper-right `X` closes the menu.
7. Selecting the cog changes the menu contents to settings actions that are safe to perform in VR.
8. In settings, the `X` becomes a back button labeled or shaped as `<-`.

Use the term "palette" in code and docs. The user-facing visual can look like a handheld pallet if desired, but "palette" is the common UI term.

## Design Principles

- Keep locomotion independent from menu selection. The existing joystick/controller path should remain usable while the palette is open unless a gesture is actively selecting UI.
- Use one command/menu model across desktop FPS and VR. Desktop right-click and VR hand/controller gestures should differ only in their input adapters and visual presentation.
- Make hand tracking optional. The app must still work with controllers because WebXR hand tracking support varies by browser and headset.
- Prefer explicit tool requests over renderer-side behavior. Hands, controllers, and desktop UI should all produce the same command/tool request shapes.
- Use in-world UI for VR-only interaction, not DOM overlays. DOM remains useful for desktop launch controls and debug text, but active XR needs Three.js objects.
- Keep destructive or disruptive actions confirmable. Reloading or changing worlds should require a second action or an obvious confirmation state.
- Keep first-pass visuals simple. Stable placement, readable labels/icons, and reliable hit testing matter more than animation polish.
- Treat geometry tools as future content for now. The first menu shows an empty tool rectangle and exposes only settings commands.

## Proposed Architecture

Add a small interaction layer between raw input and app/runtime effects.

```text
Desktop mouse + WebXR input sources
  -> desktopPaletteInput / xrHandTracking / xrPointerInput
  -> interactionFrame
  -> paletteController
  -> RuntimeCommand[] and ToolRequest[]
  -> app command dispatcher
  -> renderer-neutral tool systems and existing app/runtime APIs
```

The split should be:

- hand/controller input modules sample poses, gestures, rays, and button edges;
- desktop input modules sample right-click open requests and mouse pointer selection;
- palette controller owns UI state such as open/closed, input mode, active tab, focused item, and confirmation;
- command dispatcher owns effects such as reload, debug overlay toggles, world change URL navigation, and later selected-tool changes;
- tool modules own geometry behavior such as marker placement, ray tracing, measurement, and path traces;
- renderer modules own visual representations of hands, rays, palette panels, buttons, highlights, and tool results.

## Runtime Commands

Introduce a renderer-neutral command union. This lets palette, desktop UI, keyboard shortcuts, and future classroom controls share the same actions.

```ts
export type RuntimeCommand =
  | { readonly kind: "select-tool"; readonly toolId: GeometryToolId }
  | { readonly kind: "clear-tool" }
  | { readonly kind: "reset-player" }
  | { readonly kind: "reset-world" }
  | { readonly kind: "reload-world" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "set-debug-settings"; readonly settings: DebugSettings }
  | { readonly kind: "toggle-debug-option"; readonly optionId: DebugOptionId }
  | { readonly kind: "set-performance-overlay"; readonly enabled: boolean };
```

Recommended location: `src/runtime/runtimeCommands.ts` or `src/glue/runtimeCommands.ts`.

For the first menu implementation, only these commands are needed:

```ts
export type RuntimeCommand =
  | { readonly kind: "reload-world" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "set-debug-overlay"; readonly enabled: boolean };
```

The broader command union above is the likely future shape once tools and richer settings arrive. `reload-world` should navigate or rebuild from the current URL/world id. `change-world` should probably reload the page at first because current startup compiles and preloads one world in `src/main.ts`.

## Desktop FPS Palette

The desktop/FPS palette is not a separate feature. It is the desktop presentation of the same palette and command system.

Behavior:

- Right mouse button opens the palette at the center of the screen, aligned with the FPS reticle.
- While the palette is open, mouse-look should pause and the browser cursor should be visible.
- Left click activates buttons.
- Right click outside the palette, `Escape`, or the `X` button closes the palette.
- After closing, pointer-lock FPS controls should be restored by the existing user-gesture rules. If the browser requires a click to re-enter pointer lock, the app should present a minimal "click to resume" affordance.
- Keyboard movement may remain active while the palette is open only if it does not create accidental motion. The conservative first version should pause movement input while the palette is open.

Recommended presentation:

- Use a DOM palette for desktop FPS mode first.
- Use the same labels, grouping, cog/settings page, and command dispatch as the VR palette.
- Keep visual styling compact and tool-like, not a full modal.
- Do not use the browser context menu for right-click; call `preventDefault()` for the app canvas while the palette feature is active.

Recommended module: `src/render/three/desktopPaletteInput.ts` or `src/render/dom/desktopToolPalette.ts`.

The desktop palette can use DOM because it is outside immersive XR. The VR palette still needs Three.js geometry or a texture-backed panel because normal DOM overlays are not reliably available as interactive world-space UI inside immersive VR sessions.

## Shared Menu Definition

Do not hand-code two separate menus. The menu should be authored once and rendered differently for desktop and VR.

Recommended first-pass definition:

```ts
export type PalettePageId = "main" | "settings";

export interface PaletteButtonDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: "button";
}

export interface PaletteSelectDefinition {
  readonly id: "world";
  readonly label: string;
  readonly kind: "select";
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface PaletteToggleDefinition {
  readonly id: "debug-overlay";
  readonly label: string;
  readonly kind: "toggle";
}

export type PaletteItemDefinition =
  | PaletteButtonDefinition
  | PaletteSelectDefinition
  | PaletteToggleDefinition;

export interface PaletteDefinition {
  readonly page: PalettePageId;
  readonly title: string;
  readonly leftAction: "settings" | "none";
  readonly rightAction: "close" | "back";
  readonly items: readonly PaletteItemDefinition[];
}
```

Main page:

- left action: cogwheel/settings;
- right action: `X`;
- content: an empty rectangular tool area;
- no selectable tool buttons.

Settings page:

- left action: none or disabled cog slot;
- right action: back `<-` in the same upper-right slot where `X` appeared on the main page;
- content:
  - world dropdown populated from `worldCatalog`;
  - reload button;
  - debug overlay toggle.

Recommended modules:

- `src/ui/paletteDefinition.ts` for the shared menu model;
- `src/render/dom/desktopToolPalette.ts` for the normal DOM rendering;
- `src/render/three/vrPaletteMesh.ts` for the VR rendering.

The shared definition keeps the authoring pleasant while still allowing VR-specific hit testing.

## DOM Authoring And VR Rendering

Programming every button from scratch in raw Three.js would be unpleasant and brittle. The design should avoid that.

Use this split:

- Author the menu as a declarative TypeScript/HTML-like definition.
- Render that definition as real DOM for desktop FPS mode.
- Render that same definition into a VR panel using Three.js objects or a canvas texture.
- Route both DOM click events and VR ray selections through the same `PaletteAction` ids.

Do not rely on live DOM events inside immersive VR as the primary implementation. WebXR has a DOM Overlay module, but it is not the right baseline for this app's immersive VR menu because support and behavior vary, and it does not give us a dependable hand/controller ray interaction model for an in-world wrist panel.

Two practical implementation paths:

1. Structured menu model to dual renderers.

   This is the recommended path. Define pages/items once in TypeScript, render to DOM on desktop, render to Three.js planes/text in VR, and keep a shared rectangle layout model for hit testing.

2. DOM-inspired canvas renderer.

   Use a hidden DOM-like layout model or simple CSS-sized boxes, draw the menu to a `canvas`, use that canvas as a `CanvasTexture` on a VR plane, and map controller ray UV coordinates back to item rectangles. This keeps VR visually close to desktop but still requires explicit layout metadata.

Avoid trying to screenshot arbitrary DOM into a WebGL texture. Browsers do not provide a clean native "DOM element to canvas texture" pipeline for general HTML/CSS, and SVG foreignObject tricks are fragile.

## VR UI Library Options

There are libraries that can reduce the amount of raw Three.js UI work.

The project should not build a full widget toolkit from scratch. Buttons, toggles, dropdowns, scrollable lists, focus/hover/active states, clipping, text wrapping, and controller selection are all widget-system work. Recreating them locally would distract from the geometry app and would almost certainly produce a worse VR UI.

Recommended candidates:

- `@pmndrs/uikit`: strongest candidate for a modern 3D/XR UI layer. It provides Flexbox-like layout through Yoga, crisp text, UI components, and pointer-event-oriented interaction. It has React Three Fiber bindings and also supports vanilla Three.js usage through `@pmndrs/uikit`.
- `three-mesh-ui`: small, Three.js-native VR UI library. It creates `Object3D` UI blocks that can be added directly to a Three.js scene. It is a simpler fit for the current non-React app, but appears less actively modern than `@pmndrs/uikit`.
- `@react-three/xr` plus `@react-three/uikit`: best developer experience if the app moves to React Three Fiber. It gives web-like pointer events across XR and non-XR input, but adopting it would be a larger app architecture change.
- Wonderland Engine or A-Frame-style engines: useful for new WebXR apps, but too large a direction change for this existing renderer.

Recommendation for this project:

- Prefer evaluating `@pmndrs/uikit` first, specifically its vanilla Three.js path.
- Treat `@pmndrs/uikit` as the default implementation choice if a short integration spike proves it works with the current Three.js renderer and WebXR loop.
- Keep `three-mesh-ui` as the simpler fallback if UIKit adds too much integration weight.
- Do not migrate the app to React Three Fiber just for this menu.
- Keep the shared `PaletteDefinition` even if a VR UI library is used. The library should replace low-level layout/text/button rendering, not become the owner of app commands or menu state.

Even with a UI library, the app still needs:

- controller/hand ray selection wired to the library's pointer/event model;
- page state for main/settings;
- runtime command dispatch for world selection, reload, and debug overlay;
- desktop DOM rendering or an explicit decision to also render the desktop menu through the 3D UI layer.

The first spike should prove these widget requirements before any hand-written VR widgets are attempted:

- button click/hover/active states;
- toggle control for the debug overlay;
- dropdown or dropdown-equivalent world selector;
- scrollable list behavior for long world menus;
- readable text at wrist/menu distance;
- controller ray hover and select;
- hand-pinch select if hands are available;
- clean disposal when exiting XR or rebuilding the app.

## Tool Requests

Tool requests are future work. The first implementation should not expose selectable geometry tools.

Tool requests should be separate from settings commands. A tool request is an action in the mathematical world.

```ts
export type GeometryToolId =
  | "none"
  | "straight-ray"
  | "marker"
  | "measure-distance"
  | "measure-angle"
  | "path-trace";

export type ToolRequest =
  | {
      readonly kind: "fire-straight-ray";
      readonly originCellId: string;
      readonly origin: Vec3;
      readonly direction: Vec3;
      readonly maxDistanceMeters: number;
    }
  | {
      readonly kind: "place-marker";
      readonly cellId: string;
      readonly position: Vec3;
    }
  | {
      readonly kind: "measurement-point";
      readonly cellId: string;
      readonly position: Vec3;
    }
  | {
      readonly kind: "clear-tool-results";
    };
```

Recommended location: `src/tools/toolRequests.ts`.

Do not make `xrControls.ts` call the ray tracer or marker code. It should only produce input/selection events that become `ToolRequest` values.

## App State Shape

The current `AppState` is immutable initial state. The next interaction layer needs a mutable runtime state object owned by the app instance or a small runtime store.

Future tool-state additions:

```ts
export interface RuntimeToolState {
  readonly selectedTool: GeometryToolId;
  readonly markers: readonly Marker[];
  readonly measurements: readonly MeasurementTool[];
  readonly rayTraces: readonly StraightRayTrace[];
}

export interface RuntimeSettingsState {
  readonly debugSettings: DebugSettings;
  readonly performanceOverlayEnabled: boolean;
  readonly selectedWorldId: string;
}
```

For the first menu implementation, the required runtime state is smaller:

```ts
export interface RuntimeMenuState {
  readonly page: "main" | "settings";
  readonly selectedWorldId: string;
  readonly debugOverlayEnabled: boolean;
  readonly open: boolean;
}
```

This state can initially live inside `createThreeApp` as a local object passed into helper modules, but it should not be expressed as scattered local variables long term. The migration path is to add a small `src/runtime/createRuntimeState.ts` store with explicit methods.

## Hand Tracking Support

When starting an XR session, request hand tracking as optional:

```ts
optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"]
```

The design should tolerate three input modes:

- `hands`: WebXR input sources with `source.hand`;
- `controllers`: tracked-pointer sources with gamepads and target rays;
- `hybrid`: controllers for locomotion plus one tracked hand if available.

Do not require hand tracking for the palette. The same palette should be usable through controller rays.

Recommended module: `src/render/three/xrHands.ts`.

Responsibilities:

- detect whether an `XRInputSource` has an `XRHand`;
- sample important joints, especially wrist, index-finger-tip, thumb-tip, and palm proxy;
- provide stable hand poses in renderer/project coordinates;
- compute pinch amount from thumb/index distance;
- expose confidence/stability flags;
- avoid throwing when a browser exposes partial hand data.

Suggested pure data shape:

```ts
export interface XrHandPose {
  readonly handedness: "left" | "right";
  readonly wristMatrix: THREE.Matrix4;
  readonly indexTipWorld: THREE.Vector3;
  readonly thumbTipWorld: THREE.Vector3;
  readonly pinchStrength: number;
  readonly palmUpScore: number;
  readonly tracked: boolean;
}
```

Renderer-local types may use Three.js and WebXR. Any downstream tool request should be converted to cell-local `Vec3` data before leaving renderer code.

## Summon Gesture

Recommended first-pass summon behavior:

- Primary: non-dominant hand palm-up dwell for 0.45 seconds opens the palette near the wrist.
- Secondary: controller menu/button or long grip toggles the palette.
- Close: palm turns away, explicit close button, or selecting a tool.

Why this recommendation:

- palm-up is discoverable and common for wrist menus;
- dwell avoids accidental flicker from noisy hand poses;
- controller fallback keeps the feature testable without hand tracking.

Implementation detail: treat this as a small state machine with hysteresis.

```text
closed -> candidate-open -> open -> candidate-close -> closed
```

Use timers and thresholds in a pure module such as `src/render/three/vrPaletteState.ts`, with tests that feed synthetic pose samples.

## Palette Placement

The palette should be anchored near the non-dominant wrist when a tracked hand exists.

Placement rules:

- Position it 10-18 cm above and slightly forward of the wrist/palm.
- Face it toward the headset, not strictly with the wrist normal.
- Smooth pose changes with critically damped interpolation.
- Clamp angular velocity so the panel does not chase jitter.
- Freeze placement while the user is actively selecting a button.
- If hand tracking is lost, keep the palette in its last stable pose for a short grace period, then fall back to a head-locked or controller-anchored panel.

For controller fallback, anchor the palette in front of the headset at a comfortable distance or attach it to the off-hand controller with the same facing-toward-headset rule.

## Palette Visual Model

Recommended first layout:

- a compact rectangular panel centered on screen in desktop mode;
- a compact rectangular panel near the off-hand/wrist in VR mode;
- a small top row with the cogwheel in the upper left and `X` in the upper right;
- an empty rectangular content area on the main page;
- a settings page after pressing the cog;
- large hit targets, at least 4-5 cm in world size;
- simple icon plus short label for each active control.

Initial main page:

- upper-left cogwheel button;
- upper-right `X` close button;
- empty rectangle where tools will later appear;
- no selectable tools.

Initial settings page:

- upper-right back button `<-` replacing the `X`;
- world dropdown;
- reload button;
- debug overlay toggle.

The settings page should avoid nested modal depth at first. The world selector should be a dropdown in desktop DOM mode and a dropdown-like selector or compact list in VR mode. It should use `worldCatalog` as its source.

## Selection Model

Use one interaction abstraction for hands, controllers, and desktop mouse:

```ts
export interface PointerSample {
  readonly id: string;
  readonly handedness: "left" | "right" | "none";
  readonly originWorld?: THREE.Vector3;
  readonly directionWorld?: THREE.Vector3;
  readonly screenPosition?: { readonly x: number; readonly y: number };
  readonly selectPressed: boolean;
  readonly selectStarted: boolean;
  readonly selectEnded: boolean;
  readonly source: "desktop-mouse" | "hand-pinch" | "controller-ray";
}
```

For hand tracking, `selectPressed` comes from pinch strength crossing a threshold. For controllers, it comes from trigger/select events or gamepad button edges.

For desktop, `selectPressed` comes from mouse button edges and `screenPosition` drives DOM hit testing.

First-pass VR UI selection should use ray hits against palette button planes. Direct touch can come later. Ray selection is easier to test, works with controllers, and does not require precise near-field hand physics.

## Geometry Tool Use

This section is future work. The first implementation deliberately has no selectable tools.

After a tool is selected:

- show a subtle ray from the dominant hand/controller;
- resolve the ray against the current cell and visible/portal-aware surfaces as needed;
- convert hit points or rays into `ToolRequest` values;
- let renderer-neutral tool systems update tool result state;
- render markers/rays/measurements as scene objects attached to cell render roots and portal render paths where appropriate.

First implementation order should be:

1. Marker placement on visible cell surfaces.
2. Straight ray firing from the hand/controller ray.
3. Distance measurement with two placed points.
4. Angle measurement with three placed points.
5. Path tracing or portal-aware visualizations.

The current `src/tools` contracts are very small, so expect to expand them before adding rich visuals.

## Settings Cog Behavior

The cog should dispatch `RuntimeCommand` values, not directly mutate renderer internals.

First-version command semantics:

- `World dropdown`: selects a target world id. The actual world change may happen immediately after selection or after a separate confirmation in a later version.
- `Reload`: reload the current URL/current world.
- `Debug overlay toggle`: show or hide the shared debug overlay.

The debug overlay toggle should be simpler than the full debug settings modal. It should toggle a single visible overlay state. A later settings page can expose full `DebugSettings` and `canApplyDebugSettingsAtRuntime(...)`.

World changing should initially use URL navigation, matching the desktop world picker. Hot-swapping worlds in an active XR session is a larger lifecycle problem because `main.ts` currently compiles, preloads, and constructs the renderer once.

## Debug Overlay

The current debug overlay is a DOM element and is not visible as an in-headset panel during immersive XR. The palette should introduce a renderer-side debug panel.

Recommended first-pass overlay:

- small head-locked or wrist-pinned text panel;
- fps or frame time;
- current cell id;
- visible portal path count;
- portal instance count;
- last blocked movement reason;
- XR input mode: hands/controllers/hybrid.

Implemented in `src/render/three/xrDebugPanel.ts`: a canvas-textured plane, head-locked about 0.55 m ahead, 0.17 m left and 0.1 m above the head, that shows the same lines as the desktop overlay (`formatDebugOverlayLines`). It is visible exactly when XR is presenting, debug mode is on and the "UI overlay" toggle is on, independent of the palette's open state, and its canvas is redrawn at most four times per second.

Use the existing `runtimeDiagnostics()` and `RenderState`/`XrDebugRenderState` concepts where possible, but render the XR overlay as Three.js text or simple bitmap/canvas texture. Do not try to reuse DOM overlays inside immersive XR.

## Portal and Cell Coordinates

Hands and controllers exist in Three.js/XR tracking space. Tool requests need project cell-local coordinates.

The conversion path should be explicit:

1. sample XR pose in renderer space;
2. map through `xrPlayerRig.root` into Three.js world space;
3. convert through `worldAxes` helpers into project coordinates;
4. use the current `PlayerPose.cellId` as the starting cell unless a portal-aware ray resolver says otherwise;
5. for portal-crossing tool rays, record each segment with its cell id.

This conversion should live in renderer adapter modules such as `xrToolRays.ts`, while the actual trace or measurement logic should live in `src/tools`.

## Proposed Files

Likely new files:

- `src/runtime/runtimeCommands.ts`
- `src/runtime/runtimeState.ts`
- `src/runtime/appCommandDispatcher.ts`
- `src/ui/paletteDefinition.ts`
- `src/render/three/desktopPaletteInput.ts`
- `src/render/dom/desktopToolPalette.ts`
- `src/render/three/xrHands.ts`
- `src/render/three/xrPointers.ts`
- `src/render/three/paletteState.ts`
- `src/render/three/vrPaletteMesh.ts`
- `src/render/three/vrPaletteController.ts`
- `src/render/three/xrPerformancePanel.ts`

Future tool files:

- `src/tools/toolRequests.ts`
- `src/tools/toolState.ts`
- `src/tools/executeToolRequest.ts`
- `src/render/three/xrToolRays.ts`

Likely tests:

- `tests/render-contract/xrHands.test.ts`
- `tests/render-contract/xrPointers.test.ts`
- `tests/render-contract/desktopPaletteInput.test.ts`
- `tests/render-contract/paletteState.test.ts`
- `tests/render-contract/paletteController.test.ts`
- `tests/runtime/runtimeCommands.test.ts`

Future tool tests:

- `tests/tools/toolRequests.test.ts`

## Integration Points

`createThreeApp(...)` should eventually delegate more work instead of growing indefinitely.

First integration should be narrow:

- create `runtimeState`;
- create `appCommandDispatcher`;
- create shared `paletteController`;
- create desktop palette input/presentation for non-XR FPS mode;
- create VR palette input/presentation for immersive XR mode;
- on each frame, sample hands/controllers and feed the palette controller;
- on desktop pointer events, feed right-click/open/select/close events to the palette controller;
- dispatch returned commands after movement but before rendering;
- render/update palette meshes and optional overlay meshes;
- dispose palette resources during app disposal.

Avoid placing gesture thresholds, button definitions, command execution, and tool execution directly inside `createThreeApp.ts`.

## Implementation Phases

Phase 1: Command and state foundation.

- Add `RuntimeCommand`, `RuntimeMenuState`, `PaletteDefinition`, and shared menu actions.
- Add a dispatcher for reload, world navigation, and debug overlay toggle.
- Add tests for command behavior that does not require WebXR.

Phase 2: Desktop FPS menu.

- Add right-click open at screen center.
- Pause pointer-lock mouse-look while open.
- Render the shared menu definition as DOM.
- Wire `X`, cog, back, world dropdown, reload, and debug overlay toggle.
- Restore FPS mode after close.

Phase 3: Pointer abstraction.

- Add desktop mouse samples, controller ray samples, and hand pinch samples behind one `PointerSample` shape.
- Request optional `hand-tracking`.
- Add tests for button/pinch edge detection.

Phase 4: Palette state machine.

- Add desktop right-click open/close state.
- Add VR open/close gesture state.
- Add focus/hover/select state.
- Add settings-page transition state.
- Test with synthetic samples.

Phase 5: VR palette rendering.

- Add a simple Three.js palette mesh for VR mode.
- Add shared button definitions and hit targets.
- Add controller ray selection.
- Add hand pinch selection if hands are available.

Phase 6: Settings cog.

- Wire world dropdown/list, reload, and debug overlay toggle.
- Keep world switching URL-based initially.
- Add a minimal XR performance/debug panel.

Phase 7: Geometry tools.

- Future work; do not include in the first menu implementation.
- Wire marker placement.
- Wire straight-ray requests.
- Add measurement request state.
- Add persistent result rendering and clear behavior.

Phase 8: Headset hardening.

- Test on target headsets and browsers.
- Tune gesture thresholds.
- Document unsupported hand-tracking behavior.
- Ensure controller fallback remains fully usable.

## Acceptance Criteria

- VR can be entered without hand tracking support.
- In normal FPS mode, right mouse opens the palette.
- In normal FPS mode, the palette opens centered on screen.
- In normal FPS mode, the mouse pointer can select cog/settings actions.
- FPS mouse-look is suspended while the desktop palette is open and can resume after close.
- The main page shows an empty rectangular content area with no selectable tools.
- The upper-left cog changes the menu to the settings page.
- The upper-right `X` closes the main page.
- On the settings page, the former `X` slot becomes a back button `<-`.
- Settings contain a world selector, reload button, and debug overlay toggle.
- If hands are available, palm-up dwell summons the palette.
- If hands are unavailable, controller fallback can summon and operate the palette.
- Palette selection does not break locomotion, reset, collision, or portal traversal.
- Reload and world change route through shared runtime commands.
- Debug overlay is visible in immersive XR when enabled.
- Debug overlay state is shared by desktop and VR presentations.
- Future tool algorithms remain outside `src/render/three`.
- Contract tests cover command dispatch, pointer abstraction, gesture state, and palette selection.

## Open Design Decisions

These are the places where programmer/product judgment is still needed.

1. Dominant hand default: should the app assume right-handed pointing and left-hand palette, or expose a handedness toggle immediately?
2. Summon gesture: is palm-up dwell acceptable for the classroom audience, or should the primary gesture be a controller/menu button until hand tracking is proven reliable?
3. World switching: is URL reload acceptable from inside VR for the first version, or do we need hot world swapping without leaving the XR session?
4. Performance overlay: should it be head-locked for readability or wrist-pinned for less visual intrusion?
5. Debug access: should students see the debug overlay toggle, or should the cog expose teacher/developer controls only when a debug launch option is active?

## Recommendation

Use a conservative first version:

- desktop FPS opens the shared palette with right mouse and selects with the normal pointer;
- desktop palette appears centered on screen, near the FPS reticle;
- main page has an empty rectangular content area with no selectable tools;
- upper-left cog opens settings;
- upper-right `X` closes the main page and becomes `<-` back on the settings page;
- settings include world dropdown, reload, and debug overlay toggle;
- right hand points, left hand summons by palm-up dwell;
- controller menu/grip fallback always works;
- VR palette uses ray selection first, not direct touch;
- world switching reloads the page through the existing URL world picker contract;
- full debug toggles and geometry tools wait for later phases.

This gives the project a real shared desktop/VR menu while keeping the hard parts isolated: hand sampling, palette state, command dispatch, and future tool execution each get their own testable home.
