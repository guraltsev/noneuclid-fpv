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
import { createTorusLoopBenchmarkScene } from "./fixtures";

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
