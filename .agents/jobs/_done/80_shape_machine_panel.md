# Job 80 - Shape machine panel: one picture, Shift and Height, direct entry, presets

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.9 (F19).

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

## Report

### Done

The shape machine page now matches the decisions. Commit: COMMIT_HASH (branch `dev`).

- Picture (`src/render/three/palette/latticeDiagram.ts`): one parallelogram, current outline white, target green, the
  target's top side labelled "Shift 15.0 m" and its left side "Height 15.0 m" (one decimal), the "Same world as the
  start" badge in the picture's corner. The old `(0,0)`, `(X,0)` and `A+X,B` labels are gone. The picture is 220 px tall
  (was 280) so the whole page fits the panel frame; the userData the old test reads (`scenePaletteDiagramWorldPoints`,
  item id, icon source) is unchanged.
- Page (`src/render/three/palette/pages/geometryComputer.ts`, rewritten): a row per parameter (name, value button that
  opens the number pad, `-1 m`, `+1 m`; "At the limit" at the end of the row), the number pad (digits in two key rows
  built by `createKeypadRow`, extracted from the sign editor's keyboard in `signs.ts`, plus Back, Cancel, OK), the four
  presets, a folded "More" row (width line and the two modulus lines), and "Reshape world" with its reason. While a
  value is typed the pad takes the room of the presets and the More row. The ±8 steps are gone. The status line is only
  drawn when the machine is off in this world.
- Definition (`src/ui/paletteDefinition.ts`): `parameters`, `entry`, `presets`, `sameAsStart`, `sameAsStartLabel`,
  `moreLines`, `moreOpen`; steps are only `-1`/`+1` and disable with "At the limit" at the ends of their range.
  Presets are relative to the starting torus: Square (0, w), Shift by half (start a plus round(w/2)), Shift by a whole
  width (start a plus w), Tall (start b doubled); a shift that would leave the range goes backwards instead.
  "GO!" is now "Reshape world" (`shapeMachineText.reshape`), disabled with "Nothing to change" when target equals
  current.
- Equivalence: `src/cell-complex/deformations/torusModuli.ts` gains `torusRelation` (one classifier) and
  `isSameFlatTorus`; `describeTorusRelation` now reads the classifier and returns the same sentences. The badge uses
  `isSameFlatTorus(target, start)`. The deformation math is untouched.
- Plumbing: new command and effect `edit-geometry-computer` with `GeometryComputerEdit` (set-target, open-entry,
  entry-digit, entry-backspace, entry-apply, entry-cancel, toggle-more) in `runtimeCommands.ts`; the typing and More
  state live in `geometryComputerOptions` (`entryAxis`, `entryText`, `moreOpen`) and are cleared with the rest of the
  payload by `closeRuntimeMenu` and `showRuntimeMenuMainPage`; `editGeometryComputer` in `geometryComputerMenu.ts`;
  `onGeometryComputerEditRequested` through `adapterTypes.ts`, `scenePaletteController.ts`, `scenePaletteCommands.ts`,
  `runtimeEffects.ts`, `createThreeApp.ts`. A preset, a step or OK ends any typing. Only Reshape world reaches the
  session's target.
- Words: `shapeMachineText` in `src/world-objects/vocabulary.ts` (labels, presets, tooltips); tooltips for every
  shape machine control id in `src/ui/paletteTooltips.ts` (the old "Set skew" and "Step skew" are gone).
- Tests added: `tests/ui/shapeMachinePanel.test.ts` (definition: parameters, steps and limits, presets from two starts,
  badge, Reshape reason, pad, More, off state), `tests/render/geometryComputerMenu.test.ts` (presets, pad, clamp, cancel,
  step ends typing, Reshape only on the button), three adapter tests in `tests/render/scenePaletteAdapter.test.ts`
  (page words and ids with clicks, pad and its keys, More folded and unfolded), tooltip and `isSameFlatTorus` cases.
- Headless Chrome check on `?config=005` (script `.temp/check80.mjs`, gitignored): stood at the shape machine, opened
  its menu, pressed "Shift by a whole width": the picture showed Shift 15.0 m with the badge "Same world as the start"
  visible and "Reshape world" enabled; pressing "Reshape world" closed the menu and reshaped (the room stayed the same
  torus). Also typed 2, 2 and OK on Height: Height 22.0 m, badge gone, Reshape enabled. `npm run smoke -- --config 001`
  passed.
- Docs regenerated (`_docs/generated/*`).

### Deviations

Existing tests changed, each because the page changed as the job decides:

- `tests/runtime/runtimeMenuState.test.ts`: the status label is now "Now: Shift 1.0 m, Height 15.0 m. Target: ...", the
  step labels are `-1 m`/`+1 m` per axis (no `-8`/`+8`), the go label is "Reshape world".
- `tests/ui/paletteDefinition.test.ts`: the go label is "Reshape world".
- `tests/render/runtimeEffects.test.ts`: the deps fake gets `editGeometryComputer`.

### Uncertain

- "Shift by half" on an odd width: targets are whole meters, so half of 15 m is 8 m. Confirm that rounding up is fine.
- A typed value outside the range (for example 99) is clamped silently to the limit (30 m for Shift); no toast.
- "Square" is (0, w) whatever the start is; the other presets are relative to the start, as the job says.
- Job 35 is still queued, so the readout is today's (a, b) one; the page reads `startSkewXMeters`/`startDepthMeters`
  as before. If job 35 changes what "the start" means, the presets and the badge follow `initial` automatically.
- The badge compares the target with the start, so it is also visible when the machine opens (target = start).
- The number pad reuses the sign editor's key-row builder, not a separate component (there was none).

### Not done

- `npm test` as a whole is not green on this machine: the 10 `tests/app/*.release.test.ts` files fail with
  `CDP command ... got no response within 6000 ms`. They failed the same way in the baseline run before any change
  (9 files, 22 tests then), so they are environmental. All 214 unit files (2015 tests) pass.
- Pages checks skipped (`gh` is disabled).

### Checks

- Baseline: `npm run typecheck` clean; `npx vitest run`: 9 files failed (release CDP timeouts), 22 tests.
- After: `npm run typecheck` clean; `npx vitest run --project unit`: 214 files, 2015 tests passed; full
  `npx vitest run`: only the 10 release files fail, all with the CDP no-response timeout; `npm run docs:check` ok;
  `npm run build` ok; `npm run smoke -- --config 001` ok.
