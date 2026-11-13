/**
 * `tests/authoring/spawnFraming.test.ts` — unit tier.
 *
 * The spawn framing rule of the activity worlds: the first frame shows "here is help", "here are the tools" and "here
 * is somewhere to go". For each activity world the help cube's middle lies in the central third of the start view
 * (horizontally, for the app's camera of 70 degrees vertical on a 4:3 canvas, the narrowest common one), the tool
 * stand is in view, the cube is two to three and a half meters away, and nothing static (an object's collision
 * cylinder, a wall) lies closer than 1.5 m along the view ray. Each world also has its tool stand and its demo.
 */
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron, genus2Torus, torus, torusModuli } from "../../src/authoring/exampleWorlds";
import type { CellComplexSpec, CellObjectSpec } from "../../src/cell-complex/specs";

/** The camera of the app: 70 degrees vertical (createThreeApp), seen on a 4:3 canvas. */
const verticalFovRadians = (70 * Math.PI) / 180;
const aspect = 4 / 3;
const halfFovTangent = Math.tan(verticalFovRadians / 2) * aspect;

const activityWorlds: readonly (readonly [string, CellComplexSpec])[] = [
  ["001-basic-cube", basicCube],
  ["002-basic-tetrahedron", basicTetrahedron],
  ["torus", torus],
  ["genus-2-torus", genus2Torus],
  ["torus-moduli", torusModuli],
];

interface Flat {
  readonly x: number;
  readonly y: number;
}

/** The signed angle from the view direction to the point, in radians; positive is to the left. */
function angleFromView(eye: Flat, yawRadians: number, point: Flat): number {
  const forward = { x: -Math.sin(yawRadians), y: Math.cos(yawRadians) };
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  return Math.atan2(forward.x * dy - forward.y * dx, forward.x * dx + forward.y * dy);
}

/** The distance along the ray to the first collision cylinder it enters, or Infinity. */
function firstCylinderHit(eye: Flat, yawRadians: number, objects: readonly CellObjectSpec[]): number {
  const forward = { x: -Math.sin(yawRadians), y: Math.cos(yawRadians) };
  let nearest = Infinity;
  for (const object of objects) {
    if (object.kind !== "asset" || object.collision === undefined) continue;
    const centre = { x: object.position.x + (object.collision.offset?.x ?? 0), y: object.position.y + (object.collision.offset?.y ?? 0) };
    const toCentre = { x: centre.x - eye.x, y: centre.y - eye.y };
    const along = toCentre.x * forward.x + toCentre.y * forward.y;
    const across = Math.abs(toCentre.x * forward.y - toCentre.y * forward.x);
    if (across > object.collision.radius) continue;
    const entry = along - Math.sqrt(object.collision.radius ** 2 - across ** 2);
    if (along + object.collision.radius > 0) nearest = Math.min(nearest, Math.max(entry, 0));
  }
  return nearest;
}

/** The distance along the ray to the wall of the convex base polygon. */
function wallDistance(eye: Flat, yawRadians: number, base: readonly Flat[]): number {
  const forward = { x: -Math.sin(yawRadians), y: Math.cos(yawRadians) };
  let nearest = Infinity;
  base.forEach((from, index) => {
    const to = base[(index + 1) % base.length]!;
    const edge = { x: to.x - from.x, y: to.y - from.y };
    const denominator = forward.x * edge.y - forward.y * edge.x;
    if (Math.abs(denominator) < 1e-9) return;
    const t = ((from.x - eye.x) * edge.y - (from.y - eye.y) * edge.x) / denominator;
    const u = ((from.x - eye.x) * forward.y - (from.y - eye.y) * forward.x) / denominator;
    if (t > 0 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
  });
  return nearest;
}

describe("spawn framing of the activity worlds", () => {
  it.each(activityWorlds)("%s: the first view shows the help cube, the tool stand and open space", (_name, spec) => {
    const start = spec.startingPosition!;
    const cell = spec.cells.find((candidate) => candidate.id === start.cellId)!;
    const objects = cell.visuals?.objects ?? [];
    const cube = objects.find((object) => object.id === "startingQuestionCube")!;
    const stand = objects.find((object) => object.id === "toolStand")!;
    const yaw = start.yawRadians ?? 0;

    expect(Math.abs(Math.tan(angleFromView(start.position, yaw, cube.position)))).toBeLessThan(halfFovTangent / 3);
    expect(Math.abs(Math.tan(angleFromView(start.position, yaw, stand.position)))).toBeLessThan(halfFovTangent);
    const cubeDistance = Math.hypot(cube.position.x - start.position.x, cube.position.y - start.position.y);
    expect(cubeDistance).toBeGreaterThanOrEqual(2);
    expect(cubeDistance).toBeLessThanOrEqual(3.5);
    expect(firstCylinderHit(start.position, yaw, objects)).toBeGreaterThanOrEqual(1.5);
    expect(wallDistance(start.position, yaw, cell.baseVertices)).toBeGreaterThanOrEqual(1.5);
  });

  it.each(activityWorlds)("%s: has a tool stand with one item per tool and a demo", (_name, spec) => {
    const objects = spec.cells.flatMap((cell) => cell.visuals?.objects ?? []);
    const items = objects.filter((object) => object.kind === "asset" && object.standsTool !== undefined);

    expect(objects.some((object) => object.id === "toolStand")).toBe(true);
    expect(items.map((item) => (item.kind === "asset" ? item.standsTool : undefined))).toEqual([
      "geodesicEmitters/emitter",
      "geodesicMeasurements/length",
      "geodesicMeasurements/protractor",
      "placedFlags/flag",
      "worldMap/map",
    ]);
    expect(spec.demo).toMatchObject({ cellId: spec.startingPosition!.cellId, ruler: true, sign: { text: "Start" } });
  });

  it("sees a start that faces a wall, or has the cube off to the side, as breaking the rule", () => {
    const start = torus.startingPosition!;
    const cell = torus.cells[0]!;
    const cube = cell.visuals!.objects!.find((object) => object.id === "startingQuestionCube")!;
    const nearWall = { x: 0, y: 6.6 };

    expect(wallDistance(nearWall, 0, cell.baseVertices)).toBeLessThan(1.5);
    expect(Math.abs(Math.tan(angleFromView(start.position, (start.yawRadians ?? 0) + Math.PI / 4, cube.position)))).toBeGreaterThan(halfFovTangent / 3);
    expect(firstCylinderHit({ x: cube.position.x, y: cube.position.y + 1 }, Math.PI, cell.visuals!.objects!)).toBeLessThan(1.5);
  });
});
