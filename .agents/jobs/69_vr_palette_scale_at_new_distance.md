# Job 69 - Scale the VR palette to its new distance and remove the unused auto-close check

Status: queued.
Resolves: nothing filed; follow-up to commit `890c43f` on branch `dev`.

## Goal

Commit `890c43f` (branch `dev`) moved the VR tool palette twice as far from the eyes: the head-local offset in
`src/render/three/vrPalettePlacement.ts` went from `(0, -0.12, -0.72)` m to `(0, -0.24, -1.44)` m. The panel kept its
physical size, so in the headset it now looks half as big and its text is harder to read. Make the VR palette, and the
tooltip and hover marker drawn on it, twice as large in VR only, so the palette keeps the angular size it had before
while staying at the new distance. Also delete the auto-close helper that nothing calls, whose 1 m limit is now shorter
than the palette's own distance.

## Depends on

Nothing. Work on branch `dev` (not `main`); `dev` is published to GitHub Pages at `/dev/` on every push.

## Before you start

- Read `src/render/three/vrPalettePlacement.ts`, `src/render/three/scenePaletteController.ts` (look for `placement.scale`,
  `updatePaletteTooltip`, `updatePaletteHitMarker` or the code that positions `paletteHitMarker`), `src/render/three/scenePaletteInput.ts`
  (`ScenePalettePlacement`) and `tests/render/vrPalettePlacement.test.ts`.
- On this Windows machine, run vitest from PowerShell, not Git Bash: under Git Bash every unit file fails to load with
  "Cannot read properties of undefined (reading 'on')" (project-knowledge note K-20261112-1784).

## Background

- `ScenePalettePlacement` already has an optional uniform `scale` (absent means 1). `scenePaletteController.ts` applies it
  with `paletteRoot.scale.setScalar(frame.placement.scale ?? 1)`. The desktop placement
  (`desktopScenePalettePlacement.ts`) sets `scale: 1`; the VR placement sets no scale today.
- Pointer hits are found by `raycaster.intersectObject(root, true)` in world space (`resolvePaletteHit`), so scaling
  `paletteRoot` keeps hits correct with no change to the input code. The ray reaches 4 m; the palette is at about 1.46 m.
- The panel size is shared with the desktop palette through `scenePalettePanelPixelSize` in `scenePaletteLayout.ts`.
  Do not change that constant: it would resize the desktop palette as well.
- The tooltip (`paletteTooltip.root`) and the hover marker (`paletteHitMarker`) are added to the scene directly, not under
  `paletteRoot`, so the placement scale does not reach them. The tooltip is a 0.4 m wide plane placed 6 mm off the panel
  and 4 cm up and right of the hit point.
- `shouldAutoCloseVrPalette` and `VR_PALETTE_AUTO_CLOSE_DISTANCE_METERS` in `vrPalettePlacement.ts` are used only by
  `tests/render/vrPalettePlacement.test.ts`. The maintainer's rule is that unreachable code is deleted, not kept for later.

## Decisions

1. The VR scale is a named, exported constant in `vrPalettePlacement.ts`: `VR_PALETTE_SCALE = 2`, with a doc comment
   saying it matches the doubled head offset so the palette keeps the angular size it had at 0.72 m.
   `resolveVrPalettePlacement` returns `scale: VR_PALETTE_SCALE` on every path, including the frozen one.
   Add `readonly scale: number` to `VrPalettePlacement`.
2. The tooltip and the hover marker follow the placement scale: set their `scale` to `frame.placement.scale ?? 1`, and
   multiply their offsets from the hit point (the 6 mm, the 4 cm and the hover marker's 2 mm) by the same factor.
   The desktop palette passes scale 1, so it must look exactly as before.
3. Delete `shouldAutoCloseVrPalette`, `VR_PALETTE_AUTO_CLOSE_DISTANCE_METERS`, their test, and the sentence about
   auto-close in the module and test header comments. Search the whole repository (`src`, `tests`, `_docs`, `_issues`,
   `.agents`) for both names first; if anything outside the test uses them, do not delete them and record it under
   `### Uncertain`.
4. Do not change the head offset `(0, -0.24, -1.44)`, the smoothing, the ray length or anything on the desktop path.

## Steps

1. Baseline: `npm run typecheck`, `npm test`.
2. Add `VR_PALETTE_SCALE` and the `scale` field (decision 1). Extend `tests/render/vrPalettePlacement.test.ts`: the
   placement has `scale` 2, both unfrozen and frozen. Run `npx vitest run tests/render/vrPalettePlacement.test.ts`.
3. Scale the tooltip and the hover marker (decision 2). If `tests/render/` has a test of `scenePaletteController`, add a
   case there: with `placement.scale` 2 the tooltip root's scale is 2, and with no scale it is 1. If no such test exists
   and building the controller in a test needs a WebGL context, skip the test and record that under `### Not done`.
4. Delete the auto-close helper (decision 3). Run the placement test again.
5. Finish as the README says: `npm run typecheck`, `npm test`, `npm run docs:check` (and `npm run docs:generate` if it
   reports stale documents), then commit on `dev` and push to `github dev`.

## Tests and checks

- `tests/render/vrPalettePlacement.test.ts` passes, with the new scale assertions and without the auto-close test.
- `npm run typecheck` and `npm test` are green, or show only failures that were already in the baseline.
- The Pages publish workflow for `dev` succeeds (`gh run list --branch dev --limit 1`).
- An in-headset check is not possible here; record under `### Uncertain` that the maintainer should check the size and
  readability at https://guraltsev.github.io/noneuclid-fpv/dev/.

## Do not

- Change `scenePalettePanelPixelSize` or the canvas size in pixels.
- Change the desktop palette, its placement or its input.
- Merge `dev` into `main`.

## Done when

The VR palette, its tooltip and its hover marker are drawn at scale 2 at 1.44 m ahead; the desktop palette is unchanged;
the auto-close helper is gone; the checks above pass; the commit is pushed to `dev` and the report is appended.
