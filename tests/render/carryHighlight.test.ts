/**
 * `tests/render/carryHighlight.test.ts` — unit tier.
 *
 * The translucent highlight shape around a carried object (`src/render/three/carryHighlight.ts`) and its use by the runtime-object instance sync.
 *
 * It marks the object itself, not the hand: an object that is stuck (stopped short of a wall or a zone) is drawn with its highlight where it is,
 * and the gap to the hand shows. The shape is made from the object's own render records, so it appears wherever the object is drawn, on any
 * portal path and on another face; it is the object's own declared shape (an ellipsoid for an emitter), or a sphere from the collision shape when it declares none; and it knows
 * nothing about the kind of object, so any carryable object gets it.
 */
import { createTestEngine } from "../support/engine";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { PlayerPose } from "../../src/movement/playerPose";
import { carryHighlightArchetypeKey, collectCarryHighlightRecords } from "../../src/render/three/carryHighlight";
import { carryHighlightMarginMeters } from "../../src/world-objects/carryHighlightShape";
import { cannonCarryHighlight } from "../../src/world-objects/geodesic/objects";
import { createEmptyFrameRenderSnapshot, createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import { createRootVisiblePortalPath, unclippedPortalClipIndex } from "../../src/render/three/renderPortalInstances";
import {
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { createRuntimeObjectInstanceSync } from "../../src/render/three/runtimeObjectInstanceSync";
import type { RuntimeObjectRenderSourceMesh } from "../../src/render/three/runtimeObjectRenderRecords";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";
import { rigidTransformToThreeMatrix, worldPointToThree } from "../../src/render/three/worldAxes";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";
import { createGeodesicRuntimeRenderSources } from "../../src/render/three/geodesicCannonRenderer";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createTestClientSession } from "../support/clientSession";

const collision = { radius: 0.3, height: 1.6, offset: { x: 0, y: 0, z: 0.8 } } as const;

function carried(id: string, x = 0.2): RuntimeCreatureObject & { readonly collision: typeof collision } {
  return {
    id,
    kind: "geo-mouse",
    cellId: "room-b",
    localPose: yawRigidTransform3(0.4, { x, y: 0.1, z: 0 }),
    portalRenderable: true,
    collision,
  };
}

function scaleOf(matrix: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixScale(matrix);
}

describe("collectCarryHighlightRecords", () => {
  it("draws a sphere of radius plus margin in each cell its reach touches, if shapeless", () => {
    // 0.2 m from the portal to room-a, within the sphere's reach (0.3 + 0.1 m): the sphere crosses the portal.
    const object = carried("m", -0.8);
    const world = compileCellComplex(twoRooms());

    const balls = collectCarryHighlightRecords(object, world);

    expect(balls).toHaveLength(2);
    expect(balls.map((ball) => ball.cellId)).toEqual(["room-b", "room-a"]);
    expect(balls.every((ball) => ball.archetypeKey === carryHighlightArchetypeKey)).toBe(true);
    const radius = collision.radius + carryHighlightMarginMeters;
    scaleOf(balls[0].localMatrix).toArray().forEach((value) => expect(value).toBeCloseTo(radius, 6));
    const centre = new THREE.Vector3().setFromMatrixPosition(balls[0].localMatrix);
    const expected = worldPointToThree({ x: -0.8, y: 0.1, z: collision.offset.z });
    expect(centre.x).toBeCloseTo(expected.x, 6);
    expect(centre.y).toBeCloseTo(expected.y, 6);
    expect(centre.z).toBeCloseTo(expected.z, 6);
  });

  it("draws a declared ellipsoid scaled unevenly and turned with the object's yaw", () => {
    const object = { ...carried("m"), carryHighlight: cannonCarryHighlight };
    const pose = rigidTransformToThreeMatrix(object.localPose);

    const [shape] = collectCarryHighlightRecords(object, compileCellComplex(twoRooms()));

    // Semi-axes along the object's x, y, z become Three.js x, z, y.
    const scale = scaleOf(shape.localMatrix);
    expect(scale.x).toBeCloseTo(cannonCarryHighlight.radii.x, 6);
    expect(scale.y).toBeCloseTo(cannonCarryHighlight.radii.z, 6);
    expect(scale.z).toBeCloseTo(cannonCarryHighlight.radii.y, 6);
    expect(scale.y).toBeGreaterThan(scale.x);
    // Centred at the declared centre, and the ellipsoid's first axis points where the object's own x axis points (yaw 0.4), not along the world x axis.
    const centre = new THREE.Vector3().setFromMatrixPosition(shape.localMatrix);
    const expectedCentre = worldPointToThree(cannonCarryHighlight.centre).applyMatrix4(pose);
    expect(centre.distanceTo(expectedCentre)).toBeLessThan(1e-6);
    const shapeAxis = new THREE.Vector3().setFromMatrixColumn(shape.localMatrix, 0).normalize();
    const objectAxis = new THREE.Vector3().setFromMatrixColumn(pose, 0).normalize();
    expect(shapeAxis.distanceTo(objectAxis)).toBeLessThan(1e-6);
    expect(Math.abs(shapeAxis.z)).toBeGreaterThan(0.1);
  });

  it("turns the ellipsoid with the object when the object turns", () => {
    const object = { ...carried("m"), carryHighlight: cannonCarryHighlight };
    const turned = { ...object, localPose: yawRigidTransform3(1.2, { x: 0.2, y: 0.1, z: 0 }) };

    const world = compileCellComplex(twoRooms());
    const [before] = collectCarryHighlightRecords(object, world);
    const [after] = collectCarryHighlightRecords(turned, world);

    const axisBefore = new THREE.Vector3().setFromMatrixColumn(before.localMatrix, 0).normalize();
    const axisAfter = new THREE.Vector3().setFromMatrixColumn(after.localMatrix, 0).normalize();
    expect(axisBefore.angleTo(axisAfter)).toBeCloseTo(1.2 - 0.4, 6);
  });

  it("draws nothing for an object with no shape and no collision shape", () => {
    const object = carried("m");

    expect(collectCarryHighlightRecords({ ...object, collision: undefined }, compileCellComplex(twoRooms()))).toEqual([]);
  });

  it("draws the ellipsoid in the next cell only when its own reach crosses the portal", () => {
    const world = compileCellComplex(twoRooms());
    const atPortal = { ...carried("m", -0.9), carryHighlight: cannonCarryHighlight };
    const awayFromPortal = { ...carried("m", -0.75), carryHighlight: cannonCarryHighlight };

    // The ellipsoid reaches 0.159 m: 0.1 m from the portal it crosses it, 0.25 m from it it does not, though the 0.3 m collision radius would reach (the shape's reach is what counts).
    expect(collectCarryHighlightRecords(atPortal, world).map((shape) => shape.cellId)).toEqual(["room-b", "room-a"]);
    expect(collectCarryHighlightRecords(awayFromPortal, world).map((shape) => shape.cellId)).toEqual(["room-b"]);
  });
});

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function twoRooms(): CellComplexSpec {
  return {
    cells: [
      { id: "room-a", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }] },
      { id: "room-b", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }] },
    ],
  };
}

