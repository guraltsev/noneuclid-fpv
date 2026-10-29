import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import {
  composeRigidTransform3,
  identityMat3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  yawRigidTransform3,
  type Mat3,
  type RigidTransform3,
} from "../../src/math/rigidTransform3";
import { cube, icosahedron, tetrahedron, torusModuli } from "../../src/authoring/exampleWorlds";
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

  it("stops in a convex corner where two walls meet", () => {
    const world = compileCellComplex(singleRoom());
    const object = dynamicObject("room", { x: 0.85, y: 0.85, z: 0.5 });

    const result = moveDynamicObject({ world, object, displacement: { x: 0.1, y: 0.1, z: 0 } });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("wall");
    expect(Math.abs(result.object.localPose.translation.x - 0.9)).toBeLessThan(1e-5);
    expect(Math.abs(result.object.localPose.translation.y - 0.9)).toBeLessThan(1e-5);
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

  it("re-homes an out-of-cell anchor before moving", () => {
    const world = compileCellComplex(selfWrappingRoom());
    const object = dynamicObject("room", { x: 5.1, y: 0, z: 0.5 });

    const firstFrame = moveDynamicObject({ world, object, displacement: { x: 0, y: 0, z: 0 } });

    expect(firstFrame.blocked).toBe(false);
    expect(firstFrame.crossedPortal).toBe(true);
    expect(firstFrame.crossedPortalId).toBe("east");
    expect(firstFrame.crossings).toHaveLength(3);
    expect(firstFrame.object.cellId).toBe("room");
    expect(firstFrame.object.localPose.translation.x).toBeCloseTo(-0.9);

    const secondFrame = moveDynamicObject({ world, object: firstFrame.object, displacement: { x: 0, y: 0, z: 0 } });

    expect(secondFrame.blocked).toBe(false);
    expect(secondFrame.crossedPortal).toBe(false);
    expect(secondFrame.object.localPose.translation.x).toBeCloseTo(-0.9);
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
      { x: 0.95, y: 0.75, z: 0.5 },
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
    expect(result.object.localPose.translation.y).toBeCloseTo(0.75);
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

  it("slides around a swept forbidden zone on the path instead of crossing through it", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = dynamicObject("room-a", { x: 0.6, y: 0.9, z: 0.5 }, identityMat3, simpleCollisionCylinder(0.1, 0.2));

    const result = moveDynamicObject({
      world,
      object,
      displacement: { x: 0.8, y: 0, z: 0 },
      portalCrossingMode: "anchor",
    });
    const cell = world.cellsById.get(result.object.cellId);
    const anchor = result.object.localPose.translation;
    const zone = cell?.singularityColumns[0];

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("forbidden-zone");
    expect(cell?.sides.every((side) => (anchor.x - side.start.x) * side.inwardNormal.x + (anchor.y - side.start.y) * side.inwardNormal.y >= -1e-9)).toBe(true);
    // Every zone of the final cell is at least the combined radius (0.1 + 0.15) away.
    for (const column of cell?.singularityColumns ?? []) {
      expect(Math.hypot(anchor.x - column.center.x, anchor.y - column.center.y)).toBeGreaterThanOrEqual(column.radius + 0.1 - 1e-9);
    }
    expect(zone).toBeDefined();
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
    expect(result.object.cellId).toBe("room-a");
    expect(Math.abs(result.object.localPose.translation.x - 0.95)).toBeLessThan(1e-12);
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

describe("swept motion", () => {
  const body = simpleCollisionCylinder(0.25, 1);
  const insideCell = (world: CompiledCellComplex, state: DynamicObjectState): number => {
    const cell = world.cellsById.get(state.cellId);
    const p = state.localPose.translation;

    return Math.min(
      ...(cell?.sides ?? []).map((side) => (p.x - side.start.x) * side.inwardNormal.x + (p.y - side.start.y) * side.inwardNormal.y),
    );
  };

  it("stops in all four corners of a walled room (issue 61)", () => {
    const world = compileCellComplex(singleRoom());

    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      let object = dynamicObject("room", { x: 0, y: 0, z: 0.5 }, identityMat3, body);

      for (let i = 0; i < 200; i += 1) {
        object = moveDynamicObject({ world, object, displacement: { x: 0.03 * sx, y: 0.03 * sy, z: 0 } }).object;
      }

      expect(Math.abs(object.localPose.translation.x - 0.75 * sx)).toBeLessThan(1e-5);
      expect(Math.abs(object.localPose.translation.y - 0.75 * sy)).toBeLessThan(1e-5);
    }
  });

  it("ends inside the neighbour when a slide past the end of a wall continues through a portal (issue 61)", () => {
    const base = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const world = compileCellComplex({
      cells: [
        { id: "south", heightMeters: 2, baseVertices: base, portals: [{ id: "n", sideIndex: 2, targetCellId: "north", targetPortalId: "s" }] },
        { id: "north", heightMeters: 2, baseVertices: base, portals: [{ id: "s", sideIndex: 0, targetCellId: "south", targetPortalId: "n" }] },
      ],
    });
    const object = dynamicObject("south", { x: 0, y: 0, z: 0.5 }, identityMat3, body);
    const result = moveDynamicObject({ world, object, displacement: { x: 3, y: 6, z: 0 }, ignoreForbiddenZones: true });
    const p = result.object.localPose.translation;

    expect(result.object.cellId).toBe("north");
    expect(result.crossedPortal).toBe(true);
    expect(result.blocked).toBe(true);
    expect(insideCell(world, result.object)).toBeGreaterThanOrEqual(0.25 - 1e-5);
    expect(Math.abs(p.x - 0.75)).toBeLessThan(1e-5);
    expect(Math.abs(p.y - 0.75)).toBeLessThan(1e-5);
  });

  it("keeps the anchor inside its cell on a straight walk through a cube vertex with zones ignored (issue 62)", () => {
    const world = compileCellComplex(cube);
    const step = 0.05 / Math.SQRT2;
    let object = dynamicObject("front", { x: 0, y: 0, z: 0.5 }, identityMat3, simpleCollisionCylinder(0.2, 1));

    for (let i = 0; i < 400; i += 1) {
      object = moveDynamicObject({ world, object, displacement: { x: step, y: -step, z: 0 }, ignoreForbiddenZones: true }).object;
      expect(insideCell(world, object)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("stops at the forbidden zone of a cube vertex when zones are on (issue 62)", () => {
    const world = compileCellComplex(cube);
    const step = 0.05 / Math.SQRT2;
    let object = dynamicObject("front", { x: 0, y: 0, z: 0.5 }, identityMat3, simpleCollisionCylinder(0.2, 1));

    for (let i = 0; i < 400; i += 1) {
      object = moveDynamicObject({ world, object, displacement: { x: step, y: -step, z: 0 } }).object;
    }

    const cell = world.cellsById.get(object.cellId);
    const p = object.localPose.translation;
    const nearest = Math.min(...(cell?.singularityColumns ?? []).map((c) => Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius));

    expect(Math.abs(nearest - 0.2)).toBeLessThan(1e-5);
  });

  it("gives the same final pose for one long move as for many short ones (issue 62)", () => {
    const rooms = 6;
    const base = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const world = compileCellComplex({
      cells: Array.from({ length: rooms }, (_, i) => ({
        id: `r${i}`,
        heightMeters: 2,
        baseVertices: base,
        portals: [
          ...(i < rooms - 1 ? [{ id: `e${i}`, sideIndex: 1, targetCellId: `r${i + 1}`, targetPortalId: `w${i + 1}` }] : []),
          ...(i > 0 ? [{ id: `w${i}`, sideIndex: 3, targetCellId: `r${i - 1}`, targetPortalId: `e${i - 1}` }] : []),
        ],
      })),
    });
    const start = dynamicObject("r0", { x: 0, y: 0, z: 0.5 }, identityMat3, simpleCollisionCylinder(0.1, 1));
    const long = moveDynamicObject({ world, object: start, displacement: { x: 10, y: 0.3, z: 0 } });
    let object = start;

    for (let i = 0; i < 600; i += 1) {
      object = moveDynamicObject({ world, object, displacement: { x: 10 / 600, y: 0.3 / 600, z: 0 } }).object;
    }

    expect(long.crossings).toHaveLength(5);
    expect(long.object.cellId).toBe("r5");
    expect(object.cellId).toBe(long.object.cellId);
    expect(Math.abs(object.localPose.translation.x - long.object.localPose.translation.x)).toBeLessThan(1e-6);
    expect(Math.abs(object.localPose.translation.y - long.object.localPose.translation.y)).toBeLessThan(1e-6);
  });

  it("keeps random walks inside their cells and out of the forbidden zones on closed worlds", () => {
    for (const [name, spec] of [
      ["cube", cube],
      ["icosahedron", icosahedron],
      ["torusModuli", torusModuli],
    ] as const) {
      const world = compileCellComplex(spec);
      const cells = [...world.cellsById.values()];

      fc.assert(
        fc.property(fc.integer({ min: 0, max: cells.length - 1 }), fc.integer({ min: 1, max: 1_000_000 }), (cellIndex, seed) => {
          const cell = cells[cellIndex];
          let state = seed;
          const random = (): number => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
          };
          let object = dynamicObject(
            cell.id,
            {
              x: cell.baseVertices.reduce((s, v) => s + v.x, 0) / cell.baseVertices.length,
              y: cell.baseVertices.reduce((s, v) => s + v.y, 0) / cell.baseVertices.length,
              z: 0.5,
            },
            identityMat3,
            body,
          );

          for (let i = 0; i < 500; i += 1) {
            const angle = random() * 2 * Math.PI;
            const length = random() * 0.3;

            object = moveDynamicObject({ world, object, displacement: { x: Math.cos(angle) * length, y: Math.sin(angle) * length, z: 0 } }).object;

            if (insideCell(world, object) < -1e-9) {
              return false;
            }

            const p = object.localPose.translation;

            for (const column of world.cellsById.get(object.cellId)?.singularityColumns ?? []) {
              if (Math.hypot(p.x - column.center.x, p.y - column.center.y) < 0.4 - 1e-6) {
                return false;
              }
            }
          }

          return true;
        }),
        { numRuns: 5 },
      );
      expect(name).toBeTruthy();
    }
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

describe("bodies across portals (issue 63)", () => {
  const bodyAt = (cellId: string, x: number, y: number): DynamicObjectState => ({
    cellId,
    localPose: { rotation: identityMat3, translation: vec3(x, y, 0) },
    collision: simpleCollisionCylinder(0.25, 1, vec3(0, 0, 0.5)),
  });
  const mover = (cellId: string, x: number, y: number): DynamicObjectState => ({
    cellId,
    localPose: { rotation: identityMat3, translation: vec3(x, y, 0) },
    collision: simpleCollisionCylinder(0.1, 1, vec3(0, 0, 0.5)),
  });

  it("is blocked by a body in the neighbouring cell while straddling the portal", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const obstacle = bodyAt("room-b", -0.5, 0);
    const result = moveDynamicObject({
      world,
      object: mover("room-a", 0.9, 0),
      displacement: vec3(0.5, 0, 0),
      bodiesInCell: (cellId) => (cellId === "room-b" ? [obstacle] : []),
    });
    const x = result.object.localPose.translation.x;

    // The mover stops 0.35 m before the body: its anchor is past the portal, so it is in room-b.
    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBeUndefined();
    expect(result.crossedPortal).toBe(true);
    expect(result.object.cellId).toBe("room-b");
    expect(Math.abs(x - -0.5)).toBeGreaterThanOrEqual(0.35 - 1e-6);
    expect(Math.abs(x - -0.5)).toBeLessThan(0.35 + 1e-5);
  });

  it("is blocked the same way with the roles of the cells swapped", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const obstacle = bodyAt("room-a", 0.5, 0);
    const result = moveDynamicObject({
      world,
      object: mover("room-b", -0.9, 0),
      displacement: vec3(-0.5, 0, 0),
      bodiesInCell: (cellId) => (cellId === "room-a" ? [obstacle] : []),
    });
    const x = result.object.localPose.translation.x;

    expect(result.blocked).toBe(true);
    expect(result.object.cellId).toBe("room-a");
    expect(Math.abs(x - 0.5)).toBeGreaterThanOrEqual(0.35 - 1e-6);
    expect(Math.abs(x - 0.5)).toBeLessThan(0.35 + 1e-5);
  });

  it("does not move closer to a neighbour-cell body it already overlaps, and may move away", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const obstacle = bodyAt("room-b", -0.9, 0);
    const bodiesInCell = (cellId: string) => (cellId === "room-b" ? [obstacle] : []);
    const closer = moveDynamicObject({ world, object: mover("room-a", 0.9, 0), displacement: vec3(0.05, 0, 0), bodiesInCell });
    const away = moveDynamicObject({ world, object: mover("room-a", 0.9, 0), displacement: vec3(-0.05, 0, 0), bodiesInCell });

    expect(closer.blocked).toBe(true);
    expect(closer.object.localPose.translation.x).toBeCloseTo(0.9, 9);
    expect(away.blocked).toBe(false);
    expect(away.object.localPose.translation.x).toBeCloseTo(0.85, 9);
  });

  it("ignores listed object ids and bodies at another height", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const obstacle = { ...bodyAt("room-a", 0.5, 0), id: "mouse" };
    const high = { ...bodyAt("room-a", 0.5, 0), localPose: { rotation: identityMat3, translation: vec3(0.5, 0, 1.5) } };
    const move = (extra: object) =>
      moveDynamicObject({ world, object: mover("room-a", 0, 0), displacement: vec3(0.5, 0, 0), ...extra });

    expect(move({ bodiesInCell: (cellId: string) => (cellId === "room-a" ? [obstacle] : []) }).blocked).toBe(true);
    expect(
      move({ bodiesInCell: (cellId: string) => (cellId === "room-a" ? [obstacle] : []), ignoredObjectIds: new Set(["mouse"]) }).blocked,
    ).toBe(false);
    expect(move({ bodiesInCell: (cellId: string) => (cellId === "room-a" ? [high] : []) }).blocked).toBe(false);
  });

  it("keeps clear of a neighbour wall that meets the portal at 30 degrees", () => {
    const sqrt3 = Math.sqrt(3);
    const world = compileCellComplex({
      cells: [
        {
          id: "room-a",
          heightMeters: 2,
          baseVertices: squareRoomBase,
          portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "glued" }],
        },
        {
          id: "room-b",
          heightMeters: 2,
          baseVertices: [
            { x: 0, y: -1 },
            { x: 2 / sqrt3, y: -1 },
            { x: 0, y: 1 },
          ],
          portals: [{ id: "glued", sideIndex: 2, targetCellId: "room-a", targetPortalId: "east" }],
        },
      ],
    });
    // Wall B -> C of room-b developed into room-a's frame.
    const wallA = { x: 1 + 2 / sqrt3, y: -1 };
    const wallB = { x: 1, y: 1 };
    const distanceToWall = (p: { x: number; y: number }): number => {
      const ex = wallB.x - wallA.x;
      const ey = wallB.y - wallA.y;
      const t = Math.max(0, Math.min(1, ((p.x - wallA.x) * ex + (p.y - wallA.y) * ey) / (ex * ex + ey * ey)));

      return Math.hypot(p.x - (wallA.x + t * ex), p.y - (wallA.y + t * ey));
    };
    let object = mover("room-a", 0.95, -0.5);
    let roomAFromCurrent: RigidTransform3 = identityRigidTransform3;
    let cellChanges = 0;

    for (let step = 0; step < 100; step += 1) {
      const result = moveDynamicObject({ world, object, displacement: vec3(0, 0.02, 0), ignoreForbiddenZones: true });

      cellChanges += result.crossings.length;
      roomAFromCurrent = composeRigidTransform3(roomAFromCurrent, invertRigidTransform3(result.cellFromStart));
      object = result.object;

      const p = transformPoint3(roomAFromCurrent, object.localPose.translation);

      expect(distanceToWall(p)).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }

    expect(cellChanges).toBeLessThanOrEqual(1);
  });
});