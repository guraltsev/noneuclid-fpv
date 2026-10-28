import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  resolveFrontFacingQuaternion,
  resolveVrPalettePlacement,
  shouldAutoCloseVrPalette,
} from "../../src/render/three/vrPalettePlacement";

describe("vrPalettePlacement", () => {
  it("floats in front of the headset at a comfortable distance", () => {
    const placement = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion() },
    });

    expect(placement.anchorKind).toBe("viewer");
    expect(placement.position.x).toBeCloseTo(0);
    expect(placement.position.y).toBeCloseTo(1.48);
    expect(placement.position.z).toBeCloseTo(-0.72);
  });

  it("places the panel along the headset forward direction", () => {
    const headYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const placement = resolveVrPalettePlacement({
      head: { position: new THREE.Vector3(0, 1.6, 0), quaternion: headYaw },
    });

    expect(placement.anchorKind).toBe("viewer");
    expect(placement.position.x).toBeLessThan(-0.7);
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

  it("auto-closes once the headset moves more than a meter from the fixed panel", () => {
    expect(
      shouldAutoCloseVrPalette({
        headPosition: new THREE.Vector3(0, 1.6, 0),
        palettePosition: new THREE.Vector3(0, 1.6, 0.99),
      }),
    ).toBe(false);
    expect(
      shouldAutoCloseVrPalette({
        headPosition: new THREE.Vector3(0, 1.6, 0),
        palettePosition: new THREE.Vector3(0, 1.6, 1.01),
      }),
    ).toBe(true);
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
