/**
 * `tests/world-objects/protractorTool.test.ts` — unit tier.
 *
 * A protractor angle measures between two selections, each a side of a geodesic chosen from an emitter, a segment,
 * or an endpoint-centered connected geodesic; the angle is counterclockwise from the first to the second, wrapped
 * positive, and must come from different anchors of its geodesics. These tests check selection resolution for
 * each kind, angle measurement (counterclockwise, wrapping, different-anchor requirement, custom labels), live
 * refresh from an emitter's or segment's current direction, and hiding a vertex-centered angle while its vertex is
 * temporarily missing (then restoring it).
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import {
  createProtractorAngleObject,
  protractorAngleRadiusMeters,
  protractorSelectionsUseDifferentGeodesics,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorDirectedGeodesicSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import {
  geodesicRayBeamHeightMeters,
  type GeodesicEmitterObject,
  type GeodesicCrossingObject,
  type GeodesicSegmentObject,
} from "../../src/world-objects/geodesic/objects";
import { updateGeodesicIntersectionObjects } from "../../src/world-objects/geodesic/intersections";
import { getGeodesicSegments } from "../../src/world-objects/geodesic/segments";
import { addGeodesicLeavingEmitter } from "../fixtures/world-objects/geodesic";

describe("protractor tool objects", () => {
  it("uses the ray emitter height as the center for emitter selections", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter({
      localPose: yawRigidTransform3(0, { x: 2, y: 3, z: 0.5 }),
    }));

    expect(center.point).toEqual({ x: 2, y: 3, z: 0.5 + geodesicRayBeamHeightMeters });
  });

  it("selects the side of a geodesic segment from the center toward the hit point", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createIntersection());
    const segment = createSegment({
      geodesicId: "g-a",
      start: { x: -1, y: 0, z: 1.08 },
      direction: { x: 1, y: 0, z: 0 },
      lengthMeters: 2,
    });

    const right = resolveProtractorDirectedGeodesicSelection({
      center,
      segment,
      hitPoint: { x: 0.5, y: 0, z: 1.08 },
    });
    const left = resolveProtractorDirectedGeodesicSelection({
      center,
      segment,
      hitPoint: { x: -0.5, y: 0, z: 1.08 },
    });

    expect(right?.yawRadians).toBeCloseTo(0);
    expect(Math.abs(left?.yawRadians ?? 0)).toBeCloseTo(Math.PI);
  });

  it("uses the outgoing side from an endpoint-centered connected geodesic selection", () => {
    const emitter = createEmitter({ localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }) });
    const registry = createRuntimeObjectRegistry([emitter]);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-a", Math.PI);
    const center = resolveProtractorCenterSelection(registry, emitter);
    const segment = createSegment({
      geodesicId: "g-a",
      start: { x: -1, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 1, y: 0, z: 0 },
      lengthMeters: 2,
      terminal: { kind: "emitter-hit", emitterId: "emitter-a" },
      connectionState: "connected",
    });

    const selected = resolveProtractorDirectedGeodesicSelection({
      center,
      segment,
      hitPoint: { x: 1.05, y: 0, z: geodesicRayBeamHeightMeters },
    });

    expect(Math.abs(selected?.yawRadians ?? 0)).toBeCloseTo(Math.PI);
    expect(selected?.directionSign).toBe(-1);
  });

  it("measures the second selected side counterclockwise from the first", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter());
    const angle = createProtractorAngleObject({
      id: "angle-a",
      center,
      first: { geodesicId: "g-a", segmentId: "segment-a", yawRadians: 0 },
      second: { geodesicId: "g-b", segmentId: "segment-b", yawRadians: Math.PI / 2 },
    });

    expect(angle.kind).toBe("geodesicMeasurements/angle");
    expect(angle.radiusMeters).toBe(protractorAngleRadiusMeters);
    expect(angle.angleDegrees).toBeCloseTo(90);
    expect(angle.tooltip?.label).toBe("g-a ∠ g-b = 90°");
    expect(angle.aimStickyTarget?.localPoint).toEqual(angle.labelHitbox?.center);
  });

  it("requires the second selected side to come from a different geodesic endpoint", () => {
    const first = { geodesicId: "g-a", endRole: "start" as const, segmentId: "segment-a", yawRadians: 0 };
    const second = { geodesicId: "g-a", endRole: "start" as const, segmentId: "segment-b", yawRadians: Math.PI / 2 };

    expect(protractorSelectionsUseDifferentGeodesics(first, second)).toBe(false);
    expect(() => createProtractorAngleObject({
      id: "angle-a",
      center: resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter()),
      first,
      second,
    })).toThrow("Cannot create a protractor angle from the same geodesic endpoint twice.");
  });

  it("allows measuring different endpoint roles of the same geodesic", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter());
    const first = { geodesicId: "g-a", endRole: "start" as const, segmentId: "segment-a", yawRadians: 0 };
    const second = { geodesicId: "g-a", endRole: "end" as const, segmentId: "segment-b", yawRadians: Math.PI / 2 };

    const angle = createProtractorAngleObject({ id: "angle-a", center, first, second });

    expect(protractorSelectionsUseDifferentGeodesics(first, second)).toBe(true);
    expect(angle.angleDegrees).toBeCloseTo(90);
  });

  it("uses supplied geodesic labels in the displayed angle measurement", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter());
    const angle = createProtractorAngleObject({
      id: "angle-a",
      center,
      first: { geodesicId: "g-a", label: "G1", segmentId: "segment-a", yawRadians: 0 },
      second: { geodesicId: "g-b", label: "G2", segmentId: "segment-b", yawRadians: Math.PI / 2 },
    });

    expect(angle.tooltip?.label).toBe("G1 ∠ G2 = 90°");
    expect(angle.tooltip?.desktopPrompt).toBeUndefined();
    expect(angle.tooltip?.xrPrompt).toBeUndefined();
  });

  it("wraps clockwise-looking selections into positive counterclockwise angles", () => {
    const center = resolveProtractorCenterSelection(createRuntimeObjectRegistry(), createEmitter());
    const angle = createProtractorAngleObject({
      id: "angle-a",
      center,
      first: { geodesicId: "g-a", segmentId: "segment-a", yawRadians: Math.PI / 2 },
      second: { geodesicId: "g-b", segmentId: "segment-b", yawRadians: 0 },
    });

    expect(angle.angleDegrees).toBeCloseTo(270);
  });

  it("selects a geodesic side directly from an emitter", () => {
    const emitter = createEmitter();
    const registry = createRuntimeObjectRegistry([emitter]);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-a", 0);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-b", Math.PI / 4);
    const center = resolveProtractorCenterSelection(registry, emitter);

    const selected = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: "g-b" });

    expect(selected).toEqual({
      geodesicId: "g-b",
      endRole: "start",
      segmentId: "emitter-a:g-b:emitter",
      yawRadians: Math.PI / 4,
      directionSign: 1,
    });
  });

  it("refreshes emitter-selected angle measurements from the live geodesic directions", () => {
    const emitter = createEmitter();
    const registry = createRuntimeObjectRegistry([emitter]);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-a", 0);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-b", Math.PI / 2);
    const center = resolveProtractorCenterSelection(registry, emitter);
    const first = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: "g-a" });
    const second = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: "g-b" });
    if (!first || !second) {
      throw new Error("Expected emitter protractor selections.");
    }
    const angle = createProtractorAngleObject({ id: "angle-a", center, first, second });

    const turned = getGeodesicSegments(registry, "g-b")[0];
    registry.update({ ...turned, direction: { x: -1, y: 0, z: 0 } });

    const refreshed = refreshProtractorAngleObject({ registry, angle });

    expect(refreshed?.first.yawRadians).toBeCloseTo(0);
    expect(refreshed?.second.yawRadians).toBeCloseTo(Math.PI);
    expect(refreshed?.angleDegrees).toBeCloseTo(180);
  });

  it("refreshes segment-selected angle measurements from live segment directions", () => {
    const emitter = createEmitter();
    const registry = createRuntimeObjectRegistry([emitter]);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-a", 0);
    addGeodesicLeavingEmitter(registry, emitter.id, "g-b", Math.PI / 2);
    const firstSegment = getGeodesicSegments(registry, "g-a")[0];
    const secondSegment = getGeodesicSegments(registry, "g-b")[0];
    const center = resolveProtractorCenterSelection(registry, emitter);
    const first = resolveProtractorDirectedGeodesicSelection({
      center,
      segment: firstSegment,
      hitPoint: { x: 0.5, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const second = resolveProtractorDirectedGeodesicSelection({
      center,
      segment: secondSegment,
      hitPoint: { x: 0, y: 0.5, z: geodesicRayBeamHeightMeters },
    });
    if (!first || !second) {
      throw new Error("Expected segment protractor selections.");
    }
    const angle = createProtractorAngleObject({ id: "angle-a", center, first, second });

    registry.update({
      ...secondSegment,
      direction: { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
    });

    const refreshed = refreshProtractorAngleObject({ registry, angle });

    expect(refreshed?.first.yawRadians).toBeCloseTo(0);
    expect(refreshed?.second.yawRadians).toBeCloseTo(Math.PI / 3);
    expect(refreshed?.angleDegrees).toBeCloseTo(60);
  });

  it("hides a vertex-centered angle while its vertex is missing, and restores it when it returns", () => {
    const firstSegment = createSegment({
      id: "g-a:segment:0",
      geodesicId: "g-a",
      start: { x: -1, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 1, y: 0, z: 0 },
      lengthMeters: 2,
    });
    const secondSegment = createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 0, y: -1, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    });
    const registry = createRuntimeObjectRegistry([firstSegment, secondSegment]);
    const [vertex] = updateGeodesicIntersectionObjects(registry);
    const center = resolveProtractorCenterSelection(registry, vertex);
    const first = resolveProtractorDirectedGeodesicSelection({
      center,
      segment: firstSegment,
      hitPoint: { x: 0.5, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const second = resolveProtractorDirectedGeodesicSelection({
      center,
      segment: secondSegment,
      hitPoint: { x: 0, y: 0.5, z: geodesicRayBeamHeightMeters },
    });
    if (!first || !second) {
      throw new Error("Expected vertex protractor selections.");
    }
    const angle = createProtractorAngleObject({ id: "angle-a", center, first, second });

    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 4, y: -1, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));
    updateGeodesicIntersectionObjects(registry);

    const hidden = refreshProtractorAngleObject({ registry, angle });

    expect(hidden?.portalRenderable).toBe(false);

    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 0.25, y: -1, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));
    updateGeodesicIntersectionObjects(registry);

    const restored = hidden ? refreshProtractorAngleObject({ registry, angle: hidden }) : undefined;

    expect(restored?.portalRenderable).toBe(true);
    expect(restored?.centerObjectId).toBe(vertex.id);
    expect(restored?.centerPoint).toEqual({ x: 0.25, y: 0, z: geodesicRayBeamHeightMeters });
  });
});

function createIntersection(overrides: Partial<GeodesicCrossingObject> = {}): GeodesicCrossingObject {
  return {
    id: "vertex-a",
    kind: "geodesicModel/crossing",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 1.33 }),
    aimStickyTarget: { localPoint: { x: 0, y: 0, z: 1.08 } },
    portalRenderable: true,
    geodesicIds: ["g-a", "g-b"],
    segmentIds: ["segment-a", "segment-b"],
    ...overrides,
  };
}

function createEmitter(overrides: Partial<GeodesicEmitterObject> = {}): GeodesicEmitterObject {
  return {
    id: "emitter-a",
    kind: "geodesicEmitters/emitter",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    portalRenderable: true,
    aimYawRadians: 0,
    ...overrides,
  };
}

function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesicModel/segment",
    cellId: "cell-a",
    localPose: yawRigidTransform3(0, { x: -1, y: 0, z: 1.08 }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: -1, y: 0, z: 1.08 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 2,
    terminal: { kind: "open" },
    ...overrides,
  };
}
