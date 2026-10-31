import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolveAimCrossMarkerQuaternion } from "../../src/render/three/aimCrossMarker";

describe("aimCrossMarker", () => {
  it("keeps the cross bars aligned to the desktop camera axes on the target surface", () => {
    const quaternion = resolveAimCrossMarkerQuaternion(
      new THREE.Vector3(0, 0, 1),
      new THREE.Quaternion(),
    );

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    expect(normal.z).toBeCloseTo(1);
  });

  it("rolls the cross bars with the targeting hand or controller in XR", () => {
    const sourceQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const quaternion = resolveAimCrossMarkerQuaternion(
      new THREE.Vector3(0, 0, 1),
      sourceQuaternion,
    );

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

    expect(right.x).toBeCloseTo(0);
    expect(right.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(-1);
    expect(up.y).toBeCloseTo(0);
  });
});
