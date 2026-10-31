/**
 * Geodesic emitter label sync (src/render/three/geodesicEmitterLabelController.ts): keeps one "G<n>" billboard
 * label per (cannon, geodesic) pair in the registry, in the shared `geodesicEmitterLabelsByKey` map the caller
 * owns. A label is swept once its cannon (or the whole registry entry) disappears.
 *
 * `document.createElement("canvas")` (the label's text texture) is faked by tests/support/fakeCanvas2d.ts.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createGeodesicEmitterLabelController,
  type GeodesicEmitterLabel,
} from "../../src/render/three/geodesicEmitterLabelController";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";

function cannon(id: string): GeodesicCannonObject {
  return {
    id,
    kind: "geodesic-cannon",
    cellId: "a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    portalRenderable: true,
    geodesicIds: ["g-a"],
    aimYawRadians: 0,
  };
}

describe("geodesicEmitterLabelController sweep", () => {
  it("sweeps a label only once its cannon leaves the registry", () => {
    installFakeCanvas2d();
    const labels = new Map<string, GeodesicEmitterLabel>();
    const registry = createRuntimeObjectRegistry([cannon("cannon-a")]);
    const controller = createGeodesicEmitterLabelController({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      runtimeObjectRegistry: registry,
      geodesicEmitterLabelsByKey: labels,
      getPlayerPose: () => ({ cellId: "a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 }) as never,
      getRegistryVersion: () => registry.getVersion(),
    });

    controller.updateGeodesicEmitterLabels();
    expect(labels.has("cannon-a:g-a")).toBe(true);

    registry.remove("cannon-a");
    controller.updateGeodesicEmitterLabels();
    expect(labels.has("cannon-a:g-a")).toBe(false);
  });
});
