# 27 - Common in-scene palette and aimer interaction

Status: closed on 2026-08-03.

## Outcome

Desktop and XR feed one scene-palette input/controller model, desktop keeps
pointer lock for normal menu use, shared tool state exists, and in-scene sign
editing and object menus are implemented. Unused DOM compatibility paths are
cleanup tracked by issue 38 rather than missing acceptance behavior.

## Closing evidence

The repository audit at `09dafe7` inspected the common controller/input paths
and contract tests. Node/npm were unavailable, so tests were not rerun for this
documentation-only closure.

## Goal

Replace the split desktop DOM palette and VR-only scene palette with one common in-scene palette system.

The same menu should be rendered as Three.js UI objects and operated by an aimer in both desktop and immersive VR:

- desktop uses pointer lock, freezes camera look while the palette is open, and routes mouse movement to an in-game pointer or ray,
- VR uses controller rays, and later hand rays or pinch input,
- both paths feed the same shared palette controller,
- both paths mutate the same runtime menu state and dispatch the same app commands,
- menu panels are in-scene UI objects, not topological cell-world runtime objects.

This issue is a UI architecture issue. It should make future tools, including the geodesic cannon tool, feel the same on desktop and VR.

## Key Principle

The palette is scene UI, not world state.

Do not add menu panels to the runtime object registry. Do not assign menu panels to topological cells. Do not render menu panels through portal instance rendering. Do not make menu panels collide with world objects.

The palette exists in renderer scene space:

```text
shared RuntimeMenuState
  -> shared PaletteDefinition
  -> shared in-scene uikit palette renderer
  -> shared ray/select interaction controller
  -> desktop aimer input OR XR controller input
```

World objects such as flags, geodesic cannons, geodesic segments, creatures, and signs remain registry objects. Palette panels do not.

## Why This Refactor Is Needed

The current codebase has two menu presentations:

- desktop menu rendering and input live in DOM modules,
- VR menu rendering and input live in Three.js/uikit modules.

The two paths share some data through `PaletteDefinition` and `RuntimeMenuState`, but they do not share the actual interaction model.

This creates design drift:

- desktop has tool tiles that VR does not render,
- VR has ray-based in-scene interaction that desktop does not use,
- desktop opens the DOM menu by pausing pointer lock,
- VR samples `XRFrame`, `XRReferenceSpace`, and `XRInputSource` directly inside the palette controller.

The desired architecture is one common in-scene palette controller with small input adapters at the edge.

## Terminology

Use these terms consistently:

- `scene palette`: the common in-scene menu panel rendered with Three.js/uikit.
- `scene pointer`: a renderer-space pointer source with an origin, direction, select state, and optional toggle state.
- `desktop aimer`: the desktop pointer-lock input source that moves an in-game cursor/ray while the menu is open.
- `XR pointer`: a WebXR controller or hand-derived pointer source.
- `palette controller`: shared code that updates the palette, resolves hits, dispatches actions, and does not know about WebXR types.
- `input adapter`: desktop or XR-specific code that converts raw input into shared scene pointer data.

Avoid names implying VR ownership for common code. Prefer:

```text
scenePaletteController
scenePaletteLibraryAdapter
scenePaletteInput
desktopScenePaletteInput
xrScenePaletteInput
```

Avoid:

```text
vrPaletteController
desktopToolPalette
domPaletteController
```

unless the module is genuinely legacy, compatibility-only, or mode-specific.

## Current Code To Study

Start by reading these files:

- `src/render/three/createThreeApp.ts`
- `src/render/three/vrPaletteController.ts`
- `src/render/three/vrPaletteLibraryAdapter.ts`
- `src/render/three/xrPointers.ts`
- `src/render/three/desktopControls.ts`
- `src/render/three/desktopPaletteInput.ts`
- `src/render/dom/desktopToolPalette.ts`
- `src/runtime/runtimeMenuState.ts`
- `src/ui/paletteDefinition.ts`

