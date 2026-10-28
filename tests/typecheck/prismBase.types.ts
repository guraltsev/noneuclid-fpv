import { createWorldBuilder } from "../../src/authoring/worldBuilder";
import { createConvexPrismBaseVertices } from "../../src/cell-complex/prismBase";

const builder = createWorldBuilder();

builder.PolygonFace(
  "triangle",
  "#f6c04d",
  createConvexPrismBaseVertices([
    [0, 0],
    [1, 0],
    [0, 1],
  ]),
);

// @ts-expect-error More than 8 sides must be rejected at compile time.
createConvexPrismBaseVertices([
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 0],
  [6, 0],
  [7, 0],
  [8, 0],
]);

// @ts-expect-error Plain tuples must be wrapped in the convex-base helper.
builder.PolygonFace("plain", "#f6c04d", [[0, 0], [1, 0], [0, 1]] as const);
