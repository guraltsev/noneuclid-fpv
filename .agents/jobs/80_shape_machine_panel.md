# Job 80 - Shape machine panel: one picture, Shift and Height, direct entry, presets

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.9 (F19).

## Goal

The geometry computer, now called the shape machine, shows the torus as one labelled parallelogram with Shift and
Height in metres, lets the student type values or step them, offers generic presets, shows "Same world as the start"
when it holds, and has a "Reshape world" button that says why it is disabled.

## Depends on

Jobs 70, 78. Also check job 35 (torus re-marking): if it has landed, build on its readout; if it is still queued, do
not touch the deformation math. Branch `dev`.

## Before you start

- `GeometryComputerActionsPaletteContent` in `src/ui/paletteDefinition.ts`,
  `src/render/three/palette/pages/geometryComputer.ts`, `src/render/three/geometryComputerMenu.ts`, the runtime commands
  for it (`src/runtime/runtimeCommands.ts`, `applyRuntimeCommand.ts`).
- Job 67 (done): rigid floor patches, Teichmuller steps and the moduli readout.
- The sign editor's keypad (`EditSignPaletteContent`, `src/render/three/palette/pages/signs.ts`) for direct entry.

## Decisions

1. Main view: a 2D parallelogram drawing (canvas texture or uikit shapes) of the target torus, current outline in
   white, target in green, with the two sides labelled "Shift" and "Height" and their values in metres (one decimal).
2. The complex modulus line moves under a collapsed "More" row.
3. Steppers per parameter: −1 / +1 and a keypad entry reusing the sign editor's keypad component. Remove the ±8 step.
4. Presets: "Square", "Shift by half", "Shift by a whole width", "Tall" (Height doubled). Values relative to the
   world's starting torus.
5. Badge "Same world as the start" when the target is equivalent to the start (reuse the existing equivalence check that
   produces today's "same torus" clause).
6. "GO!" becomes "Reshape world"; disabled with reason "Nothing to change" when target equals current.

## Steps

1. Baseline.
2. Definition changes with unit tests (presets produce the expected targets; reason when target = current).
3. Rendering.
4. Finish as the README says.

## Tests and checks

- Unit tests above; existing geometry computer tests updated with recorded deviations.
- CDP on `?config=005`: open the shape machine, press "Shift by a whole width", then "Reshape world"; the badge
  "Same world as the start" is visible before reshaping.

## Do not

- Change the deformation itself, its animation or its commit path (jobs 30, 35, 68).

## Done when

The panel matches the decisions, checks pass, commit on `dev`, report appended.
