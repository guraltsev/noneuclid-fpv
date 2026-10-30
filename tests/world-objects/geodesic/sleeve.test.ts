import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { createGeodesicCannonObject, createGeodesicIntervalObject } from "../../../src/world-objects/geodesic/objects";
import { liftGeodesicEndpoint } from "../../../src/world-objects/geodesic/endpoints";
import {
  developSleeve,
  funnelPointApexes,
  solveTautPath,
  tangentBetweenDisks,
  tangentFromPointToDisk,
  type DevelopedSleeve,
  type SleeveAperture,
} from "../../../src/world-objects/geodesic/sleeve";
import { identityRigidTransform3, yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { createCarryPortalTraversal, compileLargePortalWorld } from "./fixtures";

const rho = 0.15;

function aperture(left: { x: number; y: number }, right: { x: number; y: number }): SleeveAperture {
  return { left, right, leftJunctionId: "l", rightJunctionId: "r", cellId: "a", wordIndex: 0 };
}

function sleeveOf(start: { x: number; y: number }, end: { x: number; y: number }, apertures: readonly SleeveAperture[]): DevelopedSleeve {
  return { start, end, apertures, startFromEnd: identityRigidTransform3, endCellId: "a" };
}

describe("sleeve and taut string (pure geometry)", () => {
  it("A1: tangent from a point to a disk", () => {
    const left = tangentFromPointToDisk({ x: 0, y: 0 }, { x: 2, y: 0 }, 1, "left");
    expect(left?.to.x).toBeCloseTo(1.5, 9);
    expect(left?.to.y).toBeCloseTo(-Math.sqrt(3) / 2, 9);
    expect(left?.direction.x).toBeCloseTo(Math.sqrt(3) / 2, 9);
    expect(left?.direction.y).toBeCloseTo(-0.5, 9);
    expect(left?.lengthMeters).toBeCloseTo(Math.sqrt(3), 9);
    const right = tangentFromPointToDisk({ x: 0, y: 0 }, { x: 2, y: 0 }, 1, "right");
    expect(right?.to.x).toBeCloseTo(1.5, 9);
    expect(right?.to.y).toBeCloseTo(Math.sqrt(3) / 2, 9);
  });

  it("A2: tangents between two disks", () => {
    const leftLeft = tangentBetweenDisks({ x: 0, y: 0 }, "left", { x: 3, y: 0 }, "left", 0.5);
    expect(leftLeft?.from).toEqual({ x: 0, y: -0.5 });
    expect(leftLeft?.to).toEqual({ x: 3, y: -0.5 });
    expect(leftLeft?.lengthMeters).toBeCloseTo(3, 9);
    const leftRight = tangentBetweenDisks({ x: 0, y: 0 }, "left", { x: 3, y: 0 }, "right", 0.5);
    expect(leftRight?.from.x).toBeCloseTo(1 / 6, 9);
    expect(leftRight?.from.y).toBeCloseTo(-0.47140452, 8);
    expect(leftRight?.to.x).toBeCloseTo(17 / 6, 9);
    expect(leftRight?.to.y).toBeCloseTo(0.47140452, 8);
    expect(leftRight?.lengthMeters).toBeCloseTo(2 * Math.SQRT2, 9);
    expect(tangentBetweenDisks({ x: 0, y: 0 }, "left", { x: 0.9, y: 0 }, "right", 0.5)).toBeUndefined();
  });

  it("A3: a chord that stays in the sleeve has no apex", () => {
    const result = solveTautPath(sleeveOf({ x: 0, y: 0 }, { x: 4, y: 0 }, [aperture({ x: 2, y: 1 }, { x: 2, y: -1 })]), rho);
    expect(result).toMatchObject({ status: "ok", apexes: [], points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], lengthMeters: 4 });
  });

  it("A4: developSleeve agrees with liftGeodesicEndpoint", () => {
    const world = compileLargePortalWorld();
    const word = [createCarryPortalTraversal(world, "a", "ab")];
    const result = developSleeve({ world, startCellId: "a", start: { x: 4, y: 0.1 }, word, end: { x: 2, y: 0.1 } });
    if (result.status !== "ok") {
      throw new Error("expected ok");
    }
    const { sleeve } = result;
    expect(sleeve.apertures).toHaveLength(1);
    expect(sleeve.apertures[0].left.x).toBeCloseTo(5, 12);
    expect(sleeve.apertures[0].left.y).toBeCloseTo(5, 12);
    expect(sleeve.apertures[0].right.x).toBeCloseTo(5, 12);
    expect(sleeve.apertures[0].right.y).toBeCloseTo(0, 12);
    expect(sleeve.apertures[0].leftJunctionId).toBe("a:vertex-2");
    expect(sleeve.apertures[0].rightJunctionId).toBe("a:vertex-1");
    expect(sleeve.end.x).toBeCloseTo(7, 12);
    expect(sleeve.end.y).toBeCloseTo(0.1, 12);
    expect(sleeve.endCellId).toBe("b");

    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 0.1, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "e2", cellId: "b", localPose: yawRigidTransform3(0, { x: 2, y: 0.1, z: 0 }) }));
    const interval = createGeodesicIntervalObject({ id: "g", startAnchorObjectId: "e1", endAnchorObjectId: "e2", startCellId: "a", portalWord: word });
    registry.add(interval);
    const lifted = liftGeodesicEndpoint({ world, registry, interval, sourceRole: "start" });
    expect(lifted?.targetPointInSourceCell.x).toBeCloseTo(sleeve.end.x, 12);
    expect(lifted?.targetPointInSourceCell.y).toBeCloseTo(sleeve.end.y, 12);
  });

  it("A4b: a word that does not chain is a mismatch", () => {
    const world = compileLargePortalWorld();
    const word = [createCarryPortalTraversal(world, "b", "ba")];
    expect(developSleeve({ world, startCellId: "a", start: { x: 1, y: 1 }, word, end: { x: 1, y: 1 } })).toEqual({ status: "word-mismatch", index: 0 });
  });

  it("A5: one disk is wrapped by one corner", () => {
    const result = solveTautPath(sleeveOf({ x: -2, y: 0 }, { x: 2, y: 0 }, [aperture({ x: 0, y: 0.05 }, { x: 0, y: -5 })]), rho);
    if (result.status !== "ok") {
      throw new Error(result.status);
    }
    expect(result.apexes).toHaveLength(1);
    expect(result.apexes[0]).toMatchObject({ apertureIndex: 0, side: "left" });
    expect(result.lengthMeters).toBeCloseTo(4.005003130089842, 6);
    expect(result.points).toHaveLength(3);
    expect(result.points[1].x).toBeCloseTo(0, 9);
    expect(result.points[1].y).toBeCloseTo(-0.10018808806984288, 9);
    expect(result.polylineLengthMeters).toBeCloseTo(4.005015681862478, 9);
  });

  it("A6: an alternating funnel wraps a left and then a right disk", () => {
    const result = solveTautPath(
      sleeveOf({ x: 0, y: 0 }, { x: 6, y: 0 }, [
        aperture({ x: 2, y: -0.5 }, { x: 2, y: -3 }),
        aperture({ x: 4, y: 3 }, { x: 4, y: 0.5 }),
      ]),
      rho,
    );
    if (result.status !== "ok") {
      throw new Error(result.status);
    }
    expect(result.apexes.map(({ apertureIndex, side }) => [apertureIndex, side])).toEqual([[0, "left"], [1, "right"]]);
    expect(funnelPointApexes(sleeveOf({ x: 0, y: 0 }, { x: 6, y: 0 }, [
      aperture({ x: 2, y: -0.5 }, { x: 2, y: -3 }),
      aperture({ x: 4, y: 3 }, { x: 4, y: 0.5 }),
    ]))).toEqual([{ apertureIndex: 0, side: "left" }, { apertureIndex: 1, side: "right" }]);
    // Tangent points: end of the piece into the first corner, start and end of the middle piece, start of the last piece.
    const first = tangentFromPointToDisk({ x: 0, y: 0 }, { x: 2, y: -0.5 }, rho, "left");
    const middle = tangentBetweenDisks({ x: 2, y: -0.5 }, "left", { x: 4, y: 0.5 }, "right", rho);
    const last = tangentFromPointToDisk({ x: 6, y: 0 }, { x: 4, y: 0.5 }, rho, "left");
    expect(first?.to.x).toBeCloseTo(1.953127849655967, 9);
    expect(first?.to.y).toBeCloseTo(-0.6424886013761324, 9);
    expect(middle?.from.x).toBeCloseTo(2.084475559418481, 9);
    expect(middle?.from.y).toBeCloseTo(-0.6239511188369621, 9);
    expect(middle?.to.x).toBeCloseTo(3.915524440581519, 9);
    expect(middle?.to.y).toBeCloseTo(0.6239511188369621, 9);
    expect(last?.to.x).toBeCloseTo(6 - (6 - 4.046872150344033), 9);
    expect(last?.to.y).toBeCloseTo(0.6424886013761324, 9);
    expect(result.lengthMeters).toBeCloseTo(6.602835373640863, 9);
  });

  it("A7: an aperture narrower than two radii is infeasible", () => {
    const result = solveTautPath(sleeveOf({ x: 0, y: 0 }, { x: 4, y: 0 }, [aperture({ x: 2, y: 0.1 }, { x: 2, y: -0.1 })]), rho);
    expect(result).toEqual({ status: "infeasible", apertureIndex: 0 });
  });

  it("A8: a wrap is subdivided into corners of at most the given turn", () => {
    const result = solveTautPath(
      sleeveOf({ x: -2, y: 0 }, { x: 2, y: 0 }, [aperture({ x: 0, y: 0.05 }, { x: 0, y: -5 })]),
      rho,
      { maxTurnPerCornerRadians: 0.05 },
    );
    if (result.status !== "ok") {
      throw new Error(result.status);
    }
    const phi = 0.10010440958560399;
    expect(result.points).toHaveLength(5);
    for (const corner of result.points.slice(1, 4)) {
      expect(Math.hypot(corner.x, corner.y - 0.05)).toBeCloseTo(rho / Math.cos(phi / 6), 9);
    }
    const distance = Math.hypot(2, 0.05);
    expect(result.polylineLengthMeters).toBeCloseTo(2 * Math.sqrt(distance * distance - rho * rho) + 6 * rho * Math.tan(phi / 6), 8);
  });

  it("A9: the funnel matches a brute-force shortest path (rho = 0)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.double({ min: 0.2, max: 2, noNaN: true }), fc.double({ min: -2, max: -0.2, noNaN: true })), { minLength: 3, maxLength: 6 }),
        fc.double({ min: -0.1, max: 0.1, noNaN: true }),
        fc.double({ min: -0.1, max: 0.1, noNaN: true }),
        (corridor, a, b) => {
          const k = corridor.length;
          const apertures = corridor.map(([leftY, rightY], index) => aperture({ x: index + 1, y: leftY }, { x: index + 1, y: rightY }));
          const sleeve = sleeveOf({ x: 0, y: a }, { x: k + 1, y: b }, apertures);
          const result = solveTautPath(sleeve, 0);
          if (result.status !== "ok") {
            return false;
          }
          // Brute force: dynamic programming over A, the 2k aperture endpoints and B ordered by x.
          const nodes = [
            { x: 0, y: a, column: 0 },
            ...corridor.flatMap(([leftY, rightY], index) => [
              { x: index + 1, y: leftY, column: index + 1 },
              { x: index + 1, y: rightY, column: index + 1 },
            ]),
            { x: k + 1, y: b, column: k + 1 },
          ];
          const allowed = (from: typeof nodes[number], to: typeof nodes[number]): boolean => {
            for (let column = from.column + 1; column < to.column; column += 1) {
              const y = from.y + ((to.y - from.y) * (column - from.x)) / (to.x - from.x);
              const [leftY, rightY] = corridor[column - 1];
              if (y > leftY + 1e-12 || y < rightY - 1e-12) {
                return false;
              }
            }
            return true;
          };
          const best = nodes.map(() => Infinity);
          best[0] = 0;
          for (let to = 1; to < nodes.length; to += 1) {
            for (let from = 0; from < to; from += 1) {
              if (nodes[from].column < nodes[to].column && Number.isFinite(best[from]) && allowed(nodes[from], nodes[to])) {
                best[to] = Math.min(best[to], best[from] + Math.hypot(nodes[to].x - nodes[from].x, nodes[to].y - nodes[from].y));
              }
            }
          }
          const funnelPoints = [sleeve.start, ...funnelPointApexes(sleeve).map((apex) => apertures[apex.apertureIndex][apex.side]), sleeve.end];
          let funnelLength = 0;
          for (let index = 0; index + 1 < funnelPoints.length; index += 1) {
            funnelLength += Math.hypot(funnelPoints[index + 1].x - funnelPoints[index].x, funnelPoints[index + 1].y - funnelPoints[index].y);
          }
          return Math.abs(funnelLength - best[nodes.length - 1]) < 1e-9 && Math.abs(result.lengthMeters - best[nodes.length - 1]) < 1e-9;
        },
      ),
      { numRuns: 100 },
    );
  });
});
