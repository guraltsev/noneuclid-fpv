import { describe, expect, it } from "vitest";
import { validateAuthoringSpec } from "../../src/authoring/validateAuthoringSpec";
import { starterWorldSpecs } from "../../src/authoring/worldCatalog";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { validateCellComplexSpec } from "../../src/cell-complex/validateCellComplexSpec";

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function pair(overrides: { readonly bBase?: typeof square; readonly bSide?: number } = {}): CellComplexSpec {
  return {
    cells: [
      {
        id: "a",
        heightMeters: 2,
        baseVertices: square,
        portals: [{ id: "p", sideIndex: 0, targetCellId: "b", targetPortalId: "q" }],
      },
      {
        id: "b",
        heightMeters: 2,
        baseVertices: overrides.bBase ?? square,
        portals: [{ id: "q", sideIndex: overrides.bSide ?? 0, targetCellId: "a", targetPortalId: "p" }],
      },
    ],
  };
}

describe("validateCellComplexSpec", () => {
  it("accepts a valid reciprocal pair and keeps the authoring alias", () => {
    expect(validateCellComplexSpec(pair())).toEqual([]);
    expect(validateAuthoringSpec).toBe(validateCellComplexSpec);
  });

  it("rejects non-finite heights and base coordinates", () => {
    const spec = pair();
    const bad: CellComplexSpec = {
      cells: [
        { ...spec.cells[0], heightMeters: Number.NaN },
        { ...spec.cells[1], baseVertices: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      ],
    };
    const errors = validateCellComplexSpec(bad);

    expect(errors).toContain('Cell "a" must have a finite height.');
    expect(errors).toContain('Cell "b" base vertex 1 must have finite coordinates.');
  });

  it("rejects two portals on the same side", () => {
    const spec = pair();
    const cells = [
      { ...spec.cells[0], portals: [...spec.cells[0].portals, { id: "p2", sideIndex: 0, targetCellId: "b", targetPortalId: "q" }] },
      spec.cells[1],
    ];

    expect(validateCellComplexSpec({ cells })).toContain('Portals "a:p" and "a:p2" are both on sideIndex 0.');
  });

  it("rejects a self-targeting portal", () => {
    const errors = validateCellComplexSpec({
      cells: [
        {
          id: "a",
          heightMeters: 2,
          baseVertices: square,
          portals: [{ id: "p", sideIndex: 0, targetCellId: "a", targetPortalId: "p" }],
        },
      ],
    });

    expect(errors).toContain('Portal "a:p" targets itself.');
  });

  it("rejects glued sides of unequal length but allows unequal heights", () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];
    const errors = validateCellComplexSpec(pair({ bBase: wide }));

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("glued sides must have equal length");

    const tall = pair();
    expect(validateCellComplexSpec({ cells: [tall.cells[0], { ...tall.cells[1], heightMeters: 7 }] })).toEqual([]);
  });

  it("validates every bundled catalog world", () => {
    for (const spec of starterWorldSpecs) {
      expect(validateCellComplexSpec(spec)).toEqual([]);
    }
  });
});

describe("validateCellComplexSpec options", () => {
  it("can skip the glued side length check", () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ];

    expect(validateCellComplexSpec(pair({ bBase: wide }), { checkGluedSideLengths: false })).toEqual([]);
  });
});
