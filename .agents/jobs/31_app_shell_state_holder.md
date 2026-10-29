# Job 31 - One state holder and one command path for the app shell

Status: queued.
Former issue: 77 (converted to a job on 2026-10-28).

Priority: P2 (architecture). Refines the `createThreeApp` part of issue 38 ("introduce an explicit shared-state holder
instead of more getter/setter pairs") into a concrete design.

## Status update 2026-10-28

Nothing in this issue has been implemented. Re-checked against the current code; line numbers and counts in the
evidence below are updated (`createThreeApp.ts` is now 3,555 lines).

Done:
- One small step toward item 6: `src/render/three/scenePaletteLibraryAdapter.ts` (10 lines) is now the public entry
  point that re-exports the adapter under the `ScenePalette*` names, so consumers no longer import the
  `vrPaletteLibraryAdapter.ts` file directly. The implementation is still one 2,035-line file and the aliases remain.

Remains:
- No `src/runtime/appSession.ts`; `createThreeApp` has 35 `let` declarations and 39 `menuState = ` assignments.
- `RuntimeCommand` still has 4 kinds (`src/runtime/runtimeCommands.ts:8-12`); only `go-home` (`createThreeApp.ts:609`)
  and `reload-world` (`:2966`) are dispatched.
- `AppState.selectedTool` (`src/appState.ts:18`) is still present and unread.
- Startup still calls `buildStaticallyCulledPortalPathTables` on the main thread (`createThreeApp.ts:775`).
- Mono and stereo portal sync are still two functions (`:2326-2393`, `:2397-2518`); no `portalFrameRender.ts`.

## Summary

There is no single source of truth for mutable app state and no consistent command model. `createThreeApp` keeps ~30
`let` variables, reassigns `menuState` in 38 places, and hands 25 getter/setter closures plus ~45 `on*` callbacks to
factories. `RuntimeCommand` exists but covers 4 actions, of which 2 are dispatched. `AppState` carries a dead field. Mono
and stereo portal rendering are two near-copies. The VR palette adapter is one 2,000-line file.

## Evidence

- Mutable state in the closure: `src/render/three/createThreeApp.ts:438-485`, `:784-885` (`playerPose`, `menuState`,
  `debugLevel`, `debugOptions`, tool states, id counters `placedFlagIdCounter` :817, `latestVisibleResult` :857, ...).
- `menuState = ...` occurs 39 times in `createThreeApp.ts` (e.g. :539, :571, :667, :917, :1036, :2120-2154, :2875-3235);
  palette callbacks at :566-755 are ~200 lines of inline `on*` handlers each doing its own state transition.
- Getter/setter deps: `createThreeApp.ts:900`, `:915-917`, `:1002`, `:1034-1036` (`getMenuState`/`setMenuState`-style pairs passed to
  `portalDebugRuntime`, `aimInteraction`, `geodesicCannonTools`, ...).
- `src/runtime/runtimeCommands.ts:8-12` defines 4 kinds; only `go-home` (`createThreeApp.ts:609`) and `reload-world`
  (`:2966`) are dispatched; `dispatchRuntimeCommand` (:3552) is a one-line wrapper.
- `src/appState.ts:18` `selectedTool: "none" | "straight-ray" | "marker"` names tools that no longer exist and is never
  read; `RuntimeMenuState.selectedTool` is the real one.
- Startup computes the static cull on the main thread (`createThreeApp.ts:775`) although a worker exists for exactly that
  (`src/runtime/worldGeometryWorkerClient.ts:72`).
- Mono vs stereo duplication: `syncPortalInstanceRender` (:2326-2393) and `syncStereoPortalInstanceRender` (:2397-2518)
  repeat the empty-table reset block verbatim; mono is the 1-eye case. The mono default parameter allocates a
  `THREE.Matrix4` per call (:2330).
- `src/render/three/vrPaletteLibraryAdapter.ts` (2,035 lines) mixes page builders (:436-1700), a lattice diagram widget
  (:799-1008), ~15 icon factories (:1403-1620), generic widgets (:1747-2000) and disposal (:2021-2035); it exports
  `ScenePaletteLibraryAdapter` as an alias of `VrPaletteLibraryAdapter` (:103-107, :205) though it serves desktop too; `scenePaletteLibraryAdapter.ts`
  re-exports those aliases.

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
