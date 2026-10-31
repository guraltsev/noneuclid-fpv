/**
 * `tests/cell-complex/validateCellComplexSpec.test.ts` — unit tier.
 *
 * `validateCellComplexSpec` checks an authored spec against the rules a cell complex must follow
 * (`_docs/MATHEMATICAL_MODEL.md` §2, §3): unique cell and portal ids, portals reciprocated by their target,
 * targets that exist, in-range side indices, convex counter-clockwise bases, finite coordinates and heights, and
 * glued sides of equal length (optionally skipped for tests that deliberately build an ill-formed gluing). It
 * reports every error found, with a message naming the offending cell or portal, rather than stopping at the first
 * one. `compileCellComplex` calls it and throws on any error (`tests/cell-complex/compileCellComplex.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { validateAuthoringSpec } from "../../src/authoring/validateAuthoringSpec";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { validateCellComplexSpec } from "../../src/cell-complex/validateCellComplexSpec";

const square = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const triangleBase = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
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

  it("reports readable movement-critical authoring errors", () => {
    const errors = validateCellComplexSpec({
      cells: [
        {
          id: "room",
          heightMeters: 2,
          baseVertices: triangleBase,
          portals: [
            {
              id: "bad",
              sideIndex: 3,
              targetCellId: "missing",
              targetPortalId: "also-missing",
            },
            {
              id: "bad",
              sideIndex: 0,
              targetCellId: "room",
              targetPortalId: "bad",
            },
          ],
        },
        {
          id: "room",
          heightMeters: 2,
          baseVertices: triangleBase,
          portals: [],
        },
      ],
    });

    expect(errors).toContain('Duplicate cell id "room".');
    expect(errors).toContain('Cell "room" has duplicate portal id "bad".');
    expect(errors).toContain('Portal "room:bad" has sideIndex 3, expected 0-2.');
    expect(errors).toContain('Portal "room:bad" targets missing cell "missing".');
    expect(errors).toContain('Portal "room:bad" is not reciprocated by "room:bad".');
  });

  it("rejects non-convex and clockwise prism bases", () => {
    const nonConvexErrors = validateCellComplexSpec({
      cells: [
        {
          id: "non-convex",
          heightMeters: 2,
          baseVertices: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
            { x: 0, y: 2 },
          ],
          portals: [],
        },
      ],
    });
    const clockwiseErrors = validateCellComplexSpec({
      cells: [
        {
          id: "clockwise",
          heightMeters: 2,
          baseVertices: [
            { x: -1, y: -1 },
            { x: -1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: -1 },
          ],
          portals: [],
        },
      ],
    });

    expect(nonConvexErrors).toContain(
      'Cell "non-convex" must be strictly convex; non-convex prism cells are not supported.',
    );
    expect(clockwiseErrors).toContain(
      'Cell "clockwise" must list baseVertices in counterclockwise order in the x/y plane.',
    );
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
