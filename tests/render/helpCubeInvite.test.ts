/**
 * The help cube's invitation (src/render/three/helpCubeInvite.ts): a "? Help" billboard over the cube and a bob of 3 cm
 * with a period of 2 s, until the cube has been opened once. These tests drive it with a real registry and a real object
 * owner for the cube: the bob moves the cube's record and nothing else, the label shows over the cube while the player
 * is near, and opening the cube puts the cube back on its authored height and hides the label for good.
 *
 * `document.createElement("canvas")` (the label's text texture) is faked by tests/support/fakeCanvas2d.ts.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createHelpCubeInvite, helpCubeBobAmplitudeMeters, helpCubeBobOffset, helpCubeBobPeriodSeconds } from "../../src/render/three/helpCubeInvite";
import { createObjectHost, createPlainWorldObject } from "../../src/world-objects/worldObjectOwner";
import { createRuntimeObjectRegistry, createRuntimeStaticAssetObject } from "../../src/world-objects/runtimeObjectRegistry";
import { createTestEngine } from "../support/engine";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";

const world = compileCellComplex({
  cells: [{
    id: "room",
    heightMeters: 3,
    baseVertices: [{ x: -9, y: -9 }, { x: 9, y: -9 }, { x: 9, y: 9 }, { x: -9, y: 9 }],
    portals: [],
  }],
});

function harness(playerY = 0) {
  installFakeCanvas2d();
  const registry = createRuntimeObjectRegistry();
  const host = createObjectHost();
  const cube = createRuntimeStaticAssetObject({ id: "startingQuestionCube", kind: "asset", assetPath: "questionblock/questionBlock.glb", position: { x: 0, y: 3, z: 0.05 } }, "room");
  host.register(createPlainWorldObject(registry, cube));
  const scene = new THREE.Scene();
  const invite = createHelpCubeInvite({
    scene,
    camera: new THREE.PerspectiveCamera(),
    engine: createTestEngine({ registry, playerPose: { cellId: "room", position: { x: 0, y: playerY, z: 0 }, yawRadians: 0, pitchRadians: 0 } }),
    registry,
    objectHost: host,
    getWorld: () => world,
    cubeId: "startingQuestionCube",
  });
  const cubeHeight = () => (registry.get("startingQuestionCube")!.localPose.translation.z);
  const label = () => scene.getObjectByName("help-cube-invite");
  return { invite, cubeHeight, label, scene, registry };
}

describe("helpCubeInvite", () => {
  it("bobs by 3 cm every 2 s: a sine of that amplitude and period", () => {
    expect(helpCubeBobAmplitudeMeters).toBe(0.03);
    expect(helpCubeBobPeriodSeconds).toBe(2);
    expect(helpCubeBobOffset(0)).toBeCloseTo(0, 12);
    expect(helpCubeBobOffset(0.5)).toBeCloseTo(0.03, 12);
    expect(helpCubeBobOffset(1.5)).toBeCloseTo(-0.03, 12);
    expect(helpCubeBobOffset(2.5)).toBeCloseTo(helpCubeBobOffset(0.5), 12);
  });

  it("moves the cube around its authored height and shows the label over it", () => {
    const { invite, cubeHeight, label } = harness();

    invite.update(0.5);
    expect(cubeHeight()).toBeCloseTo(0.08, 12);
    invite.update(1.5);
    expect(cubeHeight()).toBeCloseTo(0.02, 12);
    expect(label()?.visible).toBe(true);
    // The label is above the cube's top (1.1 m) and turns to the camera.
    expect(label()!.position.y).toBeGreaterThan(1.1);
    expect(invite.isInviting()).toBe(true);
  });

  it("puts the cube back and hides the label once the cube has been opened, and keeps them away", () => {
    const { invite, cubeHeight, label } = harness();
    invite.update(0.5);

    invite.markOpened();
    expect(cubeHeight()).toBeCloseTo(0.05, 12);
    expect(label()?.visible).toBe(false);

    invite.update(1.5);
    expect(cubeHeight()).toBeCloseTo(0.05, 12);
    expect(label()?.visible).toBe(false);
    expect(invite.isInviting()).toBe(false);
  });

  it("hides the label when the cube is far away, shows it again near, and removes it on dispose", () => {
    // The cube is at y = 3; a player at y = -9 is 12 m from it, out of the label's range.
    const { invite, label, scene } = harness(-9);
    invite.update(0);
    expect(label()?.visible ?? false).toBe(false);

    const near = harness(0);
    near.invite.update(0);
    expect(near.label()?.visible).toBe(true);
    near.invite.dispose();
    expect(near.scene.getObjectByName("help-cube-invite")).toBeUndefined();
    invite.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("does nothing for a world without a help cube", () => {
    installFakeCanvas2d();
    const registry = createRuntimeObjectRegistry();
    const scene = new THREE.Scene();
    const invite = createHelpCubeInvite({
      scene,
      camera: new THREE.PerspectiveCamera(),
      engine: createTestEngine({ registry, playerPose: { cellId: "room", position: { x: 0, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 } }),
      registry,
      objectHost: createObjectHost(),
      getWorld: () => world,
      cubeId: "startingQuestionCube",
    });

    expect(() => invite.update(1)).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
