# Job 19 - Fix the XR input defects and add an in-headset debug panel

Status: done, needs review on 2026-10-30 (commits 1af5ddd, 31e3557).
Former issue: 20 (converted to a job on 2026-10-28). Rewritten on 2026-10-29 for a less capable implementing model;
the legacy blueprint was dropped because everything in it except the items below is done (shared palette definition,
`@pmndrs/uikit` palette, header actions, placement, pointer input, hand models, settings page; see `git log` before
0b468e1 and the tests named in "Before you start").
Resolves: no open issue (issue 41, whose XR input items are fixed here, is already closed).

## Goal

1. **Part A - XR input defects** (merged from issue 41):
   1. XR can request carry: button 4 (A on the right controller, X on the left) sets `carryActionRequested`.
   2. The dead menu-toggle computation in `xrScenePaletteInput.ts` is removed; the side trigger keeps toggling the menu
      through the runtime interact path, as today.
   3. Each `XrScenePaletteInput` owns its own controller-object cache (no module-level state).
   4. The unused `onGeometryComputerSetTargetRequested` dependency is deleted.
   5. The legacy `xrPaletteItemId` / `xrPaletteAction` userData keys are gone; only `scenePalette*` keys remain.
2. **Part B - in-headset debug panel:** a head-locked text panel in the upper left of the headset view shows the same
   lines as the desktop debug overlay. It is visible exactly when XR is presenting, debug mode is on and the "UI
   overlay" toggle is on, whether or not the palette is open. Once job 23 lands, it also shows the stereo path counts
   (job 23 adds them to the shared formatter; this job only has to use that formatter).

## Depends on

Nothing hard. Batch order: 37, 25 -> 26 -> 27, 28 -> 29, 20 -> 21 -> 22, **then 19**, then 23. Job 23's headset checks
need this job's panel.

Jobs that run earlier touch the same files. Search by function name, not line number:

- Job 28 changes the frame loop in `createThreeApp.ts` (runtime-object sync, frame snapshot).
- Job 29 replaces the per-frame palette serialisation in `scenePaletteController.ts` with a version counter, and
  removes allocations in the frame loop.
- Jobs 21/22 change the portal pass, not the UI phase. The debug-overlay state they feed is read through
  `portalDebugRuntime.updateVisiblePortalPaths`.

## Before you start

Line numbers are from commit `0b468e1`. They drift after jobs 28/29; search by name.

