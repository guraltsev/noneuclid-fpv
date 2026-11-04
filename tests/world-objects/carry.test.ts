/**
 * `tests/world-objects/carry.test.ts` — unit tier.
 *
 * The carry contract (`src/world-objects/carry.ts`): an object that can be carried reacts to a stream of displacement steps.
 * The scenarios are those of design 012, P4: carrier and object in one cell; the object one and two portals away; the carrier crossing a portal
 * while carrying; the step sweeping across or ending in a junction's exclusion zone (the object stops short, as against a wall, and stays carried); the
 * step against a wall (the object stops short); a locked geodesic kept chained through all of it; the yaw turned with a quarter-turned face. Further tests pin down the rules of
 * the stream: a long target is several steps in order, a lost frame changes nothing, pickup glides without jumping, and steps are never merged.
 * Two worlds: two square rooms side by side (`a` -> `b` through the whole side x = 5, walls elsewhere) and the cube (every side a portal,
 * every corner a junction, neighbouring faces quarter-turned).
 */
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellPoint } from "../../src/cell-complex/portalRoute";
import { vec3 } from "../../src/math/vec3";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import {
  canBeCarried,
  carryMaxSpeedMetersPerSecond,
  carryStepCapMeters,
  carryTowardTarget,
  displacementToTarget,
  locateCarrierTarget,
  reactToDisplacement,
  remainingToTarget,
  type CarriedPlace,
  type CarryMove,
} from "../../src/world-objects/carry";
import { shootGeodesic, moveEmitterAlongRoute } from "../../src/world-objects/geodesic/cannon";
import { arcConnectsEmitters } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject, emitterConnectionToleranceMeters } from "../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord } from "../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";

const cubeWorld = (): CompiledCellComplex => compileCellComplex(cube);

function placeIn(cellId: string, x: number, y: number, yawRadians = 0): CarriedPlace {
  return { cellId, position: vec3(x, y, 0), yawRadians };
}

function target(cellId: string, x: number, y: number): CellPoint {
  return { cellId, point: vec3(x, y, 0) };
}

function asMove(reaction: ReturnType<typeof reactToDisplacement>): CarryMove {
  if (!("placement" in reaction)) {
    throw new Error(`Expected a move, got ${JSON.stringify(reaction)}.`);
  }
  return reaction;
}

// Carries `object` toward `to`, applying every accepted move to the place; returns the final place and the moves in order.
function carry(world: CompiledCellComplex, object: CarriedPlace, to: CellPoint, maxTravelMeters?: number) {
  const moves: CarryMove[] = [];
  const advance = carryTowardTarget({
    world,
    object,
    target: to,
    maxTravelMeters,
    commit: (move) => {
      moves.push(move);
      return true;
    },
  });
  return { ...advance, moves };
}

describe("the capability", () => {
  it("is declared by the emitter's constructor and by nothing else by default", () => {
    const emitter = createGeodesicCannonObject({ id: "e", cellId: "a", localPose: yawRigidTransform3(0, vec3(1, 1, 0)) });

    expect(canBeCarried(emitter)).toBe(true);
    expect(canBeCarried({})).toBe(false);
  });
});

