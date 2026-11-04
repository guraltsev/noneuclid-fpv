/**
 * `tests/world-objects/geodesic/geodesicRebuildOutcomes.test.ts` — unit tier.
 *
 * `rebuildConnectedGeodesicBetweenEmitters` rebuilds a geodesic (or, carrying an emitter, several at once) after a
 * change, preserving it when the rebuild fails and the caller asked to preserve it, or deleting it when the
 * rebuilt chord lands in a forbidden zone; `realizeIntervalChord` classifies a straight chord between two anchors
 * as feasible, blocked by a wall, blocked by a zone, or degenerate (too short to realize). `withDeferredGeodesicIntersections`
 * batches intersection-marker recomputation, including across nested scopes and when the wrapped body throws.
 * These tests check each rebuild/classification outcome and that nested deferred scopes still leave the right
 * markers in place, with or without an error. (Rewritten from a performance test that asserted internal pass and
 * trace counters and spied on the registry; those are implementation, not behaviour — see `_docs/tests.md` §2.2.
 * A `carrying 10 loops through a frame` perf number, if wanted again, belongs in a `scripts/bench/` script.)
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import {
  updateGeodesicIntersectionObjects,
  withDeferredGeodesicIntersections,
} from "../../../src/world-objects/geodesic/intersections";
import { collectConnectingArcIdsForEmitter, removeGeodesic } from "../../../src/world-objects/geodesic/lifecycle";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { realizeIntervalChord } from "../../../src/world-objects/geodesic/intervals";
import {
  createGeodesicVertexObject,
  createGeodesicCannonObject,
  createGeodesicArcObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
import { compileLargePortalWorld, compileLargeWorld, createTorusLoopBenchmarkScene } from "../../fixtures/world-objects/geodesic";

describe("geodesic rebuild outcomes", () => {
  it("keeps every carried loop's segments and portal word after moving the shared emitter", () => {
    const { world, registry, words } = createTorusLoopBenchmarkScene();
    const before = registry.get("e");
    if (before?.kind !== "geodesic-cannon") {
      throw new Error("Expected the emitter.");
    }
    registry.update({ ...before, localPose: yawRigidTransform3(0, { x: -1.95, y: 1.95, z: 0 }) });

    withDeferredGeodesicIntersections(registry, () => {
      for (const id of collectConnectingArcIdsForEmitter(registry, "e")) {
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

    for (let j = 0; j < 10; j += 1) {
      expect(getGeodesicSegments(registry, `loop-${j}`).length).toBeGreaterThan(0);
      expect(registry.get(`loop-${j}`)).toMatchObject({ portalWord: words.get(`loop-${j}`) });
    }
  });

  it("deletes a carry rebuild that lands in a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }) }));
    registry.add(createGeodesicArcObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

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
  });

  it("preserves a carry rebuild that fails when the caller asks to preserve it", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicArcObject({
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

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });

    expect(rebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesicModel/arc");
  });

  it("classifies a straight chord as feasible, wall-blocked, or too short to realize", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    const realize = (freeEndPoint: { x: number; y: number }) => {
      registry.remove("tip");
      registry.remove("g-tip");
      registry.add(createGeodesicVertexObject({ id: "tip", cellId: "a", point: { ...freeEndPoint, z: geodesicRayBeamHeightMeters } }));
      const interval = createGeodesicArcObject({ id: "g-tip", startAnchorObjectId: "cannon-a", endAnchorObjectId: "tip", startCellId: "a" });
      registry.add(interval);
      return realizeIntervalChord({ world, registry, interval });
    };

    expect(realize({ x: 1, y: 0 }).kind).toBe("ok");
    expect(realize({ x: 5, y: 0 })).toMatchObject({ kind: "wall", sideIndex: 1 });
    expect(realize({ x: -1.9, y: 0 }).kind).toBe("degenerate");
  });

  it("reports the junction of a chord blocked by a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }) }));
    const interval = createGeodesicArcObject({ id: "g-a", startAnchorObjectId: "cannon-a", endAnchorObjectId: "cannon-b", startCellId: "a" });
    registry.add(interval);

    const realization = realizeIntervalChord({ world, registry, interval });

    expect(realization.kind).toBe("zone");
    expect(realization.kind === "zone" ? realization.junctionId : "").not.toBe("");
  });

  it("keeps intersection markers correct across nested deferred scopes, even if the body throws", () => {
    const { registry } = createTorusLoopBenchmarkScene();
    updateGeodesicIntersectionObjects(registry);

    withDeferredGeodesicIntersections(registry, () =>
      withDeferredGeodesicIntersections(registry, () => {
        removeGeodesic(registry, "loop-0");
        removeGeodesic(registry, "loop-1");
      })
    );
    const markers = registry.getObjectsOfKind("geodesicModel/crossing");
    expect(markers.some((marker) => marker.geodesicIds.some((id) => id === "loop-0" || id === "loop-1"))).toBe(false);
    expect(markers.some((marker) => marker.geodesicIds.includes("loop-2"))).toBe(true);

    expect(() =>
      withDeferredGeodesicIntersections(registry, () => {
        removeGeodesic(registry, "loop-2");
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(registry.getObjectsOfKind("geodesicModel/crossing").some((marker) =>
      marker.geodesicIds.includes("loop-2")
    )).toBe(false);
  });
});