| File | Lines | What |
| --- | --- | --- |
| `src/render/three/xrControls.ts` | 41, 46-50, 57-95, 103-128, 210-217 | `XrControls` doc ("carry ... always false"), button index constants (0 trigger, 1 side trigger, 3 stick, 5 help), `createXrControls`, `createXrInputFrame`, `isCarryActionPressed` (placeholder returning false) |
| `src/render/three/xrScenePaletteInput.ts` | 1-5, 31-59, 66-112, 131-136 | header ("menu toggle is computed but not forwarded"), module-level `controllerObjects`, `createXrScenePaletteInput` (returns `menuTogglePressed: false`), `createControllerSources` (computes `menuTogglePressed` that nobody reads), `isMenuTogglePressed` |
| `src/render/three/createThreeApp.ts` | 525, 2093, 2133-2139 | `createXrScenePaletteInput()`, its `reset()` on session end, its `update(...)` in `updateScenePalette` |
| `src/render/three/createThreeApp.ts` | 1395-1399, 1439-1441, 3283-3295 | carry dispatch (`frame.carryActionRequested`), interact dispatch, `openContextMenuFromAim` (closes the palette if open, else opens the focused object's menu, else opens the palette) |
| `src/render/three/createThreeApp.ts` | 738-740, 945 | `onGeometryComputerSetTargetRequested` handler; destructured `setGeometryComputerPendingTarget` |
| `src/render/three/scenePaletteController.ts` | 91, 204, 469-495 | the option and its pass-through; `xrPaletteAction` / `xrPaletteItemId` fallback reads |
| `src/render/three/vrPaletteLibraryAdapter.ts` | 5, 67, 1935, 1976 and 21 more `userData.xrPaletteItemId =` lines | legacy writers (every one sits next to the `scenePalette*` writer with the same value); option `onGeometryComputerSetTargetRequested` (declared, never called) |
| `src/render/three/scenePointers.ts` | 6, 143-148 | `xrPaletteItemId` fallback read |
| `src/render/three/geometryComputerMenu.ts` | 64, 100, 153 | `setGeometryComputerPendingTarget` (still used by `stepGeometryComputerPendingTarget`; keep it) |
| `src/render/three/debugOverlay.ts` | 17-32, 43-88, 90-164 | `DebugOverlayState`, `createDebugOverlay` (builds the text inline), the exported `format*Line` functions |
| `src/render/three/portalDebugRuntime.ts` | 101-103, 418-445 | `PortalDebugRuntime.updateVisiblePortalPaths(): void`, which builds the `DebugOverlayState` (gated by `menuState.debugEnabled && menuState.debugOverlayEnabled` and the items `fps`, `location`, `portal-quantities`) |
| `src/render/three/createThreeApp.ts` | 1016, 1385, 1493-1497, 1527-1534, 2009, 2179-2190, 2337-2359 | tooltip controller creation (place the panel next to it), first head pose, second rig sync, the `"ui"` phase, `debugOverlay.dispose()`, `resolveXrHeadWorldPose`, `syncXrDebugState` |
| `src/render/three/xrObjectTooltipMesh.ts` | all (68) | precedent for a canvas-texture text plane in XR (`depthTest: false`, `renderOrder`, `frustumCulled = false`) |
| `src/render/three/renderState.ts` | 42-66 | `XrDebugRenderState` (`inputMode` exists but is never set) |
| `src/render/three/carriedGeodesicCannon.ts` | 21 | `XrHeadWorldPose` |
| `tests/render-contract/xrControls.test.ts` | 173-186 | "does not map face buttons to carry shortcuts" (replaced in Step A1) |
| `tests/render-contract/xrScenePaletteInput.test.ts` | all (73) | two tests; the first uses `isMenuTogglePressed` |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`.

## Background

- WebXR `xr-standard` gamepad buttons: 0 trigger, 1 squeeze (the "side trigger"), 3 thumbstick press, 4 A/X (lower
  face button), 5 B/Y (upper face button). Today 0 = primary action, 1 = interact (context menu and menu toggle),
  3 = reset, 5 = help. Button 4 is unused. Desktop carry is the `G` key (`desktopControls.ts`).
- The XR palette toggle works today: the side trigger sets `interactRequested`, and `openContextMenuFromAim` toggles.
  The palette input module also computes a toggle level and throws it away. Removing that dead code changes no
  behaviour.
- The debug overlay is a DOM element. Immersive sessions request no `dom-overlay`, so nothing shows in the headset.
  The vitest environment is `node` (no canvas), so the panel is split into pure, tested functions and a thin
  Three.js wrapper that only runs in the browser.

## Decisions

1. **Carry button.** Decided: button 4 (A on the right controller, X on the left), on any controller, rising edge, like
   every other XR action in `createXrControls` (`sources.some(...)`). The carried target is still the one under the
   active aim ray (right controller preferred), unchanged. Why: squeeze (1) is taken by interact/menu toggle, 0, 3 and
   5 are taken; 4 is the only free standard button on Quest controllers. The task suggestion "squeeze on the aiming
   controller" was rejected because it would collide with the menu toggle. Keep the signature
   `isCarryActionPressed(source: XrInputSourceLike)`; read `source.gamepad?.buttons?.[4]?.pressed === true`. Add a
   constant `carryFaceButtonIndex = 4` next to the others and update the module header and the `XrControls` doc.
2. **Menu toggle.** Decided: the XR palette toggle stays on the interact path (side trigger, either controller ->
   `openContextMenuFromAim`). `createXrScenePaletteInput` keeps returning `menuTogglePressed: false` (the field is
   required by `ScenePaletteInputFrame`, and the desktop input uses it), with a one-line comment naming
   `openContextMenuFromAim`. Delete the dead parts: the `menuTogglePressed` computation and return field of
   `createControllerSources`, and the export `isMenuTogglePressed`. Why: two toggles from one button would fire twice.
3. **Controller cache.** Decided: move `controllerObjects` into the closure of `createXrScenePaletteInput`; pass it to
   `createControllerSources` as a parameter (`controllerObjects: Map<string, THREE.Object3D>`). Make
   `createControllerSources` non-exported (nothing outside the file imports it).
4. **Geometry-computer target.** Decided: **delete** the dead dependency. Remove `onGeometryComputerSetTargetRequested`
   from `VrPaletteLibraryAdapterOptions` (adapter line 67), from the controller options (line 91) and the
   pass-through (line 204), and the handler in `createThreeApp.ts` (738-740). Keep `setGeometryComputerPendingTarget`
   in `geometryComputerMenu.ts` (the step action uses it); remove it from the destructuring in `createThreeApp.ts`
   (line 945) only if it becomes unused there. Why: the parallelogram diagram is display-only, the step buttons and
   "Go" cover the use, and no UI or test calls it. Wiring a drag-on-diagram editor is new UI, not a fix.
5. **Legacy keys.** Decided: delete every `userData.xrPaletteItemId = ...` and `userData.xrPaletteAction = ...` write in
   `vrPaletteLibraryAdapter.ts` and the `?? ...xrPalette...` fallbacks in `scenePaletteController.ts` and
   `scenePointers.ts`. Fix the comments that mention the legacy alias (adapter lines 5 and 1935, `scenePointers.ts`
   line 6, controller lines 469 and 484).
6. **Panel technology.** Decided: a `THREE.CanvasTexture` on a `PlaneGeometry`, like `xrObjectTooltipMesh.ts`, not
   `@pmndrs/uikit`. Why: the text changes several times a second; a canvas redraw is cheap and needs no font atlas;
   the tooltip already proves the approach in the headset.
7. **Panel file and API.** New file `src/render/three/xrDebugPanel.ts` with header comment and JSDoc on every export:

   ```ts
   /** Panel centre in the head frame (Three axes: x right, y up, -z forward), meters. */
   export const xrDebugPanelOffsetMeters = { x: -0.17, y: 0.1, z: -0.55 } as const;
   export const xrDebugPanelSizeMeters = { width: 0.36, height: 0.18 } as const;
   export const xrDebugPanelCanvasPixels = { width: 1024, height: 512 } as const;
   export const xrDebugPanelMaxLines = 14;
   export const xrDebugPanelMaxLineChars = 64;
   export const xrDebugPanelMinRedrawIntervalMs = 250;   // at most 4 redraws per second
   export const xrDebugPanelRenderOrder = 1100;          // above the palette (1000-1010) and tooltip (960)

   /** Splits each line at " / " so no line exceeds maxChars; a part without separator longer than maxChars is cut
    *  to maxChars. If the result has more than maxLines lines, keeps maxLines - 1 and appends "... (+K lines)". */
   export function wrapXrDebugPanelLines(lines: readonly string[], maxChars?: number, maxLines?: number): readonly string[];
   /** World pose of the panel: head.position + offset rotated by head.quaternion; quaternion = head.quaternion. */
   export function resolveXrDebugPanelPose(head: XrHeadWorldPose): { position: THREE.Vector3; quaternion: THREE.Quaternion };
   /** xrActive && debugEnabled && debugOverlayEnabled. The palette's open state is deliberately not an input. */
   export function isXrDebugPanelVisible(input: { xrActive: boolean; debugEnabled: boolean; debugOverlayEnabled: boolean }): boolean;
   /** Redraw gate: shouldRedraw(text, nowMs) is true iff text differs from the last drawn text and either nothing was
    *  drawn yet or nowMs - lastDrawnMs >= minIntervalMs; when true it records text and nowMs. */
   export function createXrDebugPanelRedrawGate(minIntervalMs?: number): { shouldRedraw(text: string, nowMs: number): boolean };
   /** "none" (no sources), "controllers", "hands" (every source has .hand), or "hybrid". */
   export function describeXrInputMode(sources: readonly { readonly hand?: unknown }[]): "none" | "controllers" | "hands" | "hybrid";
   export interface XrDebugPanel {
     readonly object: THREE.Object3D;
     update(input: { visible: boolean; state: DebugOverlayState; head: XrHeadWorldPose | undefined; nowMs: number }): void;
     dispose(): void;
   }
   export function createXrDebugPanel(): XrDebugPanel;
   ```

   `createXrDebugPanel` creates the canvas, a `CanvasTexture` (`colorSpace = SRGBColorSpace`), a `MeshBasicMaterial`
   (`transparent: true, depthTest: false, depthWrite: false, toneMapped: false`), and a mesh named `xr-debug-panel`
   with `renderOrder = xrDebugPanelRenderOrder`, `frustumCulled = false`, `visible = false`. `update`: if `!visible`
   or `head` is undefined or the wrapped lines are empty, hide the mesh and return. Otherwise set the pose from
   `resolveXrDebugPanelPose(head)` every call, and redraw the canvas only when the gate says so (text = wrapped lines
   joined by `\n`). Drawing: clear; fill a rounded rectangle (`roundRect` from `canvasDrawing.ts`) with
   `rgba(10, 17, 20, 0.78)`; text `#e2f3f5`, font `24px ui-monospace, Menlo, Consolas, monospace`, left-aligned,
   `textBaseline = "top"`, 20 px padding, 30 px line height; then `texture.needsUpdate = true`. `dispose` frees
   geometry, material and texture.
8. **Content.** Decided: the panel shows exactly the lines of the desktop overlay, from one shared function. Extract
   `export function formatDebugOverlayLines(state: DebugOverlayState): readonly string[]` from `createDebugOverlay`
   (same sections, same order: fps, frame ms, webgl, visible paths, portal eyes when more than one eye, portal
   instances, archetypes, location, geometry, inspected path). `createDebugOverlay` uses it; its DOM output must not
   change. The `location` line carries cell id, position, yaw, XR session status, blocked reason, input mode and visible
   path count, so these appear in the headset. Which sections appear is decided by the existing per-item toggles
   (`fps`, `location`, `portal-quantities`) in `portalDebugRuntime`; do not add a second gating.
   **Stereo counts:** do not add them here. Job 23 adds `DebugOverlayState.stereoPortalPaths`
   (`StereoPortalPathRenderState`: `splitRoots`, `leftRootCellId`, `rightRootCellId`, `leftPathCount`,
   `rightPathCount`, `unionPathCount`, `leftOnlyPathCount`, `rightOnlyPathCount`, `bothEyesPathCount`,
   `droppedLeftPathCount`, `droppedRightPathCount`) and a line from `formatStereoPortalPathLine`, inserted by
   `formatDebugOverlayLines` right after the portal-eyes line. The panel then shows it with no change here.
9. **State source.** Decided: `PortalDebugRuntime.updateVisiblePortalPaths()` returns the `DebugOverlayState` it built
   (return type `DebugOverlayState` instead of `void`), and still updates the DOM overlay. `createThreeApp.ts` passes
   that object to the panel.
10. **Input mode.** Decided: `syncXrDebugState` sets `inputMode: describeXrInputMode([...session.inputSources])` while
    `renderer.xr.isPresenting` (the session is `renderer.xr.getSession()`), else leaves it undefined.
11. **Head pose.** Decided: in the `"ui"` phase call `resolveXrHeadWorldPose(xrViewerPose)` again right before updating
    the panel (the value computed at line 1385 predates the second `xrRig.syncXrRig` at line 1493; a stale pose makes
    a head-locked panel shake while walking). The result aliases scratch vectors; use it immediately.
12. **Commits.** One commit per part: Part A, Part B.

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck`.

### Part A: XR input defects

1. **Carry (Decision 1).** Edit `xrControls.ts`. Replace the test "does not map face buttons to carry shortcuts"
   (`tests/render-contract/xrControls.test.ts:173-186`; record under `### Deviations`) with
   "maps button 4 to carry edges":
   - gamepad with only button 4 pressed: `isCarryActionPressed` is true for `handedness: "right"` and for `"left"`;
   - only button 1 pressed: false; only button 5 pressed: false; no gamepad: false;
   - `createXrControls().consumeFrame`: released -> false, pressed -> true, held -> false, released -> false;
   - `createXrInputFrame([pressed], 1).carryActionRequested` is true.
   Run `npx vitest run tests/render-contract/xrControls.test.ts`.
2. **Menu toggle and cache (Decisions 2-3).** Edit `xrScenePaletteInput.ts` (update the module header). In
   `tests/render-contract/xrScenePaletteInput.test.ts` test 1, remove the two `isMenuTogglePressed` assertions and keep
   the `isSelectPressed` one (record under `### Deviations`); keep test 2 as is. Add test 3: two inputs from
   `createXrScenePaletteInput()` updated with the same right-hand source give pointer objects that are **not** the same
   object; after `a.reset()`, `b.update(...)` returns the same object as its previous update. Run
   `npx vitest run tests/render-contract/xrScenePaletteInput.test.ts`.
3. **Geometry-computer target (Decision 4).** Run `npx vitest run tests/render-contract/scenePaletteLibraryAdapter.test.ts tests/render-contract/vrPaletteHeaderActions.test.ts`.
4. **Legacy keys (Decision 5).** Then Grep `src` and `tests` for `xrPaletteItemId|xrPaletteAction`: no hits. Run
   `npx vitest run tests/render-contract/scenePointers.test.ts tests/render-contract/scenePaletteLibraryAdapter.test.ts tests/render-contract/scenePaletteTooltip.test.ts tests/render-contract/vrPaletteHeaderActions.test.ts`.
5. Finish the part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale),
   `npm run build`, `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Commit Part A.

### Part B: in-headset debug panel

1. **Shared formatter (Decision 8).** Add `formatDebugOverlayLines` to `debugOverlay.ts`; make `createDebugOverlay`
   use it (keep its `hasContent` rule unchanged). New tests in `tests/render-contract/debugOverlay.test.ts`:
   - a state with `location` and `portalEyes` of two eyes gives, in order, the portal-eyes line then the location line;
     the location line equals `formatLocationLine(state.location)`;
   - with one eye the portal-eyes line is absent;
   - `visible: false` does not change the returned lines (visibility is not the formatter's business).
2. **Return the state (Decision 9).** Change `updateVisiblePortalPaths` in `portalDebugRuntime.ts`. Typecheck.
3. **Panel module (Decision 7).** Create `xrDebugPanel.ts`. New `tests/render-contract/xrDebugPanel.test.ts`:
   - `wrapXrDebugPanelLines(["aaaa / bbbb / cccc"], 11)` returns `["aaaa / bbbb", "cccc"]`; a 70-character line with
     no separator becomes one line of exactly 64 characters; 20 one-word lines with `maxLines` 14 give 14 lines, the
     last `... (+7 lines)`;
   - `resolveXrDebugPanelPose`: head at (1, 1.6, 2), identity quaternion -> position (0.83, 1.7, 1.45), quaternion
     identity; head at the same place turned by +pi/2 about +y (`setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)`)
     -> position (0.45, 1.7, 2.17) and quaternion equal to the head's; all within 1e-9;
   - `isXrDebugPanelVisible`: true only when all three inputs are true (check all 8 combinations);
   - redraw gate with interval 250: `("a", 0)` true, `("a", 100)` false, `("b", 100)` false, `("b", 260)` true,
     `("b", 600)` false, `("c", 600)` true;
   - `describeXrInputMode`: `[]` -> `"none"`; two `{}` -> `"controllers"`; two `{ hand: {} }` -> `"hands"`; one of
     each -> `"hybrid"`.
   Run `npx vitest run tests/render-contract/xrDebugPanel.test.ts tests/render-contract/debugOverlay.test.ts`.
4. **Input mode (Decision 10).** Edit `syncXrDebugState`.
5. **Wire it in `createThreeApp.ts`.**
   - Create `const xrDebugPanel = createXrDebugPanel(); scene.add(xrDebugPanel.object);` right after the
     `createXrObjectTooltipController(...)` line. Declare it **before** any setup code that could read it (the job 17
     temporal-dead-zone crash came from a late `const`); the smoke run checks this.
   - In the `"ui"` phase replace `portalDebugRuntime.updateVisiblePortalPaths();` with:

     ```ts
     const overlayState = portalDebugRuntime.updateVisiblePortalPaths();
     xrDebugPanel.update({
       visible: isXrDebugPanelVisible({
         xrActive,
         debugEnabled: menuState.debugEnabled,
         debugOverlayEnabled: menuState.debugOverlayEnabled,
       }),
       state: overlayState,
       head: xrActive ? resolveXrHeadWorldPose(xrViewerPose) : undefined,
       nowMs: performance.now(),
     });
     ```

   - In the dispose block next to `debugOverlay.dispose()`: `scene.remove(xrDebugPanel.object); xrDebugPanel.dispose();`.
6. **Docs.** `_docs/design/011-vr-hand-tools-palette.md`: in "Debug Overlay", one paragraph saying it is implemented in
   `xrDebugPanel.ts` (placement, visibility rule, 4 Hz redraw); in the status note at the top (line 6) remove
   `xrDebugPanel` from the list of files that do not exist. `_docs/design/010-webxr-vr-runtime.md` "Debug And
   Diagnostics": one sentence pointing to the panel, and the XR button map of Background (with A/X = carry).
7. Finish the part: `npm run typecheck`, `npm test`, `npm run docs:check` (`npm run docs:generate` if stale),
   `npm run build`, `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. Commit Part B.

