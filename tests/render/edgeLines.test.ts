/**
 * The edge lines of "Show edges" (src/render/three/edgeLines.ts): a thin flat strip on the floor along every side of a face that has a portal, nothing along a plain wall, hidden until switched on, and shown or hidden together for every face by the switch.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildEdgeLines, edgeLineWidthMeters, edgeLinesGroupName, setEdgeLinesVisible } from "../../src/render/three/edgeLines";

const square = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];

// A room whose bottom and top sides are glued to each other; its left and right sides are plain walls.
const world = compileCellComplex({
  cells: [{
    id: "room",
    heightMeters: 3,
    baseVertices: square,
    portals: [
      { id: "side-0", sideIndex: 0, targetCellId: "room", targetPortalId: "side-2" },
      { id: "side-2", sideIndex: 2, targetCellId: "room", targetPortalId: "side-0" },
    ],
  }],
});

describe("buildEdgeLines", () => {
  it("makes one strip per glued side, lying on the floor and as wide as the line is", () => {
    const group = buildEdgeLines(world.cells[0]!, true);
    expect(group.name).toBe(edgeLinesGroupName);
    expect(group.visible).toBe(true);

    const strips = group.children[0] as THREE.Mesh;
    const positions = strips.geometry.getAttribute("position");
    // Two sides, four corners each.
    expect(positions.count).toBe(8);
    expect(strips.geometry.getIndex()!.count).toBe(12);
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBeGreaterThan(0);
      expect(positions.getY(index)).toBeLessThan(0.1);
    }
    // The first side runs along y = -5 (the scene's z = 5) and the strip reaches edgeLineWidthMeters into the room.
    expect(positions.getZ(0)).toBeCloseTo(5, 9);
    expect(positions.getZ(3)).toBeCloseTo(5 - edgeLineWidthMeters, 5);
  });

  it("is hidden when asked and draws nothing for a face with no glued side", () => {
    expect(buildEdgeLines(world.cells[0]!, false).visible).toBe(false);

    const walled = compileCellComplex({ cells: [{ id: "closed", heightMeters: 3, baseVertices: square, portals: [] }] });
    expect(buildEdgeLines(walled.cells[0]!, true).children).toHaveLength(0);
  });

  it("is switched on and off for every face's root together", () => {
    const rootA = new THREE.Group();
    const rootB = new THREE.Group();
    rootA.add(buildEdgeLines(world.cells[0]!, false), new THREE.Group());
    rootB.add(buildEdgeLines(world.cells[0]!, false));

    setEdgeLinesVisible([rootA, rootB], true);
    expect(rootA.children[0]!.visible).toBe(true);
    expect(rootB.children[0]!.visible).toBe(true);
    expect(rootA.children[1]!.visible).toBe(true);

    setEdgeLinesVisible([rootA, rootB], false);
    expect(rootA.children[0]!.visible).toBe(false);
    expect(rootB.children[0]!.visible).toBe(false);
  });
});
