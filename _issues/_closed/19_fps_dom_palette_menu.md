# 19 - FPS DOM palette menu

Status: closed on 2026-08-03.

## Outcome

Closed as superseded by issue 27. The proposed permanent desktop DOM palette was
replaced by the shared in-scene desktop/XR palette. Residual unused DOM
compatibility cleanup is tracked by issue 38 and does not justify
finishing this obsolete product direction.

## Goal

Implement the first version of the shared palette menu in normal FPS desktop mode using standard DOM controls and browser UI behavior.

This issue is the foundation for the later VR menu. It should define the menu contract, state, commands, and desktop implementation without adding VR widget rendering.

Design reference: [docs/design/011-vr-hand-tools-palette.md](../../design/011-vr-hand-tools-palette.md).

## Scope

Build a complete desktop/FPS menu:

- right mouse button opens the palette,
- the palette appears centered on the screen near the FPS reticle,
- pointer-lock mouse-look is suspended while the menu is open,
- the normal mouse pointer is visible while the menu is open,
- the main menu content is an empty rectangle with no selectable tools,
- the upper-left button is a cogwheel/settings button,
- the upper-right button is an `X` close button,
- clicking the cogwheel changes the menu contents to the settings page,
- on the settings page, the upper-right `X` slot becomes a back button `<-`,
- the settings page contains:
  - a standard DOM dropdown for selecting a world,
  - a reload button,
  - a debug overlay toggle.

Use normal DOM widgets for this issue. Do not hand-roll dropdown behavior, scroll behavior, or toggle semantics where browser controls are sufficient.

## Required Files

Likely new files:

- `src/ui/paletteDefinition.ts`
- `src/runtime/runtimeCommands.ts`
- `src/runtime/runtimeMenuState.ts`
- `src/runtime/appCommandDispatcher.ts`
- `src/render/dom/desktopToolPalette.ts`
- `src/render/three/desktopPaletteInput.ts`

Likely touched files:

- `src/render/three/createThreeApp.ts`
- `src/render/three/desktopControls.ts`
- `src/render/three/debugOverlay.ts`
- `src/main.ts`
- `src/style.css`

Likely tests:

- `tests/runtime/runtimeCommands.test.ts`
- `tests/render-contract/desktopPaletteInput.test.ts`
- `tests/render-contract/desktopToolPalette.test.ts`

## Implementation Plan

### 1. Add shared palette definition

Create a renderer-neutral palette definition that describes:

- page id: `main` or `settings`,
- left action: `settings` or `none`,
- right action: `close` or `back`,
- main-page empty content area,
- settings items:
  - world select,
  - reload button,
  - debug overlay toggle.

Populate world select options from `worldCatalog`.

This definition is intentionally more structured than a raw DOM fragment because the next issue will render the same menu in VR through a UI library.

### 2. Add runtime commands

Add a small command union for the first menu:

```ts
export type RuntimeCommand =
  | { readonly kind: "reload-world" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "set-debug-overlay"; readonly enabled: boolean };
```

The command dispatcher should:

- reload the current URL for `reload-world`,
- navigate to the selected world URL for `change-world`,
- update the debug overlay visible state for `set-debug-overlay`.

Keep command logic separate from DOM event handlers.

### 3. Add menu state

Track:

- open/closed,
- current page,
- selected world id,
- debug overlay enabled.

This can begin as renderer-owned state, but it should be explicit and testable rather than scattered local booleans.

### 4. Add desktop input behavior

Add desktop palette input handling:

- prevent the browser context menu on the app canvas when right-click opens the palette,
- open the palette centered on screen,
- pause pointer-lock/mouse-look while open,
- show the browser cursor,
- close on `X`, `Escape`, or right-click outside,
- return to FPS mode after close.

If the browser requires a user gesture to re-enter pointer lock, show or reuse a minimal click-to-resume affordance.

### 5. Render standard DOM menu

Render the desktop palette with standard DOM controls:

- `<button>` for cog, close, back, reload,
- `<select>` for world selection,
- checkbox or switch-like `<input type="checkbox">` for debug overlay toggle.

Use CSS for layout and visual polish, but keep semantics native.

### 6. Wire settings behavior

The cog button switches to the settings page.

The settings page:

- shows back `<-` in the upper-right slot,
- lets the user select a world,
- applies world navigation according to the chosen behavior,
- reloads the current world,
- toggles the debug overlay.

### 7. Preserve existing controls

Do not regress:

- keyboard movement outside the menu,
- mouse look outside the menu,
- desktop reset behavior,
- launch controls,
- WebXR entry UI,
- current debug overlay behavior.

### 8. Add tests

Test the pure pieces first:

- palette definition contains the required main/settings structure,
- runtime commands serialize to expected navigation/debug effects via injectable adapters,
- desktop input opens on right-click and closes on expected events,
- menu state transitions from main to settings and back.

Avoid needing a real WebXR device or real pointer lock in tests.

## Acceptance Criteria

- Right-click in FPS mode opens a centered menu.
- The normal mouse pointer can interact with the menu.
- Mouse-look is suspended while the menu is open.
- The main menu has an empty rectangular content area and no selectable tools.
- The cogwheel opens settings.
- The `X` closes the main menu.
- The settings page replaces the `X` slot with `<-` back.
- Settings include a world dropdown, reload button, and debug overlay toggle.
- World selection uses the existing world catalog.
- Reload and world selection route through runtime commands.
- Debug overlay visibility can be toggled from the menu.
- Existing FPS movement, reset, launch controls, and WebXR entry still work.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Non-goals

- Do not implement VR rendering for the menu.
- Do not add hand tracking.
- Do not add selectable geometry tools.
- Do not implement marker, ray, measurement, or path-trace tool behavior.
- Do not build custom dropdown or scroll widgets when standard DOM controls work.
- Do not migrate the app to React or another renderer.
