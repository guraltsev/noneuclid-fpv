# Job 33 - Decompose runtime monoliths and retire legacy paths

Status: queued.
Former issue: 38 (converted to a job on 2026-10-28).

Priority: P1 for geodesic correctness boundaries; P3 for dead UI cleanup.

## Status update 2026-10-28

Done:

- The unused DOM palette/input modules are gone. `src/render/dom/` holds only
  `desktopFlagEditor.ts`, `desktopToolIndicator.ts` and
  `floatingObjectTooltip.ts`; `src/ui/` holds only definitions
  (`paletteDefinition.ts`, `paletteTooltips.ts`, `helpLensDefinition.ts`, ...).
  All palettes go through the scene palette (`scenePaletteController.ts`,
  `desktopScenePaletteInput.ts`, `xrScenePaletteInput.ts`).
- The legacy straightening runtime is no longer driven by the app:
  `advanceStraighteningGeodesics` and `tieAndDetachIncidentGeodesics` are
  referenced only by `src/world-objects/geodesicCannon.ts` and its test;
  `createThreeApp.ts` calls `advanceCurveShorteningPairs`.
- `npm run typecheck`, `npm test` (85 files, 608 passed, 9 skipped) and
  `npm run docs:check` pass on the current tree.

Still open:

- Sizes now: `createThreeApp.ts` 3,555 lines (up from the ~3,300 noted under
  Progress); `geodesicCannon.ts` 5,942 lines (it grew from 4,533 as the
  curve-shortening model was added); `geodesicCannonTools.ts` 1,308 lines.
- Legacy straightening code still lives in `geodesicCannon.ts`:
  `geodesicStraighteningSpeedMetersPerSecond`, `isGeodesicStraightening`,
  `hasStraighteningIncidentGeodesic`, `tieAndDetachIncidentGeodesics`,
  `advanceStraighteningGeodesics`, the segment `connectionState`
  (`"open" | "connected" | "straightening"`) and
  `syncLegacyEmitterGeodesicFields`. `geodesicCannonTools.ts` still filters
  with `isGeodesicStraightening` and guards with
  `hasStraighteningIncidentGeodesic`.
- The eight skipped legacy tests are still skipped in
  `tests/world-objects/geodesicCannon.test.ts` (lines 621, 752, 836, 1600,
  2361, 2406, 2445, 2497).
- `createThreeApp.ts` still constructs `createDesktopFlagEditor` although
  nothing calls its `open()` (also listed in issue 41).
- The `createThreeApp` split listed under Progress has not advanced, and no
  browser smoke runs in CI (issue 36).

## Problem

`src/render/three/createThreeApp.ts` was approximately 6,648 lines and
`src/world-objects/geodesicCannon.ts` approximately 4,533 lines when this was
filed (3,555 and 5,942 on 2026-10-28). They combine
multiple state machines, rendering orchestration, input actions, geometry
updates, compatibility adapters, and cleanup rules. This conflicts with the
Stage 12 goal of splitting oversized mixed-concept files.

The geodesic module still contains legacy emitter connections, segment
`connectionState`, legacy tie/detach, and straightening APIs alongside the new
interval/endpoint/curve-shortening model. The UI tree also retains unused DOM
palette/input modules and a legacy desktop editor path after issues 27 and 30.

## Required work

- Coordinate geodesic legacy removal with issues 31 and 32; do not remove a
  path until equivalent endpoint/portal/failure tests protect current behavior.
- Extract curve-shortening pair operations, anchored rebuild/portal-word logic,
  legacy migration helpers, and renderer-derived segment state into explicit
  modules with narrow contracts.
- Split `createThreeApp` by lifecycle, geometry snapshot commit, portal frame
  rendering, runtime-object actions, palette/help integration, and XR session
  orchestration without introducing a second source of truth.
- ~~Remove unused desktop DOM palette/input/editor compatibility modules after
  confirming no launch mode imports them.~~ Done for palette/input; the
  never-opened `desktopFlagEditor` remains.
- Keep the refactor behavior-preserving and land it in reviewable slices.

## Progress

- `createThreeApp.ts` was reduced from 7,342 to about 3,300 lines. Module-level
  helpers moved to focused modules (`appDebugHelpers`, `debugHitboxMeshes`,
  `protractorToolFeedback`, `frameDiagnostics`, `runtimeSceneUtils`, ...), and
  cohesive closure clusters became `create*(deps)` factories: geodesic emitter
  tools (`geodesicCannonTools`), aim resolution (`aimInteraction`), tool object
  runtimes, geometry-computer menu, debug visualization, geodesic debug dumps,
  and the portal debug runtime.
- Still in the shell: the frame loop, geometry-commit transforms, portal
  instance sync (mono and stereo), runtime-object render sync, XR session
  orchestration, and palette/help integration. These share the most mutable
  state; the next slice should introduce an explicit shared-state holder
  instead of more getter/setter pairs.
- `geodesicCannonTools.ts` is about 1,300 lines. Its tie/detach entry now calls
  the curve-shortening `tieAndDetachGeodesicEndpoints`; only the
  `isGeodesicStraightening`/`hasStraighteningIncidentGeodesic` guards of the
  legacy model remain there.

## Acceptance criteria

- Active runtime paths no longer depend on the old geodesic straightening model.
- The eight skipped legacy geodesic tests are removed or replaced by current
  endpoint/curve-shortening behavior tests, not merely unskipped unchanged.
- Dead DOM menu/editor paths are absent from runtime construction.
- Extracted modules have focused contract tests and preserve all current public
  behavior.
- Typecheck, tests, browser smoke, and build pass after each major slice.

## Merged from issue 41 (2026-10-28)

Dead code, duplication and naming from issue 41:

- `DesktopFlagEditor.open()` is never called, so the editor can never open. It would also need the key-capture guard
  that now exists. Either wire it up or delete it.
- Unused code:
  - the dithered smooth-edge clip-shader path (`portalClipEdgeSmoothingEnabled` is `false`);
  - `applyJoystickDeadZone` and `nextAcceptedHeadLocalMeters`, which only tests use;
  - `createGeodesicSegmentTooltip`, which has identical branches.
- Duplicated helpers:
  - private `disposeObject3D` copies in `buildDecorationMesh`, `helpLensRenderer` and `xrControllerHandModels`. They
    dispose different subsets, so merge them with care.
  - `formatVec3`/`roundNumber` in `debugOverlay.ts` and `appDebugHelpers.ts`, plus a third private `roundNumber` in
    `geodesicCreatureDebug.ts` and one in the `geodesicCannon` debug code.
- Naming: the `"geodesci-marmot"` kind literal and the capitalisation of `ShowCellPathRendersInstances`.
