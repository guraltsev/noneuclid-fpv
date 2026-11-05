/**
 * `tests/world-objects/geodesic/tiedCarry.test.ts` — unit tier.
 *
 * End nodes of a tied curve (design 013 section 13.1). A curve tied at a shared vertex keeps its arcs when the emitter at one end is lifted or carried:
 * the carry drags the end node, every arc keeps its homotopy class (its word changes exactly by the portals the emitter crossed, also through a
 * portal), and the vertex stays where it is. A chord that runs into a forbidden zone takes the whole curve with it, and so does a failed rebuild at
 * release. A plain shot geodesic (an unshared free end) is still deleted when its emitter is lifted. The flow is not involved: without it a dragged
 * tied curve stays kinked at its vertex.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { expectSegmentsAreRealizedFromArcs } from "../../support/segmentOracle";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { moveEmitterAlongRoute, rebuildConnectedGeodesicBetweenEmitters, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { rebuildEmitterGeodesics, releaseCarriedEmitter } from "../../../src/world-objects/geodesic/carryEnd";
import { arcsOfCurve, isStale, isTied } from "../../../src/world-objects/geodesic/endpoints";
import { arcFollowsEmitter, removePlainGeodesicsFromCannon } from "../../../src/world-objects/geodesic/lifecycle";
import {
  createGeodesicArcObject,
  createGeodesicEmitterObject,
  createGeodesicVertexObject,
  geodesicRayBeamHeightMeters,
  getGeodesicCannonEmitterPoint,
} from "../../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import {
  compileLargePortalWorld,
  createCarryPortalTraversal,
  createSymmetricPairScenario,
  createTorusTiedPairScenario,
  totalGeodesicLength,
} from "../../fixtures/world-objects/geodesic";

function emitterOf(registry: ReturnType<typeof createRuntimeObjectRegistry>, id: string) {
  const emitter = registry.get(id);
  if (emitter?.kind !== "geodesicEmitters/emitter") {
    throw new Error(`Expected the emitter ${id}.`);
  }
  return emitter;
}

describe("lifting the emitter of a tied curve", () => {
  it("keeps the tied arcs and still deletes a plain shot geodesic", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    shootGeodesic({ world, registry, cannon: emitterOf(registry, "e1"), geodesicId: "g-plain", maxLengthMeters: 1.5 });
    expect(registry.get("g-plain")?.kind).toBe("geodesicModel/arc");
    expect(isTied(registry, "g-plain")).toBe(false);

    const removed = removePlainGeodesicsFromCannon(registry, "e1");

    expect(removed).toEqual(["g-plain"]);
    expect(registry.get("g-plain")).toBeUndefined();
    expect(registry.get("g1")?.kind).toBe("geodesicModel/arc");
    expect(registry.get("g2")?.kind).toBe("geodesicModel/arc");
    expect(registry.get("free")?.kind).toBe("geodesicModel/vertex");
    expect(arcFollowsEmitter(registry, "g1", "e1")).toBe(true);
    expect(arcFollowsEmitter(registry, "g1", "e2")).toBe(false);
  });
});

describe("carrying the emitter of a tied curve", () => {
  it("moves the end node, keeps the vertex and each arc's class", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const vertexBefore = registry.get("free");
    const moved = moveEmitterAlongRoute({
      registry,
      emitterId: "e1",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2.5, y: 0.5, z: 0 }),
      route: [],
    });
    expect(moved).toEqual({ moved: true, brokenGeodesicIds: [] });

    const rebuild = rebuildEmitterGeodesics({ world, registry, emitterId: "e1", preserveGeodesicOnRebuildFailure: true });

    expect(rebuild.rebuiltGeodesicIds).toEqual(["g1"]);
    expect(registry.get("free")).toBe(vertexBefore);
    expect(collectGeodesicPortalWord(registry, "g1")).toEqual([]);
    expect(isTied(registry, "g1")).toBe(true);
    expect(isStale(registry, "g1")).toBe(false);
    const start = getGeodesicSegments(registry, "g1")[0]!.start;
    const beam = getGeodesicCannonEmitterPoint(emitterOf(registry, "e1"));
    expect(Math.hypot(start.x - beam.x, start.y - beam.y)).toBeLessThan(1e-9);
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(Math.hypot(2.5, 1.5), 9);
    expect(totalGeodesicLength(registry, "g2")).toBeCloseTo(Math.hypot(2, 2), 9);
    expect(arcsOfCurve(registry, "free")).toEqual(["g1", "g2"]);
  });

  it("keeps each arc's class when the emitter crosses a portal", () => {
    const { world, registry } = createTorusTiedPairScenario();
    const leftToRight = createCarryPortalTraversal(world, "torus-room", "left-right");
    expect(collectGeodesicPortalWord(registry, "g1")).toEqual([]);
    expect(collectGeodesicPortalWord(registry, "g2")).toEqual([createCarryPortalTraversal(world, "torus-room", "right-left")]);

    const moved = moveEmitterAlongRoute({
      registry,
      emitterId: "e1",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 7.4, y: 0, z: 0 }),
      route: [leftToRight],
    });
    expect(moved.moved).toBe(true);
    rebuildEmitterGeodesics({ world, registry, emitterId: "e1", preserveGeodesicOnRebuildFailure: true });

    // g2 ended at the emitter after wrapping once to the right: the emitter's crossing undoes the wrap. g1 started at the emitter and now leaves it to the right.
    expect(collectGeodesicPortalWord(registry, "g2")).toEqual([]);
    expect(collectGeodesicPortalWord(registry, "g1")).toHaveLength(1);
    // Lengths of the classes in the developed plane: the emitter is at (7.4, 0) = (-7.6, 0) one period to the left of the vertex at (3, 2).
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(Math.hypot(10.6, 2), 9);
    expect(totalGeodesicLength(registry, "g2")).toBeCloseTo(Math.hypot(4.4, 2), 9);
    expect(isTied(registry, "g1")).toBe(true);
    expect(isTied(registry, "g2")).toBe(true);
    expect(registry.get("free")?.kind).toBe("geodesicModel/vertex");
    expectSegmentsAreRealizedFromArcs(world, registry);
  });
});

describe("a tied curve that cannot follow its emitter", () => {
  // Cell a is a 5 m square with a portal on its right side; the emitter `cannon-b` is dragged to the corner (5, 0), a forbidden zone.
  function tiedCurveInSquare() {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createCannon("cannon-a", { x: 1, y: 2.5 }));
    registry.add(createCannon("cannon-b", { x: 5, y: 0 }));
    registry.add(createGeodesicVertexObject({ id: "v", cellId: "a", point: { x: 2.5, y: 4, z: geodesicRayBeamHeightMeters } }));
    registry.add(createGeodesicArcObject({ id: "g-a", startAnchorObjectId: "cannon-a", endAnchorObjectId: "v", startCellId: "a" }));
    registry.add(createGeodesicArcObject({ id: "g-b", startAnchorObjectId: "v", endAnchorObjectId: "cannon-b", startCellId: "a" }));
    return { world, registry };
  }

  it("removes the whole curve when a chord runs into a forbidden zone", () => {
    const { world, registry } = tiedCurveInSquare();

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-b",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(rebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
    expect(registry.get("g-b")).toBeUndefined();
    expect(registry.get("v")).toBeUndefined();
  });

  it("marks an arc stale on another failed rebuild, then removes the curve at release", () => {
    const { world, registry } = tiedCurveInSquare();
    // A word through a portal that does not exist cannot be realized, which is a failure that is not a forbidden-zone hit.
    const broken = registry.get("g-b");
    if (broken?.kind !== "geodesicModel/arc") throw new Error("Expected g-b.");
    registry.update({
      ...broken,
      portalWord: [{ sourceCellId: "a", sourcePortalId: "missing", targetCellId: "b", targetPortalId: "ba" }],
    });

    const live = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-b",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });
    expect(live).toEqual(getGeodesicSegments(registry, "g-b"));
    expect(registry.get("g-b")?.kind).toBe("geodesicModel/arc");
    expect(isStale(registry, "g-b")).toBe(true);
    expect(registry.get("g-a")?.kind).toBe("geodesicModel/arc");

    const release = releaseCarriedEmitter({ world, registry, emitterId: "cannon-b" });

    expect(release.rebuiltGeodesicIds).toEqual(["g-b"]);
    expect(registry.get("g-a")).toBeUndefined();
    expect(registry.get("g-b")).toBeUndefined();
    expect(registry.get("v")).toBeUndefined();
  });
});

function createCannon(id: string, point: { readonly x: number; readonly y: number }) {
  return createGeodesicEmitterObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { ...point, z: 0 }) });
}
