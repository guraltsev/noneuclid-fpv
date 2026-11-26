/**
 * Unit tier: the player-blocking bodies of generated landmarks.
 *
 * The lookup gives every collider of a cell's landmarks as a body the movement code takes, builds them once per world, and the player is stopped by one.
 */
import { describe, expect, it } from "vitest";
import { basicCube as basicCubeSpec } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createLandmarkBodyLookup } from "../../src/render/three/landmarkBodies";
import { computeWorldDressing } from "../../src/world-assets/worldDressing";

function basicCube() {
  return compileCellComplex(basicCubeSpec);
}

describe("landmark bodies", () => {
  it("gives one body per landmark collider of the cell, at the collider's place", () => {
    const world = basicCube();
    const lookup = createLandmarkBodyLookup();
    for (const cell of world.cells) {
      const colliders = (computeWorldDressing(world).landmarksByCellId.get(cell.id) ?? []).flatMap((placement) => placement.colliders);
      const bodies = lookup(world, cell.id);
      expect(bodies.length).toBe(colliders.length);
      bodies.forEach((body, index) => {
        expect(body.id).toBe(`landmark:${cell.id}:${index}`);
        expect(body.cellId).toBe(cell.id);
        expect([body.localPose.translation.x, body.localPose.translation.y]).toEqual([colliders[index].x, colliders[index].y]);
        expect(body.collision?.radius).toBe(colliders[index].radiusMeters);
      });
    }
    expect(world.cells.some((cell) => lookup(world, cell.id).length > 0)).toBe(true);
  });

  it("reuses the bodies of a cell and rebuilds them for another world", () => {
    const world = basicCube();
    const lookup = createLandmarkBodyLookup();
    const first = lookup(world, "left");
    expect(lookup(world, "left")).toBe(first);
    expect(lookup(basicCube(), "left")).not.toBe(first);
    expect(lookup(world, "no-such-cell")).toEqual([]);
  });
});
