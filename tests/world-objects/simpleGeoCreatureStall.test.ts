/**
 * `tests/world-objects/simpleGeoCreatureStall.test.ts` — unit tier.
 *
 * The cube world's `front-runner` mouse used to end up inside a corner's forbidden zone: its heading change swung the
 * offset collision cylinder into the zone unchecked, and from there every step, even one leading out, was rejected, so
 * it froze for good. The heading is now limited to a turn the cell allows (and a fully blocked body is pushed out as a
 * backstop). The mouse stays clear of zones and walls on every frame and never stands still for long. A creature whose geodesic
 * passes a vertex closely goes round the vertex's zone without circling the vertex, and stays on its own geodesic afterwards.
 */
import { describe, expect, it } from "vitest";
import { cube, dodecahedron, torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import { transformDirection3, transformPoint3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { testCellCollision } from "../../src/movement/collision";
import { createSimpleGeoCreatureBehavior } from "../../src/world-objects/creatures/simpleGeoCreatureBehavior";

const frameSeconds = 1 / 60;
const simulatedSeconds = 180;
const longestStillSeconds = 2;

describe("createSimpleGeoCreatureBehavior", () => {
  it("never stands still near a cube corner", () => {
    const world = compileCellComplex(cube);
    const placed = cube.cells
      .flatMap((cell) => (cell.visuals?.objects ?? []).map((object) => ({ cellId: cell.id, object })))
      .find((entry) => entry.object.id === "front-runner");
    if (!placed || (placed.object.kind !== "geo-mouse" && placed.object.kind !== "geo-butterfly")) {
      throw new Error("The cube world has no front-runner creature.");
    }
    const mouse = createSimpleGeoCreatureBehavior(placed.object, placed.cellId);
    let previous = mouse.state.localPose.translation;
    let stillSeconds = 0;

    for (let frame = 0; frame < simulatedSeconds / frameSeconds; frame += 1) {
      mouse.update(world, frameSeconds);
      const current = mouse.state.localPose.translation;
      stillSeconds = Math.hypot(current.x - previous.x, current.y - previous.y) < 1e-4 ? stillSeconds + frameSeconds : 0;
      previous = current;
      expect(stillSeconds).toBeLessThan(longestStillSeconds);
      const cell = world.cellsById.get(mouse.cellId);
      expect(cell && testCellCollision({ cell, object: mouse.state }).blocked).toBe(false);
    }
  });

  // These geodesics pass a vertex closer than the body can, so the creature goes wide round its zone. It used to overtake its leader there (the
  // leash held the leader back by the sideways distance), and then circle the whole vertex, almost a full turn, to reach it from behind. Walking
  // a geodesic, a creature turns only to go round a zone, which takes less than half a turn.
  it.each([
    { world: dodecahedron, objectId: "top-geo-mouse", seconds: 45 },
    { world: torus, objectId: "torus-geo-mouse", seconds: 20 },
  ])("does not circle a vertex its geodesic passes closely ($objectId)", ({ world: spec, objectId, seconds }) => {
    const world = compileCellComplex(spec);
    const placed = spec.cells
      .flatMap((cell) => (cell.visuals?.objects ?? []).map((object) => ({ cellId: cell.id, object })))
      .find((entry) => entry.object.id === objectId);
    if (!placed || (placed.object.kind !== "geo-mouse" && placed.object.kind !== "geo-butterfly")) {
      throw new Error(`No creature ${objectId}.`);
    }
    const creature = createSimpleGeoCreatureBehavior(placed.object, placed.cellId);
    const yawOf = (): number => {
      const forward = transformDirection3(creature.state.localPose, vec3(0, 1, 0));
      return Math.atan2(-forward.x, forward.y);
    };
    // Turns of the last 5 s, frame by frame; a frame that crosses a portal changes the cell frame, so it counts as no turn.
    const recentTurns: number[] = [];
    let yaw = yawOf();
    let cellId = creature.cellId;
    let largestTurn = 0;

    for (let frame = 0; frame < seconds / frameSeconds; frame += 1) {
      creature.update(world, frameSeconds);
      const nextYaw = yawOf();
      recentTurns.push(creature.cellId === cellId ? Math.atan2(Math.sin(nextYaw - yaw), Math.cos(nextYaw - yaw)) : 0);
      if (recentTurns.length > 5 / frameSeconds) recentTurns.shift();
      largestTurn = Math.max(largestTurn, Math.abs(recentTurns.reduce((sum, turn) => sum + turn, 0)));
      yaw = nextYaw;
      cellId = creature.cellId;
    }
    expect(largestTurn).toBeLessThan(Math.PI);
  });

  // A loop round a vertex that the leader did not make adds the vertex's rotation (90 degrees on a cube) to the map from the leader's frame to the
  // creature's, so the creature used to follow a rotated copy of its leader: another geodesic, 10 m away from its own on the cube.
  it.each([
    { world: cube, objectId: "front-runner", seconds: 40 },
    { world: dodecahedron, objectId: "top-geo-mouse", seconds: 60 },
    { world: torus, objectId: "torus-geo-mouse", seconds: 30 },
  ])("stays on its own geodesic after passing a vertex closely ($objectId)", ({ world: spec, objectId, seconds }) => {
    const world = compileCellComplex(spec);
    const placed = spec.cells
      .flatMap((cell) => (cell.visuals?.objects ?? []).map((object) => ({ cellId: cell.id, object })))
      .find((entry) => entry.object.id === objectId);
    if (!placed || (placed.object.kind !== "geo-mouse" && placed.object.kind !== "geo-butterfly")) {
      throw new Error(`No creature ${objectId}.`);
    }
    const creature = createSimpleGeoCreatureBehavior(placed.object, placed.cellId);
    const start = creature.state.localPose;
    const direction = transformDirection3(start, vec3(0, 1, 0));
    const walk = walkDevelopedSegment({
      world,
      cellId: creature.cellId,
      start: { x: start.translation.x, y: start.translation.y },
      direction: { x: direction.x, y: direction.y },
      lengthMeters: placed.object.speedMetersPerSecond * seconds + 5,
      maxCrossings: 10_000,
    });
    expect(walk.status).toBe("end");
    // The geodesic as segments in the frames of the cells it crosses.
    const segments = walk.pieces.map((piece) => {
      const at = (t: number) =>
        transformPoint3(piece.cellFromStart, vec3(start.translation.x + direction.x * t, start.translation.y + direction.y * t, 0));
      return { cellId: piece.cellId, from: at(piece.tEnter), to: at(piece.tExit) };
    });
    const distanceFromGeodesic = (cellId: string, x: number, y: number): number => {
      let nearest = Infinity;
      for (const { cellId: segmentCellId, from, to } of segments) {
        if (segmentCellId !== cellId) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSquared = dx * dx + dy * dy;
        const u = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared)) : 0;
        nearest = Math.min(nearest, Math.hypot(x - from.x - u * dx, y - from.y - u * dy));
      }
      return nearest;
    };
    let farthest = 0;

    for (let frame = 0; frame < seconds / frameSeconds; frame += 1) {
      creature.update(world, frameSeconds);
      const at = creature.state.localPose.translation;
      farthest = Math.max(farthest, distanceFromGeodesic(creature.cellId, at.x, at.y));
    }
    // The wobble and the way round a zone stay within about half a metre of the geodesic.
    expect(farthest).toBeLessThan(1);
  });
});
