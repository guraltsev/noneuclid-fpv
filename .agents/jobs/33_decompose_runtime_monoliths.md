# Job 33 - Decompose runtime monoliths and retire legacy paths

Status: done (branch `job-33`, not merged).
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
- The eight skipped legacy tests were still skipped in
  `tests/world-objects/geodesicCannon.test.ts` (lines 621, 752, 836, 1600,
  2361, 2406, 2445, 2497). Job 26 Part E deleted them together with
  `legacyConnection.ts` and `tests/world-objects/geodesic/legacyConnection.test.ts`
  (acceptance item below is met). `isGeodesicStraightening` and
  `hasStraighteningIncidentGeodesic` are gone from `geodesicCannonTools.ts`;
  `GeodesicEmitterConnection`, `getGeodesicConnection`, `geodesicConnectionsById`
  and the segment `connectionState` (display state `"straightening"` of moving
  intervals) remain for this job.
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


## Report

Branch `job-33` (worktree `../noneuclid-job33`), base `324a715`, not pushed. Commits: `733b5a3` (Part A), `3fd7f2d` (Part B), `58aed40` runtimeObjectActions, `6d9205e` aimFeedback, `a71caed` xrSessionController, `46f189a` portalFramePass, `b3fb009` geometryCommit, `f19863a` desktopInputHandlers, `529d32c` runtimeEffects + scenePaletteCommands + geometryDebugHelpers, `43abdc7` exports only tests used.

### What was done
- **Part A.** `geodesicConnectionsById` and every reader are gone; `getGeodesicConnection` keeps the interval branch only and its type is now `GeodesicEmitterAttachment` (`open | connected`) - it stays because `removeGeodesicCannonAndSegments`'s former caller path and the debug dumps (`geodesicDebugDumps.ts`, `appDebugHelpers.ts`) read it. `isGeodesicLocked`, `resolveDerivedSegmentConnectionState` and `collectGeodesicPortalWord` have no non-interval branch; `findSourceEmitterForGeodesic` is deleted. `"straightening"` is `"moving"` everywhere; `geodesicSegmentMovingArchetypeKey` = `geodesic-segment:ribbon-cross:moving`. `createGeodesicSegmentTooltip` lost its parameter. `syncLegacyEmitterGeodesicFields` is `syncEmitterGeodesicMenuCaches`. `Legacy:` comments and `_docs/MATHEMATICAL_MODEL.md` rewritten.
- **Part B.** Deleted `desktopFlagEditor` (module, construction, 13 guards, CSS), the whole sign-colour feature (`defaultPlacedFlagFontColor` is now `defaultPlacedFlagTextColor`, a constant the renderer uses), `applyJoystickDeadZone` and `nextAcceptedHeadLocalMeters`. `buildDecorationMesh` uses `runtimeSceneUtils.disposeObject3D`; `helpLensRenderer` and `xrControllerHandModels` keep their copies with a comment on how they differ.
- **Part C.** New modules in `src/render/three/`, each with a contract test in `tests/render/`: `runtimeObjectActions`, `aimFeedback`, `xrSessionController`, `portalFramePass`, `geometryCommit` (+ `geometryCommitTransforms`), `desktopInputHandlers`, `runtimeEffects`, `scenePaletteCommands`, `geometryDebugHelpers`. No deps interface has a getter/setter pair; moved `let`s are owned by the module and read through its handle.

### Size
| | lines |
| --- | --- |
| `createThreeApp.ts` at `324a715` | 3,398 |
| after Part B | 3,355 |
| after step 12 / 13 / 14 / 15 / 16 | 3,030 / 2,766 / 2,627 / 2,295 / 2,134 |
| after step 17 and the three extra modules | 1,739 (target < 1,800 reached) |

