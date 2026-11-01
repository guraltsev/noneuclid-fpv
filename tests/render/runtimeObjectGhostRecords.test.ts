/**
 * Portal ghost render records (src/render/three/runtimeObjectGhostRecords.ts): for an object whose render footprint (what is
 * drawn: a disk with its own centre and radius, never the collision shape) crosses a portal side, emits one
 * extra render record per cell the object's drawn part now also occupies, so the object's clone is drawn there too
 * (e.g. straddling a doorway, or a flat-torus corner where up to three translated copies are visible at once). No
 * extra records for an object clear of every side. Also covers `computeRenderSourceFootprint` (the render
 * footprint measured from the drawn meshes) and the player rover avatar's render records
 * (src/render/three/playerRoverModel.ts), which always suppress their own root visible path and hide within 2 m
 * of the camera so the avatar never obstructs the first-person view.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { exampleWorldSpecs } from "../support/arbitraries";
import { threePointToWorld } from "../../src/render/three/worldAxes";
import {
  collectRuntimeObjectRenderSourceMeshes,
  computeRenderSourceFootprint,
  type RenderFootprint,
} from "../../src/render/three/runtimeObjectRenderRecords";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { collectPortalGhostRuntimeObjectRenderRecords } from "../../src/render/three/runtimeObjectGhostRecords";
import { createPlayerRoverRenderModel } from "../../src/render/three/playerRoverModel";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";
import { createSimpleGeoCreature } from "../../src/world-objects/simpleGeoCreature";
import { placeSimpleGeoCreatureModel } from "../../src/render/three/creatures/simpleGeoCreatureView";
import { createFakePreparedAssets } from "../support/preparedAssets";
import { readGlbBounds } from "../support/glbBounds";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("runtime object ghost records", () => {
  it("emits target-cell render records when the render footprint touches a portal side", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 0);

    const records = collectPortalGhostRuntimeObjectRenderRecords({
      world,
      object,
      archetypeKeys: ["geo-mouse:mouse-a:mesh:0", "geo-mouse:mouse-a:mesh:1"],
      activationClearanceMeters: 0,
      renderFootprint: drawnAround(0.1),
    });

    expect(records.map((record) => record.cellId)).toEqual(["room-b", "room-b"]);
    expect(records.map((record) => record.archetypeKey)).toEqual([
      "geo-mouse:mouse-a:mesh:0",
      "geo-mouse:mouse-a:mesh:1",
    ]);
    expect(records[0]?.localMatrix.elements[12]).toBeCloseTo(-1.05);
  });

  it("does not emit ghosts while the render footprint is clear of the portal", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.75, 0);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
        renderFootprint: drawnAround(0.1),
      }),
    ).toEqual([]);
  });

  it("does not ghost when the render footprint only touches beyond the side span", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 1.2);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
        renderFootprint: drawnAround(0.1),
      }),
    ).toEqual([]);
  });

  it("emits the three flat-torus translates for an object at a corner", () => {
    const world = compileCellComplex(exampleSpec("torusModuli"));
    const object = creature("mouse-a", "torus-room", 7.3, 7.3, 0.3);

    const records = collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint: drawnAround(0.3) });

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

    const records = collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint: drawnAround(0.3) });

    expect(records.map((record) => record.cellId).sort()).toEqual(["bottom", "right"]);
  });

  it("decides ghosts by the drawn footprint, not by the collision shape", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const ghosts = (object: RuntimeCreatureObject, renderFootprint: RenderFootprint) =>
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint });
    // Collision radius 0.1 does not reach the wall at x = 1 from x = 0.8, the drawn disk of radius 0.4 does.
    expect(ghosts(creature("a", "room-a", 0.8, 0), drawnAround(0.4))).toHaveLength(1);
    // Collision radius 0.5 reaches the wall from x = 0.5, the drawn disk of radius 0.1 does not.
    expect(ghosts(creature("a", "room-a", 0.5, 0, 0.5), drawnAround(0.1))).toEqual([]);
  });

  it("uses the drawn footprint centre, not the origin or the collision centre", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.5, 0);
    const ghosts = (renderFootprint: RenderFootprint) =>
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint });

    // The drawn part is 0.4 m ahead of the origin (+x here, the object is not turned): its disk reaches the wall at x = 1.
    expect(ghosts({ center: { x: 0.4, y: 0 }, radiusMeters: 0.12 })).toHaveLength(1);
    // The same radius around the origin does not.
    expect(ghosts(drawnAround(0.12))).toEqual([]);
    // Behind the object, away from the wall: no ghost although the collision cylinder (radius 0.1 at the origin) is the same.
    expect(ghosts({ center: { x: -0.4, y: 0 }, radiusMeters: 0.12 })).toEqual([]);
  });

  it("turns the footprint centre with the object's pose", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = { ...creature("mouse-a", "room-a", 0.5, 0), localPose: yawRigidTransform3(Math.PI, { x: 0.5, y: 0, z: 0.5 }) };
    const ghosts = (renderFootprint: RenderFootprint) =>
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint });

    // Turned half a revolution, the part drawn 0.4 m ahead of the origin is now 0.4 m toward -x, away from the wall.
    expect(ghosts({ center: { x: 0.4, y: 0 }, radiusMeters: 0.12 })).toEqual([]);
    expect(ghosts({ center: { x: -0.4, y: 0 }, radiusMeters: 0.12 })).toHaveLength(1);
  });

  it("throws when the footprint has no radius instead of ghosting nothing", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 0);

    expect(() =>
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint: drawnAround(0) }),
    ).toThrow(/no render footprint/);
  });

  it("ghosts nothing for a part that draws nothing, whatever its footprint", () => {
    const world = compileCellComplex(twoRoomsWithPortal());

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object: creature("mouse-a", "room-a", 0.95, 0),
        archetypeKeys: [],
        renderFootprint: drawnAround(0),
      }),
    ).toEqual([]);
  });

  it("emits no ghosts for an object far from every side", () => {
    const world = compileCellComplex(exampleSpec("torusModuli"));
    const object = creature("mouse-a", "torus-room", 0, 0, 0.3);

    expect(collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint: drawnAround(0.3) })).toEqual([]);
  });
});

describe("player rover render model", () => {
  it("always omits its own root visible path and suppresses close to the camera", () => {
    const assets = createFakePreparedAssets({
      instantiateGltf: () => {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
        return { scene, animations: [] };
      },
    });
    const model = createPlayerRoverRenderModel(assets);
    const archetypeKeys = model!.collectSources().map((source) => source.archetypeKey);

    const records = model!.collectRecords(
      { cellId: "room-a", position: { x: 0.95, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 },
      archetypeKeys,
    );

    expect(records.map((record) => record.cellId)).toEqual(["room-a"]);
    expect(records[0]?.omitRootVisiblePath).toBe(true);
    expect(records[0]?.objectId).toBe("user-robot");
    expect(records[0]?.suppressWithinCameraDistanceMeters).toBe(2);
  });
});

describe("the render footprint of the mouse", () => {
  // The real Mouse.glb, placed the way the creature view places it. The model is longer than the collision cylinder the library gives it
  // and is not centred on it, so the collision centre and the drawn centre differ.
  const spec = createSimpleGeoCreature("geo-mouse", "m", "mouse/Mouse.glb", { position: [0, 0, 0] });
  const bounds = readGlbBounds(new URL("../../public/assets/mouse/Mouse.glb", import.meta.url));
  const scale = spec.scale ?? 1;
  const drawn = (() => {
    const root = new THREE.Group();
    const scene = new THREE.Group();
    const size = bounds.max.map((max, axis) => max - bounds.min[axis]);
    const centre = bounds.max.map((max, axis) => (max + bounds.min[axis]) / 2);
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]).translate(centre[0], centre[1], centre[2])));
    placeSimpleGeoCreatureModel(scene, spec);
    root.add(scene);
    return computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("m", root, "p"))!;
  })();

  it("is the disk through the corners of the scaled model box, around its own centre", () => {
    const width = (bounds.max[0] - bounds.min[0]) * scale;
    const length = (bounds.max[2] - bounds.min[2]) * scale;

    expect(drawn.radiusMeters).toBeCloseTo(Math.hypot(width, length) / 2, 4);
  });

  it("is not the collision cylinder: another centre and a larger reach", () => {
    const collision = spec.collision!;

    expect(Math.hypot(drawn.center.x - (collision.offset?.x ?? 0), drawn.center.y - (collision.offset?.y ?? 0))).toBeGreaterThan(0.3);
    expect(drawn.radiusMeters).toBeGreaterThan(collision.radius * 1.5);
  });

  it("ghosts the mouse by its drawn body, though its collision stays clear", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    // One metre from the east wall: the collision cylinder (radius 0.725 about 0.35 ahead of the origin) stops short of it, the drawn body does not.
    const object = { ...creature("mouse-a", "room-a", 0, 0), collision: spec.collision };
    const ghosts = (renderFootprint: RenderFootprint) =>
      collectPortalGhostRuntimeObjectRenderRecords({ world, object, archetypeKeys: ["k"], renderFootprint });

    expect(ghosts(drawn)).toHaveLength(1);
    expect(ghosts({ center: { x: spec.collision!.offset?.x ?? 0, y: spec.collision!.offset?.y ?? 0 }, radiusMeters: spec.collision!.radius })).toEqual([]);
  });
});

describe("computeRenderSourceFootprint", () => {
  it("is the disk through the corners of a unit box at the root", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const footprint = computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("o", root, "p"));

    expect(footprint?.radiusMeters).toBeCloseTo(Math.SQRT2 / 2, 9);
    expect(footprint?.center.x).toBeCloseTo(0, 9);
    expect(footprint?.center.y).toBeCloseTo(0, 9);
  });

  it("is centred on what is drawn, in world axes (y is Three -z), not on the root", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.6));
    mesh.position.set(0.3, 0.5, -0.4);
    root.add(mesh);
    const footprint = computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("o", root, "p"));

    expect(footprint?.center.x).toBeCloseTo(0.3, 6);
    expect(footprint?.center.y).toBeCloseTo(0.4, 6);
    expect(footprint?.radiusMeters).toBeCloseTo(Math.hypot(0.2, 0.6) / 2, 6);
  });

  it("is relative to the root, whatever the root's own pose", () => {
    const root = new THREE.Group();
    root.position.set(5, 2, -3);
    root.rotation.y = 0.7;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.6));
    mesh.position.set(0.3, 0.5, -0.4);
    root.add(mesh);
    const footprint = computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("o", root, "p"));

    expect(footprint?.center.x).toBeCloseTo(0.3, 6);
    expect(footprint?.center.y).toBeCloseTo(0.4, 6);
  });

  it("is undefined when nothing measurable is drawn, so that the caller can fail", () => {
    expect(computeRenderSourceFootprint([])).toBeUndefined();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0, 1, 0)));
    expect(computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("o", root, "p"))).toBeUndefined();
  });
});

/** A render footprint of the given radius around the object's origin. */
function drawnAround(radiusMeters: number): RenderFootprint {
  return { center: { x: 0, y: 0 }, radiusMeters };
}

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