describe("one displacement step", () => {
  it("moves the object inside its cell", () => {
    const world = compileLargePortalWorld();
    const move = asMove(reactToDisplacement({ world, object: placeIn("a", 2, 2), step: { x: 0.5, y: -0.25 } }));

    expect(move.placement.cellId).toBe("a");
    expect(move.placement.position.x).toBeCloseTo(2.5, 9);
    expect(move.placement.position.y).toBeCloseTo(1.75, 9);
    expect(move.route).toEqual([]);
  });

  it("re-homes the object across a portal and reports the portal read off the walk", () => {
    const world = compileLargePortalWorld();
    const move = asMove(reactToDisplacement({ world, object: placeIn("a", 4.6, 2.5), step: { x: 0.8, y: 0 } }));

    expect(move.placement.cellId).toBe("b");
    expect(move.placement.position.x).toBeCloseTo(0.4, 9);
    expect(move.placement.position.y).toBeCloseTo(2.5, 9);
    expect(move.route.map((hop) => [hop.sourceCellId, hop.sourcePortalId, hop.targetCellId, hop.targetPortalId])).toEqual([["a", "ab", "b", "ba"]]);
  });

  it("refuses a step longer than the cap", () => {
    const world = compileLargePortalWorld();

    expect(reactToDisplacement({ world, object: placeIn("a", 1, 1), step: { x: carryStepCapMeters + 0.1, y: 0 } })).toEqual({ stay: "step-exceeds-cap" });
  });

  it("stops just short of a wall", () => {
    const world = compileLargePortalWorld();
    const move = asMove(reactToDisplacement({ world, object: placeIn("a", 2.5, 4.5), step: { x: 0, y: 1 } }));

    expect(move.placement.cellId).toBe("a");
    expect(move.placement.position.y).toBeGreaterThan(4.9);
    expect(move.placement.position.y).toBeLessThan(5);
    expect(move.stoppedByWall).toBe(true);
  });

  it("stays when it already stands against the wall", () => {
    const world = compileLargePortalWorld();
    const against = asMove(reactToDisplacement({ world, object: placeIn("a", 2.5, 4.5), step: { x: 0, y: 1 } })).placement;

    expect(reactToDisplacement({ world, object: { ...placeIn("a", 0, 0), ...against }, step: { x: 0, y: 0.5 } })).toEqual({ stay: "wall" });
  });

  describe("an exclusion zone is a wall", () => {
    const cubeCorner = { x: 7.5, y: -7.5 };
    const awayFrom = (move: CarryMove, corner: { x: number; y: number }) =>
      Math.hypot(move.placement.position.x - corner.x, move.placement.position.y - corner.y);

    it("cuts a step that sweeps through a junction short, just before the zone", () => {
      const world = compileLargePortalWorld();

      // Straight at the corner (7.5, -7.5) of the cube's right face: it stops 0.15 m (the zone) before it.
      const head = asMove(reactToDisplacement({ world: cubeWorld(), object: placeIn("right", 7, -7), step: { x: 0.7071, y: -0.7071 } }));
      expect(head.stoppedByZone).toBe(true);
      expect(head.placement.cellId).toBe("right");
      expect(awayFrom(head, cubeCorner)).toBeGreaterThanOrEqual(0.15);
      expect(awayFrom(head, cubeCorner)).toBeLessThan(0.15 + 1e-4);
      // A legal crossing of the portal, but within the exclusion zone (0.15 m) of the corner (5, 0): it stops in `a`, before the portal.
      const sweep = asMove(reactToDisplacement({ world, object: placeIn("a", 4.5, 0.1), step: { x: 1, y: 0 } }));
      expect(sweep.stoppedByZone).toBe(true);
      expect(sweep.placement.cellId).toBe("a");
      expect(sweep.route).toEqual([]);
      expect(sweep.placement.position.x).toBeCloseTo(5 - Math.sqrt(0.15 ** 2 - 0.1 ** 2), 4);
      // The same crossing farther from the corner is not cut short.
      const clear = asMove(reactToDisplacement({ world, object: placeIn("a", 4.5, 0.6), step: { x: 1, y: 0 } }));
      expect(clear.stoppedByZone).toBeUndefined();
      expect(clear.placement.cellId).toBe("b");
    });

    it("widens the exclusion zone by the body radius", () => {
      const world = compileLargePortalWorld();
      const object = { ...placeIn("a", 4.5, 0.4), radiusMeters: emitterConnectionToleranceMeters };

      const move = asMove(reactToDisplacement({ world, object, step: { x: 1, y: 0 } }));
      expect(move.stoppedByZone).toBe(true);
      expect(move.placement.position.x).toBeCloseTo(5 - Math.sqrt((0.15 + emitterConnectionToleranceMeters) ** 2 - 0.4 ** 2), 4);
    });

    it("applies to an object with no body radius too, using the zone radius alone", () => {
      const world = compileLargePortalWorld();
      const move = asMove(reactToDisplacement({ world, object: placeIn("a", 4, 0.05), step: { x: 0.95, y: 0 } }));

      expect(move.stoppedByZone).toBe(true);
      expect(move.placement.position.x).toBeCloseTo(5 - Math.sqrt(0.15 ** 2 - 0.05 ** 2), 4);
    });

    it("stops an emitter whose body would end inside a zone, without destroying or detaching it", () => {
      const object = { ...placeIn("right", 7, -7), radiusMeters: emitterConnectionToleranceMeters };

      // Ends at (7.4, -7.4), 0.14 m from the corner, inside the zone widened by the body (0.15 + 0.3 m).
      const stopped = asMove(reactToDisplacement({ world: cubeWorld(), object, step: { x: 0.4, y: -0.4 } }));
      expect(stopped.stoppedByZone).toBe(true);
      expect(awayFrom(stopped, cubeCorner)).toBeGreaterThanOrEqual(0.15 + emitterConnectionToleranceMeters);
      // The same direction ending clear of the zone and the body is a plain move.
      expect(asMove(reactToDisplacement({ world: cubeWorld(), object, step: { x: 0.1, y: -0.1 } })).stoppedByZone).toBeUndefined();
    });

    it("stays when it already stands against the zone and the step goes on toward it", () => {
      const object = { ...placeIn("right", 7, -7), radiusMeters: emitterConnectionToleranceMeters };
      const against = asMove(reactToDisplacement({ world: cubeWorld(), object, step: { x: 0.4, y: -0.4 } })).placement;

      expect(reactToDisplacement({ world: cubeWorld(), object: { ...object, ...against }, step: { x: 0.2, y: -0.2 } })).toEqual({ stay: "zone" });
    });

    it("moves away from a zone it stands against, and along it", () => {
      const object = { ...placeIn("right", 7, -7), radiusMeters: emitterConnectionToleranceMeters };
      const against = { ...object, ...asMove(reactToDisplacement({ world: cubeWorld(), object, step: { x: 0.4, y: -0.4 } })).placement };

      const back = asMove(reactToDisplacement({ world: cubeWorld(), object: against, step: { x: -0.2, y: 0.2 } }));
      expect(back.stoppedByZone).toBeUndefined();
      expect(awayFrom(back, cubeCorner)).toBeGreaterThan(awayFrom({ placement: against, route: [] }, cubeCorner));
    });
  });

  it("turns the yaw with the face crossed, on the cube", () => {
    const world = cubeWorld();
    // Right face, near its side 0, which is glued to the bottom face with a quarter turn.
    const move = asMove(reactToDisplacement({ world, object: placeIn("right", 0, -7, 0.3), step: { x: 0, y: -1 } }));

    expect(move.placement.cellId).toBe("bottom");
    expect(Math.cos(move.placement.yawRadians - (0.3 - Math.PI / 2))).toBeCloseTo(1, 9);
    expect(move.route).toHaveLength(1);
  });
});

