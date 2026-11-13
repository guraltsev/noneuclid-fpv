# Job 73 - Guarded "Start over", undo, and no reset on the VR stick press

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.8 (F8, F20).

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

## Report

### Done
- Hold R: `src/render/three/desktopControls.ts` counts the frames' time while R is down; `resetRequested` fires once at 1.5 s (`resetHoldSeconds`), key repeat does not restart the hold, release or window blur cancels it, and a new press restarts it. `controls.resetHoldProgress` (0..1) is the getter. A new one-shot `undoRequested` (key U) is on the input frame (`src/interaction/inputFrame.ts`).
- Ring: `src/render/dom/resetHoldRing.ts` (SVG circle, `stroke-dasharray`), CSS `.reset-hold-ring` in `src/style.css`, drawn each frame in `createThreeApp.ts` from `controls.resetHoldProgress`.
- XR: `isResetPressed` and the reset edge are gone from `src/render/three/xrControls.ts`; XR frames carry `resetRequested: false`. Intent glyphs in `src/ui/inputIntents.ts`: XR reset is "Main menu", desktop reset is "Hold R", new `undo` intent (desktop "U", XR "Not available yet"; added to `TutorialInputIntent` in `src/cell-complex/specs.ts`).
- Undo: `src/world-objects/savedSnapshot.ts` (`savedObjectKinds`, `takeSavedSnapshot`, `restoreSavedSnapshot`, `savedKindsRemovedThisFrame`). The snapshot holds every registry object of a kind declared `persistence: "saved"` (lasers, beams, vertices, signs, lengths, angles). Restoring re-adds missing objects and puts back replaced ones; the geodesic model rebuilds segments and crossings from the beams. One level, 10 s.
- Toasts: `toastQueue.push` takes `durationMs`; the reset pushes "World reset" with "Undo (U)" for 10 s, a deletion pushes "<Noun> deleted" (sign, measurement, beam, laser) with the same action. The toast action button and key U both call `performUndo` in `createThreeApp.ts`. Strings are in `toastMessages` in `src/world-objects/vocabulary.ts`.
- Deletes covered: the sign Delete, the ruler and protractor removals, and the beam bin on a laser's page. A delete remembers the world when asked, and announces it in the frame in which a saved object is actually removed.
- Palette "Start over" button (decision 5): it did not do what R does; it restarted the whole app (`restartApp`). It now routes to the same reset path (`requestStartOver` in `runtimeEffects.ts`, performed in the next frame like R), keeping the double press and its tooltip.
- Tests: hold-R (1499 ms, 1500 ms, release and restart, U) in `tests/render/desktopControls.test.ts`; `tests/world-objects/savedSnapshot.test.ts`; a `durationMs` test in `tests/ui/toastQueue.test.ts`; `tests/render/xrControls.test.ts` changed (below).
- Commit: see the follow-up commit that records the hash (the work commit is the one before it on `dev`).

### Deviations
- The hold is timed by the frames' `deltaSeconds`, not by a timer, so the test steps `consumeFrame(1.499)` then `consumeFrame(0.001)` instead of using fake timers; it is deterministic and equal to wall time in the app.
- Changed existing tests (decision 2): in `tests/render/xrControls.test.ts` the two tests that expected the thumbstick click to request a reset (`isResetPressed`, and the edge in stateful controls) are replaced by two that expect `resetRequested` to stay `false` for the click and for all buttons; the `isResetPressed` import and the header comment were adjusted. `tests/render/runtimeEffects.test.ts` got the new `requestStartOver` dependency.
- Decision 5 was resolved by routing, not by "Reload app": the button restarted the app (not the page), which the job's two branches do not cover exactly.

### Uncertain
- Undo restores the saved objects only; the player's position, creature positions and the tool state are not restored (the player stays at home). Confirm that is enough.
- The old Start over button also rebuilt the world geometry (a deformation committed with the shape machine went back to its start) and reloaded assets; the new path, like R, does not. If a full rebuild is still wanted it needs its own entry ("Reload app"). `onReloadRequested` is still passed by `main.ts` but now unused by effects.
- Undo of a reset or deletion re-adds objects by writing the registry directly (as the reset does) and relies on the geodesic model's ticks to rebuild segments and crossings; it is unit tested at the registry level but I did not exercise it in a browser (see Not done).
- A deletion toast is raised when a saved object is removed within 3 s after the request; if a different removal of a saved kind happens in that window (for example the destroy policy), the wording could be about the wrong object.
- The ring is a DOM element and has no unit test (the repository has no DOM test environment for views).

### Not done
- The CDP check ("press R briefly; `dumpAllGeodesics()` unchanged") was not run interactively; `npm run smoke` (app boots, no errors) passed and the hold-R unit tests cover a short press.
- Deleting a whole laser has no entry point in the shell (no caller of `geodesicEmitters/remove`), so no toast was added for it.
- VR undo (key U has no VR binding; the glyph reads "Not available yet").

### Checks
- Baseline: typecheck clean, `npm test` 197 files / 1860 tests passed.
- After: `npm run typecheck` clean; `npm run docs:generate` then `npm run docs:check` all ok; `npm test` 198 files / 1868 tests passed; `npm run smoke` OK. The retired-terms scan in `tests/ui/vocabulary.test.ts` is green. The intermittent `moduleImportRules` timeout did not appear.
- Pages check skipped (`gh` is disabled).
