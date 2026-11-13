# Job 77 - VR: hand roles, one-controller layout, the belt on the wrist or the waist, the VR main menu

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 7.1 (VR
columns), 7.2, 7.3, 7.4, 7.5, 8.1 (VR start card) (F10).

## Goal

In VR, the two controllers get roles (pointer hand and belt hand), and a single controller, left or right, can do every
verb. The tool belt is a strap on the belt-hand wrist with two controllers and at the waist with one. Tools are never
reached through an aim-dependent menu. The main menu opens from a button, not from the aim.

## Depends on

Jobs 73 (XR reset removed), 75 (belt definition, main page), 76 (hint strip definition). Branch `dev`.

## Before you start

- Design 017 sections 7.1 to 7.5: the two VR columns of the verb table and section 7.3 are the specification.
- `src/render/three/xrControls.ts` (whole file). Today it ignores `handedness`, sums the sticks, and each button means
  the same on both hands: 0 trigger (primary), 1 squeeze (context menu and cancel), 3 stick press (reset; removed by job
  73), 4 lower face (carry), 5 upper face (help). Its tests in `tests/render/`.
- `src/interaction/inputFrame.ts` (`RuntimeInputFrame`) and `src/interaction/vrLocomotion.ts`.
- `src/render/three/xrControllerHandModels.ts` (wrist indicator near the right wrist), `src/render/three/xrPlayerRig.ts`.
- `src/render/three/vrPalettePlacement.ts` and `scenePaletteController.ts` (how the VR palette is placed and hit).
- `src/ui/inputIntents.ts` (`InputMode = "desktop" | "xr"`).

## Decisions

1. Layout detection, per frame, from sources with a gamepad: two sources with handedness `left` and `right` →
   `two-controllers`; exactly one source → `one-left`, `one-right`, or `one-right` for handedness `none`. A Settings
   switch "Use one controller" forces the one-controller layout using the pointer hand's controller. "Left-handed"
   (Settings) swaps roles: pointer hand left, belt hand right. Store both in the menu state like the comfort options.
2. `InputMode` stays `"desktop" | "xr"`; add `XrLayout = "two-controllers" | "one-left" | "one-right"` and give
   `getInputHintGlyph` an optional layout parameter. Glyph letters follow the controller: A/B on the right, X/Y on the
   left.
3. Two controllers. Pointer hand: trigger Use, grip Menu (toggle), lower face Pick up, upper face What's this?, stick x
   turn. Belt hand: stick walk and turn, trigger next tool, grip Hand, lower face (X when left) main menu, upper face
   unbound.
4. One controller: stick y walk and x turn; trigger Use; grip Menu (toggle); lower face Pick up; upper face tap
   What's this?, held 1000 ms main menu (the tap fires on release before 1000 ms; the hold fires at 1000 ms and
   suppresses the tap); stick press next tool, counted only when the stick is inside the locomotion dead zone at the
   moment of the press.
5. New `RuntimeInputFrame` request flags as needed: `nextToolRequested`, `handRequested`, `mainMenuRequested`. Keep
   edge detection in `createXrControls`, per source and per role.
6. Belt rendering: one scene object drawing `toolBeltDefinition` slots as a strap of small panels (reuse the palette's
   uikit rendering if a small panel is cheap; otherwise canvas textures like `worldResultBadge.ts`).
   - Two controllers: anchored to the belt-hand grip space, along the forearm; scale 1.0 normally, 1.8 when the angle
     between the head's forward vector and the direction to the strap is under 25°.
   - One controller: anchored to the player rig at waist height (head height − 0.55 m, at least 0.6 m above the floor),
     0.35 m in front, following the head's yaw only, smoothed like the palette.
   - Slots are pointable with the pointer ray; Use on a slot selects it. Point tests reuse the palette's hit path or
     a raycast against the strap.
