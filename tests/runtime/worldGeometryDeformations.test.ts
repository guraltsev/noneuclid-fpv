import { describe, expect, it } from "vitest";
import { torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { torusModuli } from "../../src/authoring/exampleWorlds";
import { inferTorusSkewState } from "../../src/runtime/deformations/torusSkewDeformation";
import {
  applyPrismBaseReplacements,
  deformationStatesEqual,
  validateTopologyPreservingSnapshot,
} from "../../src/runtime/worldGeometryDeformations";
import {
  applyWorldDeformationToSpec,
  createDefaultWorldDeformationFamilyRegistry,
  createInitialWorldDeformationState,
  getWorldDeformationFamilyOrThrow,
} from "../../src/runtime/worldGeometryDeformationFamilies";

describe("deformation state helpers", () => {
  it("compares states independent of key order", () => {
    const a = { kind: "torus-skew", cellId: "torus-room", widthMeters: 15, depthMeters: 15, skewXMeters: 1 } as const;
    const b = { skewXMeters: 1, depthMeters: 15, widthMeters: 15, cellId: "torus-room", kind: "torus-skew" } as const;

    expect(deformationStatesEqual(a, b)).toBe(true);
    expect(deformationStatesEqual(a, { ...b, skewXMeters: 1.5 })).toBe(false);
    expect(deformationStatesEqual({ kind: "static-world" }, a)).toBe(false);
  });

  it("infers the initial state from the base spec for shipped torus worlds", () => {
    for (const spec of [torus, torusModuli]) {
      const initial = createInitialWorldDeformationState(spec);
      if (initial.kind === "static-world") {
        continue;
      }
      expect(initial).toEqual(inferTorusSkewState(spec));
      expect(applyWorldDeformationToSpec(spec, initial).cells[0].baseVertices).toEqual(spec.cells[0].baseVertices);
    }
    expect(createInitialWorldDeformationState(torus).kind).toBe("torus-skew");
  });

  it("infers non-default width, depth and skew instead of 15 m", () => {
    const vertices = [
      { x: -5, y: -3 },
      { x: 5, y: -3 },
      { x: 6, y: 3 },
      { x: -4, y: 3 },
    ];
    const spec = { ...torus, cells: [{ ...torus.cells[0], baseVertices: vertices }] };

    expect(createInitialWorldDeformationState(spec)).toMatchObject({
      widthMeters: 10,
      depthMeters: 6,
      skewXMeters: 1,
    });
  });

  it("falls back to the 15 m default when inference is impossible", () => {
    const vertices = [
      { x: -50, y: -7.5 },
      { x: 50, y: -7.5 },
      { x: 50, y: 7.5 },
      { x: -50, y: 7.5 },
    ];
    const spec = { ...torus, cells: [{ ...torus.cells[0], baseVertices: vertices }] };

    expect(createInitialWorldDeformationState(spec)).toMatchObject({ widthMeters: 15, depthMeters: 15, skewXMeters: 0 });
  });
});

describe("world geometry deformation families", () => {
  it("resolves torus-skew by kind", () => {
    const registry = createDefaultWorldDeformationFamilyRegistry();
    const family = registry.get("torus-skew");

    expect(family?.kind).toBe("torus-skew");
    expect(family?.canApplyToSpec(torus)).toBe(true);
  });

  it("rejects unknown deformation kinds clearly", () => {
    const registry = createDefaultWorldDeformationFamilyRegistry();

    expect(() =>
      getWorldDeformationFamilyOrThrow(
        registry,
        "missing-family" as Parameters<typeof getWorldDeformationFamilyOrThrow>[1],
      ),
    ).toThrowError(/Unknown world deformation family "missing-family"/);
  });

  it("applies reusable convex prism base replacements without changing portal specs", () => {
    const replaced = applyPrismBaseReplacements(torus, [
      {
        cellId: "torus-room",
        baseVertices: [
          { x: -8.5, y: -7.5 },
          { x: 6.5, y: -7.5 },
          { x: 8.5, y: 7.5 },
          { x: -6.5, y: 7.5 },
        ],
      },
    ]);

    expect(replaced.cells[0].baseVertices).not.toEqual(torus.cells[0].baseVertices);
    expect(replaced.cells[0].portals).toEqual(torus.cells[0].portals);
    expect(replaced.cells[0].id).toBe(torus.cells[0].id);
  });

  it("rejects topology-changing target portal edits before renderer code sees them", () => {
    const previous = compileCellComplex(torus);
    const changedPortalTarget = compileCellComplex({
      ...torus,
      cells: [
        {
          ...torus.cells[0],
          portals: torus.cells[0].portals.map((portal) => {
            if (portal.id === "side-0") {
              return { ...portal, targetPortalId: "side-3" };
            }
            if (portal.id === "side-3") {
              return { ...portal, targetPortalId: "side-0" };
            }
            if (portal.id === "side-1") {
              return { ...portal, targetPortalId: "side-2" };
            }
            if (portal.id === "side-2") {
              return { ...portal, targetPortalId: "side-1" };
            }
            return portal;
          }),
        },
      ],
    });

    expect(validateTopologyPreservingSnapshot(previous, changedPortalTarget)).toContain(
      'Portal "torus-room:side-0" target pairing changed.',
    );
  });

  it("rejects changed portal side indices", () => {
    const previous = compileCellComplex(torus);
    const changedSideIndex = compileCellComplex({
      ...torus,
      cells: [
        {
          ...torus.cells[0],
          // Swap the side indices of side-0 and side-1 so no two portals share a side (which validation rejects).
          portals: torus.cells[0].portals.map((portal) =>
            portal.id === "side-0" ? { ...portal, sideIndex: 1 } :
            portal.id === "side-1" ? { ...portal, sideIndex: 0 } :
            portal,
          ),
        },
      ],
    });

    expect(validateTopologyPreservingSnapshot(previous, changedSideIndex)).toContain(
      'Portal "torus-room:side-0" side index changed from 0 to 1.',
    );
  });

  it("rejects changed side counts", () => {
    const previous = compileCellComplex(torus);
    const next = compileCellComplex({
      ...torus,
      cells: [
        {
          ...torus.cells[0],
          baseVertices: [
            { x: -7.5, y: -7.5 },
            { x: 7.5, y: -7.5 },
            { x: 8.5, y: 0 },
            { x: 7.5, y: 7.5 },
            { x: -7.5, y: 7.5 },
          ],
          portals: torus.cells[0].portals.map((portal) =>
            portal.id === "side-2" ? { ...portal, sideIndex: 3 } :
            portal.id === "side-3" ? { ...portal, sideIndex: 4 } :
            portal,
          ),
        },
      ],
    }, { allowUnequalGluedSides: true });

    expect(validateTopologyPreservingSnapshot(previous, next)).toContain(
      'Cell "torus-room" side count changed from 4 to 5.',
    );
  });

  it("rejects reciprocal side length mismatches", () => {
    const previous = compileCellComplex(torus);
    const mismatched = applyPrismBaseReplacements(torus, [
      {
        cellId: "torus-room",
        baseVertices: [
          { x: -7.5, y: -7.5 },
          { x: 7.5, y: -7.5 },
          { x: 7.5, y: 7.5 },
          { x: -5.5, y: 7.5 },
        ],
      },
    ]);
    const next = compileCellComplex(mismatched, { allowUnequalGluedSides: true });

    expect(validateTopologyPreservingSnapshot(previous, next)).toContain(
      'Portal pair "torus-room:side-0" <-> "torus-room:side-2" has incompatible side lengths.',
    );
  });

  it("fails nonconvex deformed bases through existing validation", () => {
    const nonconvex = applyPrismBaseReplacements(torus, [
      {
        cellId: "torus-room",
        baseVertices: [
          { x: -7.5, y: -7.5 },
          { x: 7.5, y: -7.5 },
          { x: 0, y: 0 },
          { x: -7.5, y: 7.5 },
        ],
      },
    ]);

    expect(() => compileCellComplex(nonconvex)).toThrowError(/non-convex prism cells are not supported/);
  });

  it("applies a deformation without importing Three.js or DOM code", () => {
    const spec = applyWorldDeformationToSpec(torus, {
      kind: "torus-skew",
      cellId: "torus-room",
      widthMeters: 15,
      depthMeters: 15,
      skewXMeters: 1,
    });

    expect(spec.cells[0].baseVertices[0]).toEqual({ x: -8, y: -7.5 });
  });
});
