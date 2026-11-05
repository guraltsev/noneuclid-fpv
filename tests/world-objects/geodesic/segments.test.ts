/**
 * `tests/world-objects/geodesic/segments.test.ts` unit tier.
 *
 * The display state of the derived segments of an arc (`connectionState`): `"connected"` when both ends of the arc are on
 * emitters, `"open"` otherwise. An arc tied at a vertex is drawn open: there is no separate state for a tied arc.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicArcObject,
  createGeodesicCannonObject,
  createGeodesicVertexObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
import { isTied } from "../../../src/world-objects/geodesic/endpoints";
import { rebuildDerivedGeodesicSegments, splitGeodesicIntervalAtSegmentHit } from "../../../src/world-objects/geodesic/intervals";
import { shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { removeGeodesic } from "../../../src/world-objects/geodesic/lifecycle";
import { getGeodesicSegments, removeGeodesicSegments, resolveGeodesicNumber } from "../../../src/world-objects/geodesic/segments";
import { compileLargeWorld, createSymmetricPairScenario, runCurveShorteningUntilPairGone } from "../../fixtures/world-objects/geodesic";

function addEmitter(registry: ReturnType<typeof createRuntimeObjectRegistry>, id: string, x: number, y: number): void {
  registry.add(createGeodesicCannonObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
}

function addArc(registry: ReturnType<typeof createRuntimeObjectRegistry>, id: string, start: string, end: string): void {
  registry.add(createGeodesicArcObject({ id, startAnchorObjectId: start, endAnchorObjectId: end, startCellId: "a" }));
}

describe("derived segment display state", () => {
  it("draws the segments of a tied arc open", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    addEmitter(registry, "e1", -2, -1);
    addEmitter(registry, "e2", 2, -1);
    registry.add(createGeodesicVertexObject({ id: "v", cellId: "a", point: { x: 0, y: 1, z: geodesicRayBeamHeightMeters } }));
    addArc(registry, "g0", "e1", "v");
    addArc(registry, "g1", "v", "e2");
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g0" })).toBeTruthy();
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" })).toBeTruthy();

    expect(isTied(registry, "g0")).toBe(true);
    const segments = getGeodesicSegments(registry, "g0");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.connectionState === "open")).toBe(true);
  });

  it("marks the segments of an arc with an emitter at each end connected", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    addEmitter(registry, "e1", -2, 0);
    addEmitter(registry, "e2", 2, 0);
    addArc(registry, "g0", "e1", "e2");
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g0" })).toBeTruthy();

    const segments = getGeodesicSegments(registry, "g0");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.connectionState === "connected")).toBe(true);
  });
});

describe("display numbers are stored on the arc", () => {
  function shootThree() {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }) }));
    const cannon = () => {
      const object = registry.get("cannon-a");
      if (object?.kind !== "geodesic-cannon") {
        throw new Error("Expected the emitter.");
      }
      return object;
    };
    for (const geodesicId of ["g-a", "g-b", "g-c"]) {
      shootGeodesic({ world, registry, cannon: cannon(), geodesicId, maxLengthMeters: 2 });
    }
    return { world, registry, cannon };
  }

  it("keeps a geodesic's number after its segments are removed and rebuilt", () => {
    const { world, registry } = shootThree();
    removeGeodesic(registry, "g-a");
    expect(resolveGeodesicNumber(registry, "g-c")).toBe(3);

    removeGeodesicSegments(registry, "g-c");
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-c" })).toBeTruthy();

    expect(resolveGeodesicNumber(registry, "g-c")).toBe(3);
    expect(getGeodesicSegments(registry, "g-c").every((segment) => segment.geodesicNumber === 3)).toBe(true);
    expect(getGeodesicSegments(registry, "g-c")[0]?.tooltip?.label).toBe("Geodesic G3");
  });

  it("gives the continuation of a split the next free number", () => {
    const { world, registry } = shootThree();
    registry.add(createGeodesicCannonObject({ id: "placed", cellId: "a", localPose: yawRigidTransform3(0, { x: -0.5, y: 0, z: 0 }) }));

    const surviving = splitGeodesicIntervalAtSegmentHit({
      world,
      registry,
      geodesicId: "g-b",
      segmentId: "g-b:segment:0",
      distanceAlongSegmentMeters: 0.8,
      placedEmitterId: "placed",
      createContinuationGeodesicId: (id) => `${id}:rest`,
    });

    expect(surviving.map((arc) => arc.id)).toEqual(["g-b", "g-b:rest"]);
    expect(resolveGeodesicNumber(registry, "g-b")).toBe(2);
    expect(resolveGeodesicNumber(registry, "g-b:rest")).toBe(4);
    expect(getGeodesicSegments(registry, "g-b:rest").every((segment) => segment.geodesicNumber === 4)).toBe(true);
  });

  it("keeps the surviving arc's number when the flow merges two arcs", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    for (const [id, geodesicNumber] of [["g1", 3], ["g2", 5]] as const) {
      const arc = registry.get(id);
      if (arc?.kind !== "geodesicModel/arc") {
        throw new Error("Expected an arc.");
      }
      registry.update({ ...arc, geodesicNumber });
    }

    runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: 1 / 60, maxTicks: 4000 });

    expect(registry.get("g2")).toBeUndefined();
    expect(resolveGeodesicNumber(registry, "g1")).toBe(3);
    expect(getGeodesicSegments(registry, "g1").every((segment) => segment.geodesicNumber === 3)).toBe(true);
  });

  it("reads a number without changing the registry", () => {
    const { registry } = shootThree();
    const before = registry.getVersion();

    resolveGeodesicNumber(registry, "g-b");
    resolveGeodesicNumber(registry, "unknown");

    expect(registry.getVersion()).toBe(before);
  });
});
