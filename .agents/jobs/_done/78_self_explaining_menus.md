# Job 78 - Self-explaining menus: text labels, disabled reasons, readable beam rows, one way to delete

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.5 (F16,
F17, F18, F20).

## Goal

Every palette control has a text label; every disabled control says why, in visible text; menu actions show their
key or button; the Laser menu lists beams in words; every placed thing is deleted from its own menu; the panel fits
its content and tooltips never cover a sibling.

## Depends on

Jobs 70, 75, 77 (shortcut glyphs per layout). Branch `dev`.

## Before you start

- `src/ui/paletteDefinition.ts`: `PaletteHeaderAction`, `GeodesicCannonActionsPaletteContent`,
  `GeometryComputerActionsPaletteContent`, `EditSignPaletteContent`; `ObjectActionEntry` in `src/engine/moduleTypes.ts`
  (it has `enabled` only).
- `src/ui/paletteTooltips.ts`.
- Palette pages `src/render/three/palette/pages/*.ts` and the layout in `scenePaletteLayout.ts`
  (`scenePalettePanelPixelSize`).
- Measurement removal today: "With no tool, select a measurement to remove it" (tutorial text); find it in
  `src/modules/geodesicMeasurements/`.

## Decisions

1. Add `disabledReason?: string` next to every `enabled`/availability flag in the palette definition types and in
   `ObjectActionEntry`; `isAvailable` on object-action tools gets a sibling `unavailableReason(objectId, tool)`
   returning a string from the vocabulary. A unit test walks all definitions built for a set of fixture states and fails
   on a disabled control without a reason.
2. Reasons (vocabulary): Join "Needs two linked beams at this laser"; Aim and Extend on a linked beam "Linked beams
   cannot be aimed"; Map "No map for this world"; Reshape world "Nothing to change". Add others in the same style.
