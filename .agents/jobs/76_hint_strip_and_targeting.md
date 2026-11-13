# Job 76 - Hint strip, focus outline, angular picking and sticky focus

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.2 item 3,
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
