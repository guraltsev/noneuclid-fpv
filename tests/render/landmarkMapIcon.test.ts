/**
 * `tests/render/landmarkMapIcon.test.ts` — unit tier.
 *
 * The map icon of a generated landmark is drawn from its own parts: every triangle lands inside the icon's disc, far triangles are painted
 * before near ones, and the map lists exactly one such icon, the major landmark, per themed face, at that landmark's place. Without a DOM
 * no canvas is drawn.
 */
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { drawLandmarkMapIcon, landmarkIconTriangles, landmarkMapIconPixels } from "../../src/render/three/landmarkMapIcon";
import { landmarkPieces } from "../../src/render/three/worldMapPieces";
import { computeWorldDressing } from "../../src/world-assets/worldDressing";

const world = compileCellComplex(cube);
const dressing = computeWorldDressing(world);

describe("landmark map icons", () => {
  it("fit every major landmark's triangles inside the icon disc", () => {
    const centre = landmarkMapIconPixels / 2;
    for (const placements of dressing.landmarksByCellId.values()) {
      const major = placements.find((placement) => placement.role === "major")!;
      const triangles = landmarkIconTriangles(major);
      expect(triangles.length).toBe(major.triangles);
      for (const triangle of triangles) {
        for (const [x, y] of triangle.points) {
          expect(Math.hypot(x - centre, y - centre)).toBeLessThanOrEqual(landmarkMapIconPixels * 0.49);
        }
      }
    }
  });

  it("paints far triangles first", () => {
    const parts = [
      { shape: "box" as const, at: [0, -2, 0] as const, sx: 1, sy: 1, sz: 1, color: "#ff0000" },
      { shape: "box" as const, at: [0, 2, 0] as const, sx: 1, sy: 1, sz: 1, color: "#0000ff" },
    ];
    const fills = landmarkIconTriangles({ parts }).map((triangle) => triangle.fill);
    // The blue box is farther along +v, so all of it comes before the red one.
    expect(fills.slice(0, 12).every((fill) => /^rgb\(0, 0, \d+\)$/.test(fill))).toBe(true);
    expect(fills.slice(12).every((fill) => /^rgb\(\d+, 0, 0\)$/.test(fill))).toBe(true);
  });

  it("lists one icon per themed face, at its major landmark", () => {
    const pieces = landmarkPieces(world);
    expect(pieces).toHaveLength(dressing.lookByCellId.size);
    for (const piece of pieces) {
      const major = dressing.landmarksByCellId.get(piece.cellId)!.find((placement) => placement.role === "major")!;
      expect(piece.landmark!.placement).toBe(major);
      expect(piece.cellFromIcon.elements[12]).toBeCloseTo(major.x, 6);
      expect(piece.onTop).toBe(false);
    }
  });

  it("draws nothing without a DOM", () => {
    const major = [...dressing.landmarksByCellId.values()][0][0];
    expect(drawLandmarkMapIcon(major, dressing.lookByCellId.values().next().value!.palette)).toBeUndefined();
  });
});
