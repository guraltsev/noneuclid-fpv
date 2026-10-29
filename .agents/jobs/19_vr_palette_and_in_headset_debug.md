# Job 19 - Finish the VR palette and add an in-headset debug readout

Status: queued.
Former issue: 20 (converted to a job on 2026-10-28).

Priority: P2 for manual verification only.

## Status update 2026-10-28

Done:

- Shared definition: `src/ui/paletteDefinition.ts` drives both the desktop in-scene palette and the VR palette
  (`scenePaletteController.ts`, `scenePaletteLibraryAdapter.ts`, `vrPaletteLibraryAdapter.ts`). The DOM palette of
  issue 19 is gone; desktop also uses the in-scene palette (`desktopScenePaletteInput.ts`).
- Library: `@pmndrs/uikit`, `@pmndrs/uikit-default` and `@pmndrs/uikit-lucide` in `package.json`, used through the
  vanilla Three.js path. The cog is the lucide `Settings` icon, and the header also uses `X`, `ArrowLeft`,
  `ChevronLeft`/`ChevronRight`.
- Header actions: `tests/render-contract/vrPaletteHeaderActions.test.ts` checks settings plus close on the main page,
  and back plus close on the settings and debug submenus.
- Placement: `vrPalettePlacement.ts`, tested in `vrPalettePlacement.test.ts`.
- Input: `xrScenePaletteInput.ts` (`isSelectPressed`, `isMenuTogglePressed` on the side trigger) and
  `scenePointers.ts`, tested in `xrScenePaletteInput.test.ts` and `scenePointers.test.ts`.
- Hands: `xrControllerHandModels.ts` loads `lowpolyhands/Lowpolyhands.glb`, tested in
  `xrControllerHandModels.test.ts`.
- Settings content: world selector, reload, and a "UI overlay" toggle with per-item toggles
  (`vrPaletteLibraryAdapter.ts`, debug settings page).
- Superseded: "main page has no selectable tools" and "empty content area" no longer apply. Issues 27 and 30 put
  tools (geodesic cannon, flags, help) on the main page.

Remaining:

- **In-XR debug readout (step 7).** `xrDebugPanel.ts` was removed, and the only debug overlay is the DOM element from
  `debugOverlay.ts`. That element is not visible in an immersive session (the session requests no `dom-overlay`
  feature). The VR "UI overlay" toggle therefore changes state, but nothing appears in the headset. The two
  acceptance items "debug overlay can be toggled in immersive VR" and "remains visible independent of menu open/closed
  state" are not met. Either add a small head-locked Three.js/uikit text panel fed from `DebugOverlayState`, or drop
  these items explicitly.
- Manual headset check of the items in step 9: hover/select, menu toggle from either controller, menu closed at
  session start, hand tracking of the models, and text readability. No headset result is recorded.

Shared definitions, scene UI rendering, controller pointer/select behavior,
tracked hand models, page headers, world/debug settings, and contract tests now
exist. Issues 27 and 30 subsequently generalized the UI beyond a VR-only
palette. Record a brief headset result and archive this implementation blueprint.

## Goal

Port the FPS palette menu to immersive VR by reusing the shared menu definition from issue 19 and rendering it with a VR-capable UI library.

This issue should not recreate widgets from scratch. It should evaluate and integrate a library-backed VR UI path for buttons, toggles, dropdown/list behavior, text, focus/hover/active states, clipping, and controller selection.

Supersedes the closed DOM-first proposal in
[[job 19](../../_issues/_closed/19_fps_dom_palette_menu.md)](../../_issues/_closed/19_fps_dom_palette_menu.md).

Design reference: [_docs/design/011-vr-hand-tools-palette.md](../../_docs/design/011-vr-hand-tools-palette.md).

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
- ~~`src/render/three/vrPaletteController.ts`~~ removed; the live path is `scenePaletteController.ts`
- `src/render/three/vrPalettePlacement.ts`
- `src/render/three/xrControllerHandModels.ts`
- ~~`src/render/three/xrPointers.ts`~~ removed; pointers live in `scenePointers.ts` and `xrScenePaletteInput.ts`
- ~~`src/render/three/xrDebugPanel.ts`~~ removed as unused; no in-XR debug panel exists (see status update)

Likely tests:

- ~~`tests/render-contract/vrPaletteController.test.ts`~~ not created; see `scenePaletteLibraryAdapter.test.ts`, `vrPaletteHeaderActions.test.ts`
- `tests/render-contract/vrPalettePlacement.test.ts`
- ~~`tests/render-contract/xrPointers.test.ts`~~ not created; see `scenePointers.test.ts`, `xrScenePaletteInput.test.ts`

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

- ~~The VR menu uses the shared palette definition from issue 19.~~ done: `src/ui/paletteDefinition.ts`.
- ~~A VR UI library handles widget rendering/layout rather than local custom widgets.~~ done: `@pmndrs/uikit`.
- ~~The main VR menu shows an empty rectangular content area with no selectable tools and no placeholder text.~~ superseded by issues 27 and 30 (the main page now holds tools).
- ~~The cog/settings button renders as a recognizable cogwheel icon, not a missing-glyph rectangle.~~ done: lucide `Settings` icon.
- ~~The `Lowpolyhands.glb` models render as left and right controller-tracked hand visuals.~~ done in code (`xrControllerHandModels.ts`); headset check pending.
- Entering XR does not auto-open the VR menu.
- The side/menu button on either controller toggles the VR menu.
- The cog opens settings.
- ~~The `X` closes every VR menu page.~~ done: `vrPaletteHeaderActions.test.ts`.
- ~~The settings page uses `<-` back while still keeping an `X` close button available.~~ done: `vrPaletteHeaderActions.test.ts`.
- ~~Settings include a world selector, reload button, and debug overlay toggle.~~ done.
- Controller ray hover/select works.
- The debug overlay can be toggled in immersive VR. **Not met:** the toggle exists, but no overlay renders in XR.
- The debug overlay remains visible independent of menu open/closed state when enabled. **Not met** in XR (see status update).
- Existing VR locomotion, collision, reset, and portal traversal still work.
- ~~Desktop FPS menu from issue 19 still works.~~ superseded: the DOM menu was replaced by the shared in-scene palette.
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

## Merged from issues 21 and 41 (2026-10-28)

From issue 41 (XR input and palette):

- `isCarryActionPressed` (`render/three/xrControls.ts`) always returns false, so carry cannot be reached from XR. This
  needs a button-binding decision.
- `menuTogglePressed` is always false in both palette input modules: `xrScenePaletteInput.ts` computes it in
  `createControllerSources`, but `createXrScenePaletteInput` returns `false`.
- `xrScenePaletteInput` shares a module-level `controllerObjects` set across instances.
- `onGeometryComputerSetTargetRequested` is wired through `scenePaletteController.ts` but never invoked by
  `vrPaletteLibraryAdapter.ts`.
- Legacy `xrPalette*` userData keys still exist beside `scenePalette*`: the writers are in
  `vrPaletteLibraryAdapter.ts`, and fallback readers are in `scenePaletteController.ts` and `scenePointers.ts`.

From issue 21 (stereo debugging):

- The in-headset debug readout is the one missing piece for the stereo headset checks in issue
  [59](../../_issues/59_stereo_split_root_unclipped_roots_and_union_budget.md). When it exists, it should show per-eye, union, left-only, right-only and both-eye path counts.
