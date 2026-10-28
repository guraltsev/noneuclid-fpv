# 18 - Stage 08: WebXR VR controls

## Goal

Add WebXR entry and VR controller support while keeping desktop fallback intact.

The VR version should let students explore the same compiled cell complex and use the same tool contracts.

## Files to create

```text
src/render/three/xrControls.ts
src/render/three/xrSessionState.ts
src/render/three/vrComfort.ts
src/render/three/controllerRays.ts
tests/render-contract/xrSessionState.test.ts
```

## WebXR entry

Use Three.js WebXR support.

The app should expose an obvious Enter VR button when WebXR is available and a clear fallback message when it is not.

The app should still run in desktop mode without XR.

## Controller behavior

First pass:

- one controller points,
- trigger fires straight ray,
- thumbstick or simple input moves/turns if supported,
- reset remains easy to access.

Do not make controller logic responsible for tool algorithms. It only creates tool requests.

## Comfort defaults

Use conservative comfort defaults:

- moderate movement speed,
- continuous controller turning,
- no jump,
- no forced camera animation,
- stable horizon,
- reset button.

## Portal crossing in VR

Portal crossing should use the same `movePlayer` contract as desktop.

Do not implement a separate VR movement model unless testing proves it is needed.

## Debug behavior

In VR, debug text should be optional and unobtrusive.

Keep a desktop mirror/debug overlay if possible.

## Secure context

WebXR commonly requires secure contexts. The app should show a readable message when the page is not in a secure context.

GitHub Pages hosting should be the default remote testing path.

## Tests to write

Automated tests may be limited.

Required contract tests:

- XR session state can report unavailable, available, entering, active, and ended states,
- controller input events map to movement/tool requests without invoking renderer internals.

Manual checks:

- GitHub Pages build loads,
- headset can open the page,
- Enter VR appears when supported,
- controller ray is visible,
- trigger fires straight ray,
- movement and portal crossing work,
- reset works.

## Exit criteria

A student can explore a small world in VR and desktop fallback remains usable.

## Do not do in this stage

Do not add multiplayer.

Do not add headset-specific native code.

Do not remove desktop controls.
