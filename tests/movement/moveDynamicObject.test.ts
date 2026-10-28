import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityMat3, yawRigidTransform3, type Mat3 } from "../../src/math/rigidTransform3";
import { cube, tetrahedron } from "../../src/authoring/exampleWorlds";
import { vec3 } from "../../src/math/vec3";
import {
  AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
  moveDynamicObject,
} from "../../src/movement/moveDynamicObject";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("moveDynamicObject", () => {
  it("moves generic dynamic objects inside a prism until geometry blocks them", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: 0, y: 0, z: 0.5 });

    const moved = moveDynamicObject({ world, object, displacement: { x: 0.5, y: 0, z: 0 } });
    expect(moved.blocked).toBe(false);
    expect(moved.object.localPose.translation.x).toBeCloseTo(0.5);

    const blocked = moveDynamicObject({ world, object, displacement: { x: 1, y: 0, z: 0 } });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockingReason).toBe("wall");
    expect(blocked.object.localPose.translation.x).toBeCloseTo(0.9, 5);
  });

  it("blocks floor and ceiling intersections", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: 0, y: 0, z: 0.5 });

    expect(moveDynamicObject({ world, object, displacement: { x: 0, y: 0, z: -0.6 } }).blockingReason).toBe("floor");
    expect(moveDynamicObject({ world, object, displacement: { x: 0, y: 0, z: 1.6 } }).blockingReason).toBe("ceiling");
  });

  it("crosses centered portals and transforms orientation through the portal mapping", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject(
      "room-a",
      { x: 0.8, y: 0, z: 0.5 },
      yawRigidTransform3(Math.PI / 2).rotation,
      simpleCollisionCylinder(0.1, 0.2),
    );

    const result = moveDynamicObject({ world, object, displacement: { x: 0.4, y: 0, z: 0 } });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(result.crossedPortalId).toBe("east");
    expect(result.object.cellId).toBe("room-b");
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.8);
    expect(result.object.localPose.rotation.m00).toBeCloseTo(0);
    expect(result.object.localPose.rotation.m10).toBeCloseTo(1);
  });

  it("does not cross a portal before the anchor point exits the source cell", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.75, y: 0, z: 0.5 });

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.2, y: 0, z: 0 },
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(false);
    expect(result.object.cellId).toBe("room-a");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.95);
  });

  it("throws for the unimplemented bounds crossing mode", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0, y: 0, z: 0.5 });

    expect(() =>
      moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0, z: 0 }, portalCrossingMode: "bounds" }),
    ).toThrow(/bounds/);
  });

  it("falls back to the original pose when pushing out of one wall leaves the body inside another (convex corner)", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: 0.85, y: 0.85, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0.1, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("wall");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.85);
    expect(result.object.localPose.translation.y).toBeCloseTo(0.85);
  });

  it("still slides along a single wall when moving diagonally into it", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: 0.85, y: 0, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0.3, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.object.localPose.translation.x).toBeCloseTo(0.9, 5);
    expect(result.object.localPose.translation.y).toBeCloseTo(0.3);
  });

  it("keeps anchor-crossing objects in the source cell until their traversal center crosses the portal plane", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.75, y: 0, z: 0.5 });

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.2, y: 0, z: 0 },
      portalCrossingMode: "anchor",
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(false);
    expect(result.object.cellId).toBe("room-a");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.95);
  });

  it("crosses a portal in anchor mode once the traversal center crosses the portal plane", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.95, y: 0, z: 0.5 });

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.1, y: 0, z: 0 },
      portalCrossingMode: "anchor",
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(result.crossedPortalId).toBe("east");
    expect(result.object.cellId).toBe("room-b");
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.95);
  });

  it("teleports an out-of-domain endpoint through only one most probable portal per frame", () => {
    const world = compileCellComplex(selfWrappingRoom());
    const object = dynamicObject("room", { x: 5.1, y: 0, z: 0.5 });

    const firstFrame = moveDynamicObject({ world, object, displacement: { x: 0, y: 0, z: 0 } });

    expect(firstFrame.blocked).toBe(false);
    expect(firstFrame.crossedPortal).toBe(true);
    expect(firstFrame.crossedPortalId).toBe("east");
    expect(firstFrame.object.cellId).toBe("room");
    expect(firstFrame.object.localPose.translation.x).toBeCloseTo(3.1);

    const secondFrame = moveDynamicObject({ world, object: firstFrame.object, displacement: { x: 0, y: 0, z: 0 } });

    expect(secondFrame.blocked).toBe(false);
    expect(secondFrame.crossedPortal).toBe(true);
    expect(secondFrame.crossedPortalId).toBe("east");
    expect(secondFrame.object.localPose.translation.x).toBeCloseTo(1.1);
  });

  it("does not let an offset collision center trigger anchor portal crossing before the object anchor crosses", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject(
      "room-a",
      { x: 0.75, y: 0, z: 0.5 },
      identityMat3,
      simpleCollisionCylinder(0.1, 0.2, { x: 0.3, y: 0, z: 0 }),
    );

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0, y: 0, z: 0 },
      portalCrossingMode: "anchor",
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(false);
    expect(result.object.cellId).toBe("room-a");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.75);
  });

  it("resolves blocked non-portal exits back to an in-bounds pose near the wall", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: -0.8, y: 0, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: -0.4, y: 0, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("wall");
    expect(result.crossedPortal).toBe(false);
    expect(result.object).not.toBe(object);
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.9, 5);
  });

  it("rejects movement into invisible collision columns at portal junctions", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.65, y: 0.7, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: 0.2, y: 0.2, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("forbidden-zone");
  });

  it("can ignore forbidden zones while preserving other movement collision", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.65, y: 0.7, z: 0.5 });

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.2, y: 0.2, z: 0 },
      ignoreForbiddenZones: true,
    });

    expect(result.blocked).toBe(false);
    expect(result.object.localPose.translation.x).toBeCloseTo(0.85);
    expect(result.object.localPose.translation.y).toBeCloseTo(0.9);
  });

  it("crosses portals near an endpoint when forbidden-zone collision is ignored", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject(
      "room-a",
      { x: 0.95, y: 0.9, z: 0.5 },
      identityMat3,
      simpleCollisionCylinder(0.2, 0.2),
    );

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.1, y: 0, z: 0 },
      portalCrossingMode: "anchor",
      ignoreForbiddenZones: true,
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(result.object.cellId).toBe("room-b");
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.95);
    expect(result.object.localPose.translation.y).toBeCloseTo(0.9);
  });

  it("uses cylindrical bounds for forbidden-zone blocking regardless of rotation", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject(
      "room-a",
      { x: 0.45, y: 0.55, z: 0.5 },
      yawRigidTransform3(Math.PI / 4).rotation,
      simpleCollisionCylinder(0.5, 0.2),
    );

    const result = moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("forbidden-zone");
  });

  it("lets anchor portal crossing take precedence over swept forbidden-zone collision", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.6, y: 0.9, z: 0.5 }, identityMat3, simpleCollisionCylinder(0.1, 0.2));

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.8, y: 0, z: 0 },
      portalCrossingMode: "anchor",
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(result.object.cellId).toBe("room-b");
  });

  it("uses cylindrical radius for wall blocking", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject(
      "room",
      { x: 0.49, y: 0, z: 0.5 },
      yawRigidTransform3(Math.PI / 2).rotation,
      simpleCollisionCylinder(0.5, 0.2),
    );

    const result = moveDynamicObject({ world, object, displacement: { x: 0.02, y: 0, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("wall");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.5, 5);
  });

  it("does not use cylindrical radius for portal reachability", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject(
      "room-a",
      { x: 0.45, y: 0, z: 0.5 },
      yawRigidTransform3(Math.PI / 2).rotation,
      simpleCollisionCylinder(0.5, 0.2),
    );

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.1, y: 0, z: 0 },
    });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(false);
    expect(result.object.cellId).toBe("room-a");
    expect(result.object.localPose.translation.x).toBeCloseTo(0.55);
  });

  it("refuses to cross when the object would violate the target cell ceiling", () => {
    const world = compileCellComplex(twoRoomsWithPortal({ targetHeightMeters: 0.75 }));
    const object = dynamicObject(
      "room-a",
      { x: 0.95, y: 0, z: 0.5 },
      pitchMat3(Math.PI / 2),
      simpleCollisionCylinder(0.1, 0.8),
    );

    const result = moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("ceiling");
    expect(result.crossedPortal).toBe(false);
    expect(result.object).toBe(object);
  });

  it("keeps the autonomous dynamic-object traversal policy explicit and anchor-based", () => {
    expect(AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE).toBe("anchor");
  });

  it("defaults SimpleCollisionCylinder offset to zero and honors explicit offsets", () => {
    const world = compileCellComplex(singleRoom());
    const centered = dynamicObject("room", { x: 0, y: 0, z: 0.11 }, identityMat3, simpleCollisionCylinder(0.1, 0.2));
    const raised = dynamicObject(
      "room",
      { x: 0, y: 0, z: 0.01 },
      identityMat3,
      simpleCollisionCylinder(0.1, 0.2, { x: 0, y: 0, z: 0.1 }),
    );

    expect(moveDynamicObject({ world, object: centered, displacement: { x: 0, y: 0, z: -0.02 } }).blocked).toBe(true);
    expect(moveDynamicObject({ world, object: raised, displacement: { x: 0, y: 0, z: 0 } }).blocked).toBe(false);
  });

  it("crosses a compiled cube portal without authored transforms", () => {
    const world = compileCellComplex(cube);
    const object = dynamicObject("front", { x: 7.2, y: 0, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: 0.4, y: 0, z: 0 } });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(result.object.cellId).toBe("right");
    expect(result.object.localPose.translation.x).toBeCloseTo(-7.4);
  });

  it("crosses a compiled tetrahedron portal without authored transforms", () => {
    const world = compileCellComplex(tetrahedron);
    const approach = portalApproach(world, "face-a", "side-0");
    const expectedTargetCellId = world.cellsById.get("face-a")?.portalsById.get("side-0")?.targetCellId;
    const object = dynamicObject("face-a", approach.start, identityMat3, simpleCollisionCylinder(0.025, 1));

    const result = moveDynamicObject({ world, object, displacement: approach.displacement });

    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(true);
    expect(expectedTargetCellId).toBeDefined();
    expect(result.object.cellId).toBe(expectedTargetCellId);
  });
});

