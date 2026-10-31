/**
 * `tests/world-objects/measureLengthTool.test.ts` — unit tier.
 *
 * `createMeasuredGeodesicLengthObject` sums a geodesic's segment lengths and places its label at the player's
 * horizontal position in whichever of the geodesic's own cells the player currently occupies, at the geodesic's
 * own height; `refreshMeasuredGeodesicLengthObject` keeps the last label location when the player leaves every
 * cell the geodesic passes through. These tests check both.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import {
  createMeasuredGeodesicLengthObject,
  refreshMeasuredGeodesicLengthObject,
} from "../../src/world-objects/measureLengthTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { GeodesicSegmentObject } from "../../src/world-objects/geodesic/objects";

describe("measure length tool objects", () => {
  it("measures a geodesic's length and places the label near the player in its segment's cell", () => {
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
