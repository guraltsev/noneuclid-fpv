import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
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
import { createSegment, compileWorld, getCannonGeodesicIds } from "./fixtures";

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
});