## Tests and checks

All tests named in the steps, plus `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run build` and the
smoke command, after each part.

Manual headset checks (Quest or similar, `?config=full` and debug mode on). If you have no headset, list them under
`### Manual checks not run` in the report. **Not running them does not make this job "needs review"**: with empty
`### Uncertain` and `### Not done`, set `Status: done on <date>.`

1. Enter VR: the palette is closed.
2. Side trigger on the left controller with nothing aimed opens the palette; again closes it. Same on the right.
3. Ray hover highlights a button; trigger selects it; settings -> back -> close work; the hands track both controllers.
4. Debug settings page: turn "UI overlay" on. The panel appears in the upper left. Close the palette: the panel stays.
   Turn the overlay off: the panel disappears.
5. The panel text is readable, updates (fps changes) without flicker, and does not shake while walking and turning.
6. Aim at a geodesic emitter and press A: carry starts; press A again: it is dropped.
7. With the palette closed, stick locomotion, turning and stick-press reset still work.

## Do not

- Do not change the button of any existing XR action, or desktop controls.
- Do not render the panel through `@pmndrs/uikit` or the DOM, and do not add `dom-overlay` to the session request.
- Do not add stereo counts or change `DebugOverlayState` beyond what Decision 8 says (job 23 does that).
- Do not touch the portal pass, `portalClipData.ts` or `renderPortalInstances.ts`.
- Do not fix the XR hint "Y = next focus target" in `src/ui/inputIntents.ts` (no XR button cycles focus; button 5 on
  either controller is help). Write it under `### Not done` as a follow-up.