describe("the stream of steps", () => {
  it("applies a long target as several steps in order, none longer than the cap", () => {
    const world = compileLargePortalWorld();
    const { moves, end, place } = carry(world, placeIn("a", 1, 2.5), target("a", 4.5, 2.5));

    expect(end).toBe("arrived");
    expect(moves.length).toBe(4);
    const xs = moves.map((move) => move.placement.position.x);
    expect(xs).toEqual([...xs].sort((left, right) => left - right));
    xs.forEach((x, index) => expect(x - (index === 0 ? 1 : xs[index - 1])).toBeLessThanOrEqual(carryStepCapMeters + 1e-9));
    expect(place.position.x).toBeCloseTo(4.5, 9);
  });

  it("glides to a target in the next room across the portal", () => {
    const world = compileLargePortalWorld();
    const { place, end } = carry(world, placeIn("a", 4, 2.5), target("b", 2, 2.5));

    expect(end).toBe("arrived");
    expect(place.cellId).toBe("b");
    expect(place.position.x).toBeCloseTo(2, 9);
  });

  it("ends at the same place whether or not a frame was lost", () => {
    const world = cubeWorld();
    const start = placeIn("right", -2.4, -4.4);
    const middle = target("bottom", 6, -3);
    const finish = target("bottom", 1, 2);

    const direct = carry(world, start, finish).place;
    const viaMiddle = carry(world, carry(world, start, middle).place, finish).place;

    expect(viaMiddle.cellId).toBe(direct.cellId);
    expect(viaMiddle.position.x).toBeCloseTo(direct.position.x, 6);
    expect(viaMiddle.position.y).toBeCloseTo(direct.position.y, 6);
    expect(Math.cos(viaMiddle.yawRadians - direct.yawRadians)).toBeCloseTo(1, 9);
  });

  it("does not merge steps: two steps are not the one step of their sum", () => {
    const world = cubeWorld();
    const start = placeIn("right", 0, -7);
    // Step 1 crosses into the bottom face, whose frame is quarter-turned; step 2 is written in that frame.
    const first = asMove(reactToDisplacement({ world, object: start, step: { x: 0, y: -1 } }));
    const second = asMove(reactToDisplacement({ world, object: { ...start, ...first.placement }, step: { x: 0, y: -1 } }));
    // The "sum" written in the first frame is one straight line of length 2 into the same face (the sender splits it into steps).
    const merged = carry(world, start, target("right", 0, -9));

    expect(second.placement.cellId).toBe("bottom");
    expect(merged.place.cellId).toBe("bottom");
    const apart = Math.hypot(merged.place.position.x - second.placement.position.x, merged.place.position.y - second.placement.position.y);
    expect(apart).toBeGreaterThan(0.5);
  });

  it("stops at the edge of a zone a later step would sweep and reports the remaining distance", () => {
    const world = cubeWorld();
    // Written in the right face's frame, straight down along x = 7.4, 0.1 m from the corner (7.5, -7.5).
    const { place, end, moves, remaining } = carry(world, placeIn("right", 7.4, -6), target("right", 7.4, -9));

    expect(end).toBe("zone");
    expect(moves).toHaveLength(2);
    expect(place.cellId).toBe("right");
    expect(place.position.y).toBeCloseTo(-7.5 + Math.sqrt(0.15 ** 2 - 0.1 ** 2), 4);
    expect(remaining).toBeCloseTo(9 + place.position.y, 4);
  });

  it("keeps an emitter at a zone's edge, still carried, while the hand is held beyond it", () => {
    const world = cubeWorld();
    const object = { ...placeIn("right", 7, -7), radiusMeters: emitterConnectionToleranceMeters };
    const hand = target("right", 7.45, -7.45);
    const first = carry(world, object, hand);
    const second = carry(world, first.place, hand);

    expect(first.end).toBe("zone");
    expect(first.moves.length).toBeGreaterThan(0);
    // Nothing more happens while the hand stays: no step, no end of the carry, the same place.
    expect(second.end).toBe("zone");
    expect(second.moves).toHaveLength(0);
    expect(second.place).toEqual(first.place);
    // When the hand moves away, the emitter follows again.
    const away = carry(world, second.place, target("right", 6, -6));
    expect(away.end).toBe("arrived");
  });

  it("never gets stuck in a loop at a zone when moved in tiny steps", () => {
    const world = cubeWorld();
    const hand = target("right", 7.4, -7.4);
    let place: CarriedPlace = { ...placeIn("right", 6.2, -6.2), radiusMeters: emitterConnectionToleranceMeters };
    const ends = new Set<string>();

    for (let frame = 0; frame < 200; frame += 1) {
      const advance = carry(world, place, hand, 0.02);
      ends.add(advance.end);
      place = advance.place;
    }

    // Every frame was either limited by the travel allowed or stopped by the zone; none was refused, lost or ended the carry.
    expect([...ends].every((end) => end === "travel-limited" || end === "zone")).toBe(true);
    expect(ends.has("zone")).toBe(true);
    expect(Math.hypot(place.position.x - 7.5, place.position.y + 7.5)).toBeGreaterThanOrEqual(0.15 + emitterConnectionToleranceMeters);
  });

  it("reports the remaining distance to the target, or that it is unreachable", () => {
    const world = compileLargePortalWorld();

    expect(carry(world, placeIn("a", 1, 2.5), target("a", 4.5, 2.5)).remaining).toBeCloseTo(0, 6);
    expect(carry(world, placeIn("a", 2.5, 2.5), target("a", 2.5, 4), 0.5).remaining).toBeCloseTo(1, 6);
    expect(remainingToTarget(world, placeIn("a", 1, 1), target("a", 4, 5))).toBeCloseTo(5, 6);
  });

  it("stops short of a wall after a gliding step and reports it", () => {
    const world = compileLargePortalWorld();
    const { place, end } = carry(world, placeIn("a", 2.5, 2.5), target("a", 2.5, 7));

    expect(end).toBe("wall");
    expect(place.position.y).toBeGreaterThan(4.9);
    expect(place.position.y).toBeLessThan(5);
  });

  it("stops at once when the commit refuses a move", () => {
    const world = compileLargePortalWorld();
    let accepted = 0;
    const advance = carryTowardTarget({
      world,
      object: placeIn("a", 1, 2.5),
      target: target("a", 4.5, 2.5),
      commit: () => {
        accepted += 1;
        return false;
      },
    });

    expect(advance.end).toBe("refused");
    expect(accepted).toBe(1);
    expect(advance.place.position.x).toBe(1);
  });

  it("leaves the object where it was when picked up and released at once", () => {
    const world = cubeWorld();
    const start = placeIn("right", -2.4, -4.4);

    // No travel allowed (no time passed): nothing is committed.
    const none = carry(world, start, target("top", 0, 0), 0);
    expect(none.moves).toHaveLength(0);
    expect(none.place).toEqual(start);
    // A hand exactly at the object: arrived without a step.
    expect(carry(world, start, target("right", -2.4, -4.4)).moves).toHaveLength(0);
  });

  it("locates a hand past a wall just short of it", () => {
    const world = compileLargePortalWorld();
    const located = locateCarrierTarget(world, { cellId: "a", position: { x: 2.5, y: 2.5 } }, { x: 2.5, y: 7 });

    expect(located?.cellId).toBe("a");
    expect(located?.point.y).toBeGreaterThan(4.9);
    expect(located?.point.y).toBeLessThan(5);
  });

  it("locates a hand past a portal in the next cell and a hand in the carrier's own cell", () => {
    const world = compileLargePortalWorld();
    const past = locateCarrierTarget(world, { cellId: "a", position: { x: 4.5, y: 2.5 } }, { x: 5.8, y: 3 });
    const here = locateCarrierTarget(world, { cellId: "a", position: { x: 4.5, y: 2.5 } }, { x: 4.6, y: 3.2 });

    expect(past).toMatchObject({ cellId: "b" });
    expect(past?.point.x).toBeCloseTo(0.8, 9);
    expect(here).toMatchObject({ cellId: "a" });
  });
});

