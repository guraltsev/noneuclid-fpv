# 20 - VR palette menu from shared definition

## Repository audit status - 2026-08-03T14:24:10-05:00

Status: archive candidate after a current headset interaction check. Note: `vrPaletteController`, `xrPointers`, and `xrDebugPanel` listed below were later removed as unused; the live path is `scenePaletteController` + `vrPaletteLibraryAdapter`.

Priority: P2 for manual verification only.

Shared definitions, scene UI rendering, controller pointer/select behavior,
tracked hand models, page headers, world/debug settings, and contract tests now
exist. Issues 27 and 30 subsequently generalized the UI beyond a VR-only
palette. Record a brief headset result and archive this implementation blueprint.

## Goal

Port the FPS palette menu to immersive VR by reusing the shared menu definition from issue 19 and rendering it with a VR-capable UI library.

This issue should not recreate widgets from scratch. It should evaluate and integrate a library-backed VR UI path for buttons, toggles, dropdown/list behavior, text, focus/hover/active states, clipping, and controller selection.

Supersedes the closed DOM-first proposal in
[19_fps_dom_palette_menu.md](./_closed/19_fps_dom_palette_menu.md).

Design reference: [docs/design/011-vr-hand-tools-palette.md](../design/011-vr-hand-tools-palette.md).

## Scope

Bring the existing menu into VR:

- use the same shared palette/menu definition created for FPS mode,
- render the main page in VR:
  - empty rectangular content area with no placeholder text,
  - upper-left cogwheel/settings button rendered as a recognizable cog, not a missing-glyph rectangle,
  - upper-right `X` close button,
- render the settings page in VR:
  - `<-` back button for submenu navigation,
  - `X` close button available alongside back,
  - world selector,
  - reload button,
  - debug overlay toggle,
- toggle the VR menu with the side/menu button on either controller,
- show the `Lowpolyhands.glb` hand models on the tracked left and right controller poses,
- support controller ray hover and select,
- keep the VR menu closed when entering XR until the user toggles it open,
- preserve controller locomotion, reset, collision, and portal traversal,
- avoid hand-written widget implementations where the selected UI library can provide them.

## Library Direction

Default spike target: `@pmndrs/uikit`, specifically its vanilla Three.js path.

Fallback: `three-mesh-ui` if UIKit integration is too heavy or incompatible with the current renderer.

Do not migrate the app to React Three Fiber solely for this menu. `@react-three/xr` and `@react-three/uikit` are useful references, but this app currently uses plain Three.js and should stay there unless a larger renderer migration is explicitly approved.

## Required Files

Likely touched files:

- `package.json`
- `package-lock.json`
- `src/render/three/createThreeApp.ts`
- `src/render/three/xrControls.ts`
- `src/render/three/xrPlayerRig.ts`
- `src/render/three/xrSessionState.ts`

Likely new files:

- `src/render/three/vrPaletteLibraryAdapter.ts`
- `src/render/three/vrPaletteController.ts`
- `src/render/three/vrPalettePlacement.ts`
- `src/render/three/xrControllerHandModels.ts`
- `src/render/three/xrPointers.ts`
- `src/render/three/xrDebugPanel.ts`

Likely tests:

- `tests/render-contract/vrPaletteController.test.ts`
- `tests/render-contract/vrPalettePlacement.test.ts`
- `tests/render-contract/xrPointers.test.ts`

## Implementation Plan

### 1. Run a UI-library spike

Before wiring the full menu, prove the chosen library can support:

- a panel attached to a Three.js scene,
- readable text at VR menu distance,
- a button with hover/active/click states,
- a toggle control,
- a dropdown or dropdown-equivalent selector,
- a scrollable list or clipped list for long world menus,
- controller ray hover and select,
- clean per-frame update inside `renderer.setAnimationLoop(...)`,
- clean disposal when exiting XR or disposing the app.

If `@pmndrs/uikit` cannot satisfy these without substantial architecture churn, evaluate `three-mesh-ui`.

### 2. Keep the shared menu definition authoritative

The VR implementation should consume the same palette definition as the FPS DOM menu.

Do not fork menu content into a separate VR-only hierarchy. The library adapter may translate the shared definition into UI components, but the app-visible actions and item ids must remain shared.

### 3. Add VR placement

First placement target:

- place the palette in front of the headset/player at a comfortable fixed distance,
- face the panel toward the headset,
- smooth pose changes to reduce jitter,
- freeze or stabilize while the user is actively selecting.

Fallback placement:

