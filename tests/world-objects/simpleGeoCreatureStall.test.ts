/**
 * `tests/world-objects/simpleGeoCreatureStall.test.ts` — unit tier.
 *
 * The cube world's `front-runner` mouse used to end up inside a corner's forbidden zone: its heading change swung the
 * offset collision cylinder into the zone unchecked, and from there every step, even one leading out, was rejected, so
 * it froze for good. The heading is now limited to a turn the cell allows (and a fully blocked body is pushed out as a
 * backstop). The mouse stays clear of zones and walls on every frame and never stands still for long.
 */
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
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
});
