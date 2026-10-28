import { describe, expect, it } from "vitest";
import { compileWorldScript } from "../../src/authoring/compileWorldScript";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import cubeWorldSource from "../../src/examples/cube.world.js?raw";

describe("compileWorldScript", () => {
  it("compiles a minimal script into a valid CellComplexSpec", () => {
    const spec = compileWorldScript(`
triangle = [
  [0, 0],
  [4, 0],
  [2, 3],
];

PolygonFace("triangle-room", floorTexture("grass1"), triangle);
OnFace("triangle-room", [
  tree("triangle-tree", {
    position: [0, 0, 0],
    scale: 0.1,
  }),
]);
`);

    expect(spec).toMatchObject({
      cells: [
        {
          id: "triangle-room",
          heightMeters: 15,
          baseVertices: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 2, y: 3 },
          ],
          visuals: {
            floorColor: "#5b8f48",
            floorMaterial: {
              kind: "floor-texture",
              name: "grass1",
            },
            objects: [{ id: "triangle-tree", assetPath: "Tree1/Tree.glb" }],
          },
        },
      ],
    });
  });

  it("compiles the cube world script and produces a spec that passes runtime compilation", () => {
    const spec = compileWorldScript(cubeWorldSource, {
      sourceName: "cube.world.js",
    });
    const compiled = compileCellComplex(spec);
    const front = compiled.cellsById.get("front");

    expect(spec.cells).toHaveLength(6);
    expect(spec.startingPosition?.cellId).toBe("front");
    expect(compiled.cells).toHaveLength(6);
    expect(front?.portalsById.get("side-1")?.targetCellId).toBe("right");
    expect(front?.objects).toHaveLength(3);
  });

  it("reports readable authoring errors for malformed scripts", () => {
    expect(() =>
      compileWorldScript(
        `
square = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

PolygonFace("front", "#f00", square);
PolygonFace("right", "#0f0", square);
Portal("front", 4, "right", 3);
`,
        { sourceName: "bad.world.js" },
      ),
    ).toThrowError(
      'World script "bad.world.js" failed: Invalid side 4; expected an index in the range 0-3.',
    );
  });
});
