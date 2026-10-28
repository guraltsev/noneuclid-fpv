import { describe, expect, it } from "vitest";
import { createProtractorAngleRuntime } from "../../src/render/three/protractorAngleRenderer";
import {
  createProtractorAngleObject,
  protractorAngleLabelVerticalOffsetMeters,
  resolveProtractorCenterSelection,
} from "../../src/world-objects/protractorTool";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { GeodesicCannonObject } from "../../src/world-objects/geodesicCannon";

describe("protractor angle renderer", () => {
  it("creates portal-renderable source meshes for the highlighted angle", () => {
    const object = createProtractorAngleObject({
      id: "angle-a",
      center: resolveProtractorCenterSelection(createEmitter()),
      first: { geodesicId: "g-a", segmentId: "segment-a", yawRadians: 0 },
      second: { geodesicId: "g-b", segmentId: "segment-b", yawRadians: Math.PI / 2 },
    });

    const runtime = createProtractorAngleRuntime(object);
    const objectNames: string[] = [];
    const meshNames: string[] = [];
    runtime.root.traverse((child) => {
      objectNames.push(child.name);
      if (child.type === "Mesh" || child.type === "Sprite") {
        meshNames.push(child.name);
      }
    });

    expect(runtime.objectId).toBe("angle-a");
    expect(runtime.cellId).toBe("cell-a");
    expect(meshNames).toContain("protractor-angle-fill");
    expect(meshNames).toContain("protractor-angle-arc");
    expect(meshNames).toContain("protractor-angle-boundary:first");
    expect(meshNames).toContain("protractor-angle-boundary:second");
    expect(meshNames).toContain("protractor-angle-floating-tooltip:front");
    expect(meshNames).toContain("protractor-angle-floating-tooltip:back");
    expect(objectNames).toContain("protractor-angle-floating-tooltip");

    runtime.dispose();
  });

  it("places the floating label above the midpoint of the angle arc and tangent to it", () => {
    const object = createProtractorAngleObject({
      id: "angle-a",
      center: resolveProtractorCenterSelection(createEmitter()),
      first: { geodesicId: "g-a", segmentId: "segment-a", yawRadians: 0 },
      second: { geodesicId: "g-b", segmentId: "segment-b", yawRadians: Math.PI / 2 },
    });

    const runtime = createProtractorAngleRuntime(object);
    const label = runtime.root.getObjectByName("protractor-angle-floating-tooltip");
    const labelAngle = object.angleRadians / 2;

    expect(label?.position.x).toBeCloseTo(Math.cos(labelAngle) * object.radiusMeters);
    expect(label?.position.y).toBeCloseTo(protractorAngleLabelVerticalOffsetMeters);
    expect(label?.position.z).toBeCloseTo(-Math.sin(labelAngle) * object.radiusMeters);
    expect(label?.rotation.y).toBeCloseTo(labelAngle + Math.PI / 2);

    runtime.dispose();
  });
});

function createEmitter(overrides: Partial<GeodesicCannonObject> = {}): GeodesicCannonObject {
  return {
    id: "emitter-a",
    kind: "geodesic-cannon",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    portalRenderable: true,
    geodesicIds: ["g-a", "g-b"],
    aimYawRadians: 0,
    ...overrides,
  };
}