Important current facts:

- `vrPaletteController.update(...)` is WebXR-shaped because it requires `XRFrame`, `XRReferenceSpace`, and `XRInputSource[]`.
- `desktopToolPalette.ts` renders tool tiles for `aim`, `place-flag`, and `geodesic-cannon`.
- `vrPaletteLibraryAdapter.ts` currently renders `main` and `place-flag-options` as mostly empty content.
- `desktopPaletteInput.ts` pauses and resumes desktop controls around the DOM palette.
- `desktopControls.ts` currently turns pointer-lock clicks into `primaryActionRequested`.
- `createThreeApp.ts` wires both DOM desktop palette callbacks and VR palette callbacks separately.

## Target Architecture

Refactor toward this shape:

```text
WebXR input sources                 Desktop pointer-lock mouse
        |                                      |
        v                                      v
xrScenePaletteInput                 desktopScenePaletteInput
        |                                      |
        +---------------+----------------------+
                        |
                        v
              ScenePaletteInputFrame
                        |
                        v
              scenePaletteController
                        |
                        v
              scenePaletteLibraryAdapter
                        |
                        v
              RuntimeMenuState updates
              RuntimeCommand dispatch
              selected tool changes
```

The shared controller should not import or reference WebXR types.

Allowed shared dependencies:

- `three`
- `@pmndrs/uikit`
- `PaletteDefinition`
- `RuntimeMenuState` types and state reducers
- app callback interfaces for menu actions

Forbidden in shared controller:

- `XRFrame`
- `XRReferenceSpace`
- `XRInputSource`
- `Gamepad`
- DOM `HTMLElement`
- pointer lock API calls
- runtime object registry ownership
- cell id, portal path, or cell-local world data

Mode-specific adapters may use those APIs at the boundary.

## Shared Pointer Contract

Add a renderer-space pointer contract.

Suggested file:

```text
src/render/three/scenePaletteInput.ts
```

Suggested types:

```ts
import * as THREE from "three";

export type ScenePalettePointerKind = "desktop-aimer" | "xr-controller" | "xr-hand";

export interface ScenePalettePointerSource {
  readonly id: string;
  readonly kind: ScenePalettePointerKind;
  readonly object: THREE.Object3D;
  readonly selectPressed: boolean;
  readonly dominant?: boolean;
  readonly visibleRay?: boolean;
}

export interface ScenePaletteInputFrame {
  readonly deltaSeconds: number;
  readonly menuTogglePressed: boolean;
  readonly pointers: readonly ScenePalettePointerSource[];
}

export interface ScenePalettePointerState {
  readonly id: string;
  readonly kind: ScenePalettePointerKind;
  readonly hoveredTargetId?: string;
  readonly selectPressed: boolean;
  readonly selectStarted: boolean;
  readonly selectEnded: boolean;
  readonly dominant: boolean;
}
```

`object` should be an `Object3D` whose world transform represents the pointer ray:

```text
origin = object world position
direction = object local -Z transformed into world space
```

This matches the current VR ray convention.

## Shared Controller API

Create a common scene palette controller.

Suggested file:

```text
src/render/three/scenePaletteController.ts
```

Suggested API:

