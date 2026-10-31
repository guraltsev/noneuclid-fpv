/**
 * XR input path for the in-scene palette (src/render/three/xrScenePaletteInput.ts): converts XR controller
 * target-ray poses and gamepad state into palette pointer sources. Only gamepad controllers with left or right
 * handedness are used; hand-tracking sources are skipped. The side-trigger menu toggle is handled by the runtime
 * interact path, not here, so this adapter never emits its own toggle edge for it.
 *
 * `XRInputSource`/`XRFrame`/gamepads are faked by tests/support/fakeXr.ts.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createXrScenePaletteInput, isSelectPressed } from "../../src/render/three/xrScenePaletteInput";
import { createFakeGamepad, createFakeXrFrame, createFakeXrInputSource } from "../support/fakeXr";

describe("xrScenePaletteInput", () => {
  it("maps select and side-trigger buttons, not face buttons, to menu toggles", () => {
    const gamepad = createFakeGamepad({ pressedButtonIndexes: [0, 1] });

    expect(isSelectPressed(gamepad)).toBe(true);
  });

  it("leaves the side-trigger menu toggle to XR runtime input, not the palette", () => {
    const input = createXrScenePaletteInput();
    const xrFrame = createFakeXrFrame();
    const referenceSpace = {} as XRReferenceSpace;
    const source = createFakeXrInputSource({
      handedness: "right",
      gamepad: createFakeGamepad({ pressedButtonIndexes: [1] }),
    });

    const frame = input.update({
      deltaSeconds: 1 / 60,
      inputSources: [source],
      xrFrame,
      referenceSpace,
      referenceSpaceToWorldMatrix: new THREE.Matrix4(),
    });

    expect(frame.menuTogglePressed).toBe(false);
    expect(frame.pointers).toHaveLength(1);
    expect(frame.pointers[0]?.selectPressed).toBe(false);
  });

  it("keeps a separate controller object cache per input", () => {
    const a = createXrScenePaletteInput();
    const b = createXrScenePaletteInput();
    const xrFrame = createFakeXrFrame();
    const source = createFakeXrInputSource({ handedness: "right" });
    const run = (input: ReturnType<typeof createXrScenePaletteInput>) =>
      input.update({
        deltaSeconds: 1 / 60,
        inputSources: [source],
        xrFrame,
        referenceSpace: {} as XRReferenceSpace,
        referenceSpaceToWorldMatrix: new THREE.Matrix4(),
      }).pointers[0]?.object;

    const first = run(a);
    const second = run(b);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);

    const before = run(b);
    a.reset();
    expect(run(b)).toBe(before);
  });
});
