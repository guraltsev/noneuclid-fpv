import { describe, expect, it } from "vitest";
import { describeGeometrySpec } from "../../src/cell-complex/describeGeometry";
import { cube, torus } from "../../src/authoring/exampleWorlds";

describe("describeGeometrySpec", () => {
  it("summarizes cell counts, cell shapes, and oriented connections", () => {
    const summary = describeGeometrySpec(cube);

    expect(summary).toContain("Ingested geometry: 6 cells.");
    expect(summary).toContain("cell=front: prism, sides=4, floor=#5b8f48, objects=3");
    expect(summary).toContain("(cell=front, side=0) -> (cell=bottom, side=2)");
    expect(summary).toContain("(cell=top, side=1) -> (cell=right, side=2)");
  });

  it("uses singular grammar for one-cell geometries", () => {
    expect(describeGeometrySpec(torus)).toContain("Ingested geometry: 1 cell.");
  });
});
