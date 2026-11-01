/**
 * `tests/cell-complex/portalRoute.test.ts` — unit tier.
 *
 * `findNearestImageRoute` says which portals an object crossed between two places on the surface. A place does not
 * determine the way round, so the route is chosen geometrically: the chain of portals whose image of the old point is
 * nearest the new point, among those the straight segment between the places really crosses. These tests check the
 * three kinds of move the carry code makes: staying in a cell, a step across one portal (also in a cell glued to itself),
 * and a jump to a neighbouring face; and that a route winding around a cube corner, which has a nearer image but no straight path, is not chosen.
 */
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../src/cell-complex/portalRoute";
import { compileLargePortalWorld, compileTorusLoopWorld } from "../fixtures/world-objects/geodesic";

const at = (cellId: string, x: number, y: number) => ({ cellId, point: { x, y, z: 0 } });

describe("findNearestImageRoute", () => {
  it("returns the empty route for a move inside one cell", () => {
    const world = compileLargePortalWorld();

    expect(findNearestImageRoute(world, at("a", 1, 1), at("a", 1.2, 1.1), 2)).toMatchObject({ hops: [] });
  });

  it("finds the one portal crossed by a step from a cell into its neighbour", () => {
    const world = compileLargePortalWorld();
    const route = findNearestImageRoute(world, at("a", 4.95, 2.5), at("b", 0.05, 2.5), 2);

    expect(route?.hops.map((hop) => `${hop.sourceCellId}:${hop.sourcePortalId}>${hop.targetCellId}`)).toEqual(["a:ab>b"]);
    expect(route?.distanceMeters).toBeCloseTo(0.1, 6);
  });

  it("tells a step across a portal of a cell glued to itself from a step that stays inside", () => {
    const world = compileTorusLoopWorld();
    const cell = [...world.cellsById.keys()][0];

    expect(findNearestImageRoute(world, at(cell, 7.45, 0), at(cell, -7.45, 0), 2)?.hops).toHaveLength(1);
    expect(findNearestImageRoute(world, at(cell, 7.45, 0), at(cell, 7.4, 0), 2)?.hops).toEqual([]);
  });

  it("finds the single portal between two faces of the cube for a jump to the neighbouring face", () => {
    const world = compileCellComplex(cube);
    // The emitter of a locked geodesic on the right face, and a hand on the bottom face (the player is next to it).
    const route = findNearestImageRoute(world, at("right", -2.46, -4.45), at("bottom", 3.4, -6.97), 6);

    expect(route?.hops.map((hop) => `${hop.sourceCellId}>${hop.targetCellId}`)).toEqual(["right>bottom"]);
  });

  it("does not choose a route around a cube corner when the straight line does not follow it", () => {
    const world = compileCellComplex(cube);

    for (const hops of [1, 2, 3, 6]) {
      const route = findNearestImageRoute(world, at("right", -2.46, -4.45), at("bottom", 3.4, -6.97), hops);
      expect(route === undefined || route.hops.length <= 1).toBe(true);
    }
  });

  it("reports no route when the cells are farther apart than the allowed number of portals", () => {
    const world = compileLargePortalWorld();

    expect(findNearestImageRoute(world, at("a", 1, 1), at("b", 1, 1), 0)).toBeUndefined();
  });
});
