# Job 76 - Hint strip, focus outline, angular picking and sticky focus

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.2 item 3,
8.3 (previews), 8.4 (F7, F12, F24, F25).

## Goal

A line above the belt always names up to three inputs that do something right now. Thin objects are easy to aim at,
focus does not flicker, wandering creatures do not steal it, and the focused object is outlined. The Laser shows a
ghost where it would place.

## Depends on

Job 75. Branch `dev`.

## Before you start

- Design 017 section 8.2, the strip table (it is the test oracle).
- `src/ui/worldInteractionDefinition.ts` (the focus message) and `src/ui/helpLensDefinition.ts`: the strip uses the
  same sources.
- `src/render/dom/floatingObjectTooltip.ts`.
- `src/interaction/aimTarget.ts` and `src/render/three/aimTarget.ts` (both exist; find which ranks candidates),
  `src/render/three/aimInteraction.ts`.
- Tool descriptors' `helpRows` and `prompt`.

## Decisions

1. `src/ui/hintStripDefinition.ts` (pure): input = input mode, selected tool, focus (kind, available actions), carry
   state, menu open; output = up to three `{ glyphLabel, text }`. It reproduces every row of the design table for
   desktop. XR output uses the XR glyphs (job 77 wires its display).
2. Desktop DOM line just above the belt. The floating focus tooltip keeps only the object's name; its action rows go.
3. Settings: a "Show hints" switch, on by default, stored in `localStorage` inside try/catch (works when storage throws).
4. Angular picking: when the exact ray hits nothing usable, accept the nearest focusable candidate whose hit proxy lies
   within 1.5° of the ray, with nothing nearer blocking it. Put the angle in a named constant.
5. Sticky focus: keep the current focus 150 ms after the ray leaves it, unless the ray lands on another usable target.
6. Creatures are not focusable unless the selected tool has an action on them; the help lens still names them.
7. Focus outline: a backface-hull or edge outline on the focused object's mesh in the tool's `indicatorColor` (white for
   the Hand). Use what Three.js offers without new dependencies.
8. Laser preview: with the Laser selected and the aim on the floor, a translucent ghost of the laser model at the aim
   point and an arrow along `aimYawRadians`. Minimum beam width 2 px in screen space if the beam material allows it;
   if it would need a new line renderer, skip it and record under `### Not done`.

## Steps

1. Baseline.
2. `hintStripDefinition.ts` with `tests/ui/hintStripDefinition.test.ts` covering each row of the design table.
3. DOM strip, tooltip trimmed, Settings switch.
4. Angular picking and sticky focus with unit tests in the aim-target tests (a thin proxy 1° off the ray is picked;
   3° is not; focus kept for 149 ms and dropped at 151 ms with fake time).
5. Creature focus, outline, Laser ghost.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP: `motion.run([{ to: "geodesicEmitters/emitter:0", stopAt: 2.5, lookAt: "geodesicEmitters/emitter:0" }])` gives
  focus on the laser with no pitch adjustment.

## Do not

- Change what any action does.

## Done when

The strip matches the table, thin targets are picked, focus is stable, checks pass, commit on `dev`, report appended.

## Report