```ts
export interface ScenePaletteControllerOptions {
  readonly scene: THREE.Scene;
  readonly getCamera: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly getIsOpen: () => boolean;
  readonly onOpenRequested: () => void;
  readonly onCloseRequested: () => void;
  readonly onShowSettingsRequested: () => void;
  readonly onShowMainRequested: () => void;
  readonly onWorldSelected: (worldId: string) => void;
  readonly onReloadRequested: () => void;
  readonly onDebugEnabledChanged: (enabled: boolean) => void;
  readonly onDebugSettingsRequested: () => void;
  readonly onConsoleLogLevelSelected: (level: RuntimeMenuConsoleLogLevelId) => void;
  readonly onDebugOverlayToggled: (enabled: boolean) => void;
  readonly onDebugOverlayItemToggled: (itemId: RuntimeDebugOverlayItemId, enabled: boolean) => void;
  readonly onPortalPanelModeSelected: (mode: PortalPanelModeId) => void;
  readonly onPortalInspectionToggled: (enabled: boolean) => void;
  readonly onCollisionGeometryWireframesToggled: (enabled: boolean) => void;
  readonly onToolSelected: (toolId: RuntimeToolId) => void;
  readonly onPlaceFlagOptionsRequested: () => void;
  readonly onPlaceFlagTypeSelected: (flagType: PlacedFlagType) => void;
}

export interface ScenePaletteControllerUpdate {
  readonly input: ScenePaletteInputFrame;
  readonly definition: PaletteDefinition;
  readonly placement: ScenePalettePlacement;
}

export interface ScenePaletteController {
  update(frame: ScenePaletteControllerUpdate): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
```

The exact names can vary, but the boundary must remain mode-neutral.

## Desktop Aimer Behavior

Desktop should keep pointer lock when the menu is open.

While the menu is closed:

- mouse movement controls camera yaw and pitch,
- left click performs the active tool primary action,
- right click opens the scene palette.

While the menu is open:

- camera yaw and pitch are frozen,
- mouse movement moves the desktop aimer/palette pointer,
- left click selects the focused palette item,
- right click closes the palette or toggles it closed,
- `Escape` closes the palette,
- movement keys should be either disabled or intentionally allowed by design. Prefer disabling movement for the first implementation to avoid accidental walking while choosing UI.

Do not release pointer lock just to show a browser cursor.

Implement desktop menu pointer state as an in-game pointer. Two acceptable first designs:

1. Reticle ray with angular offset.

   Store yaw/pitch offsets from screen center while the palette is open. Mouse deltas update the offset. Clamp the offset to the visual palette area. Build a pointer object in front of the camera whose ray intersects the palette.

2. Panel-local cursor.

   Store normalized panel-local cursor coordinates. Mouse deltas move the cursor over the panel. Convert the cursor position to a ray or directly to a palette hit. This can feel more like a 2D mouse while still rendering in-scene.

Recommended first implementation:

Use a panel-local cursor for desktop. It will feel stable, avoids aiming jitter, and still uses the same scene palette action model. Keep the cursor rendered as a small in-scene marker on the panel.

## Desktop Controls Refactor

`desktopControls.ts` should stop treating every pointer-lock click as a world primary action when the menu is open.

Possible approach:

- keep `desktopControls` responsible for movement and camera look,
- add an option or method to set a `lookMode`,
- when `lookMode === "camera"`, mouse deltas update camera look,
- when `lookMode === "palette"`, mouse deltas are exposed to `desktopScenePaletteInput` and not consumed as camera look.

Suggested shape:

```ts
export type DesktopLookMode = "camera" | "palette";

interface DesktopControls {
  setLookMode(mode: DesktopLookMode): void;
  consumeFrame(deltaSeconds: number): DesktopInputFrame;
}
```

Alternatively, split raw mouse collection out of `desktopControls` into a lower-level desktop input source. Choose the smaller refactor that preserves existing tests.

Do not use DOM cursor APIs for palette selection in the final common path.

## XR Input Adapter

Move WebXR-specific sampling out of the shared controller.

Suggested file:

```text
src/render/three/xrScenePaletteInput.ts
```

Responsibilities:

- inspect `XRInputSource[]`,
- use `XRFrame.getPose(...)`,
- apply `referenceSpaceToWorldMatrix`,
- create or update pointer `Object3D`s,
- read select/menu buttons from `Gamepad`,
- return a `ScenePaletteInputFrame`.

This module may contain the current `createControllerSources(...)`, `applyXrPoseToObject(...)`, `isSelectPressed(...)`, and `isMenuTogglePressed(...)` logic from `vrPaletteController.ts`.

The output should be shared scene pointer data only.

## Shared Pointer Events