function path(cellId: string, pathId: number, depth: number, matrix = new THREE.Matrix4()): VisiblePortalPath {
  return { ...createRootVisiblePortalPath(cellId), pathId, depth, rootFromDestinationMatrix: matrix };
}

function setupSync(carriedId: string | undefined) {
  const object = carried("m");
  const registry = createRuntimeObjectRegistry([object]);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
  const renderArchetypesByKey = new Map<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>();
  const world = compileCellComplex(twoRooms());
  const sync = createRuntimeObjectInstanceSync({
    registry,
    runtimeObjectRootsById: new Map([[object.id, root]]),
    renderSourcesByKey: new Map<string, RuntimeObjectRenderSourceMesh>(),
    renderArchetypesByKey,
    renderRoot: new THREE.Group(),
    geodesicRenderSources: [],
    geodesicArchetypeKeys: [],
    playerRoverRenderModel: undefined,
    maxVisiblePaths: 4,
    diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
    getWorld: () => world,
    session: createTestClientSession(),
    engine: createTestEngine({ playerPose: { cellId: "room-b", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 } as unknown as PlayerPose, carrying: carriedId }),
    buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
  });
  return { sync, renderArchetypesByKey, object };
}

function snapshotOf(paths: Record<string, VisiblePortalPath[]>) {
  return createFrameRenderSnapshot({
    serial: 1,
    rootCellId: "room-b",
    visiblePathsByDestinationCell: new Map(Object.entries(paths)),
    clipIndexByPathId: new Map(),
    cameraPositions: [],
  });
}

