import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createGeodesicEmitterLabelController,
  type GeodesicEmitterLabel,
} from "../../src/render/three/geodesicEmitterLabelController";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

describe("geodesicEmitterLabelController sweep", () => {
  it("sweeps stale labels only when the registry version changed", () => {
    const labels = new Map<string, GeodesicEmitterLabel>();
    let version = 0;
    const controller = createGeodesicEmitterLabelController({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      runtimeObjectRegistry: createRuntimeObjectRegistry(),
      geodesicEmitterLabelsByKey: labels,
      getPlayerPose: () => ({ cellId: "a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 }) as never,
      getRegistryVersion: () => version,
    });

    controller.updateGeodesicEmitterLabels();
    labels.set("stale", { text: "G9", root: new THREE.Object3D() });

    controller.updateGeodesicEmitterLabels();
    expect(labels.has("stale")).toBe(true);

    version += 1;
    controller.updateGeodesicEmitterLabels();
    expect(labels.has("stale")).toBe(false);
  });
});
