import { describe, expect, it } from "vitest";
import { torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityMat3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { testCellCollision } from "../../src/movement/collision";
import { depenetrateDynamicObject } from "../../src/movement/depenetrateDynamicObject";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { moveDynamicObject } from "../../src/movement/moveDynamicObject";
import {
  createTorusSkewCellDeformationMaps,
  createTorusSkewDeformationFamily,
} from "../../src/runtime/deformations/torusSkewDeformation";
import { transformPoseWithCellMaps } from "../../src/runtime/worldGeometryDeformations";

const rest = { kind: "torus-skew", cellId: "torus-room", widthMeters: 15, depthMeters: 15, skewXMeters: 0 } as const;
const trap = { ...rest, depthMeters: 7.5, skewXMeters: 30 } as const;
const playerCollision = simpleCollisionCylinder(0.25, 1.6, { x: 0, y: 0, z: 0.8 });
const trapWorld = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torusModuli, trap));
const restWorld = compileCellComplex(torusModuli);

function player(x: number, y: number): DynamicObjectState {
  return { cellId: "torus-room", localPose: yawRigidTransform3(0, vec3(x, y, 0)), collision: playerCollision };
}

function mapToTrap(object: DynamicObjectState, target: typeof trap | (typeof rest & { skewXMeters: number; depthMeters: number }) = trap): DynamicObjectState {
  const mapped = transformPoseWithCellMaps(
    { cellId: object.cellId, localPose: object.localPose },
    createTorusSkewCellDeformationMaps(rest, target),
  )!;
  return { ...object, cellId: mapped.cellId, localPose: mapped.localPose };
}

function blocked(world: ReturnType<typeof compileCellComplex>, object: DynamicObjectState) {
  return testCellCollision({ cell: world.cellsById.get(object.cellId)!, object });
}

describe("depenetrateDynamicObject", () => {
  it("pushes the player out of the junction zone after the issue-53 trap commit", () => {
    const object = player(7.1, -7.3);
    expect(blocked(restWorld, object).blocked).toBe(false);

    const mapped = mapToTrap(object);
    expect(mapped.localPose.translation.x).toBeCloseTo(-7.5, 9);
    expect(mapped.localPose.translation.y).toBeCloseTo(-3.65, 9);
    expect(blocked(trapWorld, mapped)).toMatchObject({ blocked: true, reason: "forbidden-zone" });

    const result = depenetrateDynamicObject(trapWorld, mapped);
    expect(result.kind).toBe("pushed");
    expect(result.object.localPose.translation.x).toBeCloseTo(-7.5, 9);
    expect(result.object.localPose.translation.y).toBeCloseTo(-3.349999, 9);
    expect(result.object.cellId).toBe("torus-room");
    for (const vertex of trapWorld.cellsById.get("torus-room")!.baseVertices) {
      const t = result.object.localPose.translation;
      expect(Math.hypot(t.x - vertex.x, t.y - vertex.y)).toBeGreaterThanOrEqual(0.4);
    }
    expect(moveDynamicObject({ world: trapWorld, object: result.object, displacement: vec3(0, 0.01, 0) }).blocked).toBe(false);
    expect(moveDynamicObject({ world: trapWorld, object: result.object, displacement: vec3(0.01, 0, 0) }).blocked).toBe(false);
  });

  it("returns the same object when nothing overlaps", () => {
    const object = player(0, 0);
    const result = depenetrateDynamicObject(trapWorld, object);
    expect(result.kind).toBe("unchanged");
    expect(result.object).toBe(object);
  });

  it("pushes a body sitting exactly on a vertex toward the cell centroid", () => {
    const object = player(-7.5, -3.75);
    const result = depenetrateDynamicObject(trapWorld, object);
    expect(result.kind).toBe("pushed");
    expect(blocked(trapWorld, result.object).blocked).toBe(false);
    for (const vertex of trapWorld.cellsById.get("torus-room")!.baseVertices) {
      const t = result.object.localPose.translation;
      expect(Math.hypot(t.x - vertex.x, t.y - vertex.y)).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("leaves no body blocked for legal rest poses near the corners", () => {
    const targets = [trap, { ...rest, skewXMeters: 15 }, { ...rest, skewXMeters: 30, depthMeters: 30 }];
    const corners = restWorld.cellsById.get("torus-room")!.baseVertices;
    for (const target of targets) {
      const world = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torusModuli, target));
      for (const corner of corners) {
        for (const r of [0.41, 0.45, 0.5, 0.6]) {
          for (let k = 0; k < 36; k += 1) {
            const angle = (k * 10 * Math.PI) / 180;
            const x = corner.x + r * Math.cos(angle);
            const y = corner.y + r * Math.sin(angle);
            if (Math.abs(x) > 7.5 || Math.abs(y) > 7.5) continue;
            const object = player(x, y);
            if (blocked(restWorld, object).blocked) continue;
            const result = depenetrateDynamicObject(world, mapToTrap(object, target as typeof trap));
            expect(result.kind).not.toBe("failed");
            expect(blocked(world, result.object).blocked).toBe(false);
          }
        }
      }
    }
  });

  it("pushes a body out of a wall along the inward normal", () => {
    const world = compileCellComplex(singleRoom());
    const result = depenetrateDynamicObject(world, wallBody(-0.95, 0));
    expect(result.kind).toBe("pushed");
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.899999, 9);
    expect(result.object.localPose.translation.y).toBeCloseTo(0, 9);
  });

  it("pushes a body out of a corner in one call", () => {
    const world = compileCellComplex(singleRoom());
    const result = depenetrateDynamicObject(world, wallBody(-0.95, -0.95));
    expect(result.kind).toBe("pushed");
    expect(result.object.localPose.translation.x).toBeCloseTo(-0.899999, 9);
    expect(result.object.localPose.translation.y).toBeCloseTo(-0.899999, 9);
  });

  it("ignores zones when asked", () => {
    const mapped = mapToTrap(player(7.1, -7.3));
    const result = depenetrateDynamicObject(trapWorld, mapped, { ignoreForbiddenZones: true });
    expect(result.kind).toBe("unchanged");
  });
});

function singleRoom(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 2,
        baseVertices: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ],
        portals: [],
      },
    ],
  };
}

function wallBody(x: number, y: number): DynamicObjectState {
  return {
    cellId: "room",
    localPose: { rotation: identityMat3, translation: vec3(x, y, 0.5) },
    collision: simpleCollisionCylinder(0.1, 1),
  };
}
