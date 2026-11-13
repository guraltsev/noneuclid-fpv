/**
 * `tests/authoring/discoveries.test.ts` - unit tier.
 *
 * The authoring call `discoveries({ disable, add, markers })`: it records the switches, the world's own discoveries with their detectors (a visit to a face, an approach to a floor point) and the curiosity markers in the spec, refuses bad input with a message, and the spec validator checks the faces and numbers. The shipped worlds declare theirs: markers in 001, genus-2 and the torus with the shape machine, and every catalog built from them is free of mistakes.
 */
import { describe, expect, it } from "vitest";
import { createWorldBuilder } from "../../src/authoring/worldBuilder";
import { basicCube, basicTetrahedron, cube, dodecahedron, genus2Torus, icosahedron, octahedron, tetrahedron, torus, torusModuli } from "../../src/authoring/exampleWorlds";
import { validateCellComplexSpec } from "../../src/cell-complex/validateCellComplexSpec";
import { createConvexPrismBaseVertices } from "../../src/cell-complex/prismBase";
import { createDiscoveryCatalog } from "../../src/modules/discoveries";

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

describe("the discoveries call", () => {
  it("records the switches, an approach, a visit and the markers in cell-local meters", () => {
    const builder = builderWithRoom();
    builder.discoveries({
      disable: ["around-a-corner"],
      add: [
        {
          id: "corner",
          name: "The corner",
          question: "How many squares meet?",
          teaser: "three squares",
          detector: { approach: { face: "room", position: [6, 0, -5], radius: 1.5 } },
          marker: { face: "room", position: [6, 0, -5] },
        },
        { id: "visit", name: "Visit", question: "Q?", teaser: "T", detector: { visitFace: "room" } },
      ],
      markers: [{ discovery: "new-shape", face: "room", position: [1, 0, 2] }],
    });

    const spec = builder.build().discoveries!;
    expect(spec.disable).toEqual(["around-a-corner"]);
    expect(spec.add[0]).toEqual({
      id: "corner",
      name: "The corner",
      question: "How many squares meet?",
      teaser: "three squares",
      detector: { kind: "approach", cellId: "room", position: { x: 6, y: -5, z: 0 }, radius: 1.5 },
      marker: { cellId: "room", position: { x: 6, y: -5, z: 0 } },
    });
    expect(spec.add[1]!.detector).toEqual({ kind: "visitFace", cellId: "room" });
    expect(spec.markers).toEqual([{ discovery: "new-shape", cellId: "room", position: { x: 1, y: 2, z: 0 } }]);
    expect(validateCellComplexSpec(builder.build())).toEqual([]);
  });

  it("leaves the spec without a discoveries section when the world never calls it", () => {
    expect(builderWithRoom().build().discoveries).toBeUndefined();
  });

  it("refuses an unknown face, a bad radius, a missing detector, a repeated id and a second call", () => {
    const entry = { id: "x", name: "X", question: "Q?", teaser: "T" };
    expect(() => builderWithRoom().discoveries({ add: [{ ...entry, detector: { visitFace: "nowhere" } }] })).toThrow(/Unknown face "nowhere"/);
    expect(() => builderWithRoom().discoveries({ add: [{ ...entry, detector: { approach: { face: "room", position: [0, 0, 0], radius: 0 } } }] })).toThrow(/positive radius/);
    expect(() => builderWithRoom().discoveries({ add: [{ ...entry, detector: undefined as never }] })).toThrow(/needs a detector/);
    expect(() => builderWithRoom().discoveries({ add: [{ ...entry, detector: { visitFace: "room" } }, { ...entry, detector: { visitFace: "room" } }] })).toThrow(/twice/);
    expect(() => builderWithRoom().discoveries({ markers: [{ discovery: "new-shape", face: "nowhere", position: [0, 0, 0] }] })).toThrow(/Unknown face/);

    const builder = builderWithRoom();
    builder.discoveries({});
    expect(() => builder.discoveries({})).toThrow(/one discoveries section/);
  });

  it("is checked by the spec validator for faces and numbers", () => {
    const spec = builderWithRoom().build();
    const bad = {
      ...spec,
      discoveries: {
        disable: [],
        add: [{ id: "x", name: "X", question: "Q?", teaser: "T", detector: { kind: "approach" as const, cellId: "gone", position: { x: Number.NaN, y: 0, z: 0 }, radius: -1 } }],
        markers: [{ discovery: "new-shape", cellId: "gone", position: { x: 0, y: 0, z: 0 } }],
      },
    };
    const errors = validateCellComplexSpec(bad);
    expect(errors.some((error) => error.includes('missing cell "gone"'))).toBe(true);
    expect(errors.some((error) => error.includes("finite position"))).toBe(true);
    expect(errors.some((error) => error.includes("positive radius"))).toBe(true);
  });
});

describe("the shipped worlds", () => {
  const worlds = { basicCube, basicTetrahedron, cube, tetrahedron, octahedron, icosahedron, dodecahedron, genus2Torus, torus, torusModuli };

  it("have catalogs without mistakes and valid specs", () => {
    for (const [name, world] of Object.entries(worlds)) {
      expect(validateCellComplexSpec(world), name).toEqual([]);
      expect(createDiscoveryCatalog(world.discoveries).problems, name).toEqual([]);
    }
  });

  it("put markers at a cube corner, the genus-2 corner and the shape machine", () => {
    const markers = (world: typeof basicCube) => createDiscoveryCatalog(world.discoveries).definitions.flatMap((definition) => (definition.marker === undefined ? [] : [{ id: definition.id, ...definition.marker }]));

    const cubeMarkers = markers(basicCube);
    expect(cubeMarkers).toHaveLength(1);
    expect(cubeMarkers[0]).toMatchObject({ id: "cube-corner", cellId: "front" });
    expect(Math.abs(cubeMarkers[0]!.position.x)).toBeGreaterThan(5);
    expect(Math.abs(cubeMarkers[0]!.position.y)).toBeGreaterThan(5);

    expect(markers(genus2Torus)).toMatchObject([{ id: "genus-2-corner", cellId: "genus-2-octagon" }]);
    expect(markers(torusModuli)).toMatchObject([{ id: "new-shape", cellId: "torus-room" }]);
    expect(markers(torus)).toEqual([]);
  });

  it("leave out the discoveries that cannot happen: no shape machine, no second face", () => {
    const ids = (world: typeof basicCube) => createDiscoveryCatalog(world.discoveries).definitions.map((definition) => definition.id);
    expect(ids(basicCube)).not.toContain("new-shape");
    expect(ids(genus2Torus)).not.toContain("new-shape");
    expect(ids(torus)).not.toContain("back-where-you-started");
    expect(ids(torusModuli)).toContain("new-shape");
    expect(ids(torusModuli)).not.toContain("back-where-you-started");
  });

  it("place each marker at a spot a person can stand on, clear of the corner's forbidden zone", () => {
    const worldWith = { basicCube, genus2Torus, torusModuli };
    for (const [name, world] of Object.entries(worldWith)) {
      for (const definition of createDiscoveryCatalog(world.discoveries).definitions) {
        if (definition.marker === undefined) continue;
        const cell = world.cells.find((candidate) => candidate.id === definition.marker!.cellId)!;
        for (const vertex of cell.baseVertices) {
          const distance = Math.hypot(vertex.x - definition.marker.position.x, vertex.y - definition.marker.position.y);
          expect(distance, `${name} ${definition.id}`).toBeGreaterThan(0.5);
        }
      }
    }
  });
});