### Done
- `src/ui/hintStripDefinition.ts` (pure): `createHintStripDefinition({ inputMode, selectedTool, focus, carrying, menuOpen, extendLengthMeters })` gives up to three `{ glyphLabel, text }`, glyphs from the input-intent table (so the XR glyphs already work for job 77); `formatHintStripLine`. Strings are in `hintStripText` (`src/world-objects/vocabulary.ts`). `tests/ui/hintStripDefinition.test.ts` (11) covers every desktop row of the design table plus the three-entry cap and a VR glyph case.
- `src/render/dom/hintStrip.ts` and CSS: one line above the belt (key caps plus text), hidden while the pointer is unlocked, in VR, or when hints are off. The desktop floating tooltip now shows only the object's name (`aimFeedback.ts`); VR keeps its action rows until job 77. Toasts moved up to clear the strip.
- "Show hints" switch: `RuntimeMenuState.showHintsEnabled` (absent means on), command `set-show-hints`, `SettingsPaletteContent.showHintsEnabled`, a "Hints" section on the Settings page (`pages/debugSettings.ts`), optional `onShowHintsToggled` on the adapter and controller. `createThreeApp.ts` reads `localStorage["noneuclid.showHints"]` before the session is built and writes it when the switch changes, both in try/catch.
- Angular picking (`src/interaction/aimTarget.ts`): `aimPickAngularRadiusRadians` (1.5 degrees). When the exact ray hits no object in any cell it walked, a second pass accepts the object whose proxy axis (segment centerline, emitter body axis and handle axes, collision-cylinder axis, or a point for a sphere proxy) passes within proxy radius plus the angular radius at the closest approach. Floor and wall limits are already in the hit windows, so nothing nearer is skipped; creatures and protractor labels are never picked this way. Tests in `tests/interaction/aimTarget.test.ts`: 1 degree off is picked, 3 degrees is not, and a nearer exact hit wins.
- Sticky focus (`src/render/three/aimInteraction.ts`): `findDisplayFocusedRuntimeObject` holds the focus `stickyFocusMilliseconds` (150) after the ray leaves it unless another usable object is aimed at; creatures are not focusable unless the focus message offers an available action under the tool in hand (none today), and the next focusable candidate is used instead. Tests in `tests/render/aimInteraction.test.ts` (149 ms kept, 151 ms dropped, injected clock). Tooltip, outline, hint strip and crosshair ring use it; actions, menus and the help key still use the exact `findFocusedRuntimeObject`, so H still names creatures.
- Focus outline (`src/render/three/focusOutline.ts`): the object's hit proxy built with the debug hit-box builders, as a translucent shell tinted with the tool's `indicatorColor` (white for the Hand), parented to the object's cell root so it shows through portals. Test in `tests/render/focusOutline.test.ts`.
- Laser preview (`src/render/three/laserPreview.ts`, driven from `aimFeedback.updateAim`): with the Laser selected and the aim on the floor, a translucent post and head in the Laser color at the aim point and an arrow along the aim ray's horizontal heading.
- Commit: see the follow-up line below.

### Deviations
- Existing test changed: `tests/interaction/aimTarget.test.ts` "misses geodesic emitters just outside the narrowed cylindrical aim outline" now aims 1.6 m off at 40 m (2.3 degrees) and is renamed; the old 0.2 m miss (0.3 degrees) is picked by design now.
- Existing test harness `tests/render/aimFeedback.test.ts` gained the new `findDisplayFocusedRuntimeObject` dependency.
- The strip row "Laser in hand, aiming at a free beam" reads `Left click: extend 2 m` without "right click: Laser menu": right click on a beam opens nothing in the code, so the strip does not promise it. The first row shows the intent label "1-5 . wheel" instead of "1-5".
- The hint strip and the Settings switch are desktop-only; VR still shows its action rows in the focus label.

### Uncertain
- The CDP recipe `motion.run([{ to: "geodesicEmitters/emitter:0", stopAt: 2.5, ... }])` gives no focus here: the laser's interaction range is 2.5 m measured from the eye to the hit, and a player standing 2.5 m away with the eye at 1.6 m is out of range. With `stopAt: 2.0` the laser is focused with no pitch adjustment (tooltip "Laser L1", strip "Left click / Right click / F: Laser menu · G: pick up", outline visible). The range was not changed (the job says not to change what actions do); the recipe number may need to be 2.0.
- Sticky focus is display-only; a click within 150 ms after the ray left an object acts on what is aimed at now, not on the held focus. Making actions sticky too would be a one-line change in `createThreeApp.ts` but changes what a click does.
- The outline is the hit proxy shell (a cylinder for a laser, a capsule for a beam), not the exact mesh silhouette; objects are drawn as shared instances through portals, so a per-mesh back-face hull was not attempted.
- A real left click with the Laser did not place a laser in the headless run (the aim was possibly too steep or the synthetic events do not reach the primary path); the ghost was verified by screenshot and the laser was placed through `noneuclid.api.geodesicEmitters.place` instead.
- The "Show hints" switch is a uikit toggle in the 3D palette; it was covered by the command and definition tests, not clicked.

### Not done
- Minimum beam width of 2 px: the beams are lit meshes, not lines, so a screen-space minimum needs a new line renderer or a shader change; skipped per decision 8.
- Pages check skipped (`gh` is disabled).

### Checks
- Baseline before changes: not rerun separately (job 75 left typecheck, docs:check and npm test green).
- After: `npm run typecheck` clean; `npm run docs:check` ok (after `npm run docs:generate`); `npm test` 202 files, 1904 tests, all passed after fixing one test name over 90 characters (the hygiene check H6); `npm run build` then headless Chrome (`.temp/check76.mjs`, pointer lock stubbed, `?config=001`): strip on the floor with the Hand, "Left click: open Help" with the tooltip "Help cube" and a white outline on the help cube, "Left click: place a laser · 0: put the Laser away" with the ghost, "Left click / Right click / F: Laser menu · G: pick up" with tooltip "Laser L1" and outline, "0: put the Ruler away" style rows for the Ruler on a laser. Screenshots checked.