function dynamicObject(
  cellId: string,
  translation: { readonly x: number; readonly y: number; readonly z: number },
  rotation = identityMat3,
  collision = simpleCollisionCylinder(0.1, 1),
): DynamicObjectState {
  return {
    cellId,
    localPose: { rotation, translation },
    collision,
  };
}

function portalApproach(world: CompiledCellComplex, cellId: string, portalId: string) {
  const cell = world.cellsById.get(cellId);
  const portal = cell?.portalsById.get(portalId);

  if (!cell || !portal) {
    throw new Error(`Missing portal approach data for ${cellId}:${portalId}.`);
  }

  const side = cell.sides[portal.sideIndex];
  const midpoint = {
    x: (side.start.x + side.end.x) / 2,
    y: (side.start.y + side.end.y) / 2,
    z: 0.5,
  };
  const inward = vec3(side.inwardNormal.x, side.inwardNormal.y, 0);
  const outward = vec3(-side.inwardNormal.x, -side.inwardNormal.y, 0);

  return {
    start: {
      x: midpoint.x + inward.x * 0.12,
      y: midpoint.y,
      z: midpoint.z,
    },
    displacement: {
      x: outward.x * 0.3,
      y: outward.y * 0.3,
      z: 0,
    },
  };
}

function singleRoom(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [],
      },
    ],
  };
}

function twoRoomsWithPortal(options: { readonly targetHeightMeters?: number } = {}): CellComplexSpec {
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
        heightMeters: options.targetHeightMeters ?? 2,
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

function selfWrappingRoom(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room",
            targetPortalId: "west",
          },
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}

function pitchMat3(radians: number): Mat3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    m00: 1,
    m01: 0,
    m02: 0,
    m10: 0,
    m11: cos,
    m12: -sin,
    m20: 0,
    m21: sin,
    m22: cos,
  };
}
