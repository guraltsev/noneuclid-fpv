# Job 78 - Self-explaining menus: text labels, disabled reasons, readable beam rows, one way to delete

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.5 (F16,
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
