import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import {
  createMeasuredGeodesicLengthObject,
  refreshMeasuredGeodesicLengthObject,
} from "../../src/world-objects/measureLengthTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { GeodesicSegmentObject } from "../../src/world-objects/geodesicCannon";

describe("measure length tool objects", () => {
  it("measures the full geodesic length and places the label near the player in the current segment cell", () => {
    const first = createSegment({
      id: "g-a:segment:0",
      cellId: "cell-a",
      start: { x: 0, y: 0, z: 1.08 },
      lengthMeters: 2,
    });
    const second = createSegment({
      id: "g-a:segment:1",
      cellId: "cell-b",
      start: { x: 10, y: 0, z: 1.08 },
      lengthMeters: 3,
    });
    const registry = createRuntimeObjectRegistry([first, second]);

    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-a",
      registry,
      geodesicId: "g-a",
      label: "G1",
      playerCellId: "cell-a",
      playerPoint: { x: 1.25, y: 0.4, z: 0 },
    });

    expect(measurement?.lengthMeters).toBe(5);
    expect(measurement?.tooltip?.label).toBe("G1 length = 5 m");
    expect(measurement?.cellId).toBe("cell-a");
    expect(measurement?.labelPoint).toEqual({ x: 1.25, y: 0, z: 1.08 });
    expect(measurement?.localPose.rotation.m00).toBeCloseTo(0);
    expect(measurement?.localPose.rotation.m10).toBeCloseTo(1);
  });

  it("keeps the last label location when the player is in a cell without that geodesic", () => {
    const segment = createSegment({
      id: "g-a:segment:0",
      cellId: "cell-a",
      start: { x: 0, y: 0, z: 1.08 },
      lengthMeters: 2,
    });
    const registry = createRuntimeObjectRegistry([segment]);
    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-a",
      registry,
      geodesicId: "g-a",
      label: "G1",
      playerCellId: "cell-a",
      playerPoint: { x: 1, y: 0, z: 0 },
    });
    if (!measurement) {
      throw new Error("Expected measurement.");
    }

    const refreshed = refreshMeasuredGeodesicLengthObject({
      registry,
      measurement,
      playerCellId: "cell-b",
      playerPoint: { x: 20, y: 0, z: 0 },
    });

    expect(refreshed?.cellId).toBe("cell-a");
    expect(refreshed?.labelPoint).toEqual(measurement.labelPoint);
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