3. Rendering: the reason is drawn in small text under the control, always visible while disabled.
4. Header actions get text: "+ Add beam", "Pick up · G" (VR: the layout's glyph), "Join", "Delete"; main-menu header
   actions as in job 75. Tooltips keep only the longer explanation and are placed outside the panel edge.
5. Beam rows: "Beam 1 · 4.0 m · free" or "Beam 2 · L1–L3 · linked" with the chain icon; lengths with one decimal.
6. Delete: lasers, signs, beams and measurements all have Delete in their menu. Use with the Hand on a measurement opens
   its menu (no more delete-on-click). Each delete uses job 73's toast.
7. The panel height fits its content up to the current maximum; width stays fixed (do not change
   `scenePalettePanelPixelSize`). If the uikit layout cannot size to content, keep the size and record it.

## Steps

1. Baseline.
2. Types and reasons (decisions 1, 2) with the walking unit test in `tests/ui/paletteDefinition.test.ts`.
3. Rendering of reasons and text labels; tooltip placement.
4. Beam rows; delete paths.
5. Panel sizing.
6. Finish as the README says.

## Tests and checks

- Unit tests above; existing palette tests updated with recorded deviations.
- CDP: open a laser's menu with one beam; the Join control shows "Needs two linked beams at this laser".

## Do not

- Change what actions do, except the measurement click (decision 6).

## Done when

No disabled control without a visible reason, text labels everywhere, beam rows in words, one delete path, checks pass,
commit on `dev`, report appended.

## Report

### Done

Commit: `COMMIT_HASH` on `dev`.

- Vocabulary (`src/world-objects/vocabulary.ts`): `disabledReasons` (Join, Aim/Extend on a linked beam, Map, Reshape world, shape machine off, first/last page, empty help topic), `menuControlText` ("+ Add beam", Delete, Previous/Next, the measurement menu), `actionWithKey` ("Pick up · G"), `beamRowLabel`, `laserShortIdOfLabel`. `toolBeltText.noMapForWorld` now reads from `disabledReasons`.
- Types: `ObjectActionEntry.disabledReason`; object-action tool entries get `unavailableReason(objectId, tool)` (the Join tool gives its reason; `objectActionsFor` fills `disabledReason`, with a generic fallback). `PaletteHeaderAction.disabledReason`, a shared `PaletteTextAction`, `disabledReason` on the shape machine steps and Reshape button ("GO!" keeps its label, reason "Nothing to change"), on the page buttons and on the help hub buttons. The Aim button of a linked beam is now drawn disabled with "Linked beams cannot be aimed" (it was hidden).
- `createPaletteDefinition` and the definition cache take the XR layout, so the Pick up button reads "Pick up · G" on desktop and "Pick up · A" / "· X" in VR (`desktopInputHandlers` passes `frame.xrLayout`).
- Rendering (`palette/widgets.ts`, `header.ts`, `pages/*`): header actions are icon plus text ("+ Add beam", "Pick up · G", "Join", "Delete"); every disabled control draws its reason under it in small amber text (`createDisabledReasonText`, `withDisabledReason`, `userData.scenePaletteDisabledReason`); Previous/Next have text; beam rows are "Beam 1 · 4.0 m · free" / "Beam 2 · L1–L3 · linked" / "Beam 3 · string" (`world-objects/geodesic/beamRows.ts`); the beam Delete button says "Delete".
- Tooltips: add-beam tooltip is now the longer sentence; new ids for Delete laser and Delete measurement; the hover tooltip sits above the panel's top edge, clamped to its width, so it never covers a sibling (`scenePaletteController.ts`).
- One way to delete: lasers (new header "Delete", command `delete-laser`, `requestLaserRemoval` over `geodesicEmitters/remove`), signs (header "Delete"), beams (row "Delete") and measurements (new `measurement-actions` page with its header "Delete", commands `show-measurement-actions` and `delete-measurement`). Use with the Hand on a measurement now opens that menu instead of deleting; each delete goes through the existing undo toast (`beginDeletion`). The worldBuilder tutorial sentence and the focus/hint text say so.
- Dead code: the unreachable tool-tile drawing in `palette/pages/main.ts` is removed (the job covers the main page's text labels).
- Tests: walking test in `tests/ui/paletteDefinition.test.ts` (every disabled control in 12 fixture states has a reason; asserts at least 15 were seen), reason/label tests, `tests/world-objects/geodesic/beamRows.test.ts`, the Join reason in `tieTool.test.ts`.

### Deviations

- Existing tests updated: `tests/runtime/runtimeMenuState.test.ts` (labels "+ Add beam", "Previous"/"Next", the new `aimDisabled` fields), `tests/ui/paletteTooltips.test.ts` (add-beam tooltip), `tests/ui/worldInteractionDefinition.test.ts` (a measurement now offers "Measurement menu", not Delete), `tests/render/scenePaletteAdapter.test.ts` (a linked beam keeps its disabled Aim button with the reason), `tests/render/runtimeEffects.test.ts` (two new deps).
- The Extend reason "Linked beams cannot be aimed" is defined in the vocabulary but Extend is not a button in any menu (it is the Use click on a beam), so only Aim shows it.
- The shape machine's step buttons share one reason, drawn once under the grid rather than eight times.
- The "GO!" label and the A/B step labels are left for job 80 (shape machine panel).

### Uncertain

- The middle dot in "Beam 1 · 4.0 m · free" and "Pick up · G" renders as a small square-ish dot in the uikit font in the headless screenshot; legible, but a real headset may differ.
- The measurement menu and the laser Delete button were checked by unit tests and typecheck only; the CDP check covered the laser menu (labels, the Join reason, beam row, tooltip above the panel).

### Not done

- Decision 7, panel height fitting its content: not done. The panel root is a fixed 980 x 760 uikit container and the cursor clamp, the hit tests and the tooltip placement all read the same constants (`scenePaletteLayout.ts`); a content-sized height would need those to follow. The width is unchanged as required. Recorded as the job allows.
- The dead home/reload utility buttons in `palette/header.ts` (`showUtilityActions` is always false now) are left in place; not in the job's scope.

### Checks

- Baseline before changes: typecheck, docs:check and npm test green.
- After: `npm run typecheck` clean; `npm run docs:check` all ok (after `docs:generate`); `npm test` 208 files, 1974 tests passed; `npm run build` then `npm run smoke -- --config 001`: SMOKE OK cube.
- Headless Chrome (`.temp/check78.mjs`): a laser with one beam shows "+ Add beam", "Pick up · G", greyed "Join" with "Needs two linked beams at this laser" under it, "Delete", the row "Beam 1 · 4.0 m · free" with Aim and Delete, and the Add beam tooltip above the panel's top edge. GitHub Pages checks skipped (`gh` is disabled).