The current `xrPointers.ts` is close to what is needed, but it is named and typed as XR-only.

Refactor it into a common pointer module.

Suggested file:

```text
src/render/three/scenePointers.ts
```

Responsibilities:

- create `@pmndrs/pointer-events` ray pointers,
- move pointers against the scene or palette root,
- generate hover target ids,
- track select started and select ended edges,
- choose the active pointer.

Suggested renamed functions:

```ts
createScenePointers(...)
chooseActiveScenePointer(...)
```

The shared pointer module should accept `ScenePalettePointerSource[]`, not `XRInputSource[]`.

## Palette Placement

Create mode-specific placement helpers, but feed their output into the same controller.

Suggested shared type:

```ts
export interface ScenePalettePlacement {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale?: number;
  readonly freeze?: boolean;
}
```

Desktop placement:

- attach visually in front of the camera,
- make it feel like a 2D panel,
- keep it stable while open,
- render above the world using high render order and `depthTest: false`,
- avoid using the DOM layer.

XR placement:

- keep current head-relative placement initially,
- later support wrist/off-hand anchoring,
- freeze or smooth while selecting.

The current `vrPalettePlacement.ts` can either stay XR-specific or become a more general helper if the abstractions fit cleanly.

## Palette Renderer Parity

The uikit adapter must render all menu content that desktop currently renders.

Update the common palette library adapter so the main page supports:

- `aim` tool tile,
- `place-flag` tool tile,
- `geodesic-cannon` tool tile,
- selected tool state,
- flag type options entry.

Update it so `place-flag-options` supports:

- flag type choices,
- selecting a flag type,
- returning to main page or closing according to shared menu state rules.

Do not leave VR/common main content empty after this issue. The point is one common menu.

Suggested migration:

- rename `vrPaletteLibraryAdapter.ts` to `scenePaletteLibraryAdapter.ts`,
- add the missing callbacks from `desktopToolPalette.ts`,
- port the tool tiles to uikit containers,
- keep icon visuals simple if needed,
- preserve readable hit targets.

## Runtime Menu State Naming

`RuntimeDesktopToolId` is no longer accurate once the menu is common.

Rename it to:

```ts
RuntimeToolId
```

or:

```ts
RuntimePaletteToolId
```

Update:

- `runtimeMenuState.ts`,
- `paletteDefinition.ts`,
- desktop DOM compatibility code if it remains temporarily,
- tests.

Do not create separate desktop and VR selected tool ids.

## createThreeApp Integration

`createThreeApp.ts` should eventually create:

- one scene palette controller,
- one desktop palette input adapter,
- one XR palette input adapter,
- no active DOM tool palette for normal runtime.

During migration, it is acceptable to keep the DOM palette behind a temporary fallback if tests or browser behavior need a staged rollout.

Target loop:

```ts
const xrActive = renderer.xr.isPresenting && xrSessionState.status === "active";
const paletteDefinition = createPaletteDefinition(menuState);
const paletteInput = xrActive
  ? xrScenePaletteInput.update(...)
  : desktopScenePaletteInput.update(...);

scenePaletteController.update({
  input: paletteInput,
  definition: paletteDefinition,
  placement: xrActive
    ? resolveXrPalettePlacement(...)
    : resolveDesktopPalettePlacement(...),
});
```

The palette controller should run in desktop and XR frames.

## Tool Use And Menu Use

Avoid conflating palette selection with world tool firing.

For desktop:

- when menu is open, left click selects palette items,
- when menu is closed, left click performs active world tool behavior.

For XR:

- when a pointer is hitting an open palette, trigger selects palette items,
- when menu is closed or no palette hit is active, trigger may later perform world tool behavior.

First implementation may keep XR world tool firing disabled if not already implemented. The priority of this issue is common menu interaction.

## World Object Interaction Prompts

World objects may have two interaction classes:

- primary/default interaction from aiming at the object and pressing the world primary action,
- complex/menu interaction from aiming at the object and opening the object menu.

