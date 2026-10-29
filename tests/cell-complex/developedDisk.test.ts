import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import {
  clipSegmentToWedge,
  collectDevelopedDisk,
  distanceToWedge,
  intersectWedges,
  wedgeContainsDirection,
  type DevelopedWedge,
} from "../../src/cell-complex/developedDisk";
import { transformPoint3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { exampleWorldSpecs } from "../support/arbitraries";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

const firstQuadrant: DevelopedWedge = { kind: "cone", from: { x: 1, y: 0 }, to: { x: 0, y: 1 } };

describe("collectDevelopedDisk", () => {
  const names = ["cube", "icosahedron", "torusModuli", "dodecahedron", "genus2Torus", "tetrahedron"];

  it.each(names)("tiles the disk exactly once on %s", (name) => {
    const world = compileCellComplex(exampleWorldSpecs.find(([candidate]) => candidate === name)![1]);
    const rho = 0.25;

    for (const cell of world.cells.slice(0, 3)) {
      const avg = {
        x: cell.baseVertices.reduce((sum, v) => sum + v.x, 0) / cell.baseVertices.length,
        y: cell.baseVertices.reduce((sum, v) => sum + v.y, 0) / cell.baseVertices.length,
      };

      for (const v of cell.baseVertices) {
        const length = Math.hypot(avg.x - v.x, avg.y - v.y);

        for (const dist of [0.3, 0.27, 0.1]) {
          const c = { x: v.x + ((avg.x - v.x) / length) * dist, y: v.y + ((avg.y - v.y) / length) * dist };
          const atlas = collectDevelopedDisk({ world, cellId: cell.id, center: c, radiusMeters: rho });

          expect(atlas.truncated).toBe(false);
          expect(atlas.nodes.length).toBeLessThanOrEqual(8);

          for (let i = 0; i < 400; i += 1) {
            const r = atlas.radiusMeters * Math.sqrt((i * 0.618034) % 1);
            const angle = i * 2.399963;
            const p = { x: atlas.center.x + r * Math.cos(angle), y: atlas.center.y + r * Math.sin(angle) };
            let count = 0;

            for (const node of atlas.nodes) {
              if (!wedgeContainsDirection(node.wedge, { x: p.x - atlas.center.x, y: p.y - atlas.center.y })) {
                continue;
              }

              const q = transformPoint3(node.cellFromStart, vec3(p.x, p.y, 0));
              const nodeCell = world.cellsById.get(node.cellId)!;

              if (
                nodeCell.sides.every(
                  (side) => (q.x - side.start.x) * side.inwardNormal.x + (q.y - side.start.y) * side.inwardNormal.y >= -1e-9,
                )
              ) {
                count += 1;
              }
            }

            expect(count).toBe(1);
          }
        }
      }
    }
  });

  it("includes the neighbour for a centre exactly on a portal side", () => {
    const world = compileCellComplex({
      cells: [
        {
          id: "room-a",
          heightMeters: 2,
          baseVertices: squareRoomBase,
          portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
        },
        {
          id: "room-b",
          heightMeters: 2,
          baseVertices: squareRoomBase,
          portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
        },
      ],
    });
    const atlas = collectDevelopedDisk({ world, cellId: "room-a", center: { x: 1, y: 0 }, radiusMeters: 0.25 });

    expect(atlas.nodes.map((node) => node.cellId)).toEqual(["room-a", "room-b"]);
    expect(atlas.center.x).toBeLessThan(1);
  });
});

describe("wedge helpers", () => {
  it("intersects wedges", () => {
    const inner: DevelopedWedge = { kind: "cone", from: { x: 1, y: 0.5 }, to: { x: 0.5, y: 1 } };
    const shifted: DevelopedWedge = { kind: "cone", from: { x: 1, y: 1 }, to: { x: -1, y: 1 } };
    const opposite: DevelopedWedge = { kind: "cone", from: { x: -1, y: 0 }, to: { x: 0, y: -1 } };

    expect(intersectWedges(firstQuadrant, inner)).toEqual(inner);
    expect(intersectWedges(firstQuadrant, shifted)).toEqual({ kind: "cone", from: { x: 1, y: 1 }, to: { x: 0, y: 1 } });
    expect(intersectWedges(firstQuadrant, opposite)).toBeUndefined();
    expect(intersectWedges({ kind: "full" }, inner)).toBe(inner);
  });

  it("clips segments to a wedge", () => {
    const origin = { x: 0, y: 0 };

    expect(clipSegmentToWedge(firstQuadrant, origin, { x: -1, y: 1 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(clipSegmentToWedge(firstQuadrant, origin, { x: 1, y: 1 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(clipSegmentToWedge(firstQuadrant, origin, { x: -2, y: -1 }, { x: -1, y: -2 })).toBeUndefined();
  });

  it("measures the distance to a wedge", () => {
    const origin = { x: 0, y: 0 };

    expect(distanceToWedge(firstQuadrant, origin, { x: 1, y: 1 })).toBe(0);
    expect(distanceToWedge(firstQuadrant, origin, { x: -1, y: 1 })).toBeCloseTo(1, 9);
    expect(distanceToWedge(firstQuadrant, origin, { x: -1, y: -1 })).toBeCloseTo(Math.SQRT2, 9);
  });
});
