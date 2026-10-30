import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
  getGeodesicSegmentEnd,
  intersectionTolerance,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { crossXY } from "../../../src/math/vec2";
import { extendGeodesic, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { getGeodesicSegments, getGeodesicTail } from "../../../src/world-objects/geodesic/segments";
import {
  getRememberedGeodesicIntersectionObject,
  pruneMissingGeodesicIntersectionObjects,
  updateGeodesicIntersectionObjects,
} from "../../../src/world-objects/geodesic/intersections";
import { replaceGeodesicEndpointAttachment } from "../../../src/world-objects/geodesic/endpoints";
import { removeGeodesic } from "../../../src/world-objects/geodesic/lifecycle";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import { createSegment, compileWorld, createTorusLoopBenchmarkScene, getCannonGeodesicIds } from "./fixtures";

describe("geodesic cannon world objects: intersections", () => {
  it("looks up tails and removes segment chains", () => {
    const world = compileWorld(false);
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0.25, y: 1, z: 0 }),
    });
    registry.add(cannon);
    shootGeodesic({ world, registry, cannon, geodesicId: "g-a", maxLengthMeters: 0.5 });
    extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 0.5 });

    expect(getGeodesicTail(registry, "g-a")?.segmentIndex).toBe(1);
    expect(getGeodesicSegments(registry, "g-a")).toHaveLength(2);
    removeGeodesic(registry, "g-a");
    expect(registry.getAll().filter((object) => object.kind === "geodesic-segment")).toHaveLength(0);
    expect(registry.get("cannon-a")?.kind).toBe("geodesic-cannon");
  });

  it("clears the old emitter legacy attachment when an interval endpoint is detached", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: ["g-a"],
      }),
      createGeodesicCannonObject({
        id: "cannon-b",
        cellId: "a",
        localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: ["g-a"],
      }),
      createFreeGeodesicEndObject({
        id: "free-a",
        cellId: "a",
        point: { x: 0.5, y: 0, z: geodesicRayBeamHeightMeters },
      }),
      createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-b",
        startCellId: "a",
        motionState: "stable",
      }),
    ]);

    replaceGeodesicEndpointAttachment(registry, "g-a", "start", "free-a");

    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
  });

  it("clears stale active emitter state when a deleted interval is no longer in geodesicIds", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: [],
        geodesicEmitterYawRadiansById: { "g-a": 0 },
        geodesicConnectionsById: { "g-a": { outgoingEmitterId: "cannon-a", state: "open" } },
      }),
      createFreeGeodesicEndObject({
        id: "free-a",
        cellId: "a",
        point: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
      }),
      createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "free-a",
        startCellId: "a",
        motionState: "stable",
      }),
    ]);

    removeGeodesic(registry, "g-a");

    const cannon = registry.get("cannon-a");
    expect(cannon?.kind === "geodesic-cannon" ? cannon.activeGeodesicId : undefined).toBeUndefined();
    expect(cannon?.kind === "geodesic-cannon" ? cannon.geodesicEmitterYawRadiansById : undefined).toEqual({});
    expect(cannon?.kind === "geodesic-cannon" ? cannon.geodesicConnectionsById : undefined).toEqual({});
  });

  it("creates a vertex balloon where two geodesics intersect outside an emitter", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [vertex] = updateGeodesicIntersectionObjects(registry);

    expect(vertex).toMatchObject({
      kind: "geodesic-intersection",
      cellId: "a",
      tooltip: { label: "vertex", rangeMeters: 3 },
      geodesicIds: ["g-a", "g-b"],
      segmentIds: ["g-a:segment:0", "g-b:segment:0"],
    });
    expect(vertex.localPose.translation).toEqual({ x: 1, y: 1, z: geodesicRayBeamHeightMeters + 0.25 });
    expect(vertex.aimStickyTarget?.localPoint).toEqual({ x: 1, y: 1, z: geodesicRayBeamHeightMeters });
    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(1);
  });

  it("creates a vertex balloon where geodesics intersect at an unrelated emitter (job 15: the 0.3 m emitter exclusion is gone)", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }),
      }),
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const vertices = updateGeodesicIntersectionObjects(registry);

    expect(vertices).toHaveLength(1);
    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(1);
  });

  it("keeps vertex identity while a geodesic pair intersection moves continuously", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 1.5, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [moved] = updateGeodesicIntersectionObjects(registry);

    expect(moved.id).toBe(first.id);
    expect(moved.aimStickyTarget?.localPoint).toEqual({ x: 1.5, y: 1, z: geodesicRayBeamHeightMeters });
  });

  it("remembers a missing vertex and recreates it with the same identity within ten meters", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 4, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    expect(updateGeodesicIntersectionObjects(registry)).toEqual([]);
    expect(getRememberedGeodesicIntersectionObject(registry, first.id)?.id).toBe(first.id);

    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 1.25, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [recreated] = updateGeodesicIntersectionObjects(registry);

    expect(recreated.id).toBe(first.id);
  });

  it("prunes non-existent vertex memory and refuses to match jumps beyond ten meters", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 20,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 14, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [jumped] = updateGeodesicIntersectionObjects(registry);

    expect(jumped.id).not.toBe(first.id);
    expect(pruneMissingGeodesicIntersectionObjects(registry)).toEqual([first.id]);
    expect(getRememberedGeodesicIntersectionObject(registry, first.id)).toBeUndefined();
  });

  it("removes stale vertex balloons when a geodesic is removed", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);
    updateGeodesicIntersectionObjects(registry);

    removeGeodesic(registry, "g-a");

    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(0);
  });

  it("B4: a crossing exactly on a portal side is reported once, in the cell the geodesics enter", () => {
    const z = geodesicRayBeamHeightMeters;
    const root = Math.sqrt(1.25);
    const portalHit = (direction: { x: number; y: number; z: number }) => ({
      kind: "portal-hit" as const,
      portalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
      targetStart: { x: 0, y: 1, z },
      targetDirection: direction,
    });
    const through = (id: string, start: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) => [
      createSegment({
        id: `${id}:segment:0`,
        geodesicId: id,
        cellId: "a",
        segmentIndex: 0,
        start,
        direction,
        lengthMeters: root,
        terminal: portalHit(direction),
      }),
      createSegment({
        id: `${id}:segment:1`,
        geodesicId: id,
        cellId: "b",
        segmentIndex: 1,
        start: { x: 0, y: 1, z },
        direction,
        lengthMeters: root,
        terminal: { kind: "open" },
      }),
    ];
    const registry = createRuntimeObjectRegistry([
      ...through("X", { x: 1, y: 0.5, z }, { x: 1 / root, y: 0.5 / root, z: 0 }),
      ...through("Y", { x: 1, y: 1.5, z }, { x: 1 / root, y: -0.5 / root, z: 0 }),
    ]);

    const markers = updateGeodesicIntersectionObjects(registry);

    expect(markers).toHaveLength(1);
    expect(markers[0].cellId).toBe("b");
    expect(markers[0].geodesicIds).toEqual(["X", "Y"]);
    expect(markers[0].aimStickyTarget?.localPoint.x).toBeCloseTo(0);
    expect(markers[0].aimStickyTarget?.localPoint.y).toBeCloseTo(1);
  });

  it("B5: per-cell buckets find the same markers as the all-pairs search", () => {
    const { registry } = createTorusLoopBenchmarkScene();
    const markers = updateGeodesicIntersectionObjects(registry);
    expect(markers.length).toBeGreaterThan(10);

    const describeMarker = (cellId: string, geodesicIds: readonly string[], point: { x: number; y: number }) =>
      `${cellId}|${geodesicIds.join(",")}|${point.x.toFixed(9)}|${point.y.toFixed(9)}`;
    const actual = new Set(markers.map((marker) =>
      describeMarker(marker.cellId, marker.geodesicIds, marker.aimStickyTarget!.localPoint)
    ));
    expect(actual.size).toBe(markers.length);
    expect(allPairsIntersectionKeys(registry.getObjectsOfKind("geodesic-segment"), describeMarker)).toEqual(actual);
  });
});