7. Tool-change toasts (job 71) move: above the belt-hand wrist with two controllers; low in the field of view (0.6 m
   ahead, 0.3 m below eye level, yaw-following) with one. A layout change pushes the toast "One controller: your tools
   are on your belt, look down" (or "Two controllers: your tools are on your left wrist").
8. VR main menu: opens the palette main page (main-menu actions) in front of the player, not tied to the aim. Remove
   any remaining XR path that opens the tool list from empty floor (see job 75 decision 6).
9. VR start card: at session start, a panel in front of the player shows the controllers of the current layout with the
   verb on each button (text list is enough: "Trigger: Use", ...), dismissed by the trigger. Regenerated on a layout
   change.
10. The hint strip in VR shows inside the existing XR focus label (`xrObjectTooltipMesh.ts`) using the XR glyphs.

## Steps

1. Baseline.
2. Layout detection and per-layout button mapping in `xrControls.ts`, test-first in `tests/render/xrControls*.test.ts`:
   - two controllers: belt-hand trigger → next tool; pointer-hand trigger → use; left-handed swaps;
   - one left / one right: trigger → use; stick press centered → next tool; stick press while pushed → nothing; upper
     face held 1000 ms → main menu, tapped → help;
   - removing one of two sources switches the layout.
3. Glyph tables per layout, `tests/ui/inputIntents.test.ts`.
4. Shell wiring of the new request flags (next tool cycles the belt as the wheel does on desktop).
5. Belt strap rendering for both anchors; toasts placement; main menu; start card; hint in the focus label.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- No headset here. Under `### Uncertain`, list for the maintainer: the button layout with two controllers, each single
  controller, left-handed mode, the waist belt when seated, and readability of the strap. Check that a desktop session
  is unchanged (CDP smoke).

## Do not

- Change desktop input.
- Add teleport locomotion or hand tracking.

## Done when

The XR reader produces the verbs of both layouts (tested), the belt is drawn and usable in both anchors, the main menu
and the start card exist, checks pass, commit on `dev`, report appended with the headset checklist.

## Report

