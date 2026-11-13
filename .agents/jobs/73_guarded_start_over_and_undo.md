# Job 73 - Guarded "Start over", undo, and no reset on the VR stick press

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.8 (F8, F20).

## Goal

No single key or button wipes the student's work. On desktop, R must be held for 1.5 s; a ring shows the progress.
After a reset, a toast offers undo for 10 s (U). In VR, the stick press no longer resets. Deleting one thing is
announced and the last deletion can be undone.

## Depends on

Job 71 (toasts). Branch `dev`.

## Before you start

- Note K-20261112-0eb0.
- `src/render/three/createThreeApp.ts` around line 1191: `if (frame.resetRequested) { scriptedMotion.cancel(...);
  teleportPlayerHome(); resetRuntimeWorld(); }`, and line ~1305.
- `resetRuntimeWorld` and `teleportPlayerHome` in `src/render/three/runtimeObjectActions.ts` (around lines 212, 257).
  Read what `resetRuntimeWorld` rebuilds and from what.
- `src/render/three/desktopControls.ts` (KeyR sets `resetRequested`) and `src/render/three/xrControls.ts`
  (`isResetPressed`, thumbstick button index 3).
- The engine's object persistence: object kinds declare `persistence: "saved"` or `"rebuilt"` (for example
  `src/modules/geodesicModel/module.ts:69`). Look for an existing save/export of saved objects in `src/engine/`.
- The palette's existing Reload button with its double press (search `reload` in `src/ui/paletteDefinition.ts`).

## Decisions

1. Desktop: R starts a hold; `resetRequested` fires only after R has been held 1500 ms with no release. Releasing early
   cancels. `desktopControls` exposes the hold progress (0..1) on the input frame or a getter; the DOM draws a ring
   around the screen center (a small SVG circle with `stroke-dasharray`) while progress is above 0.
2. XR: `isResetPressed` and the reset edge are removed from `xrControls.ts`; XR frames always carry
   `resetRequested: false`. The input-intent glyph for XR reset becomes "Main menu" (job 77 adds the menu entry).
3. Undo snapshot: before a reset, take a snapshot of every object with `persistence: "saved"` (and whatever else
   `resetRuntimeWorld` discards that the student created). Undo restores it by submitting the engine commands that
   recreate those objects, or by an engine restore call if one exists. If neither is possible without changing the
   engine's core, ship decisions 1, 2 and 5 only, and write under `### Not done` what an undo would need.
4. After a reset, push the toast "World reset" with action "Undo (U)"; `KeyU` within 10 s restores. One level of undo.
5. The palette's Reload button: find out whether it does the same as R. If yes, rename it "Start over" (vocabulary) and
   route it to the same reset path, keeping its double press. If it reloads the page, leave it, renamed "Reload app",
   and record that.
6. Deletes (the bin on beams, Delete on signs and lasers, removing a measurement) push a toast naming what was deleted,
   with "Undo (U)" when decision 3's mechanism can restore that one object; otherwise no action.
7. Add an `undo` intent to `inputIntents.ts` (desktop "U", XR "Not available yet").

## Steps

1. Baseline.
2. Hold-R in `desktopControls.ts` with a unit test using fake timers (pressed 1499 ms → no reset; 1500 ms → one reset;
   release and press again → restarts). Run it.
3. Ring overlay.
4. Remove the XR reset; update `tests/render/xrControls*.test.ts` and record the changed expectations.
5. Snapshot and undo (decision 3), with a test at the level where the snapshot lives.
6. Toasts for reset and delete; Reload (decision 5).
7. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP: press R briefly; the world is unchanged (`noneuclid.api.debug.dumpAllGeodesics()` before and after).

## Do not

- Change `teleportPlayerHome` ("Go home" stays immediate and harmless).

## Done when

A short R press does nothing, a 1.5 s hold resets with a ring and a toast, VR stick press does nothing, undo works or
its absence is reported, checks pass, commit on `dev`, report appended.