// Test-local copy of the all-pairs search used before the per-cell buckets (without the portal-side rule).
function allPairsIntersectionKeys(
  segments: readonly GeodesicSegmentObject[],
  describeMarker: (cellId: string, geodesicIds: readonly string[], point: { x: number; y: number }) => string,
): Set<string> {
  const tolerance = 1e-6;
  const lastIndex = new Map<string, number>();
  for (const segment of segments) {
    lastIndex.set(segment.geodesicId, Math.max(lastIndex.get(segment.geodesicId) ?? 0, segment.segmentIndex));
  }
  const atAnchor = (segment: GeodesicSegmentObject, t: number, length: number): boolean => {
    const toleranceT = length > 0 ? tolerance / length : 1;
    return (segment.segmentIndex === 0 && t <= toleranceT) ||
      (segment.segmentIndex === (lastIndex.get(segment.geodesicId) ?? 0) && t >= 1 - toleranceT);
  };
  const keys = new Set<string>();
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const left = segments[i];
      const right = segments[j];
      if (left.cellId !== right.cellId) {
        continue;
      }
      if (left.geodesicId === right.geodesicId && Math.abs(left.segmentIndex - right.segmentIndex) < 2) {
        continue;
      }
      const leftEnd = getGeodesicSegmentEnd(left);
      const rightEnd = getGeodesicSegmentEnd(right);
      const rx = leftEnd.x - left.start.x;
      const ry = leftEnd.y - left.start.y;
      const sx = rightEnd.x - right.start.x;
      const sy = rightEnd.y - right.start.y;
      const denominator = crossXY(rx, ry, sx, sy);
      if (Math.abs(denominator) <= intersectionTolerance) {
        continue;
      }
      const dx = right.start.x - left.start.x;
      const dy = right.start.y - left.start.y;
      const leftT = crossXY(dx, dy, sx, sy) / denominator;
      const rightT = crossXY(dx, dy, rx, ry) / denominator;
      if (
        leftT < -intersectionTolerance || leftT > 1 + intersectionTolerance ||
        rightT < -intersectionTolerance || rightT > 1 + intersectionTolerance
      ) {
        continue;
      }
      const clampedLeft = Math.min(1, Math.max(0, leftT));
      const clampedRight = Math.min(1, Math.max(0, rightT));
      if (atAnchor(left, clampedLeft, Math.hypot(rx, ry)) || atAnchor(right, clampedRight, Math.hypot(sx, sy))) {
        continue;
      }
      keys.add(describeMarker(
        left.cellId,
        [left.geodesicId, right.geodesicId].sort(),
        { x: left.start.x + rx * clampedLeft, y: left.start.y + ry * clampedLeft },
      ));
    }
  }
  return keys;
}
