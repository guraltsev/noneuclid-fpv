import { describe, expect, it, vi } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import {
  updateGeodesicIntersectionObjects,
  withDeferredGeodesicIntersections,
} from "../../../src/world-objects/geodesic/intersections";
import { collectLockedIncidentGeodesicIdsForEmitter, removeGeodesic } from "../../../src/world-objects/geodesic/lifecycle";
import { geodesicPerfCounters, resetGeodesicPerfCounters } from "../../../src/world-objects/geodesic/perfCounters";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { realizeIntervalChord } from "../../../src/world-objects/geodesic/intervals";
import {
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
import { compileLargePortalWorld, compileLargeWorld, createTorusLoopBenchmarkScene } from "./fixtures";

function countSegments(registry: ReturnType<typeof createRuntimeObjectRegistry>): number {
  return registry.getObjectsOfKind("geodesic-segment").length;
}

describe("geodesic rebuild performance", () => {
  it("B1: a carry frame of 10 loops and 200 segments does one intersection pass, at most 10 chord traces and no getAll()", () => {
    const { world, registry, words } = createTorusLoopBenchmarkScene();
    expect(countSegments(registry)).toBeGreaterThanOrEqual(195);
    expect(countSegments(registry)).toBeLessThanOrEqual(205);

    const before = registry.get("e");
    if (before?.kind !== "geodesic-cannon") {
      throw new Error("Expected the emitter.");
    }
    registry.update({ ...before, localPose: yawRigidTransform3(0, { x: -1.95, y: 1.95, z: 0 }) });
    resetGeodesicPerfCounters();
    const getAll = vi.spyOn(registry, "getAll");
    const startedAt = performance.now();
    withDeferredGeodesicIntersections(registry, () => {
      for (const id of collectLockedIncidentGeodesicIdsForEmitter(registry, "e")) {
        rebuildConnectedGeodesicBetweenEmitters({
          world,
          registry,
          geodesicId: id,
          carriedEmitterId: "e",
          carriedEmitterBeforeMove: before,
          preserveGeodesicOnRebuildFailure: true,
          allowOutOfBoundsCarriedEndpoint: true,
        });
      }
    });
    console.info(
      `carry frame: ${(performance.now() - startedAt).toFixed(1)} ms, ` +
        `${geodesicPerfCounters.intersectionPasses} intersection passes, ${geodesicPerfCounters.chordTraces} chord traces`,
    );

    expect(geodesicPerfCounters.intersectionPasses).toBeLessThanOrEqual(1);
    expect(geodesicPerfCounters.chordTraces).toBeLessThanOrEqual(10);
    expect(getAll).not.toHaveBeenCalled();
    for (let j = 0; j < 10; j += 1) {
      expect(getGeodesicSegments(registry, `loop-${j}`).length).toBeGreaterThan(0);
      expect(registry.get(`loop-${j}`)).toMatchObject({ portalWord: words.get(`loop-${j}`) });
    }
  });

  it("B2: a public call makes one intersection pass", () => {
    const { world, registry } = createTorusLoopBenchmarkScene();

    resetGeodesicPerfCounters();
    removeGeodesic(registry, "loop-0");
    expect(geodesicPerfCounters.intersectionPasses).toBe(1);

    resetGeodesicPerfCounters();
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "loop-1" });
    expect(geodesicPerfCounters.intersectionPasses).toBe(1);
    expect(geodesicPerfCounters.chordTraces).toBe(1);
  });

  it("C1: a live carry rebuild that ends in a forbidden zone traces the chord once and deletes the interval", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }) }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    resetGeodesicPerfCounters();
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(rebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
    expect(geodesicPerfCounters.chordTraces).toBe(1);
  });

  it("C2: a failed live carry rebuild that is preserved traces the chord once", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
      portalWord: [{ sourceCellId: "a", sourcePortalId: "ab", targetCellId: "b", targetPortalId: "ba" }],
    }));

    // The carried end is moved below the floor edge of cell b, so the straight chord from cannon-a hits the wall y = 0 before the portal.
    const carried = registry.get("cannon-b");
    if (carried?.kind !== "geodesic-cannon") {
      throw new Error("Expected the carried emitter.");
    }
    registry.update({ ...carried, localPose: yawRigidTransform3(Math.PI, { x: 1, y: -3, z: 0 }) });

    resetGeodesicPerfCounters();
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });

    expect(rebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");
    expect(geodesicPerfCounters.chordTraces).toBe(1);
  });

  it("C3: realizeIntervalChord classifies a chord with one trace", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    const realize = (freeEndPoint: { x: number; y: number }) => {
      registry.remove("tip");
      registry.remove("g-tip");
      registry.add(createFreeGeodesicEndObject({ id: "tip", cellId: "a", point: { ...freeEndPoint, z: geodesicRayBeamHeightMeters } }));
      const interval = createGeodesicIntervalObject({ id: "g-tip", startAnchorObjectId: "cannon-a", endAnchorObjectId: "tip", startCellId: "a" });
      registry.add(interval);
      resetGeodesicPerfCounters();
      const realization = realizeIntervalChord({ world, registry, interval });
      return realization;
    };

    expect(realize({ x: 1, y: 0 }).kind).toBe("ok");
    expect(geodesicPerfCounters.chordTraces).toBe(1);

    const wall = realize({ x: 5, y: 0 });
    expect(wall).toMatchObject({ kind: "wall", sideIndex: 1 });
    expect(geodesicPerfCounters.chordTraces).toBe(1);

    const degenerate = realize({ x: -1.9, y: 0 });
    expect(degenerate.kind).toBe("degenerate");
    expect(geodesicPerfCounters.chordTraces).toBe(0);
  });

  it("C3: realizeIntervalChord reports the junction of a forbidden-zone hit", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }) }));
    const interval = createGeodesicIntervalObject({ id: "g-a", startAnchorObjectId: "cannon-a", endAnchorObjectId: "cannon-b", startCellId: "a" });
    registry.add(interval);

    const realization = realizeIntervalChord({ world, registry, interval });

    expect(realization.kind).toBe("zone");
    expect(realization.kind === "zone" ? realization.junctionId : "").not.toBe("");
  });

  it("B3: nested deferral scopes coalesce into one pass, also when the body throws", () => {
    const { registry } = createTorusLoopBenchmarkScene();
    updateGeodesicIntersectionObjects(registry);

    resetGeodesicPerfCounters();
    withDeferredGeodesicIntersections(registry, () =>
      withDeferredGeodesicIntersections(registry, () => {
        removeGeodesic(registry, "loop-0");
        removeGeodesic(registry, "loop-1");
      })
    );
    expect(geodesicPerfCounters.intersectionPasses).toBe(1);
    const markers = registry.getObjectsOfKind("geodesic-intersection");
    expect(markers.some((marker) => marker.geodesicIds.some((id) => id === "loop-0" || id === "loop-1"))).toBe(false);
    expect(markers.some((marker) => marker.geodesicIds.includes("loop-2"))).toBe(true);

    resetGeodesicPerfCounters();
    expect(() =>
      withDeferredGeodesicIntersections(registry, () => {
        removeGeodesic(registry, "loop-2");
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(geodesicPerfCounters.intersectionPasses).toBe(1);
    expect(registry.getObjectsOfKind("geodesic-intersection").some((marker) =>
      marker.geodesicIds.includes("loop-2")
    )).toBe(false);
  });
});
