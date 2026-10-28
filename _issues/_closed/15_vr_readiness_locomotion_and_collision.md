# 15 - VR readiness for locomotion and collision

Status: closed on 2026-08-03.

## Outcome

Closed as duplicated and superseded by issue 17. The XR session, player rig,
physical-motion, joystick-locomotion, reset, and shared movement/collision paths
were implemented under the broader Stage 08 work. Headset regression evidence
remains a closing condition of issue 17 rather than a reason to keep this
duplicate blueprint open.

## Closing evidence

The repository audit at `09dafe7` found the implementation and corresponding
XR/VR render-contract tests. Node/npm were unavailable in the audit environment,
so the test suite was not rerun as part of this documentation-only closure.

## Goal

Make the current world explorable in VR with WebXR while keeping the first scope narrow:

- headset entry works,
- physical spatial motion works,
- joystick locomotion works,
- collision and portal crossing remain reliable,
- desktop fallback still works.

This issue is about movement readiness, not full embodied interaction.

## Scope boundary

For now, VR support should limit itself to locomotion and collision detection.

Specifically in scope:

- entering and exiting VR,
- syncing the camera to headset pose,
- allowing player movement from controller joystick input,
- allowing ordinary room-scale physical motion inside the tracked play space,
- resolving movement through the existing compiled movement and collision rules,
- keeping portal crossing behavior consistent with desktop.

Explicitly out of scope for this issue:

- hand tracking,
- grabbing, pushing, or touching objects,
- gesture systems,
- controller-based object manipulation,
- tool firing,
- ray-based classroom tools,
- UI panels floating in 3D space beyond a minimal entry/reset path.

## Motivation

The movement pipeline is already meaningful on desktop. The next practical question is whether the same compiled cell complex can be explored comfortably in a headset without inventing a separate VR physics model.

The important success condition is not “full VR interactivity.” The important success condition is that a student can put on a headset, move around naturally, use joystick locomotion when needed, collide with walls correctly, and cross portals without breaking the world rules.

## Input model

Use two movement sources:

- physical spatial motion from the headset and tracked play area,
- artificial locomotion from the right joystick.

For this issue, the right joystick is the controller locomotion input.

The implementation should treat these as different input sources feeding the same runtime pose contract:

- physical motion updates the viewer pose relative to the tracked origin,
- joystick locomotion requests movement through the same collision and portal-crossing pipeline used on desktop.

Do not make hand/controller transforms part of the world interaction model yet.

## Movement and collision rules

VR movement should continue to use the existing world rules:

- walls remain solid,
- floor and ceiling remain barriers,
- portal traversal uses compiled portal transforms,
- forbidden zones near portal junctions remain forbidden,
- leaving the authored world except through a valid portal remains impossible.

Do not introduce a second collision system only for VR.

If a headset or joystick move would place the player in an invalid position, the same movement logic should clamp, reject, or portal-cross it according to the current movement contracts.

## Comfort expectations

Keep the first pass conservative and boring:

- moderate locomotion speed,
- no jumping,
- no forced camera bob,
- no sudden scripted camera animations,
- easy reset to spawn,
- stable horizon.

Snap turning may be added if needed, but it is not the primary goal of this issue. Reliable translation and collision matter more than broader comfort customization in this first pass.

## WebXR entry and fallback

Use Three.js WebXR support.

Required behavior:

- show a clear `Enter VR` path when XR is available,
- show a readable fallback state when XR is unavailable,
- remain usable on desktop without XR,
- report when secure-context requirements block XR startup.

GitHub Pages or another HTTPS-hosted build should be the normal remote test target.

## Suggested files

```text
src/render/three/xrControls.ts
src/render/three/xrSessionState.ts
src/render/three/vrLocomotion.ts
src/render/three/vrPlayerRig.ts
tests/render-contract/xrSessionState.test.ts
tests/render-contract/vrLocomotion.test.ts
```

The exact file split may vary, but keep XR session state, locomotion mapping, and player-rig behavior separate enough to test without a live headset.

## Implementation direction

### 1. Session state

Add a small XR session state model that can represent:

- unavailable,
- available,
- entering,
- active,
- ended,
- failed.

The app should be able to render readable desktop messaging from that state without depending on headset-only behavior.

### 2. VR rig integration

Add a VR player rig that:

- follows WebXR headset pose for physical movement,
- keeps the rendered camera aligned with the tracked head,
- still maps back to the existing app/player pose model.

Keep the rig concept renderer-local. Do not leak Three.js-specific data structures into domain movement code.

### 3. Joystick locomotion

Map the right joystick to locomotion requests.

The locomotion layer should:

- read joystick axes,
- convert them into intended local movement deltas,
- call the existing movement pipeline,
- preserve portal crossing and collision behavior.

If turning is added in this issue, keep it minimal and clearly separated from translation.

### 4. Reset and recovery

Provide an easy way to reset to spawn from VR.

If tracking drift, boundary issues, or collision edge cases leave the player in a confusing state, reset should recover cleanly without reloading the page.

## Tests to write

Automated tests may stay contract-level rather than headset-emulation-heavy.

Required contract tests:

- XR session state transitions are readable and stable,
- joystick inputs map to locomotion requests without invoking domain logic directly,
- VR locomotion requests still route through the existing movement/collision contract,
- reset returns the player to spawn state cleanly.

Manual checks:

- the page loads over HTTPS,
- `Enter VR` appears when supported,
- entering VR succeeds on a headset,
- physical room-scale movement updates the viewpoint naturally,
- right-joystick locomotion moves the player through the world,
- walls block movement,
- portal crossing still works,
- reset works from inside VR,
- desktop mode still works after the XR changes.

## Acceptance criteria

This issue is complete when:

- a headset user can enter VR from the existing app,
- physical headset motion updates the viewpoint correctly,
- right-joystick locomotion works,
- locomotion respects collision and forbidden-zone rules,
- portal crossing works in VR through the same world logic used on desktop,
- reset works in VR,
- desktop fallback still works,
- XR availability and failure states are readable,
- no hand interaction or object manipulation is required for the feature to be considered complete.

## Non-goals

- Do not add hand tracking.
- Do not add grabbing or physics interaction.
- Do not add controller-based object selection.
- Do not add straight-ray tools in this issue.
- Do not add multiplayer.
- Do not create a VR-only movement/collision engine.
- Do not remove or regress desktop controls.

## Notes for future sessions

Keep this issue centered on “can the student move around the world safely in a headset?”

If a design choice would improve future hand interaction but complicate locomotion readiness now, prefer the simpler locomotion-first implementation. The current target is dependable movement, not a full embodied interaction model.
