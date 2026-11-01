/**
 * `tests/world-objects/geodesic/moveEmitter.test.ts` — unit tier.
 *
 * `moveEmitterAlongRoute` is the one way to change the cell of an emitter that anchors a locked geodesic: it stores the
 * new cell and pose and extends the portal word of each such geodesic by the portals crossed, so the word always leads to
 * the cell the emitter is in. The move is all or nothing. These tests check that the word follows the emitter across a
 * portal and back, that a move the route does not explain is refused and reported, with the emitter and the word left
 * as they were, and that an emitter without locked geodesics just moves.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { moveEmitterAlongRoute, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import { createGeodesicCannonObject } from "../../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord } from "../../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld, createCarryPortalTraversal } from "../../fixtures/world-objects/geodesic";

function lockedPair() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") {
    throw new Error("Expected the source emitter.");
  }
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

  return { world, registry };
}

const wordOf = (registry: ReturnType<typeof createRuntimeObjectRegistry>) =>
  collectGeodesicPortalWord(registry, "g-a").map((step) => `${step.sourceCellId}>${step.targetCellId}`);

describe("moveEmitterAlongRoute", () => {
  it("extends the geodesic's word by the portal crossed, and shortens it crossing back", () => {
    const { world, registry } = lockedPair();
    expect(wordOf(registry)).toEqual(["a>b"]);

    const back = moveEmitterAlongRoute({
      registry,
      emitterId: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.5, y: 2.5, z: 0 }),
      route: [createCarryPortalTraversal(world, "b", "ba")],
    });

    expect(back).toEqual({ moved: true, brokenGeodesicIds: [] });
    expect(registry.get("cannon-b")).toMatchObject({ cellId: "a" });
    expect(wordOf(registry)).toEqual([]);
  });

  it("refuses a move the route does not explain and changes nothing", () => {
    const { world, registry } = lockedPair();

    const wrongRoute = moveEmitterAlongRoute({
      registry,
      emitterId: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.5, y: 2.5, z: 0 }),
      route: [createCarryPortalTraversal(world, "a", "ab")],
    });
    const noRoute = moveEmitterAlongRoute({
      registry,
      emitterId: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.5, y: 2.5, z: 0 }),
      route: [],
    });

    expect(wrongRoute).toEqual({ moved: false, brokenGeodesicIds: ["g-a"] });
    expect(noRoute).toEqual({ moved: false, brokenGeodesicIds: ["g-a"] });
    expect(registry.get("cannon-b")).toMatchObject({ cellId: "b" });
    expect(wordOf(registry)).toEqual(["a>b"]);
  });

  it("moves within a cell without touching the word", () => {
    const { registry } = lockedPair();

    const result = moveEmitterAlongRoute({
      registry,
      emitterId: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1.5, y: 3, z: 0 }),
      route: [],
    });

    expect(result).toEqual({ moved: true, brokenGeodesicIds: [] });
    expect(registry.get("cannon-b")).toMatchObject({ cellId: "b" });
    expect(wordOf(registry)).toEqual(["a>b"]);
  });

  it("moves an emitter that has no locked geodesic, and ignores an unknown emitter", () => {
    const { world, registry } = lockedPair();
    registry.add(createGeodesicCannonObject({ id: "cannon-c", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }) }));

    const moved = moveEmitterAlongRoute({
      registry,
      emitterId: "cannon-c",
      cellId: "b",
      localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }),
      route: [createCarryPortalTraversal(world, "a", "ab")],
    });

    expect(moved).toEqual({ moved: true, brokenGeodesicIds: [] });
    expect(registry.get("cannon-c")).toMatchObject({ cellId: "b" });
    expect(moveEmitterAlongRoute({ registry, emitterId: "nobody", cellId: "a", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }), route: [] }).moved).toBe(false);
  });
});
