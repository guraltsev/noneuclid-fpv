import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distancePointToSegment2 } from "../../src/cell-complex/developedDisk";
import type { Vec2xy } from "../../src/math/polygons";
import { slideDisc, sweepDiscAgainstObstacle, type SweptObstacle } from "../../src/movement/sweptCollision";
import { arbConvexPolygon2xy } from "../support/arbitraries";

const disc = (x: number, y: number, radius: number): SweptObstacle => ({
  kind: "disc",
  center: { x, y },
  radius,
  reason: "forbidden-zone",
});
const capsule = (a: Vec2xy, b: Vec2xy, radius: number): SweptObstacle => ({ kind: "capsule", a, b, radius, reason: "wall" });

function squareWalls(radius: number, half = 1): SweptObstacle[] {
  const corners: Vec2xy[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];

  return corners.map((a, i) => capsule(a, corners[(i + 1) % 4], radius));
}

describe("sweepDiscAgainstObstacle", () => {
  it("hits a disc head-on at the right parameter", () => {
    const hit = sweepDiscAgainstObstacle({ x: 0, y: 0 }, { x: 4, y: 0 }, disc(3, 0, 1));

    expect(hit?.s).toBeCloseTo(0.5, 12);
    expect(hit?.normal.x).toBeCloseTo(-1, 12);
    expect(hit?.normal.y).toBeCloseTo(0, 12);
  });

  it("misses a disc the path only passes", () => {
    expect(sweepDiscAgainstObstacle({ x: 0, y: 1.01 }, { x: 4, y: 0 }, disc(3, 0, 1))).toBeUndefined();
  });

  it("lets a body that overlaps a disc move away but not closer", () => {
    expect(sweepDiscAgainstObstacle({ x: 2.5, y: 0 }, { x: 0.1, y: 0 }, disc(3, 0, 1))?.s).toBe(0);
    expect(sweepDiscAgainstObstacle({ x: 2.5, y: 0 }, { x: -0.1, y: 0 }, disc(3, 0, 1))).toBeUndefined();
    expect(sweepDiscAgainstObstacle({ x: 3.5, y: 0 }, { x: -0.1, y: 0 }, disc(3, 0, 1))?.s).toBe(0);
  });

  it("hits a capsule on its slab", () => {
    const hit = sweepDiscAgainstObstacle({ x: 0, y: 0 }, { x: 0, y: 2 }, capsule({ x: -1, y: 1 }, { x: 1, y: 1 }, 0.25));

    expect(hit?.s).toBeCloseTo(0.375, 12);
    expect(hit?.normal.y).toBeCloseTo(-1, 12);
  });

  it("hits a capsule on its end cap", () => {
    const hit = sweepDiscAgainstObstacle({ x: 2, y: 1 }, { x: -2, y: 0 }, capsule({ x: -1, y: 1 }, { x: 1, y: 1 }, 0.25));

    expect(hit?.s).toBeCloseTo(0.375, 12);
    expect(hit?.normal.x).toBeCloseTo(1, 12);
  });

  it("misses the slab of a capsule the path passes beyond the segment end", () => {
    expect(
      sweepDiscAgainstObstacle({ x: 1.6, y: 0 }, { x: 0, y: 2 }, capsule({ x: -1, y: 1 }, { x: 1, y: 1 }, 0.25)),
    ).toBeUndefined();
  });
});

describe("slideDisc", () => {
  it("stops in every corner of a walled square (issue 61)", () => {
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const walls = squareWalls(0.25);
      let position: Vec2xy = { x: 0, y: 0 };

      for (let i = 0; i < 200; i += 1) {
        position = slideDisc(position, { x: 0.03 * sx, y: 0.03 * sy }, walls).end;
      }

      expect(Math.abs(position.x - 0.75 * sx)).toBeLessThan(1e-5);
      expect(Math.abs(position.y - 0.75 * sy)).toBeLessThan(1e-5);
    }
  });

  it("keeps the tangential part of a diagonal step into one wall", () => {
    const result = slideDisc({ x: 0.7, y: 0 }, { x: 0.1, y: 0.3 }, squareWalls(0.25));

    expect(Math.abs(result.end.x - 0.75)).toBeLessThan(1e-5);
    expect(result.end.y).toBeCloseTo(0.3, 5);
    expect(result.contacts).toHaveLength(1);
  });

  it("never gets closer than the radius to any wall of a random convex polygon", () => {
    fc.assert(
      fc.property(arbConvexPolygon2xy, fc.integer({ min: 1, max: 1_000_000 }), (polygon, seed) => {
        const vertices = polygon.vertices;
        const average = {
          x: vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length,
          y: vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length,
        };
        const walls = vertices.map((a, i) => capsule(a, vertices[(i + 1) % vertices.length], 0.25));

        fc.pre(vertices.every((a, i) => distancePointToSegment2(average, a, vertices[(i + 1) % vertices.length]) > 0.4));

        let state = seed;
        const random = (): number => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 4294967296;
        };
        let position: Vec2xy = average;

        for (let i = 0; i < 2000; i += 1) {
          const angle = random() * 2 * Math.PI;
          const length = random() * 0.5;

          position = slideDisc(position, { x: Math.cos(angle) * length, y: Math.sin(angle) * length }, walls).end;

          for (let k = 0; k < vertices.length; k += 1) {
            const a = vertices[k];
            const b = vertices[(k + 1) % vertices.length];
            const e = { x: b.x - a.x, y: b.y - a.y };
            const l = Math.hypot(e.x, e.y);
            // Inward normal of a counterclockwise polygon; the distance to the wall line.
            const clearance = ((position.x - a.x) * -e.y + (position.y - a.y) * e.x) / l;

            if (clearance < 0.25 - 1e-9) {
              return false;
            }
          }
        }

        return true;
      }),
      { numRuns: 25 },
    );
  });
});