### Deviations
- **Test changes (Decisions required a record).** Part A: fixtures that set `geodesicConnectionsById` (`intersections.test.ts`, `protractorTool.test.ts`, `worldGeometryComputedObjects.test.ts`) only lost that line; one `intersections` assertion about the removed field was deleted; titles that said "legacy" were reworded. `collectGeodesicPortalWord` lost its unused `world` parameter, so about 30 call sites in tests changed (`wordOf` in `moveEmitter.test.ts` too). Renamed `"straightening"` literals and archetype key in `geodesicCannonRenderer.test.ts` and `curveShortening.test.ts`. Part B: the two sign-colour tests in `placedFlags.test.ts`, one `nextAcceptedHeadLocalMeters` assertion. Stale sweep: three `getGeodesicRayArchetypeKeys` tests now use a local filter; `trace.test.ts` reads the end anchor from the registry and two `resolveGeodesicCannonAimYawRadians` tests and the `isPlacedFlagType` test are deleted; the "numbered default text" test now calls `placeFlagAtFloorPoint` with the old ray's floor points (assertions unchanged).
- **`geodesicCreatureDebug.ts` keeps its private `roundNumber`.** The body equals `appDebugHelpers.roundNumber`, but importing it creates an import cycle (`docs:check` FAIL). `debugOverlay.ts` keeps its copies: they round to 3 digits, `appDebugHelpers` to 6 (and `formatVec3` there does not round).
- **Geometry-commit transforms stay in `render/three`** (they import `runtimeSceneUtils`); moving them to `runtime/` would break the layer order. `geometryCommit.active()` is a third handle method beyond `commitReady`/`commit`, because the shell reads the bundle.
- **`aimFrameSerial` stays in the shell** and is passed to each `portalFramePass` sync call (a getter would break the no-getter rule). `rebuildCellMeshes`, `applyDebugSettings` and the frame loop stay in the shell.
- `aimFeedback` has two update calls (tooltips, aim) because the frame loop runs them under different error guards. `desktopInputHandlers` took `applyDesktopScenePaletteToggle` into the `runtimeObjectActions` handle to avoid a dependency cycle. Dispose order in `createThreeApp` changed slightly (entry UI before palette controller).
- Extra modules beyond the plan (`runtimeEffects`, `scenePaletteCommands`, `geometryDebugHelpers`) were extracted to get under 1,800 lines.

### Stale sweep (both sweeps)
Removed, transitively with their tests: `desktopFlagEditor`, `placedFlagFontColors`, `sanitizePlacedFlagFontColor`, `updatePlacedFlagFontColor`, `applyJoystickDeadZone`, `removeGeodesicCannonAndSegments`, `isGeodesicIntersectionObject`, `isGeodesicCannonObject`, `isGeodesicIntervalObject`, `isCurveShorteningPairObject`, `collectGeodesicMenuRowsForEmitter`, `GeodesicDebugToolState`, `getGeodesicRayArchetypeKeys`, `getGeodesicEndpoints`, `geodesicHasNonzeroLiftedDisplacement`, `updatePortalWordForMovedEndpoint`, `resolveGeodesicCannonAimYawRadians`, `isPlacedFlagType`, `placeFlagFromAim` (+ `PlaceFlagFromAimRequest`). The sweep after Part C found nothing more in the Part C modules.

### Uncertain
- The non-interval returns in `cannon.ts` (`rebuildConnectedGeodesicBetweenEmitters`, `connectGeodesicToEmitter`) were not examined for reachability; kept.
- `removeGeodesicNow` keeps its non-interval branch (removes stale segments and emitter cache entries for an id that is not an interval); not on the list, not proven dead.
- `MATHEMATICAL_MODEL.md` now points at `updateLockedGeodesicPortalWordForCarriedAnchorTraversal` where it named `updatePortalWordForMovedEndpoint`; whether the sentence matches that function exactly was not re-read.
- Factory handles are now `const`s built in order; a use before the factory call is a temporal-dead-zone error that typecheck cannot see. Nothing does it, and the release tier passes.
- XR `end`-listener removal and late-`end` handling are tested only against the fake session, not a headset.

### Not done
- `rebuildCellMeshes`, `applyDebugSettings`, `syncLaunchOptionsState` and the frame loop remain in the shell (they touch `visibleCellId`, `cellRootsGeneration`, the recreated `portalDebugRuntime`).

### Checks
Baseline at `324a715`: typecheck green, `npm test` 144 files / 1237 tests. Final (`43abdc7`): `npm run typecheck`, `npm run docs:check` green; `npm test` 153 files / 1281 tests; `npm run test:release` 6 files / 13 tests, the known `appCommands` CDP timeout did not occur in these runs. Both done-greps print nothing.
