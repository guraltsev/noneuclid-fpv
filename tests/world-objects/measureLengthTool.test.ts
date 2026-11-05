/**
 * `tests/world-objects/measureLengthTool.test.ts` — unit tier.
 *
 * `createMeasuredGeodesicLengthObject` sums a geodesic's segment lengths and places its label at the player's
 * horizontal position in whichever of the geodesic's own cells the player currently occupies, at the geodesic's
 * own height; `refreshMeasuredGeodesicLengthObject` keeps the last label location when the player leaves every
 * cell the geodesic passes through. Given the world, the label sits at the point of the geodesic nearest the player as
 * the player sees it, including parts seen through a portal of the player's cell, so it slides continuously when the
 * player steps into the neighbouring cell. These tests check all three.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import {
  createMeasuredGeodesicLengthObject,
  refreshMeasuredGeodesicLengthObject,
} from "../../src/world-objects/measureLengthTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
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

  it("slides continuously when the player steps through a portal to the neighbouring cell", () => {
    const world = compileLargePortalWorld();
    // In cell a (x from 0 to 5) a short run near its far end; in cell b the geodesic's long run, close to a's portal at x = 5.
    const registry = createRuntimeObjectRegistry([
      createSegment({ id: "g-a:segment:0", cellId: "a", start: { x: 0, y: 0.5, z: 1.08 }, lengthMeters: 1 }),
      createSegment({ id: "g-a:segment:1", cellId: "b", segmentIndex: 1, start: { x: 0, y: 4.5, z: 1.08 }, lengthMeters: 3 }),
    ]);
    // Cell b sits at x + 5 in a's frame.
    const inFrameOfA = (measurement: { readonly cellId: string; readonly labelPoint: { readonly x: number; readonly y: number } }) =>
      measurement.cellId === "b" ? { x: measurement.labelPoint.x + 5, y: measurement.labelPoint.y } : measurement.labelPoint;

    const before = createMeasuredGeodesicLengthObject({
      id: "measure-a",
      registry,
      world,
      geodesicId: "g-a",
      playerCellId: "a",
      playerPoint: { x: 4.9, y: 4.5, z: 0 },
    });
    if (!before) {
      throw new Error("Expected measurement.");
    }
    const after = refreshMeasuredGeodesicLengthObject({
      registry,
      world,
      measurement: before,
      playerCellId: "b",
      playerPoint: { x: 0.1, y: 4.5, z: 0 },
    });

    const labelBefore = inFrameOfA(before);
    const labelAfter = inFrameOfA(after ?? before);
    expect(Math.hypot(labelAfter.x - labelBefore.x, labelAfter.y - labelBefore.y)).toBeLessThan(0.5);
  });
});

function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesicModel/segment",
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
