import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { exampleWorldSpecs } from "../support/arbitraries";
import { threePointToWorld } from "../../src/render/three/worldAxes";
import {
  collectRuntimeObjectRenderSourceMeshes,
  computeRenderSourceFootprintRadius,
} from "../../src/render/three/runtimeObjectRenderRecords";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { collectPortalGhostRuntimeObjectRenderRecords } from "../../src/render/three/runtimeObjectGhostRecords";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectRegistry";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("runtime object ghost records", () => {
  it("emits target-cell render records when collision bounds touch a portal side", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 0);

    const records = collectPortalGhostRuntimeObjectRenderRecords({
      world,
      object,
      archetypeKeys: ["geo-mouse:mouse-a:mesh:0", "geo-mouse:mouse-a:mesh:1"],
      activationClearanceMeters: 0,
    });

    expect(records.map((record) => record.cellId)).toEqual(["room-b", "room-b"]);
    expect(records.map((record) => record.archetypeKey)).toEqual([
      "geo-mouse:mouse-a:mesh:0",
      "geo-mouse:mouse-a:mesh:1",
    ]);
    expect(records[0]?.localMatrix.elements[12]).toBeCloseTo(-1.05);
  });

  it("does not emit ghosts while the collision bounds are clear of the portal", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.75, 0);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
      }),
    ).toEqual([]);
  });

  it("does not ghost through a portal when the collision bounds only touch beyond the side span", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 1.2);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
      }),
    ).toEqual([]);
  });

  it("emits the three flat-torus translates for an object at a corner", () => {
    const world = compileCellComplex(exampleSpec("torusModuli"));
    const object = creature("mouse-a", "torus-room", 7.3, 7.3, 0.3);

    const records = collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"] });

    expect(records).toHaveLength(3);
    expect(records.every((record) => record.cellId === "torus-room")).toBe(true);
    const places = records
      .map((record) => threePointToWorld(new THREE.Vector3().setFromMatrixPosition(record.localMatrix)))
      .map((p) => [p.x, p.y]);
    for (const [dx, dy] of [[-15, 0], [0, -15], [-15, -15]]) {
      expect(places.some(([x, y]) => Math.abs(x - (7.3 + dx)) < 1e-9 && Math.abs(y - (7.3 + dy)) < 1e-9)).toBe(true);
    }
  });

  it("emits one ghost in each of the other two cells at a cube vertex", () => {
    const world = compileCellComplex(exampleSpec("cube"));
    const offset = 0.1 / Math.SQRT2;
    const object = creature("mouse-a", "front", 7.5 - offset, -7.5 + offset, 0.3);

    const records = collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"] });

    expect(records.map((record) => record.cellId).sort()).toEqual(["bottom", "right"]);
  });

  it("ghosts an object without collision by its render footprint only when a radius is given", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = { ...creature("tree-a", "room-a", 0.8, 0), collision: undefined };

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], footprintRadiusMeters: 0.4 }),
    ).toHaveLength(1);
    expect(collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"] })).toEqual([]);
  });

  it("emits no ghosts for an object far from every side", () => {
    const world = compileCellComplex(exampleSpec("torusModuli"));
    const object = creature("mouse-a", "torus-room", 0, 0, 0.3);

    expect(collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"] })).toEqual([]);
  });
});

describe("computeRenderSourceFootprintRadius", () => {
  it("is the half diagonal of a unit box at the root", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    root.add(mesh);
    const sources = collectRuntimeObjectRenderSourceMeshes("o", root, "p");

    expect(computeRenderSourceFootprintRadius(sources)).toBeCloseTo(Math.SQRT2 / 2, 9);
    expect(computeRenderSourceFootprintRadius([])).toBe(0);
  });
});

function exampleSpec(name: string): CellComplexSpec {
  return exampleWorldSpecs.find(([n]) => n === name)![1];
}

function creature(id: string, cellId: string, x: number, y: number, radius = 0.1): RuntimeCreatureObject {
  return {
    id,
    kind: "geo-mouse",
    cellId,
    localPose: yawRigidTransform3(0, { x, y, z: 0.5 }),
    collision: simpleCollisionCylinder(radius, 0.2),
    portalRenderable: true,
  };
}

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "west",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}
