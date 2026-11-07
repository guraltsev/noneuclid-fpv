/**
 * `tests/cell-complex/platonicSolid.test.ts` - unit tier.
 *
 * `findPlatonicSolid` folds a world's portal gluings into a solid. Every bundled solid world must close up as its own solid, with its faces on the solid's outside and glued sides meeting; a torus, a genus-2 surface and a mis-glued cube must not.
 */
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron, cube, dodecahedron, genus2Torus, icosahedron, octahedron, tetrahedron, torus, torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { faceCenter, findPlatonicSolid } from "../../src/cell-complex/platonicSolid";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { transformDirection3, transformPoint3 } from "../../src/math/rigidTransform3";
import { dotVec3, lengthVec3, subVec3, vec3 } from "../../src/math/vec3";

describe("findPlatonicSolid", () => {
  it.each([
    ["tetrahedron", tetrahedron, "tetrahedron"],
    ["cube", cube, "cube"],
    ["octahedron", octahedron, "octahedron"],
    ["dodecahedron", dodecahedron, "dodecahedron"],
    ["icosahedron", icosahedron, "icosahedron"],
    ["001 basic cube", basicCube, "cube"],
    ["002 basic tetrahedron", basicTetrahedron, "tetrahedron"],
  ] as const)("recognizes %s", (_label, spec, name) => {
    const world = compileCellComplex(spec);
    const solid = findPlatonicSolid(world);
    expect(solid?.name).toBe(name);
    for (const cell of world.cells) {
      const frame = solid!.cellFrames.get(cell.id)!;
      const normal = transformDirection3(frame, vec3(0, 0, 1));
      expect(dotVec3(transformPoint3(frame, faceCenter(cell)), normal)).toBeGreaterThan(0);
      for (const side of cell.sides) {
        // A corner lands where its image under the gluing lands.
        const portal = side.portal!;
        const targetFrame = solid!.cellFrames.get(portal.targetCellId)!;
        const corner = vec3(side.start.x, side.start.y, 0);
        const gap = subVec3(transformPoint3(frame, corner), transformPoint3(targetFrame, transformPoint3(portal.transformToTarget, corner)));
        expect(lengthVec3(gap)).toBeLessThan(0.02);
      }
    }
  });

  it.each([
    ["torus", torus],
    ["torus moduli", torusModuli],
    ["genus 2", genus2Torus],
  ] as const)("has no solid for %s", (_label, spec) => {
    expect(findPlatonicSolid(compileCellComplex(spec))).toBeUndefined();
  });

  it("refuses a cube whose gluing does not close up", () => {
    // Two gluings trade partners: the same polygons and the same counts, but not a cube.
    const portalOf = (cellId: string, targetCellId: string) => cube.cells.find((cell) => cell.id === cellId)!.portals.find((portal) => portal.targetCellId === targetCellId)!;
    const a = portalOf("front", "right");
    const aBack = portalOf("right", "front");
    const b = portalOf("back", "left");
    const bBack = portalOf("left", "back");
    const swapped: CellComplexSpec = {
      ...cube,
      cells: cube.cells.map((cell) => ({
        ...cell,
        portals: cell.portals.map((portal) => {
          if (portal === a) return { ...portal, targetCellId: "left", targetPortalId: bBack.id };
          if (portal === bBack) return { ...portal, targetCellId: "front", targetPortalId: a.id };
          if (portal === b) return { ...portal, targetCellId: "right", targetPortalId: aBack.id };
          if (portal === aBack) return { ...portal, targetCellId: "back", targetPortalId: b.id };
          return portal;
        }),
      })),
    };
    expect(findPlatonicSolid(compileCellComplex(swapped))).toBeUndefined();
  });
});
