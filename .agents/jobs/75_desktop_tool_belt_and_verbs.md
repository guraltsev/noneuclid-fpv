# Job 75 - The tool belt and the input verbs on desktop

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 7.1, 7.4,
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
