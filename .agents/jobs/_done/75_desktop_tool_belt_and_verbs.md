# Job 75 - The tool belt and the input verbs on desktop

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 7.1, 7.4,
7.5 (desktop parts), 11 (F6, F7, F13, F14).

## Goal

A tool belt at the bottom of the screen shows Hand and every tool, with number keys. The mouse wheel switches tools.
Right click opens only the menu of the aimed object and closes an open menu. Tools are never reached through an object
menu. The palette's main page becomes the main menu (Help, Settings, Go home, Start over); the tool tiles leave it.

## Depends on

Jobs 72 (Hand, key 0), 74 (pause card = desktop main menu). Branch `dev`.

## Before you start

- Design 017 section 7.1 (the verb table, desktop column) and 7.4 (the belt table).
- `src/render/three/desktopInputHandlers.ts`: `openContextMenuFromAim`, the Escape and Tab handling (lines ~203, 214),
  the wheel (line ~69: "The wheel cycles the focused aim target while no menu is open").
- `src/render/three/desktopScenePaletteInput.ts` (`reduceDesktopScenePaletteToggle`).
- `src/render/three/createThreeApp.ts` around 1525 (`onDesktopWheel`, `onDesktopPaletteKeyDown`) and 1736
  (`desktopToolIndicator.setTool`).
- `src/render/dom/desktopToolIndicator.ts` (to be replaced by the belt).
- `src/ui/paletteDefinition.ts` (`MainPaletteContent`, `PaletteHeaderAction`) and
  `src/render/three/palette/pages/main.ts`.
- Map availability: the map exists only for Platonic solids. Find the check that hides the Map tile today.

## Decisions

1. `src/ui/toolBeltDefinition.ts` (pure): from the app config, the tools by id and the world, return
   `{ slots: { key: string; toolId: RuntimeToolId | "hand" | "main-menu"; icon; name; subtitle; enabled;
   disabledReason?; active }[] }`. Order: Hand (key "0"), Laser ("1"), Ruler ("2"), Protractor ("3"), Sign ("4"),
   Map ("5"), main menu ("Esc", icon ☰). A tool the config disables is left out. A tool the world cannot support (Map
   outside Platonic solids) is present with `enabled: false` and a reason from the vocabulary ("No map for this world").