describe("pickup", () => {
  // The cube, with a locked geodesic from an emitter on the front face to one on the right face, as in the carry tool's tests.
  function lockedCube() {
    const world = cubeWorld();
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
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);

    // Stores each move the way the tool does and checks that the locked geodesic's word still chains to the emitter's cell.
    const commit = (move: CarryMove): boolean => {
      const result = moveEmitterAlongRoute({
        registry,
        emitterId: "cannon-b",
        cellId: move.placement.cellId,
        localPose: yawRigidTransform3(move.placement.yawRadians, move.placement.position),
        route: move.route,
      });
      if (result.moved) {
        const word = collectGeodesicPortalWord(registry, "g-a");
        word.slice(1).forEach((traversal, index) => expect(traversal.sourceCellId).toBe(word[index].targetCellId));
        expect(word.at(-1)?.targetCellId ?? "front").toBe(registry.get("cannon-b")?.cellId);
      }
      return result.moved;
    };
    const placeOf = (): CarriedPlace => {
      const emitter = registry.get("cannon-b");
      if (emitter?.kind !== "geodesic-cannon") {
        throw new Error("Expected the carried emitter.");
      }
      return { cellId: emitter.cellId, position: emitter.localPose.translation, yawRadians: emitter.aimYawRadians };
    };
    return { world, registry, commit, placeOf };
  }

  it("glides an emitter from another face to the hand under the speed cap, geodesic chained", () => {
    const { world, registry, commit, placeOf } = lockedCube();
    const hand = target("top", 1, 1);
    const frameSeconds = 1 / 60;
    const perFrame = carryMaxSpeedMetersPerSecond * frameSeconds;
    let frames = 0;
    let end = "";

    for (; frames < 400; frames += 1) {
      const before = placeOf();
      const distanceBefore = Math.hypot(...Object.values(displacementToTarget(world, before, hand) ?? { x: 99, y: 99 }));
      const advance = carryTowardTarget({ world, object: before, target: hand, maxTravelMeters: perFrame, commit });
      const distanceAfter = Math.hypot(...Object.values(displacementToTarget(world, advance.place, hand) ?? { x: 99, y: 99 }));
      // Each frame closes the distance by at most what the speed cap allows: the emitter never jumps.
      expect(distanceBefore - distanceAfter).toBeLessThanOrEqual(perFrame + 1e-6);
      expect(distanceAfter).toBeLessThanOrEqual(distanceBefore + 1e-6);
      end = advance.end;
      if (end === "arrived") {
        break;
      }
      expect(end).toBe("travel-limited");
    }

    expect(end).toBe("arrived");
    expect(frames).toBeGreaterThan(5);
    expect(registry.get("cannon-b")).toMatchObject({ kind: "geodesic-cannon", cellId: "top" });
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
  });

  it("keeps the geodesic chained across two faces and turns the emitter with them", () => {
    const { world, registry, commit, placeOf } = lockedCube();
    const startYaw = placeOf().yawRadians;
    const hand = locateCarrierTarget(world, { cellId: "right", position: { x: -2.4, y: -4.4 } }, { x: -2.4, y: -9 });
    if (!hand) {
      throw new Error("Expected a hand.");
    }
    const advance = carryTowardTarget({ world, object: placeOf(), target: hand, commit });

    expect(advance.end).toBe("arrived");
    expect(registry.get("cannon-b")?.cellId).toBe("bottom");
    expect(Math.cos(placeOf().yawRadians - (startYaw - Math.PI / 2))).toBeCloseTo(1, 6);
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
  });
});
