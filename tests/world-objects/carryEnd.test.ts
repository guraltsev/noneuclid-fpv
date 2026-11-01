/**
 * `tests/world-objects/carryEnd.test.ts` — unit tier.
 *
 * What an emitter does to its geodesics when it has been carried (`src/world-objects/geodesic/carryEnd.ts`): the rebuild after a move and the
 * final rebuild at release. The scene is the cube with a locked geodesic from an
 * emitter on the front face to one on the right face, the carried one.
 */
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { vec3 } from "../../src/math/vec3";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { rebuildEmitterGeodesics, releaseCarriedEmitter } from "../../src/world-objects/geodesic/carryEnd";
import { moveEmitterAlongRoute, shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { isGeodesicLocked } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord } from "../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

function lockedCube() {
  const world = compileCellComplex(cube);
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({
    id: "cannon-a",
    cellId: "front",
    localPose: yawRigidTransform3(Math.atan2(-0.6299138870477234, 0.776664982411611), vec3(5.356468478410459, 1.3724895861593076, 0)),
  }));
  registry.add(createGeodesicCannonObject({
    id: "cannon-b",
    cellId: "right",
    localPose: yawRigidTransform3(0, vec3(-2.4644086473935514, -4.450135738386821, 0)),
  }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") {
    throw new Error("Expected the source emitter.");
  }
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 12 });
  expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  return { world, registry };
}

// Moves the carried emitter a little inside its cell, the way a carry step does, so that the geodesic is stale until it is rebuilt.
function nudgeCarriedEmitter(registry: ReturnType<typeof lockedCube>["registry"]): void {
  const emitter = registry.get("cannon-b");
  if (emitter?.kind !== "geodesic-cannon") {
    throw new Error("Expected the carried emitter.");
  }
  const moved = moveEmitterAlongRoute({
    registry,
    emitterId: "cannon-b",
    cellId: emitter.cellId,
    localPose: yawRigidTransform3(emitter.aimYawRadians, vec3(emitter.localPose.translation.x + 0.5, emitter.localPose.translation.y, 0)),
    route: [],
  });
  expect(moved.moved).toBe(true);
}

describe("rebuilding an emitter's geodesics after it moved", () => {
  it("rebuilds the locked geodesic incident to the emitter and keeps it chained", () => {
    const { world, registry } = lockedCube();
    nudgeCarriedEmitter(registry);

    const rebuild = rebuildEmitterGeodesics({ world, registry, emitterId: "cannon-b", preserveGeodesicOnRebuildFailure: true });

    expect(rebuild.rebuiltGeodesicIds).toEqual(["g-a"]);
    expect(rebuild.regrownActiveGeodesicId).toBeUndefined();
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    const word = collectGeodesicPortalWord(registry, "g-a");
    word.slice(1).forEach((traversal, index) => expect(traversal.sourceCellId).toBe(word[index].targetCellId));
    expect(word.at(-1)?.targetCellId ?? "front").toBe(registry.get("cannon-b")?.cellId);
  });

  it("does nothing for an object that is not an emitter", () => {
    const { world, registry } = lockedCube();

    expect(rebuildEmitterGeodesics({ world, registry, emitterId: "g-a" })).toEqual({ rebuiltGeodesicIds: [] });
  });
});

describe("releasing a carried emitter", () => {
  it("rebuilds its geodesic one last time and leaves it locked and chained", () => {
    const { world, registry } = lockedCube();
    nudgeCarriedEmitter(registry);

    const release = releaseCarriedEmitter({ world, registry, emitterId: "cannon-b" });

    expect(release.rebuiltGeodesicIds).toEqual(["g-a"]);
    expect(release.prunedIntersectionIds).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    const word = collectGeodesicPortalWord(registry, "g-a");
    word.slice(1).forEach((traversal, index) => expect(traversal.sourceCellId).toBe(word[index].targetCellId));
    expect(word.at(-1)?.targetCellId ?? "front").toBe(registry.get("cannon-b")?.cellId);
  });

  it("leaves the emitter where it was put and changes nothing for an emitter with no geodesics", () => {
    const { world, registry } = lockedCube();
    registry.add(createGeodesicCannonObject({ id: "lone", cellId: "top", localPose: yawRigidTransform3(0, vec3(1, 1, 0)) }));
    const before = registry.get("lone");

    const release = releaseCarriedEmitter({ world, registry, emitterId: "lone" });

    expect(release.rebuiltGeodesicIds).toEqual([]);
    expect(registry.get("lone")).toBe(before);
  });
});