### Done
- Pure, tested logic:
  - `src/glue/xrLayout.ts`: `XrLayout` ("two-controllers" | "one-left" | "one-right"), `XrHandOptions` ("Use one controller", "Left-handed").
  - `src/interaction/xrHandRoles.ts`: `resolveXrHandRoles` (layout from the sources that have a gamepad; pointer hand and belt hand; "Use one controller" forces the pointer hand's controller; handedness `none` counts as right) and `createTapOrHoldTracker` (tap on release before 1000 ms; the hold fires at 1000 ms and suppresses the tap).
  - `src/interaction/xrBeltMath.ts`: slot layout and slot-at-point, the 25 degree / 1.8x wrist-belt scale rule, waist height (head - 0.55 m, at least 0.6 m above the floor), waist pose 0.35 m ahead along the head yaw only (smoothed 0.22 per call, shortest-way yaw), the low toast pose (0.6 m ahead, 0.3 m below the eyes).
  - `src/ui/inputIntents.ts`: `getInputHintGlyph(mode, intent, layout?)` with per-layout tables (A/B on the right, X/Y on the left; "Left trigger", "Stick press", "Hold B", "Hold Y", "Grip"); `src/ui/vrStartCardDefinition.ts` builds the start card text from them.
  - `src/ui/hintStripDefinition.ts`: optional `xrLayout`, so the strip uses the layout glyphs.
- `src/render/three/xrControls.ts` rewritten around the roles. Two controllers: pointer hand trigger Use, grip Menu, lower face Pick up, upper face What's this?; belt hand stick walk (y) and turn (x; the turn is the clamped sum of both sticks' x), trigger next tool, grip Hand, lower face main menu, upper face unbound. One controller: stick y walk and x turn, trigger, grip, lower face as above, upper face tap What's this? on release and 1000 ms hold main menu, stick press next tool only if the stick was inside the dead zone at the press. A layout change raises no request on that frame. `createXrControls(options, handOptions)`, `setHandOptions`, `layout()`. New frame fields `nextToolRequested`, `mainMenuRequested`, `xrLayout` (`handRequested` already existed).
- Settings: a "Controllers" section (Use one controller, Left-handed) through the menu state (`useOneControllerEnabled`, `leftHandedEnabled`), the command `set-xr-hand-option`, the palette content, the settings page and the palette callbacks; remembered in `localStorage` like "Show hints". Strings in `src/world-objects/vocabulary.ts` (`controllersSettingsText`, `vrBeltText`).
- VR belt: `src/render/three/xrToolBelt.ts` (one canvas-textured strap drawing `toolBeltDefinition`; the active slot is yellow and raised, a caption strip shows the tool in hand or the hovered slot's subtitle or disabled reason; `pick(ray)` returns the slot), `xrStartCard.ts` (panel in front of the player), `xrHandUi.ts` (owns both, decides the anchors from the roles).
- Shell wiring (`createThreeApp.ts`, `desktopInputHandlers.ts`): next tool steps the belt as the wheel does; the belt-hand grip is the Hand (the existing `handRequested` path); the main menu button toggles the main page in front of the player; Use on a pointed slot selects it and consumes the press; the trigger dismisses the start card and is consumed; a layout change mid-session pushes the toast ("One controller: your tools are on your belt, look down" / "Two controllers: your tools are on your left wrist", right wrist when left-handed); the toast panel stands above the belt-hand wrist (two controllers) or low in the field of view (one); the aim ray, the palette pointer and the wrist tool indicator follow the pointer hand, and only the pointer hand points at the palette; `hand(handedness)` was added to the hand models and the map uses it.
- Removed the XR path that opened the tool list: the grip with nothing aimed at now shows "Aim at something to open its menu", as F does on desktop; the XR main page has no tool tiles (`toolOptions` is always empty, `createToolOptions` is deleted, `createPaletteDefinition` and the cache lose their unused `toolsById` argument).
- The VR hint strip shows inside the XR focus label: the object's name and up to three hint lines with the layout's glyphs (`xrObjectTooltipMesh.ts` draws up to four lines now); it follows "Show hints".
- Main-menu buttons got tooltips (`main-menu:*` in `paletteTooltips.ts`).
- Tests: `tests/render/xrControlsHandRoles.test.ts` (26), `tests/interaction/xrBeltMath.test.ts` (12), `tests/render/xrToolBelt.test.ts` (7), `tests/render/xrHandUi.test.ts` (8), `tests/ui/vrStartCardDefinition.test.ts` (3); glyph tests in `tests/ui/inputIntents.test.ts`, VR rows in `hintStripDefinition.test.ts`, the command in `applyRuntimeCommand.test.ts`, hands by handedness in `xrControllerHandModels.test.ts`, the XR palette feed in `desktopInputHandlers.test.ts`, tooltips in `paletteTooltips.test.ts`. `npm run docs:generate` run.
- Commit: e7a60e2 on `dev`.

### Deviations
- Existing tests changed: `xrControls.test.ts` "help edges" now uses two controllers (with one controller the What's this? tap fires on release, per the decisions); `paletteDefinition.test.ts` (the two VR tile tests became one "no tiles in VR" test; the third, about the `entry` kind choosing the main list, was deleted because that list no longer exists); `worldMap.test.ts` reads the belt definition instead of the palette tiles; `scenePaletteAdapter.test.ts` lost "maps each main tool and its nested options to the right icon" (the tiles are gone); `scenePaletteControllerScale.test.ts` hovers a main-menu button instead of a tool tile (hence the new main-menu tooltips); `paletteDefinitionCache.test.ts` and `tests/support/tools.ts` follow the removed `toolsById` argument.
- With two controllers the glyph tables name the default hands (pointer right), because `XrLayout` has three values (decision 2). With "Left-handed" the letters (X/Y on the pointer hand, A for the main menu) are right only on the start card, which takes the flag; the hint strip, help rows and the toast keep the default letters.
- The hold of the upper face button has no filling ring on the glyph (the design mentions one); the glyph label says "Hold B" or "Hold Y" instead.
- Belt slots are drawn as text (key and name) on one canvas, not with the tool icons: the icon images load asynchronously and the strap is small.
- Layout detection counts two or more gamepad sources as "two controllers" even when their handedness is not left and right (the pointer hand is then the first source).
- A VR hint appears in the focus label, so it shows only with an object aimed at; there is no VR hint for the empty floor.

### Uncertain
Only a headset session can confirm these (the headset checklist):
- The button layout with two controllers on the real controllers: trigger Use, grip Menu, A pick up, B What's this?; on the belt hand trigger next tool, grip Hand, X main menu, stick walk. Does the runtime report buttons 4 and 5 as A/B (right) and X/Y (left) and button 3 as the stick press?
- Each single controller (left, right, and one reporting handedness `none`): trigger, grip, A or X pick up, tap and 1 s hold of B or Y, stick press as next tool (is the 0.18 dead zone right for a press while resting? is a press during a walk really ignored?), walking and turning on the one stick.
- Left-handed mode and Use one controller from the Settings page: the rows toggle with the VR pointer; the palette, the aim ray and the wrist indicator are on the correct hand.
- The wrist strap: its offset (0.05 m above, 0.16 m behind the grip), its orientation and text direction (the plane basis was written from the WebXR grip axes and may be mirrored or upside down on one hand), its size (0.06 m per slot, 1.8x when looked at), readability, and whether the 25 degree enlarge flickers near the edge.
- The waist belt when seated: head - 0.55 m with the 0.6 m floor limit, 0.35 m ahead, the 50 degree tilt, whether looking down shows it and whether the pointer can reach a slot from the hand's natural position. The floor is taken as the scene's y = 0.
- Toast placement: above the belt-hand wrist (0.3 m, as before) and the low panel (0.6 m ahead, 0.3 m below the eyes) with one controller.
- The start card (1.2 m ahead, 0.9 m wide): that the trigger dismisses it without placing anything. After a layout change the card is rebuilt only if it is still up (a dismissed card does not return; the toast announces the change): decision 9 says "Regenerated on a layout change" and this is the reading chosen.
- The focus label with four lines (name plus hints) fits and stays readable; the main menu opened from X or the hold appears in front of the player and not at the aim.
- Controller reconnects: that the per-frame source list switches the layout without a flicker of toasts.

### Not done
- A filling ring on the hold glyph; tool icons on the VR strap; VR hints for an empty aim.
- No XR run of any kind (no headset here); only the desktop session was checked (see Checks).
- `src/render/three/palette/pages/main.ts` still holds the tool tile drawing (`createToolTile` and friends); it is unreachable now because the page never gets tiles. Remove it with the menu work of job 78.
- The base XR rows of `inputIntents.ts` ("Not available yet" and the comments "arrives with job 77") are still the answer when no layout is given; every shell caller now passes one.
- Pages check skipped (`gh` is disabled).

### Checks
- Baseline before changes: typecheck, docs:check and npm test green (job 76's numbers).
- After: `npm run typecheck` clean; `npm run docs:check` all ok; `npm test` 207 files, 1967 tests passed (one earlier run failed only `tests/project/testHygiene.test.ts` for test names over 90 characters, fixed; no `moduleImportRules` timeout appeared).
- `npm run build`, then `npm run smoke -- --config 001`: SMOKE OK (the first run failed with a 6 s CDP timeout while the world could not keep up; the second passed).
- Headless Chrome, pointer lock stubbed (`.temp/check76.mjs`, `?config=001`): the desktop belt, hint strip and keys 0, 1, 2 behave as after job 76 (strip "Left click open Help" at the help cube, "Left click place a laser, 0 put the Laser away" with the Laser, laser menu strip on a laser).
