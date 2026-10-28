import { createWorldBuilder } from "../../src/authoring/worldBuilder";
import { createConvexPrismBaseVertices } from "../../src/cell-complex/prismBase";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { worldFloorTextureLibrary } from "../../src/world-assets/floorTextures";

const square = [
  [-7.5, -7.5],
  [7.5, -7.5],
  [7.5, 7.5],
  [-7.5, 7.5],
] as const;

export const twoPrismLoop: CellComplexSpec = createTwoPrismLoop();

function createTwoPrismLoop(): CellComplexSpec {
  const builder = createWorldBuilder();
  const squareBase = createConvexPrismBaseVertices(square);

  builder.PolygonFace("room-a", worldFloorTextureLibrary.floorTexture("grass1"), squareBase);
  builder.PolygonFace("room-b", worldFloorTextureLibrary.floorTexture("snow"), squareBase);
  builder.Portal("room-a", 1, "room-b", 3);

  return builder.build();
}
