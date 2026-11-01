# A hidden debug window stalls the app and the inspection

If the Edge window opened by `npm run edge` is minimised, covered or on another desktop, the page is `document.visibilityState === "hidden"`: `requestAnimationFrame` never fires. Symptoms:
a page that stays on "Loading world description" (the boot awaits an animation frame, nothing is wrong with the code or the dev server), an `api` that only has `app`, and `render.*` data
that is from a frame before your last `debug.setPlayerPose`. Check with `document.visibilityState` and a rAF count.

Fix without raising the window or stealing focus: after attaching, send `Emulation.setFocusEmulationEnabled { enabled: true }` on the CDP session (`session.send` in `scripts/lib/cdpClient.mjs`);
the page then reports visible and runs at the display rate. It lasts only while that session is attached, so every driver script sends it first. `Page.bringToFront` also works but takes the user's screen.
After `debug.setPlayerPose`, wait a few frames (`render.*` reads the last synced frame) before reading or taking a screenshot; read everything in one `evaluate` so it is one frame.