2. Desktop DOM `src/render/dom/toolBelt.ts` replaces `desktopToolIndicator.ts` (delete the old file and its tests once
   nothing imports it; the maintainer's rule is that unreachable code is deleted). Bottom center, slot = key label,
   icon, and the name under the active slot. Hovering a slot (only possible with the pointer unlocked) shows its
   subtitle. Clicking a slot with the pointer unlocked selects it.
3. Keys `Digit1`..`Digit5` (and numpad) select slots by their key; a disabled slot pushes its reason as a toast. The
   wheel steps to the next/previous enabled slot among Hand and tools (not the main-menu slot), while no menu is open.
   Cycling overlapping targets keeps only Tab.
4. Right click: with an aimed object that has a menu, open it; with a menu open, close it (toggle); with nothing aimed,
   push the toast "Aim at something to open its menu" and open nothing. F stays an alias of right click.
5. Use (left click) with the Hand on an object runs its main action if it has one, else opens its menu
   (`useFocusedObject` in `toolHost.dispatchPrimaryAction`). Check what it does today and change only the "no main
   action" case.
6. The palette's main page: remove the tool tiles and the Hand tile of job 72. The page holds the main-menu actions as
   buttons with text (Help, Settings, Go home, Start over). It is still reachable from the pause card and, in VR, from
   job 77's entries. If the XR path still needs the tool tiles to select tools before job 77, keep the tiles on the XR
   path only and record it; job 77 removes them.
7. Update the pause card's "Switch tool" row to "1–5 · wheel".
8. Update the `context-menu` intent label to "Right click / F" and add `switch-tool` (desktop "1–5 · wheel") and
   `main-menu` (desktop "Esc") intents.

## Steps

1. Baseline.
2. `toolBeltDefinition.ts` + `tests/ui/toolBeltDefinition.test.ts` (order, keys, disabled map with reason, config
   filtering, active slot).
3. DOM belt, replacing the indicator.
4. Keys and wheel; right click and F; Hand Use fallback. Tests for the reducer in `desktopScenePaletteInput.ts` and the
   handlers where tests exist.
5. Main page change.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP: on `?config=005`, press 2: the Ruler is selected whatever the aim. Right click at the sky opens nothing. The belt
  text contains every tool name and the Map slot reads disabled.

## Do not

- Change VR input (job 77).
- Remove Tab target cycling.

## Done when

Desktop tools are reached only through the belt, keys and wheel; right click is object-only and toggles; checks pass;
commit on `dev`; report appended.

## Report

### Done
- `src/ui/toolBeltDefinition.ts` (pure, reusable by the VR belt of job 77): `createToolBeltDefinition({ appConfig, worldHasMap, selectedTool })` gives `{ slots }` in the order Hand "0", Laser "1", Ruler "2", Protractor "3", Sign "4", Map "5", main menu "Esc" (icon id `menu`). A tool the config switches off is left out; the Map outside a Platonic solid is present with `enabled: false` and `disabledReason` "No map for this world". Also `activeBeltToolId` (laser modes and Join count as the Laser), `isEmitterMode`, `stepBeltSlot` (wheel stepping over enabled slots among the Hand and tools, wrapping, never the menu slot) and `beltSlotForKey`. The belt takes the config as loaded (`options.appConfig`), not the world-narrowed one, because the narrowed one drops the Map.
- `src/render/dom/toolBelt.ts` replaces `desktopToolIndicator.ts` (deleted, with its CSS): bottom-centre strip, key label, icon, name under the active slot (raised, yellow border), the tool's prompt above the active slot, subtitle or disabled reason above the belt on hover, click selects (the menu slot opens the main menu page). All names stay in the belt's text (visually hidden unless active) so `innerText` lists every tool. CSS in `src/style.css`; toasts moved up to clear the belt.
- Keys: `desktopControls.ts` reports `toolKeyRequested` ("1" to "5", Digit and Numpad); `createThreeApp.ts` selects the slot when no menu is open; a disabled slot pushes its reason as a toast. Wheel (`desktopInputHandlers.ts`): steps to the next or previous belt tool (accumulates 40 px, at least 120 ms apart) while no menu is open; it no longer cycles targets (Tab only). The belt is hidden in XR.
- Right click and F: `openContextMenuFromAim(ray, { objectOnly })` now returns "closed" | "opened" | "nothing". Desktop passes `objectOnly`: an aimed object with a menu opens it, an open menu closes (goes back), nothing aimed pushes "Aim at something to open its menu". VR keeps the old fallback (opens the main menu).
- Use with the Hand (`tryUseFocusedObjectPrimaryInteraction`): only the "no main action" case changed; it now opens the object's menu (laser, sign, shape machine).
- Main page: `MainPaletteContent` has `menuActions` (Help, Settings, Go home, Start over); `toolOptions` is empty on desktop. `pages/main.ts` draws the four as text buttons (Start over keeps the two-press guard). New `onHelpRequested` plumbed to `openHelpPage()` in `createThreeApp.ts`, which the pause card's Help now also uses. The header's home and reload icons show only where tool tiles remain.
- Vocabulary: `toolBeltText`, `mainMenuText`; pause card "Switch tool" row is "1-5 . wheel"; intents: `context-menu` label "Right click / F", new `switch-tool` ("1-5 . wheel", XR "Not available yet") and `main-menu` ("Esc", XR "Not available yet"); `worldInteractionDefinition` no longer appends a separate F.
- Tests: `tests/ui/toolBeltDefinition.test.ts` (7), belt keys in `desktopControls.test.ts`, right click, wheel and Tab in `desktopInputHandlers.test.ts`, desktop main page in `paletteDefinition.test.ts` and `scenePaletteAdapter.test.ts`. `npm run docs:generate` run.
- Commit: 36e6296 on `dev`.

### Deviations
- XR path keeps the tool tiles on the main page (decision 6): `toolOptions` is filled only for `inputMode === "xr"`; job 77 removes them.
- Existing tests changed because the tiles moved to XR: `paletteDefinition.test.ts` (2 tests now ask for "xr"), `worldMap.test.ts` (`toolIdsOnPalette` uses "xr"), `scenePaletteAdapter.test.ts` and `scenePaletteControllerScale.test.ts` (build the XR page); label tests `inputIntents.test.ts`, `helpLensDefinition.test.ts` and `pauseCardDefinition.test.ts` follow the new labels.
- Fixed a job 72 slip: key 0 (and the belt's Hand) was ignored while the plain Laser was selected because the guard was `startsWith("geodesicEmitters/")`, which includes `geodesicEmitters/emitter`; it is now `isEmitterMode` (carry, rotate, aim only).
- The belt definition reads names from the vocabulary, not from `toolsById`, so it needs no tool lookup.
- Selecting the already-active slot does nothing.

### Uncertain
- Pressing a number key inside a laser mode (carry, rotate, aim) switches tool through the world's tool request; whether that always drops a carried beam cleanly was not checked.
- The belt slot click and hover were not exercised with a real mouse (unlocked pointer); only the rendering was seen in a screenshot.
- The Map slot in a world that has a map but whose config forbids it is left out (config wins); correct per the decision but untested in the browser.
- VR Use with an empty hand now also opens object menus (shared code path); job 77 may want to confirm.

### Not done
- Real pointer-lock behaviour with a mouse and the main-menu text buttons were not clicked in a browser; the palette is drawn in the 3D scene and was only covered by the adapter unit test.
- Pages check skipped (`gh` is disabled).

### Checks
- Baseline before changes: not rerun separately (jobs 74 left it green: 199 files, 1873 tests).
- After: `npm run typecheck` clean; `npm test` 200 files, 1886 tests passed; `npm run docs:check` ok; `npm run build` then `npm run smoke -- --config 001` SMOKE OK.
- Headless Chrome, pointer lock stubbed (script in `.temp/check.mjs`), `?config=005`: belt text lists Hand, Laser, Ruler, Protractor, Sign, Map, Main menu; the Map slot has `aria-disabled` true; key 2 selects the Ruler (`geodesicMeasurements/length`), key 3 the Protractor, key 5 shows the toast "No map for this world" and keeps the Protractor, key 0 gives the Hand; wheel down selects the Laser and wheel up the Hand; a right click at the sky opens nothing and shows "Aim at something to open its menu". On `?config=001` key 5 selects the Map. Screenshot checked.
