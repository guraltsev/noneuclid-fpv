import { describe, expect, it } from "vitest";
import {
  authorSideToSideIndex,
  createWorldBuilder,
  defaultStartingQuestionCubeGoalPages,
  defaultStartingQuestionCubeMessage,
  defaultStartingQuestionCubeTutorialPages,
} from "../../src/authoring/worldBuilder";
import { createConvexPrismBaseVertices } from "../../src/cell-complex/prismBase";
import { worldObjectLibrary } from "../../src/world-objects/library";
import { worldFloorTextureLibrary } from "../../src/world-assets/floorTextures";

const squareBase = createConvexPrismBaseVertices([
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]);

describe("worldBuilder", () => {
  it("creates polygon faces with expected colors and vertices", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#d95f5f", squareBase);

    const spec = builder.build();

    expect(spec.cells).toHaveLength(1);
    expect(spec.cells[0]).toMatchObject({
      id: "front",
      heightMeters: 15,
      baseVertices: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      visuals: {
        floorColor: "#d95f5f",
        objects: [],
      },
    });
  });

  it("creates polygon faces with named floor materials", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", worldFloorTextureLibrary.floorTexture("grass1"), squareBase);

    const spec = builder.build();

    expect(spec.cells[0]?.visuals).toMatchObject({
      floorColor: "#5b8f48",
      floorMaterial: {
        kind: "floor-texture",
        name: "grass1",
        floorColor: "#5b8f48",
        tileSizeMeters: 60,
      },
      objects: [],
    });
  });

  it("creates reciprocal directed portals from a single Portal call", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.PolygonFace("right", "#0f0", squareBase);
    builder.Portal("front", 1, "right", 3);

    const spec = builder.build();
    const front = spec.cells.find((cell) => cell.id === "front");
    const right = spec.cells.find((cell) => cell.id === "right");

    expect(front?.portals).toEqual([
      {
        id: "side-1",
        sideIndex: 1,
        targetCellId: "right",
        targetPortalId: "side-3",
      },
    ]);
    expect(right?.portals).toEqual([
      {
        id: "side-3",
        sideIndex: 3,
        targetCellId: "front",
        targetPortalId: "side-1",
      },
    ]);
  });

  it("maps authored side numbers to the expected side indexes", () => {
    expect(authorSideToSideIndex(4, 0)).toBe(0);
    expect(authorSideToSideIndex(4, 1)).toBe(1);
    expect(authorSideToSideIndex(4, 2)).toBe(2);
    expect(authorSideToSideIndex(4, 3)).toBe(3);
  });

  it("rejects invalid sides and duplicate portal assignments clearly", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.PolygonFace("right", "#0f0", squareBase);

    expect(() => builder.Portal("front", 4, "right", 3)).toThrowError(
      "Invalid side 4; expected an index in the range 0-3.",
    );

    builder.Portal("front", 1, "right", 3);

    expect(() => builder.Portal("front", 1, "right", 0)).toThrowError(
      'Face "front" already has a portal on side-1.',
    );
  });

  it("attaches library objects to the requested face", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);

    builder.OnFace("front", [
      worldObjectLibrary.small_house("front-house", {
        position: [-0.5, 0, 0.25],
        scale: 3,
        turn: 12,
      }),
      worldObjectLibrary.geo_mouse("front-runner", {
        position: [-0.8, 0, -0.2],
        turn: 72,
        speed: 1.3,
      }),
    ]);

    const spec = builder.build();

    expect(spec.cells[0]?.visuals?.objects).toMatchObject([
      {
        id: "front-house",
        kind: "asset",
        position: { x: -0.5, y: 0.25, z: 0 },
      },
      {
        id: "front-runner",
        kind: "geo-mouse",
        position: { x: -0.8, y: -0.2, z: 0 },
        speedMetersPerSecond: 1.3,
        yawRadians: (72 * Math.PI) / 180,
      },
    ]);
  });

  it("adds a starting house and derives the starting player position", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.startingHouse("front", {
      position: [-0.5, 0, 0.25],
      scale: 1,
      turn: 30,
    });

    const spec = builder.build();

    expect(spec.cells[0]?.visuals?.objects).toMatchObject([
      {
        id: "startingHouse",
        kind: "asset",
        assetPath: "small_house/small_house.glb",
      },
    ]);
    expect(spec.startingPosition).toMatchObject({
      cellId: "front",
      pitchRadians: 0,
    });
    expect(spec.startingPosition?.yawRadians).toBeCloseTo(((30 + 180 - 12) * Math.PI) / 180);
    expect(spec.startingPosition?.position.x).toBeCloseTo(-1.85);
    expect(spec.startingPosition?.position.y).toBeCloseTo(2.5882685902179845);
    expect(spec.startingPosition?.position.z).toBe(0);
  });

  it("adds a starting question cube with a customizable tutorial message", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.startingQuestionCube("front", {
      position: [-0.25, 0.05, 0.8],
      scale: 1,
      turn: -18,
      message: "Try the movement controls.",
    });

    const spec = builder.build();

    expect(spec.cells[0]?.visuals?.objects).toMatchObject([
      {
        id: "startingQuestionCube",
        kind: "asset",
        assetPath: "questionblock/questionBlock.glb",
        displayHelpMessage: defaultStartingQuestionCubeMessage,
        tutorialPages: [{ title: "Tutorial", body: "Try the movement controls." }],
        goalPages: defaultStartingQuestionCubeGoalPages,
      },
    ]);
  });

  it("uses the shared starting question cube tutorial by default", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.startingQuestionCube("front", {
      position: [-0.25, 0.05, 0.8],
    });

    const spec = builder.build();

    expect(spec.cells[0]?.visuals?.objects?.[0]).toMatchObject({
      id: "startingQuestionCube",
      displayHelpMessage: defaultStartingQuestionCubeMessage,
      tutorialPages: defaultStartingQuestionCubeTutorialPages,
      goalPages: defaultStartingQuestionCubeGoalPages,
    });
  });

  it("accepts an explicit starting position without adding a house", () => {
    const builder = createWorldBuilder();

    builder.PolygonFace("front", "#f00", squareBase);
    builder.startingPosition("front", {
      position: [0.25, 0.1, -0.5],
      turn: 90,
      pitch: -5,
    });

    const spec = builder.build();

    expect(spec.cells[0]?.visuals?.objects).toEqual([]);
    expect(spec.startingPosition).toEqual({
      cellId: "front",
      position: { x: 0.25, y: -0.5, z: 0.1 },
      yawRadians: Math.PI / 2,
      pitchRadians: (-5 * Math.PI) / 180,
    });
  });
});
