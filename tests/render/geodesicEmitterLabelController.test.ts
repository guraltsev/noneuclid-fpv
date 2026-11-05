/**
 * Geodesic emitter label sync (src/render/three/geodesicEmitterLabelController.ts): keeps one "G<n>" billboard
 * label per (cannon, geodesic) pair in the registry, in the shared `geodesicEmitterLabelsByKey` map the caller
 * owns. A label is swept once its cannon (or the whole registry entry) disappears. A label is shown for a cannon within
 * range of the player that the player could see: in the player's cell, or in a neighbouring cell reached through portals.
 * It is drawn where the cannon appears in the player's frame, which for a cannon on another face is not its own pose.
 *
 * `document.createElement("canvas")` (the label's text texture) is faked by tests/support/fakeCanvas2d.ts.
 */
import { createTestEngine } from "../support/engine";
import * as THREE from "three";
import { createTestClientSession } from "../support/clientSession";
import { describe, expect, it } from "vitest";
import {
  createGeodesicEmitterLabelController,
  type GeodesicEmitterLabel,
} from "../../src/render/three/geodesicEmitterLabelController";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { resolveGeodesicEmitterLabelPosition } from "../../src/render/three/geodesicEmitterLabels";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";
import { addGeodesicLeavingEmitter, compileLargePortalWorld } from "../fixtures/world-objects/geodesic";

function cannon(id: string, cellId = "a", x = 0, y = 0): GeodesicCannonObject {
  return {
    id,
    kind: "geodesic-cannon",
    cellId,
    localPose: yawRigidTransform3(0, { x, y, z: 0 }),
    portalRenderable: true,
    aimYawRadians: 0,
  };
}

describe("geodesicEmitterLabelController sweep", () => {
  it("sweeps a label only once its cannon leaves the registry", () => {
    installFakeCanvas2d();
    const labels = new Map<string, GeodesicEmitterLabel>();
    const registry = createRuntimeObjectRegistry([cannon("cannon-a")]);
    addGeodesicLeavingEmitter(registry, "cannon-a", "g-a", 0);
    const controller = createGeodesicEmitterLabelController({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      runtimeObjectRegistry: registry,
      geodesicEmitterLabelsByKey: labels,
      getWorld: () => compileLargePortalWorld(),
      session: createTestClientSession(),
      engine: createTestEngine({ playerPose: { cellId: "a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 } as never }),
      getRegistryVersion: () => registry.getVersion(),
    });

    controller.updateGeodesicEmitterLabels();
    expect(labels.has("cannon-a:g-a")).toBe(true);

    registry.remove("cannon-a");
    controller.updateGeodesicEmitterLabels();
    expect(labels.has("cannon-a:g-a")).toBe(false);
  });
});

describe("geodesicEmitterLabelController placement", () => {
  function setup(cannons: readonly GeodesicCannonObject[]) {
    installFakeCanvas2d();
    const labels = new Map<string, GeodesicEmitterLabel>();
    const registry = createRuntimeObjectRegistry(cannons);
    for (const object of cannons) {
      addGeodesicLeavingEmitter(registry, object.id, "g-a", 0);
    }
    const world = compileLargePortalWorld();
    const controller = createGeodesicEmitterLabelController({
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      runtimeObjectRegistry: registry,
      geodesicEmitterLabelsByKey: labels,
      getWorld: () => world,
      session: createTestClientSession(),
      engine: createTestEngine({ playerPose: { cellId: "a", position: { x: 4.5, y: 2.5, z: 0 }, yawRadians: 0, pitchRadians: 0 } }),
      getRegistryVersion: () => registry.getVersion(),
    });
    controller.updateGeodesicEmitterLabels();

    return labels;
  }

  it("labels a cannon on the neighbouring face where it appears in the player's frame", () => {
    // The player is in cell a, next to a's portal at x = 5; the cannon is in cell b at (0.8, 2.5), which appears at (5.8, 2.5) in a.
    const labels = setup([cannon("cannon-b", "b", 0.8, 2.5)]);
    const label = labels.get("cannon-b:g-a");
    const seenFromA = cannon("seen-from-a", "a", 5.8, 2.5);
    const reference = createRuntimeObjectRegistry([seenFromA]);
    addGeodesicLeavingEmitter(reference, seenFromA.id, "g-a", 0);
    const expected = resolveGeodesicEmitterLabelPosition(reference, seenFromA, "g-a");

    expect(label?.root.visible).toBe(true);
    expect(label?.root.position.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it("shows no label for a cannon on the neighbouring face that is out of range", () => {
    const labels = setup([cannon("cannon-b", "b", 4.5, 2.5)]);

    expect(labels.get("cannon-b:g-a")?.root.visible).toBe(false);
  });
});