describe("the instance sync's highlight of the carried object", () => {
  it("draws the highlight on the carried object at every path that shows it", () => {
    const { sync, renderArchetypesByKey, object } = setupSync("m");
    const shift = new THREE.Matrix4().makeTranslation(3, 0, 0);

    sync.sync(snapshotOf({ "room-b": [path("room-b", 0, 0), path("room-b", 5, 1, shift)] }));

    const ball = renderArchetypesByKey.get(carryHighlightArchetypeKey);
    expect(ball?.mesh.count).toBe(2);
    const first = new THREE.Matrix4();
    const second = new THREE.Matrix4();
    ball?.mesh.getMatrixAt(0, first);
    ball?.mesh.getMatrixAt(1, second);
    const expectedAt = (path: THREE.Matrix4): THREE.Vector3 => {
      const centre = worldPointToThree({ x: 0, y: 0, z: collision.offset.z });
      return centre.applyMatrix4(path.clone().multiply(rigidTransformToThreeMatrix(object.localPose)));
    };
    const atFirst = new THREE.Vector3().setFromMatrixPosition(first);
    const atSecond = new THREE.Vector3().setFromMatrixPosition(second);
    expect(atFirst.distanceTo(expectedAt(new THREE.Matrix4()))).toBeLessThan(1e-6);
    expect(atSecond.distanceTo(expectedAt(shift))).toBeLessThan(1e-6);
  });

  it("draws no highlight when nothing is carried, or the carried object is gone", () => {
    for (const carriedId of [undefined, "missing"]) {
      const { sync, renderArchetypesByKey } = setupSync(carriedId);
      sync.sync(snapshotOf({ "room-b": [path("room-b", 0, 0)] }));
      expect(renderArchetypesByKey.get(carryHighlightArchetypeKey)).toBeUndefined();
    }
  });

  it("draws nothing for an empty frame", () => {
    const { sync, renderArchetypesByKey } = setupSync("m");
    sync.sync(createEmptyFrameRenderSnapshot(1, "room-b"));
    expect(renderArchetypesByKey.get(carryHighlightArchetypeKey)?.mesh.count ?? 0).toBe(0);
  });
});

describe("the highlight of a carried geodesic emitter", () => {
  it("is drawn on the emitter itself, through the geodesic branch, on every path", () => {
    const emitter = createGeodesicEmitterObject({ id: "cannon-b", cellId: "room-b", localPose: yawRigidTransform3(0, { x: 0.4, y: -0.2, z: 0 }) });
    const registry = createRuntimeObjectRegistry([emitter]);
    const world = compileCellComplex(twoRooms());
    const geodesicRenderSources = createGeodesicRuntimeRenderSources();
    const renderArchetypesByKey = new Map<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>();
    const sync = createRuntimeObjectInstanceSync({
      registry,
      runtimeObjectRootsById: new Map(),
      renderSourcesByKey: new Map<string, RuntimeObjectRenderSourceMesh>(),
      renderArchetypesByKey,
      renderRoot: new THREE.Group(),
      geodesicRenderSources,
      geodesicArchetypeKeys: geodesicRenderSources.map((source) => source.archetypeKey),
      playerRoverRenderModel: undefined,
      maxVisiblePaths: 4,
      diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
      getWorld: () => world,
      session: createTestClientSession(),
      engine: createTestEngine({ carrying: "cannon-b" }),
      buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
    });
    const shift = new THREE.Matrix4().makeTranslation(-2, 0, 0);

    sync.sync(snapshotOf({ "room-b": [path("room-b", 0, 0), path("room-b", 5, 1, shift)] }));

    const ball = renderArchetypesByKey.get(carryHighlightArchetypeKey);
    expect(ball?.mesh.count).toBe(2);
    const atEmitter = new THREE.Vector3().setFromMatrixPosition(rigidTransformToThreeMatrix(emitter.localPose));
    const first = new THREE.Matrix4();
    ball?.mesh.getMatrixAt(0, first);
    const centre = new THREE.Vector3().setFromMatrixPosition(first);
    // Over the emitter's own place (its horizontal position), at the height of its collision shape.
    expect(centre.x).toBeCloseTo(atEmitter.x, 6);
    expect(centre.z).toBeCloseTo(atEmitter.z, 6);
    // The emitter declares an ellipsoid around its whole post: centred at half the post height, with the declared semi-axes.
    expect(centre.y).toBeCloseTo(cannonCarryHighlight.centre.z, 6);
    const scale = scaleOf(first);
    expect(scale.x).toBeCloseTo(cannonCarryHighlight.radii.x, 6);
    expect(scale.y).toBeCloseTo(cannonCarryHighlight.radii.z, 6);
  });
});

