import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createXrScenePaletteInput, isSelectPressed } from "../../src/render/three/xrScenePaletteInput";

describe("xrScenePaletteInput", () => {
  it("maps controller select and side trigger buttons without treating face buttons as menu toggles", () => {
    const gamepad = {
      buttons: [
        { pressed: true },
        { pressed: true },
        { pressed: false },
        { pressed: false },
        { pressed: false },
        { pressed: false },
      ],
    } as unknown as XRInputSource["gamepad"];

    expect(isSelectPressed(gamepad)).toBe(true);
  });

  it("does not emit a second menu toggle edge because XR runtime input already owns side-trigger menu actions", () => {
    const input = createXrScenePaletteInput();
    const xrFrame = {
      getPose: () => ({
        transform: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      }),
    } as unknown as XRFrame;
    const referenceSpace = {} as XRReferenceSpace;
    const source = {
      handedness: "right",
      targetRaySpace: {},
      gamepad: {
        buttons: [
          { pressed: false },
          { pressed: true },
          { pressed: false },
          { pressed: false },
          { pressed: false },
          { pressed: false },
        ],
      },
    } as unknown as XRInputSource;

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
    const xrFrame = {
      getPose: () => ({
        transform: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      }),
    } as unknown as XRFrame;
    const source = {
      handedness: "right",
      targetRaySpace: {},
      gamepad: { buttons: [{ pressed: false }] },
    } as unknown as XRInputSource;
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