Use these default prompts for complex menu-based object interaction:

- desktop: `RMouse / F`,
- VR: `A / X`.

Use the primary/default prompt only when the object actually defines a direct primary interaction:

- desktop: aim + `LMouse`,
- VR: aim + trigger/select.

For example, a placed wooden sign should advertise its complex edit interaction as:

```text
RMouse / F: edit sign
A / X: edit sign
```

Do not describe this as only `F` on desktop or only `A` in VR. The tooltip should teach the shared menu affordance as well as the keyboard/controller shortcut.

## Sign Text Editing

Placed signs need an in-game editing path, not just a desktop DOM editor.

Add a sign-edit menu opened through the complex object interaction. The menu should allow changing the sign message and should be usable from both desktop and VR through the common scene palette/aimer system.

The sign-edit menu should include an on-screen keyboard:

- number row,
- QWERTY letter rows,
- `Space` inserts a space,
- `Enter` inserts a newline,
- no `Shift`, no upper/lower case toggle, no `Ctrl`, `Alt`, function keys, arrow keys, or browser-style modifier shortcuts,
- `Backspace` deletes the last character,
- a visible cursor shows where the next character will be inserted,
- a trash button removes the entire sign object,
- keep existing sign message sanitization and maximum length rules,
- keep color selection available for sign text if it remains part of the sign feature.

Desktop physical keyboard input may be added as a convenience later, but the shared in-game path must not depend on native DOM text input. VR must be able to edit a sign using the same menu and on-screen keyboard.

## Interaction Priority

When menu is open:

1. palette hits consume select input,
2. camera look is frozen on desktop,
3. world primary actions should not fire from the same click,
4. reset and emergency controls may remain available if existing behavior expects them.

When menu is closed:

1. desktop camera look works normally,
2. XR locomotion works normally,
3. selected world tool receives primary action input according to existing tool rules.

## Rendering Caveats

The scene palette should render as UI, not as a portal-visible object.

Use:

- high `renderOrder`,
- `depthTest: false`,
- `depthWrite: false`,
- transparent sort compatibility with `reversePainterSortStable`,
- stable camera-relative or XR-relative placement.

Do not:

- add the palette to cell meshes,
- add it to runtime object render archetypes,
- add it to portal clip materials,
- clone it for portal visibility,
- make it visible through portals as if it lived in a cell.

## Accessibility And Text Input Caveat

Moving desktop menus and sign editing from DOM to in-scene UI loses native browser affordances:

- tab focus,
- native select controls,
- screen reader semantics,
- browser text selection,
- easy text input.

This is acceptable for the tool palette and for the short sign-message editor, because sign messages are deliberately constrained. Do not use this issue as precedent for long-form text editing without a separate accessibility plan.

## Non-Goals

- Do not make menu panels runtime registry objects.
- Do not assign menu panels to topological cells.
- Do not portal-render the menu.
- Do not implement hand tracking unless it falls out cheaply from the pointer abstraction.
- Do not implement world tool firing for XR unless needed for parity tests.
- Do not migrate the app to React Three Fiber.
- Do not keep a permanent forked desktop DOM palette and VR scene palette.

## Implementation Plan

### 1. Rename concepts away from desktop-only and VR-only

Rename or alias:

- `RuntimeDesktopToolId` -> `RuntimeToolId`,
- `vrPaletteLibraryAdapter` -> `scenePaletteLibraryAdapter`,
- `vrPaletteController` -> `scenePaletteController` after extracting XR-specific pieces.

Keep compatibility wrappers only if needed for a staged migration.

### 2. Add the shared scene pointer contract

Create `scenePaletteInput.ts`.

Move common pointer state and active pointer selection out of `xrPointers.ts` into a shared module.

Tests should cover:

- select started edge,
- select ended edge,
- hover target id,
- dominant pointer priority,
- fallback active pointer when nothing is hovered.

### 3. Extract XR input adapter

