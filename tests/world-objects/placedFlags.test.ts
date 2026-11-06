/**
 * `tests/world-objects/placedFlags.test.ts` — unit tier.
 *
 * A placed flag is a wooden-sign world object a player authors in place: `placeFlagAtFloorPoint`
 * places one at a floor point, with numbered default text continuing from existing flags of the
 * same type; its message is sanitized (clamped length, newlines preserved, other whitespace normalized). These
 * tests check message sanitizing, default-text numbering, placement and orientation toward the
 * eye, font colour updates, and conversion to a dynamic-object state for collision.
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityRigidTransform3, transformDirection3 } from "../../src/math/rigidTransform3";
import {
  createPlacedFlagObject,
  defaultPlacedFlagMessage,
  placeFlagAtFloorPoint,
  placedFlagToDynamicObjectState,
  sanitizePlacedFlagMessage,
} from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

describe("placedFlags", () => {
  it("clamps messages to twenty characters", () => {
    expect(sanitizePlacedFlagMessage("1234567890123456789012345")).toBe("12345678901234567890");
  });

  it("preserves sign editor newlines while normalizing other whitespace", () => {
    expect(sanitizePlacedFlagMessage("A\tB\r\nC\nD")).toBe("A B\nC\nD");
  });

  it("defaults flag text by type and the next existing matching number", () => {
    const a1 = createPlacedFlagObject({
      id: "flag-a1",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "A1",
    });
    const a7 = createPlacedFlagObject({
      id: "flag-a7",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
      message: "A7",
    });
    const b3 = createPlacedFlagObject({
      id: "flag-b3",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign2",
      message: "B3",
    });

    expect(defaultPlacedFlagMessage("WoodenSign1", [a1, a7, b3])).toBe("A8");
    expect(defaultPlacedFlagMessage("WoodenSign2", [a1, a7, b3])).toBe("B4");
  });

  it("places flags with numbered default text from existing runtime flags", () => {
    const world = compileCellComplex(singleRoomWorld());
    const registry = createRuntimeObjectRegistry([
      createPlacedFlagObject({
        id: "flag-a7",
        cellId: "other-room",
        localPose: identityRigidTransform3,
        flagType: "WoodenSign1",
        message: "A7",
      }),
      createPlacedFlagObject({
        id: "flag-b3",
        cellId: "other-room",
        localPose: identityRigidTransform3,
        flagType: "WoodenSign2",
        message: "B3",
      }),
    ]);

    const sign1Result = placeFlagAtFloorPoint({
      world,
      registry,
      cellId: "room",
      eyePosition: { x: -1.5, y: -2, z: 1.6 },
      floorPoint: { x: -1.5, y: -2, z: 0 },
      flagType: "WoodenSign1",
      createId: () => "flag-new-a",
    });
    const sign2Result = placeFlagAtFloorPoint({
      world,
      registry,
      cellId: "room",
      eyePosition: { x: 1.5, y: -2, z: 1.6 },
      floorPoint: { x: 1.5, y: -2, z: 0 },
      flagType: "WoodenSign2",
      createId: () => "flag-new-b",
    });

    expect(sign1Result.object?.message).toBe("A8");
    expect(sign2Result.object?.message).toBe("B4");
  });

  it("places flags at a resolved floor point in the resolved cell", () => {
    const world = compileCellComplex(twoRoomWorld());
    const registry = createRuntimeObjectRegistry();

    const result = placeFlagAtFloorPoint({
      world,
      registry,
      cellId: "room-b",
      eyePosition: { x: 0, y: -2, z: 1.6 },
      floorPoint: { x: 1, y: 0.5, z: 0 },
      flagType: "WoodenSign1",
      createId: () => "flag-room-b",
    });

    expect(result.placed).toBe(true);
    expect(result.object?.cellId).toBe("room-b");
    expect(result.object?.localPose.translation).toEqual({ x: 1, y: 0.5, z: 0 });
    expect(registry.getObjectsInCell("room-b").map((object) => object.id)).toEqual(["flag-room-b"]);
    expect(registry.getObjectsInCell("room-a")).toEqual([]);
  });

  it("turns the flag front (local +y, the renderer's front text plane side) towards the eye", () => {
    const world = compileCellComplex(twoRoomWorld());
    const floorPoint = { x: 1, y: 0.5, z: 0 };
    for (const eye of [{ x: 0, y: -2, z: 1.6 }, { x: 2.5, y: 0.2, z: 1.6 }, { x: 3, y: 2, z: 1.6 }]) {
      const registry = createRuntimeObjectRegistry();
      const result = placeFlagAtFloorPoint({ world, registry, cellId: "room-b", eyePosition: eye, floorPoint, flagType: "WoodenSign1", createId: () => "f" });
      expect(result.placed).toBe(true);
      const front = transformDirection3(result.object!.localPose, { x: 0, y: 1, z: 0 });
      const length = Math.hypot(eye.x - floorPoint.x, eye.y - floorPoint.y);
      expect(front.x).toBeCloseTo((eye.x - floorPoint.x) / length, 9);
      expect(front.y).toBeCloseTo((eye.y - floorPoint.y) / length, 9);
    }
  });

  it("keeps sign tooltip metadata separate from structured edit actions", () => {
    const flag = createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign1",
    });

    expect(flag.tooltip).toMatchObject({
      label: "Sign",
      rangeMeters: 2.5,
    });
    expect(flag.tooltip?.desktopPrompt).toBeUndefined();
    expect(flag.tooltip?.xrPrompt).toBeUndefined();
    expect(flag.interactable).toMatchObject({
      label: "Edit sign",
      action: "edit-flag",
      rangeMeters: 2.5,
    });
  });


  it("exposes placed flags as dynamic object state for collision", () => {
    const flag = createPlacedFlagObject({
      id: "flag-a",
      cellId: "room-a",
      localPose: identityRigidTransform3,
      flagType: "WoodenSign2",
    });

    expect(placedFlagToDynamicObjectState(flag)).toEqual({
      cellId: "room-a",
      localPose: identityRigidTransform3,
      collision: flag.collision,
    });
  });
});

function singleRoomWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 3,
        baseVertices: [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
        ],
        portals: [],
      },
    ],
  };
}

function twoRoomWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 3,
        baseVertices: [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
        ],
        portals: [],
      },
      {
        id: "room-b",
        heightMeters: 3,
        baseVertices: [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
        ],
        portals: [],
      },
    ],
  };
}
