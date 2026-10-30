import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../../src/cell-complex/compileCellComplex";
import { type GeodesicPortalTraversal } from "../../../src/world-objects/geodesic/objects";
import { reverseGeodesicPortalWord } from "../../../src/world-objects/geodesic/portalWord";
import { exampleWorldSpecs } from "../../support/arbitraries";

const world = compileCellComplex(exampleWorldSpecs.find(([name]) => name === "cube")![1]);

/** Walks the cube: at each step picks a portal of the current cell by index and crosses it. */
function wordFromChoices(startIndex: number, choices: readonly number[]): readonly GeodesicPortalTraversal[] {
  let cell = world.cells[startIndex % world.cells.length];
  const word: GeodesicPortalTraversal[] = [];

  for (const choice of choices) {
    const portal = cell.portals[choice % cell.portals.length];

    word.push({
      sourceCellId: cell.id,
      sourcePortalId: portal.id,
      targetCellId: portal.targetCellId,
      targetPortalId: portal.targetPortalId,
    });
    cell = world.cellsById.get(portal.targetCellId)!;
  }

  return word;
}

describe("reverseGeodesicPortalWord properties", () => {
  it("is an involution on chained words", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.array(fc.nat(100), { maxLength: 12 }), (start, choices) => {
        const word = wordFromChoices(start, choices);

        expect(reverseGeodesicPortalWord(reverseGeodesicPortalWord(word))).toEqual(word);
      }),
      { numRuns: 200 },
    );
  });

  it("reverses a chained word into a chained word", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.array(fc.nat(100), { minLength: 1, maxLength: 12 }), (start, choices) => {
        const reversed = reverseGeodesicPortalWord(wordFromChoices(start, choices));

        for (let index = 0; index + 1 < reversed.length; index += 1) {
          expect(reversed[index].targetCellId).toBe(reversed[index + 1].sourceCellId);
        }
      }),
      { numRuns: 200 },
    );
  });
});
