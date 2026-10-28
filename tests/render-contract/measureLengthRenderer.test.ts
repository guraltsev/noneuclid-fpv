import { describe, expect, it } from "vitest";
import { createMeasuredGeodesicLengthRuntime } from "../../src/render/three/measureLengthRenderer";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { GeodesicSegmentObject } from "../../src/world-objects/geodesicCannon";

describe("measure length renderer", () => {
  it("creates portal-renderable source meshes for the floating length label", () => {
    const segment = createSegment();
    const object = createMeasuredGeodesicLengthObject({
      id: "measure-a",
      registry: createRuntimeObjectRegistry([segment]),
      geodesicId: "g-a",
      label: "G1",
      playerCellId: "cell-a",
      playerPoint: { x: 1, y: 0, z: 0 },
    });
    if (!object) {
      throw new Error("Expected measurement.");
    }

    const runtime = createMeasuredGeodesicLengthRuntime(object);
    const objectNames: string[] = [];
    const meshNames: string[] = [];
    runtime.root.traverse((child) => {
      objectNames.push(child.name);
      if (child.type === "Mesh" || child.type === "Sprite") {
        meshNames.push(child.name);
      }
    });

    expect(runtime.objectId).toBe("measure-a");
    expect(runtime.cellId).toBe("cell-a");
    expect(objectNames).toContain("measured-geodesic-length-floating-tooltip");
    expect(meshNames).toContain("measured-geodesic-length-floating-tooltip:front");
    expect(meshNames).toContain("measured-geodesic-length-floating-tooltip:back");

    runtime.dispose();
  });
});

function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesic-segment",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 1.08 }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: 1.08 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 2,
    terminal: { kind: "open" },
    ...overrides,
  };
}