## Done when

- Button 4 requests carry in XR; the dead toggle code, the module-level cache, the unused geometry-computer option and
  every `xrPalette*` userData key are gone.
- `xrDebugPanel.ts` exists with the tests above; in XR the panel follows the visibility rule independent of the
  palette, and shows the lines of `formatDebugOverlayLines`.
- Typecheck, tests, docs check, build and smoke pass after each part; two commits (Part A, Part B).
- Report written per [README](README.md), with `### Manual checks not run` when no headset was used. Move the job to
  `_done/` and mark its queue row.

## Report

### Done
Part A (1af5ddd): `xrControls.ts` binds button 4 to carry (`carryFaceButtonIndex`, `isCarryActionPressed` reads it; header and `XrControls` doc updated). `xrScenePaletteInput.ts`: the controller cache is now per instance, `createControllerSources` is non-exported and takes the cache, the dead `menuTogglePressed` computation and `isMenuTogglePressed` are removed, and the file keeps `menuTogglePressed: false` with a comment naming `openContextMenuFromAim`. `onGeometryComputerSetTargetRequested` is deleted from the adapter options, the controller options and pass-through, and the `createThreeApp.ts` handler. The now-unused `setGeometryComputerPendingTarget` destructure in `createThreeApp.ts` is removed, and the function stays in `geometryComputerMenu.ts`. All 22 `userData.xrPaletteItemId` and `xrPaletteAction` writes and the fallback reads in `scenePaletteController.ts` and `scenePointers.ts` are gone, and the comments are fixed. Grep finds no `xrPalette*` hits outside the markdown notes. Tests: "maps button 4 to carry edges" and a new per-instance cache test.