describe("the highlight of a carried emitter that stands at a portal", () => {
  // The emitter stands in room-b, 0.1 m from the portal to room-a, and the viewer is in room-a. A geodesic emitter's own render records are in
  // room-b only, so seen from room-a its highlight is the room-b copy clipped at the portal. The highlight reaches 0.159 m, so it crosses the
  // portal: the part on room-a's side must be drawn too, as one whole shape, not cut off at the portal.
  it("is drawn whole in the viewer's room, not cut off at the portal", () => {
    const emitter = createGeodesicEmitterObject({ id: "cannon-b", cellId: "room-b", localPose: yawRigidTransform3(0, { x: -0.9, y: 0, z: 0 }) });
    const registry = createRuntimeObjectRegistry([emitter]);
    const world = compileCellComplex(twoRooms());
    const geodesicRenderSources = createGeodesicRuntimeRenderSources();
    const renderArchetypesByKey = new Map<string, ReturnType<typeof buildRuntimeObjectRenderArchetype>>();
    const sync = createRuntimeObjectInstanceSync({
      registry,
      runtimeObjectRootsById: new Map(),
      renderSourcesByKey: new Map<string, RuntimeObjectRenderSourceMesh>(),
      renderArchetypesByKey,
      renderRoot: new THREE.Group(),
      geodesicRenderSources,
      geodesicArchetypeKeys: geodesicRenderSources.map((source) => source.archetypeKey),
      playerRoverRenderModel: undefined,
      maxVisiblePaths: 4,
      diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
      getWorld: () => world,
      session: createTestClientSession(),
      engine: createTestEngine({ carrying: "cannon-b" }),
      buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
    });
    // room-b's frame seen from room-a: room-b's west wall (x = -1) is room-a's east wall (x = 1).
    const intoRoomA = new THREE.Matrix4().makeTranslation(2, 0, 0);

    sync.sync(createFrameRenderSnapshot({
      serial: 1,
      rootCellId: "room-a",
      visiblePathsByDestinationCell: new Map([["room-a", [path("room-a", 0, 0)]], ["room-b", [path("room-b", 5, 1, intoRoomA)]]]),
      clipIndexByPathId: new Map([[5, 3]]),
      cameraPositions: [],
    }));

    const highlight = renderArchetypesByKey.get(carryHighlightArchetypeKey);
    expect(highlight?.mesh.count).toBe(1);
    // The one copy of the shape is the unclipped depth-0 copy (the unclipped marker), not the copy clipped by the portal's planes.
    expect(highlight?.portalClipIndexAttribute.getX(0)).toBe(unclippedPortalClipIndex);
    const first = new THREE.Matrix4();
    highlight?.mesh.getMatrixAt(0, first);
    const centre = new THREE.Vector3().setFromMatrixPosition(first);
    const expected = worldPointToThree({ x: 1.1, y: 0, z: cannonCarryHighlight.centre.z });
    expect(centre.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
