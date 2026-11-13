/**
 * `tests/authoring/spawnAndStand.test.ts` — unit tier.
 *
 * The authoring calls that arrange the first view: `startingPosition(..., { faceToward })` computes the yaw that looks at
 * an object of the face (declared before or after it), `toolStand` lays a table with one item per tool, and `demo`
 * records the laser, its beam, the ruler and the sign that the shell makes when the world starts. Bad input is refused
 * with a message, and a spec with a demo in a missing cell fails validation.
 */
import { describe, expect, it } from "vitest";
import { createWorldBuilder } from "../../src/authoring/worldBuilder";
import { validateCellComplexSpec } from "../../src/cell-complex/validateCellComplexSpec";
import { createConvexPrismBaseVertices } from "../../src/cell-complex/prismBase";
import { worldObjectLibrary } from "../../src/world-objects/library";

const square = createConvexPrismBaseVertices([
  [-7.5, -7.5],
  [7.5, -7.5],
  [7.5, 7.5],
  [-7.5, 7.5],
]);

function builderWithRoom() {
  const builder = createWorldBuilder();
  builder.PolygonFace("room", "#336699", square);
  return builder;
}

describe("startingPosition faceToward", () => {
  it("looks at the object, which then appears 8 degrees left of the middle", () => {
    const builder = builderWithRoom();
    builder.OnFace("room", [worldObjectLibrary.tree("tree", { position: [0, 0, 0] })]);
    builder.startingPosition("room", { position: [0, 0, 5], faceToward: "tree" });

    // The tree is straight ahead along -y; a yaw of pi faces -y, and looking 8 degrees to its right puts it 8 degrees left.
    const yaw = builder.build().startingPosition!.yawRadians!;
    expect(Math.atan2(Math.sin(yaw), Math.cos(yaw))).toBeCloseTo(Math.PI - (8 * Math.PI) / 180, 9);
  });

  it("accepts an object declared after the start, and a different offset", () => {
    const builder = builderWithRoom();
    builder.startingPosition("room", { position: [0, 0, 0], faceToward: "tree", leftOfCenterDegrees: 0 });
    builder.OnFace("room", [worldObjectLibrary.tree("tree", { position: [3, 0, 0] })]);

    // Straight to +x: a quarter turn to the right.
    expect(builder.build().startingPosition?.yawRadians).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("refuses an object that is not in the start's face, or is where the player starts", () => {
    const builder = builderWithRoom();
    builder.startingPosition("room", { position: [1, 0, 1], faceToward: "nothing" });
    expect(() => builder.build()).toThrow(/faceToward "nothing"/);

    builder.OnFace("room", [worldObjectLibrary.tree("nothing", { position: [1, 0, 1] })]);
    expect(() => builder.build()).toThrow(/where the player starts/);
  });
});

describe("toolStand", () => {
  it("lays a table and one item for each tool, in a row along the table, on the table top", () => {
    const builder = builderWithRoom();
    builder.toolStand("room", { position: [2, 0, 3], facing: 0 });
    const objects = builder.build().cells[0]!.visuals!.objects!;

    expect(objects.map((object) => object.id)).toEqual([
      "toolStand",
      "toolStand-emitter",
      "toolStand-length",
      "toolStand-protractor",
      "toolStand-flag",
      "toolStand-map",
    ]);
    const items = objects.slice(1);
    // Facing +y, the first item is on the viewer's left, which is the table's +x.
    expect(items.map((item) => item.position.x)).toEqual([2.44, 2.22, 2, 1.78, 1.56].map((x) => expect.closeTo(x, 9)));
    expect(items.every((item) => item.position.y === 3 && item.position.z === 0.6)).toBe(true);
    expect(items.map((item) => (item.kind === "asset" ? item.standsTool : undefined))).toEqual([
      "geodesicEmitters/emitter",
      "geodesicMeasurements/length",
      "geodesicMeasurements/protractor",
      "placedFlags/flag",
      "worldMap/map",
    ]);
  });

  it("turns the row with the table, and refuses a second stand and a missing facing", () => {
    const builder = builderWithRoom();
    builder.toolStand("room", { position: [0, 0, 0], facing: 90 });
    const items = builder.build().cells[0]!.visuals!.objects!.slice(1);

    // Turned a quarter, the row runs along +y.
    expect(items[0]!.position.x).toBeCloseTo(0, 9);
    expect(items[0]!.position.y).toBeCloseTo(0.44, 9);
    expect(() => builder.toolStand("room", { position: [0, 0, 0], facing: 0 })).toThrow(/one tool stand/);
    expect(() => builderWithRoom().toolStand("room", { position: [0, 0, 0] } as never)).toThrow(/facing/);
  });
});

describe("demo", () => {
  it("records the laser, the ruler and the sign in cell-local axes and radians", () => {
    const builder = builderWithRoom();
    builder.demo("room", {
      laser: { position: [1, 0, 2], yawDegrees: 180, beamLength: 12 },
      ruler: true,
      sign: { position: [3, 0, 4], text: "Start" },
    });

    expect(builder.build().demo).toEqual({
      cellId: "room",
      laser: { position: { x: 1, y: 2, z: 0 }, yawRadians: Math.PI, beamLengthMeters: 12 },
      ruler: true,
      sign: { position: { x: 3, y: 4, z: 0 }, text: "Start" },
    });
  });

  it("is absent when the world has none, and refuses a second demo or a beam with no length", () => {
    const builder = builderWithRoom();
    expect(builder.build().demo).toBeUndefined();

    expect(() => builder.demo("room", { laser: { position: [0, 0, 0], yawDegrees: 0, beamLength: 0 } })).toThrow(/positive beamLength/);
    builder.demo("room", { laser: { position: [0, 0, 0], yawDegrees: 0, beamLength: 5 } });
    expect(() => builder.demo("room", { laser: { position: [0, 0, 0], yawDegrees: 0, beamLength: 5 } })).toThrow(/one demo/);
    expect(builder.build().demo?.ruler).toBe(false);
  });

  it("fails validation when its cell is missing or its beam has no length", () => {
    const spec = builderWithRoom().build();

    expect(validateCellComplexSpec({ ...spec, demo: { cellId: "nowhere", laser: { position: { x: 0, y: 0, z: 0 }, yawRadians: 0, beamLengthMeters: 5 }, ruler: false } }))
      .toContain('Demo targets missing cell "nowhere".');
    expect(validateCellComplexSpec({ ...spec, demo: { cellId: "room", laser: { position: { x: 0, y: 0, z: 0 }, yawRadians: 0, beamLengthMeters: -1 }, ruler: false } }))
      .toContain("Demo beam length must be a positive number of meters.");
  });
});