Part B (31e3557): `formatDebugOverlayLines` is extracted in `debugOverlay.ts` and used by `createDebugOverlay`. `PortalDebugRuntime.updateVisiblePortalPaths()` now returns the `DebugOverlayState`. New `src/render/three/xrDebugPanel.ts` follows Decision 7. It is created next to the tooltip controller, updated in the `"ui"` phase with a freshly resolved head pose, and disposed next to `debugOverlay.dispose()`. `syncXrDebugState` sets `inputMode` via `describeXrInputMode` while presenting. New tests `tests/render-contract/xrDebugPanel.test.ts` and `tests/render-contract/debugOverlay.test.ts`. Docs updated in `010-webxr-vr-runtime.md` and `011-vr-hand-tools-palette.md`; `docs:generate` was run for both parts.

### Deviations
- Replaced the test "does not map face buttons to carry shortcuts" with "maps button 4 to carry edges" (Step A1).
- In `xrScenePaletteInput.test.ts` test 1, removed the two `isMenuTogglePressed` assertions and the face-button block (Step A2).
- `tests/render-contract/debugOverlay.test.ts` did not exist, so it was created.
- Step A3 and the Part A line-number references in the job were stale; I searched by name.

### Uncertain
- Wrapping packs parts greedily with " / " up to `maxChars`. The job's examples pass, but whether the headset text looks right is unverified.
- The stereo path-count line (job 23) is not present; job 23 has not landed. The panel picks it up through the shared formatter.

### Not done
- XR hint "Y = next focus target" in `src/ui/inputIntents.ts` is wrong (no XR button cycles focus; button 5 is help). Follow-up only, per the job.

### Manual checks not run
No headset was available. In a Quest browser with `?config=full` and debug mode on, run the job's checks 1-7:
1. Enter VR with the palette closed.
2. Press the side trigger on each controller with nothing aimed to open the palette; press it again to close it.
3. Hover, select, settings -> back -> close, and hand tracking.
4. In Debug settings, turn "UI overlay" on: the panel appears in the upper left. Close the palette: the panel stays. Turn the overlay off: it disappears.
5. The text is readable, updates (fps) without flicker, and does not shake while walking or turning.
6. Aim at a geodesic emitter and press A (X on the left): carry starts; press again: it drops.
7. With the palette closed, stick locomotion, turning and stick-press reset still work.

### Checks
Baseline typecheck and tests were green. After each part: `npm run typecheck` ok; `npm test` ok (Part B: 142 files passed, 1031 tests, 1 skipped); `npm run docs:check` ok after `npm run docs:generate` (stale generated docs were regenerated after each part); `npm run build` ok; `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus` gave SMOKE OK (4 pages) on the first run both times.