- keep the menu head-relative even if controller pose data is unavailable; controller tracking is for rays/select only.

### 4. Add VR input abstraction

Add one pointer abstraction for:

- controller target rays,
- select started/ended edges,
- hover target id,
- active pointer source.

The pointer abstraction should produce menu events and commands, not mutate world/menu state directly.

### 5. Wire controller ray selection

Use the selected UI library's event or hit-testing model if possible.

The side/menu button on either controller should toggle the VR menu. Pointer rays should work from tracked controllers, with whichever controller is actively selecting treated as the active pointer source.

If manual ray bridging is still required:

- raycast against the library's interactive objects,
- map hits to shared item/action ids,
- dispatch the same commands used by the desktop menu.

### 6. Render settings behavior

The VR menu must match the FPS menu behavior:

- main page has no selectable tools,
- main page content remains empty, matching the desktop palette; do not add VR-only placeholder copy such as `Tool area reserved`,
- left and right controller poses render the `Lowpolyhands.glb` visual hand models,
- menu remains closed on XR session start until toggled open,
- cog opens settings,
- `X` closes main page,
- settings page offers `<-` back without removing the `X` close button,
- every VR menu page has an `X` close button,
- VR submenu pages may also have a `<-` back button,
- world selector uses the shared world catalog,
- reload dispatches `reload-world`,
- debug overlay toggle dispatches `set-debug-overlay`.

### 7. Add XR debug overlay rendering

The DOM debug overlay is not visible in immersive VR. Add a renderer-side debug panel that can be toggled from the menu.

Place the VR debug panel in the upper-left of the headset view so it remains visible when enabled. Its visibility should follow debug mode and the debug overlay toggle, not whether the palette is currently open.

The first version can show compact state:

- current cell id,
- XR session state,
- input mode,
- last blocked movement reason,
- visible portal path count if available.

### 8. Preserve VR runtime behavior

Do not regress:

- joystick locomotion,
- continuous turn,
- reset,
- room-scale collision approval,
- forbidden-zone blocking,
- portal traversal,
- desktop fallback.

### 9. Add tests and manual headset checks

Contract tests should cover pure menu and input behavior without requiring a headset.

Manual checks should cover:

- menu opens in headset,
- main page content is empty, with no placeholder text,
- cogwheel icon renders as a recognizable cog instead of a missing-glyph rectangle,
- left and right controller hand models appear and track the controller poses,
- menu starts closed when entering XR,
- menu toggles from the side/menu button on either controller,
- controller ray hover works,
- controller select works,
- settings page back behavior,
- world selector behavior,
- reload behavior,
- debug overlay toggle visibility,
- debug overlay remains visible after closing the menu when debug mode and UI overlay are enabled,
- locomotion still works when the menu is closed.

## Acceptance Criteria

- The VR menu uses the shared palette definition from issue 19.
- A VR UI library handles widget rendering/layout rather than local custom widgets.
- The main VR menu shows an empty rectangular content area with no selectable tools and no placeholder text.
- The cog/settings button renders as a recognizable cogwheel icon, not a missing-glyph rectangle.
- The `Lowpolyhands.glb` models render as left and right controller-tracked hand visuals.
- Entering XR does not auto-open the VR menu.
- The side/menu button on either controller toggles the VR menu.
- The cog opens settings.
- The `X` closes every VR menu page.
- The settings page uses `<-` back while still keeping an `X` close button available.
- Settings include a world selector, reload button, and debug overlay toggle.
- Controller ray hover/select works.
- The debug overlay can be toggled in immersive VR.
- The debug overlay remains visible independent of menu open/closed state when enabled.
- Existing VR locomotion, collision, reset, and portal traversal still work.
- Desktop FPS menu from issue 19 still works.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Non-goals

- Do not implement geometry tools.
- Do not implement marker, ray, measurement, or path-trace behavior.
- Do not write custom dropdown, toggle, button, or scrolling widgets from scratch unless the library spike fails and the fallback is explicitly approved.
- Do not migrate the app to React Three Fiber as part of this issue.
- Do not implement hand tracking or hand-pinch input for this issue.
- Do not hot-swap worlds inside the current XR session unless it naturally falls out of existing URL/reload behavior.

## Risks

- `@pmndrs/uikit` may require more integration work than expected in a plain Three.js app.
- Dropdown behavior in VR may be better represented as a compact scrollable list than as a literal desktop-style dropdown.
- Text readability and transparent panel ordering need headset testing, not only desktop inspection.