Move XR-only pose and button sampling out of the palette controller into `xrScenePaletteInput.ts`.

After this step, the shared controller should not mention `XRFrame`, `XRReferenceSpace`, or `XRInputSource`.

Tests should cover pure button mapping where practical:

- select button maps to `selectPressed`,
- menu button maps to `menuTogglePressed`,
- non-controller hand sources are ignored or represented intentionally.

### 4. Add desktop scene palette input

Create `desktopScenePaletteInput.ts`.

It should:

- keep pointer lock active,
- track whether the palette is open,
- consume mouse deltas for a panel cursor or aimer ray while open,
- expose a `ScenePaletteInputFrame`,
- map left click to select,
- map right click or Escape to menu toggle or close request.

Update `desktopControls.ts` so menu-open mouse movement does not move the camera.

Tests should cover:

- mouse movement changes palette pointer state when menu is open,
- mouse movement changes camera look when menu is closed,
- left click while menu is open does not produce world primary action,
- left click while menu is closed still produces world primary action,
- right click opens or closes the menu without releasing pointer lock.

### 5. Build the shared scene palette controller

Create or refactor `scenePaletteController.ts`.

It should:

- own the uikit palette root,
- update the adapter definition,
- apply placement,
- update pointer events,
- resolve palette hit actions,
- dispatch actions on select started,
- show a hit marker or cursor,
- expose `dispose()`.

It should not know whether the pointer came from desktop or XR.

### 6. Bring palette renderer parity to uikit

Port desktop tool content into the scene palette adapter:

- main tool grid,
- selected state,
- place flag options,
- geodesic cannon tile,
- debug settings,
- world selection,
- reload,
- portal/debug toggles.

This is the step that turns the common scene palette into the real menu.

### 7. Wire common controller in createThreeApp

Update `createThreeApp.ts` to use the common controller in both desktop and XR.

Keep DOM palette only as a temporary fallback if needed, preferably gated by a local constant or launch option during migration.

Make `syncDesktopPalette()` become a more general `syncPalette()` or remove it if the scene controller pulls fresh `PaletteDefinition` each frame.

### 8. Remove or demote legacy DOM palette path

Once feature parity is confirmed:

- remove `desktopPaletteInput.ts` from the normal runtime path,
- remove `desktopToolPalette.ts` from the normal runtime path,
- keep tests only if the modules remain as fallback,
- ensure no desktop-only palette state remains.

Do not keep DOM flag editing as the only sign-editing path. The common in-scene sign-edit menu and on-screen keyboard should become the normal runtime path for desktop and VR.

### 8a. Add in-scene sign editing

Add sign editing to the common object interaction path:

- focusing a sign and pressing `RMouse / F` on desktop opens the sign-edit menu,
- focusing a sign and pressing `A / X` in VR opens the sign-edit menu,
- the menu edits the placed sign registry object, not a renderer instance,
- all portal-visible sign instances update from the same sign text texture/material path,
- the on-screen keyboard supports numbers, QWERTY letters, Space, Enter, and backspace,
- backspace removes the last character,
- the editor shows a visible end-of-text cursor,
- a trash button deletes the entire sign object,
- no Shift, case-toggle, arrow, or modifier keys are shown.

### 9. Verify desktop and XR behavior

Run the automated tests and manually check desktop behavior.

Manual desktop checks:

- pointer lock remains active while opening the menu,
- opening the menu freezes camera look,
- mouse movement moves the in-scene pointer,
- left click selects menu items,
- tool selection changes the tool indicator or selected state,
- closing the menu resumes camera look,
- left click after closing fires the selected world tool.

Manual XR checks:

- entering VR still works,
- controller rays still appear when the menu is open,
- menu toggle opens and closes the same scene palette,
- selecting settings/tool items works,
- locomotion still works when the menu is closed,
- reset behavior is not regressed.

## Tests

Required tests:

