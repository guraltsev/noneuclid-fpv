# 77 - Give the application shell one state holder and one command path

Status: open as of 2026-10-08.

Priority: P2 (architecture). Refines the `createThreeApp` part of issue 38 ("introduce an explicit shared-state holder
instead of more getter/setter pairs") into a concrete design.

## Summary

There is no single source of truth for mutable app state and no consistent command model. `createThreeApp` keeps ~30
`let` variables, reassigns `menuState` in 38 places, and hands 25 getter/setter closures plus ~45 `on*` callbacks to
factories. `RuntimeCommand` exists but covers 4 actions, of which 2 are dispatched. `AppState` carries a dead field. Mono
and stereo portal rendering are two near-copies. The VR palette adapter is one 2,000-line file.

## Evidence

- Mutable state in the closure: `src/render/three/createThreeApp.ts:438-481`, `:813-881` (`playerPose`, `menuState`,
  `debugLevel`, `debugOptions`, tool states, id counters `placedFlagIdCounter` :813, `latestVisibleResult` :853, ...).
- `menuState = ...` occurs 38 times in `createThreeApp.ts` (e.g. :535, :567, :663, :913, :1032, :2063-2097, :2818-2923);
  palette callbacks at :562-765 are ~200 lines of inline `on*` handlers each doing its own state transition.
- Getter/setter deps: `createThreeApp.ts:564-565`, `:895-913` (`getMenuState`/`setMenuState`-style pairs passed to
  `portalDebugRuntime`, `aimInteraction`, `geodesicCannonTools`, ...).
- `src/runtime/runtimeCommands.ts:8-12` defines 4 kinds; only `go-home` (`createThreeApp.ts:605`) and `reload-world`
  (`:2909`) are dispatched; `dispatchRuntimeCommand` (:3495) is a one-line wrapper.
- `src/appState.ts:18` `selectedTool: "none" | "straight-ray" | "marker"` names tools that no longer exist and is never
  read; `RuntimeMenuState.selectedTool` is the real one.
- Startup computes the static cull on the main thread (`createThreeApp.ts:771`) although a worker exists for exactly that
  (`src/runtime/worldGeometryWorkerClient.ts:72`).
- Mono vs stereo duplication: `syncPortalInstanceRender` (:2269-2339) and `syncStereoPortalInstanceRender` (:2340-2462)
  repeat the empty-table reset block verbatim; mono is the 1-eye case. The mono default parameter allocates a
  `THREE.Matrix4` per call (:2274).
- `src/render/three/vrPaletteLibraryAdapter.ts` (2,035 lines) mixes page builders (:436-1700), a lattice diagram widget
  (:799-1008), ~15 icon factories (:1403-1620), generic widgets (:1747-2000) and disposal (:2021-2035); it exports
  `ScenePaletteLibraryAdapter` as an alias of `VrPaletteLibraryAdapter` (:103-107) though it serves desktop too.

## Proposed change

1. **`src/runtime/appSession.ts`**: a plain object `AppSessionState { playerPose, menuState, toolStates, debug,
   idCounters, xr }` plus `createAppSession(initial)` returning `{ get(): AppSessionState; update(fn) }`. Factories receive
   the session instead of getter/setter pairs. No events, no framework (per `docs/coding_style.md`).
2. **Widen `RuntimeCommand`** to every UI-originated action (select tool, open page, select world/config, toggle debug
   option, sign editing, geodesic-cannon menu actions). `scenePaletteController` callbacks become
   `dispatch({ kind: ... })`. `appCommandDispatcher.ts` grows into `applyRuntimeCommand(session, command)`, a pure
   menu-state reducer for menu commands and an effect list for the rest. Test it in `tests/runtime/` without Three.js.
3. Delete `AppState.selectedTool`; consider folding `AppState` into `AppSessionState` seed.
4. Replace the two portal sync functions with one `syncPortalInstances(renderRoots: readonly XrPortalEyeRenderRoot[])`
   in a new `render/three/portalFrameRender.ts`; mono passes a one-element array built from a reused root.
5. Take the startup static cull from the geometry worker (first snapshot), show the existing loading status meanwhile.
6. Split `vrPaletteLibraryAdapter.ts` into `palette/pages/*.ts` (main, geodesicActions, geometryComputer, help, signs,
   debugSettings), `palette/latticeDiagram.ts`, `palette/icons.ts`, `palette/widgets.ts`; rename the type to
   `ScenePaletteAdapter` and drop the alias.

## Acceptance criteria

- `grep -c "menuState = " src/render/three/createThreeApp.ts` is 0; menu transitions happen only in the reducer.
- No factory `deps` interface contains `get*`/`set*` pairs for shell state; they take the session.
- Every palette action is a `RuntimeCommand` variant with a reducer test.
- One portal-instance sync function; `createThreeApp.ts` < 1,500 lines.
- No main-thread `buildStaticallyCulledPortalPathTables` call during startup.
