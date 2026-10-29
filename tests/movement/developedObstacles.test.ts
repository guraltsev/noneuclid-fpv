import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { collectDevelopedObstacles } from "../../src/movement/developedObstacles";

const squareBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function singleRoom(): CellComplexSpec {
  return { cells: [{ id: "room", heightMeters: 2, baseVertices: squareBase, portals: [] }] };
}

function twoRooms(targetHeightMeters = 2): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareBase,
        portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
      },
      {
        id: "room-b",
        heightMeters: targetHeightMeters,
        baseVertices: squareBase,
        portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
      },
    ],
  };
}

const base = { bodyRadius: 0.25, bodyBottomZ: 0, bodyTopZ: 1, ignoreForbiddenZones: true } as const;

describe("collectDevelopedObstacles", () => {
  it("returns only the walls near the body", () => {
    const world = compileCellComplex(singleRoom());
    const nearCorner = collectDevelopedObstacles({ ...base, world, cellId: "room", center: { x: 0.9, y: 0.9 }, reachMeters: 0.5 });
    const nearCentre = collectDevelopedObstacles({ ...base, world, cellId: "room", center: { x: 0, y: 0 }, reachMeters: 0.5 });

    expect(nearCorner).toHaveLength(2);
    expect(nearCentre).toHaveLength(0);
    expect(nearCorner.every((o) => o.kind === "capsule" && o.reason === "wall" && o.radius === 0.25)).toBe(true);
  });

  it("includes the walls of the neighbour behind a portal, developed into the start frame", () => {
    const world = compileCellComplex(twoRooms());
    const obstacles = collectDevelopedObstacles({ ...base, world, cellId: "room-a", center: { x: 0.9, y: 0.8 }, reachMeters: 0.6 });
    const capsules = obstacles.filter((o) => o.kind === "capsule");
    const xs = capsules.flatMap((o) => (o.kind === "capsule" ? [o.a.x, o.b.x] : []));

    // room-b's north and south walls run from x = 1 to x = 3 in room-a's frame.
    expect(capsules.some((o) => o.kind === "capsule" && Math.abs(Math.min(o.a.x, o.b.x) - 1) < 1e-9 && Math.abs(Math.max(o.a.x, o.b.x) - 3) < 1e-9)).toBe(true);
    expect(Math.max(...xs)).toBeCloseTo(3, 9);
  });

  it("turns a portal into a too-low target into a ceiling wall", () => {
    const world = compileCellComplex(twoRooms(0.75));
    const obstacles = collectDevelopedObstacles({
      ...base,
      world,
      cellId: "room-a",
      center: { x: 0.9, y: 0 },
      reachMeters: 0.6,
      bodyTopZ: 1,
    });
    const ceiling = obstacles.filter((o) => o.reason === "ceiling");

    expect(ceiling).toHaveLength(1);
    expect(ceiling[0].kind === "capsule" && ceiling[0].a.x === 1 && ceiling[0].b.x === 1).toBe(true);
  });

  it("deduplicates the forbidden zone of a vertex seen through several cell copies", () => {
    const world = compileCellComplex(cube);
    const cell = world.cellsById.get("front");
    const vertex = cell?.baseVertices[2];

    if (!cell || !vertex) {
      throw new Error("cube cell front is missing");
    }

    const length = Math.hypot(vertex.x, vertex.y);
    const center = { x: vertex.x - (vertex.x / length) * 0.5, y: vertex.y - (vertex.y / length) * 0.5 };
    const obstacles = collectDevelopedObstacles({
      world,
      cellId: "front",
      center,
      reachMeters: 0.6,
      bodyRadius: 0.2,
      bodyBottomZ: 0,
      bodyTopZ: 1,
    });
    const zones = obstacles.filter((o) => o.reason === "forbidden-zone");

    expect(zones).toHaveLength(1);
  });
});