- `scenePointers` active pointer selection.
- `scenePointers` select edge detection.
- `scenePaletteController` dispatches an action on select started.
- `scenePaletteController` does not dispatch repeatedly while select is held.
- `desktopScenePaletteInput` keeps pointer lock model and emits palette pointer input while open.
- `desktopScenePaletteInput` prevents world primary action while the menu is open.
- `xrScenePaletteInput` maps controller select/menu buttons into shared input.
- `scenePaletteLibraryAdapter` renders tool tiles for the main page.
- `scenePaletteLibraryAdapter` renders place flag options.
- `scenePaletteLibraryAdapter` renders the sign-edit menu and on-screen keyboard.
- selecting `aim`, `place-flag`, and `geodesic-cannon` updates shared runtime menu state.
- focusing a sign exposes `RMouse / F: edit sign` on desktop.
- focusing a sign exposes `A / X: edit sign` in VR.
- sign keyboard number and QWERTY keys append characters up to the existing sign limit.
- sign keyboard Space inserts a space.
- sign keyboard Enter inserts a newline.
- sign keyboard backspace removes the last character.
- sign editor preview shows a cursor at the current insertion point.
- sign editor trash button removes the whole sign object.
- desktop and XR code paths both consume the same `PaletteDefinition`.

Regression tests:

- existing runtime menu state tests pass.
- existing desktop controls tests pass or are updated for the new menu-open behavior.
- existing VR palette tests are renamed or adapted to shared scene palette tests.
- existing movement, reset, portal rendering, and runtime object tests continue to pass.

## Acceptance Criteria

- There is one common in-scene palette renderer for desktop and VR.
- Desktop no longer uses the DOM tool palette for normal menu interaction.
- Desktop does not release pointer lock just to use the menu.
- Desktop freezes camera look while the menu is open.
- Desktop mouse movement moves an in-scene pointer or ray while the menu is open.
- Desktop left click selects palette items while the menu is open.
- Desktop left click fires world tool actions only when the menu is closed.
- XR controller rays operate the same palette controller as desktop.
- The shared palette controller has no WebXR-specific types in its public update API.
- The shared palette controller has no DOM-specific types in its public update API.
- Tool selection state is shared and not named desktop-only.
- The main palette exposes `aim`, `place-flag`, and `geodesic-cannon` through the in-scene UI.
- The place flag options page works through the in-scene UI.
- Placed signs can be edited through an in-game sign-edit menu.
- The in-game sign editor includes number keys, QWERTY keys, Space, Enter, backspace, and a trash-sign button, with no Shift, case-toggle, arrow, or modifier keys.
- Complex object interaction tooltips use `RMouse / F` on desktop and `A / X` in VR.
- Menu panels are not runtime registry objects.
- Menu panels are not cell-local or portal-rendered.
- Existing world object rendering and portal rendering remain unchanged.

## Notes For LLM Devs

Do not solve this by making a second desktop-looking uikit menu next to the VR menu. The goal is common controller and common renderer, with only input adapters differing.

Do not keep WebXR objects in the shared controller. If a type starts with `XR`, it belongs in the XR adapter.

Do not keep DOM elements in the shared controller. If a type is `HTMLElement`, it belongs in a temporary DOM fallback or a DOM-only editor.

Do not confuse pointer lock with camera control. Pointer lock can remain active while the menu is open. The important behavior is that mouse deltas are routed to the menu pointer instead of yaw/pitch.

Do not place menu UI in the runtime object registry. Runtime registry objects are for things in the mathematical world. The menu is a renderer interaction surface.

Do not portal-render the menu. The palette is user interface, not cell geometry.

Prefer small extracted modules over more logic in `createThreeApp.ts`. The app file is already large. This issue should reduce mode-specific menu wiring in that file, not grow it substantially.

Keep the first pass boring and reliable:

```text
common scene palette
desktop pointer-lock aimer
XR controller ray
shared RuntimeMenuState
shared PaletteDefinition
shared menu actions
```

Hand tracking, wrist placement, animated panels, and in-scene text editing can follow later.
