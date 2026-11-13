/**
 * VR palette placement (src/render/three/vrPalettePlacement.ts): the in-scene palette floats at a head-relative
 * target (0, -0.24, -1.44) m from the headset, facing back toward it, smoothed from the previous pose; freezing
 * keeps it at its previous pose instead. The placement always carries scale `VR_PALETTE_SCALE` (2), so the panel
 * keeps the angular size it had at half the distance. `resolveFrontFacingQuaternion` orients a tooltip plane's
 * front face toward a target position.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  VR_PALETTE_SCALE,
  resolveFrontFacingQuaternion,
  resolveVrPalettePlacement,
} from "../../src/render/three/vrPalettePlacement";

describe("vrPalettePlacement", () => {
  it("floats in front of the headset at a comfortable distance", () => {
    const placement = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion() },
    });

    expect(placement.anchorKind).toBe("viewer");
    expect(placement.position.x).toBeCloseTo(0);
    expect(placement.position.y).toBeCloseTo(1.36);
    expect(placement.position.z).toBeCloseTo(-1.44);
  });

  it("places the panel along the headset forward direction", () => {
    const headYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const placement = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0), quaternion: headYaw },
    });

    expect(placement.anchorKind).toBe("viewer");
    expect(placement.position.x).toBeLessThan(-1.4);
    expect(placement.position.z).toBeCloseTo(0);
  });

  it("stabilizes from the previous pose when freeze is active", () => {
    const placement = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0) },
      previousPosition: new THREE.Vector3(1, 2, 3),
      previousQuaternion: new THREE.Quaternion(0, 0, 0, 1),
      freeze: true,
    });

    expect(placement.position.toArray()).toEqual([1, 2, 3]);
  });

  it("draws the panel at twice its size, frozen or not, to match the doubled distance", () => {
    expect(VR_PALETTE_SCALE).toBe(2);

    const unfrozen = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion() },
      previousPosition: new THREE.Vector3(0, 1.4, -1.4),
      previousQuaternion: new THREE.Quaternion(),
    });
    const frozen = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0) },
      previousPosition: new THREE.Vector3(1, 2, 3),
      previousQuaternion: new THREE.Quaternion(0, 0, 0, 1),
      freeze: true,
    });

    expect(unfrozen.scale).toBe(2);
    expect(frozen.scale).toBe(2);
  });

  it("can orient tooltip planes so their front faces the headset", () => {
    const tooltipPosition = new THREE.Vector3(0.5, 1.4, -1.2);
    const headPosition = new THREE.Vector3(0, 1.7, 0);
    const quaternion = resolveFrontFacingQuaternion(tooltipPosition, headPosition);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
    const toHead = headPosition.clone().sub(tooltipPosition).normalize();

    expect(facing.angleTo(toHead)).toBeLessThan(1e-6);
  });
});
