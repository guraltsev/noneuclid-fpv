/**
 * `tests/render/geodesicCannonCarryPolicies.test.ts` — unit tier.
 *
 * The carry tool sends displacement steps and applies the carry contract's answer (`src/world-objects/carry.ts`, tested in
 * `tests/world-objects/carry.test.ts`); these tests drive the real tool (`createGeodesicCannonTools`) through the agreed policies:
 * - the emitter stops just short of a wall that stands between it and the hand;
 * - an exclusion zone is a wall: a step that would sweep across or end inside one stops short of it, and the emitter stays carried;
 * - the hand lets go of an emitter that is farther than its leash and never lets go of a fresh pickup (the policy is `src/interaction/handCarry.ts`);
 * - the emitter glides to the hand at no more than the speed cap when the tool is told how much time passed.
 * `tests/render/geodesicCannonCarry.test.ts` keeps the release, re-homing, glow and yaw behaviour.
 */
import { createTestEngine } from "../support/engine";
import { driveCarryTools } from "../support/carryTools";
import { createDefaultWorldModules } from "../../src/runtime/experience";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose, type PlayerPose } from "../../src/movement/playerPose";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { createTestClientSession } from "../support/clientSession";
import { handCarryLeashMeters } from "../../src/interaction/handCarry";
import { carryMaxSpeedMetersPerSecond } from "../../src/world-objects/carry";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { arcConnectsEmitters } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject, emitterConnectionToleranceMeters } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createGeodesicCannonTools } from "../../src/render/three/geodesicCannonTools";
import { getRuntimeObjectInteractionRangeMeters, type RootAimRay } from "../../src/render/three/rootAimRay";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";

function createHarness(world: CompiledCellComplex, registry: RuntimeObjectRegistry, playerPose: PlayerPose) {
  const session = createTestClientSession();
  const engine = createTestEngine({ registry, playerPose, getWorld: () => world, modules: createDefaultWorldModules() });
  const nothing = (): void => {};
  const rawTools = createGeodesicCannonTools({
    renderer: { xr: { isPresenting: false } } as unknown as THREE.WebGLRenderer,
    controls: { requestPointerLock: () => Promise.resolve() } as never,
    runtimeObjectRegistry: registry,
    getWorld: () => world,
    session,
    engine,
    dispatch: (command) => {
      applyRuntimeCommand(session, command);
    },
    resolveCurrentAimTarget: () => undefined,
    resolveCurrentAimTargets: () => [],
    targetIsWithinInteractionRange: () => false,
    logVerboseAimClick: nothing,
    findFocusedRuntimeObject: () => undefined,
    getGeodesicLabelsById: () => ({}),
    syncDesktopPalette: nothing,
    syncRuntimeObjectPortalInstances: nothing,
    syncSelectableHitboxDebug: nothing,
    removeMeasuredGeodesicLengthsForGeodesic: nothing,
    removeProtractorAnglesForGeodesic: nothing,
    removeProtractorAnglesForMissingVertices: nothing,
  });
  // The shell steps the world after the tools have run; the harness steps it after each carry call.
  const tools = driveCarryTools(rawTools, engine);

  return { tools, selectedTool: () => session.get().menuState.selectedTool };
}

function handAt(x: number, y: number): RootAimRay {
  return {
    origin: worldPointToThree({ x, y, z: 1.2 }),
    direction: new THREE.Vector3(0, 0, -1),
    quaternion: new THREE.Quaternion(),
  };
}

// Two rooms side by side with a locked geodesic from an emitter in `a` to one in `b`; the player stands in `a`.
function setupRooms(playerX: number, playerY: number) {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") {
    throw new Error("Expected the source emitter.");
  }
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

  return { registry, ...createHarness(world, registry, { ...createDefaultPlayerPose("a"), position: { x: playerX, y: playerY, z: 0 } }) };
}

describe("the carry tool applies the agreed policies", () => {
  it("stops the emitter just short of a wall between it and the hand, keeping the geodesic", () => {
    const { registry, tools } = setupRooms(3.5, 2.5);

    tools.startGeodesicCannonCarry("cannon-b");
    // The hand is past the wall y = 5 of the room the player stands in.
    tools.updateCarriedGeodesicCannonPose(true, handAt(3.5, 9));
    tools.finishGeodesicCannonCarry();

    const emitter = registry.get("cannon-b");
    expect(emitter).toMatchObject({ kind: "geodesic-cannon", cellId: "a" });
    expect(emitter?.localPose.translation.y).toBeGreaterThan(4.9);
    expect(emitter?.localPose.translation.y).toBeLessThan(5);
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
  });

  it("stops the emitter at a junction's zone, still carried, when a step would sweep it", () => {
    // Two rooms; the emitter hangs in b at x = 1.6, y = 4.7. The hand is in a at y = 4.7, so the glide crosses the portal 0.3 m from the corner
    // (0, 5): inside the exclusion zone (0.15 m) widened by the emitter's body, though the portal itself is open.
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "lamp", cellId: "b", localPose: yawRigidTransform3(0, { x: 1.6, y: 4.7, z: 0 }) }));
    const { tools, selectedTool } = createHarness(world, registry, { ...createDefaultPlayerPose("a"), position: { x: 4.5, y: 3.5, z: 0 } });
    const stopX = Math.sqrt((0.15 + emitterConnectionToleranceMeters) ** 2 - 0.3 ** 2);

    tools.startGeodesicCannonCarry("lamp");
    expect(selectedTool()).toBe("geodesic-cannon-carry");
    tools.updateCarriedGeodesicCannonPose(true, handAt(4, 4.7));

    // It followed the hand for one step, then the next step would have swept the zone: it stops at the zone's edge and is still carried.
    expect(selectedTool()).toBe("geodesic-cannon-carry");
    expect(registry.get("lamp")).toMatchObject({ kind: "geodesic-cannon", cellId: "b" });
    expect(registry.get("lamp")?.localPose.translation.x).toBeCloseTo(stopX, 3);
    expect(registry.get("lamp")?.localPose.translation.y).toBeCloseTo(4.7, 6);
    // The hand stays where it is: another frame changes nothing and the carry goes on.
    tools.updateCarriedGeodesicCannonPose(true, handAt(4, 4.7));
    expect(selectedTool()).toBe("geodesic-cannon-carry");
    expect(registry.get("lamp")?.localPose.translation.x).toBeCloseTo(stopX, 3);
  });

  it("stops the emitter at a forbidden zone the hand put it in, keeping it and its geodesic", () => {
    const { registry, tools, selectedTool } = setupRooms(3.5, 2.5);

    tools.startGeodesicCannonCarry("cannon-a");
    // The hand is 0.22 m from the corner (5, 5) of the room, inside its exclusion zone widened by the emitter's body, and the glide
    // does not cross a portal on the way: the emitter stops at the edge of the zone.
    tools.updateCarriedGeodesicCannonPose(true, handAt(4.9, 4.8));

    const emitter = registry.get("cannon-a");
    expect(emitter).toMatchObject({ kind: "geodesic-cannon", cellId: "a" });
    expect(Math.hypot((emitter?.localPose.translation.x ?? 0) - 5, (emitter?.localPose.translation.y ?? 0) - 5))
      .toBeGreaterThanOrEqual(0.15 + emitterConnectionToleranceMeters);
    expect(registry.get("g-a")).toBeDefined();
    expect(registry.get("cannon-b")).toBeDefined();
    expect(selectedTool()).toBe("geodesic-cannon-carry");
  });

  describe("the hand lets go of an emitter that is too far", () => {
    // The emitter hangs in b at x = 1, which is x = 6 in the frame of a, where the player stands; the hand is in a on the line y = 2.5.
    // With no time allowed to pass (deltaSeconds 0) the emitter does not move, so the distance to the hand is just 6 - hand x.
    const leash = (registry: RuntimeObjectRegistry): number => {
      const emitter = registry.get("cannon-b");
      if (!emitter) {
        throw new Error("Expected the carried emitter.");
      }

      return handCarryLeashMeters({ pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(emitter), handReachMeters: 0 });
    };

    it("holds it while it is within the leash of the hand and lets go beyond", () => {
      const near = setupRooms(3.5, 2.5);
      near.tools.startGeodesicCannonCarry("cannon-b");
      near.tools.updateCarriedGeodesicCannonPose(true, handAt(6 - (leash(near.registry) - 0.1), 2.5), 0);
      expect(near.selectedTool()).toBe("geodesic-cannon-carry");

      const far = setupRooms(3.5, 2.5);
      far.tools.startGeodesicCannonCarry("cannon-b");
      far.tools.updateCarriedGeodesicCannonPose(true, handAt(6 - (leash(far.registry) + 0.1), 2.5), 0);
      expect(far.selectedTool()).toBe("none");
    });

    it("holds a fresh pickup at the limit of the pickup range", () => {
      const { tools, selectedTool } = setupRooms(3.5, 2.5);

      tools.startGeodesicCannonCarry("cannon-b");
      // 2.55 m from the emitter: just beyond the 2.5 m pickup range, within the loose leash; the emitter has not moved (no time passes).
      tools.updateCarriedGeodesicCannonPose(true, handAt(3.5, 3), 0);

      expect(selectedTool()).toBe("geodesic-cannon-carry");
    });

    it("holds at 1.5 m while gliding, but lets go at 1.5 m once the emitter has arrived", () => {
      const gliding = setupRooms(3.5, 2.5);
      gliding.tools.startGeodesicCannonCarry("cannon-b");
      // The emitter (x = 6 in the frame of a) is 1.5 m from the hand and has not reached it: the loose leash applies.
      gliding.tools.updateCarriedGeodesicCannonPose(true, handAt(4.5, 2.5), 0);
      expect(gliding.selectedTool()).toBe("geodesic-cannon-carry");

      const held = setupRooms(3.5, 2.5);
      held.tools.startGeodesicCannonCarry("cannon-b");
      // Without a time limit the emitter follows the hand all the way: it has arrived, the tight leash applies from now on.
      held.tools.updateCarriedGeodesicCannonPose(true, handAt(4.5, 2.5));
      expect(held.selectedTool()).toBe("geodesic-cannon-carry");
      // Within 1 m of the arrived emitter the carry goes on; at 1.5 m (the emitter stuck, the hand gone) it is let go.
      held.tools.updateCarriedGeodesicCannonPose(true, handAt(4.5, 1.6), 0);
      expect(held.selectedTool()).toBe("geodesic-cannon-carry");
      held.tools.updateCarriedGeodesicCannonPose(true, handAt(4.5, 1), 0);
      expect(held.selectedTool()).toBe("none");
    });

    it("keeps the geodesic chained when a hand that moved far away lets go", () => {
      const { registry, tools, selectedTool } = setupRooms(3.5, 2.5);
      const frameSeconds = 1 / 60;

      tools.startGeodesicCannonCarry("cannon-b");
      // The hand is at the far corner of a, 5.8 m from the emitter; the emitter follows by at most one frame's travel, then is let go.
      tools.updateCarriedGeodesicCannonPose(true, handAt(0.5, 0.5), frameSeconds);

      expect(selectedTool()).toBe("none");
      const emitter = registry.get("cannon-b");
      expect(emitter).toMatchObject({ kind: "geodesic-cannon" });
      expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
      const travelled = Math.hypot((emitter?.cellId === "b" ? 5 : 0) + (emitter?.localPose.translation.x ?? 0) - 6, (emitter?.localPose.translation.y ?? 0) - 2.5);
      expect(travelled).toBeLessThanOrEqual(carryMaxSpeedMetersPerSecond * frameSeconds + 1e-6);
    });

    it("does not let go of an emitter picked up from the edge of the pickup range", () => {
      const { registry, tools, selectedTool } = setupRooms(3.5, 2.5);
      const emitter = registry.get("cannon-b");
      if (!emitter) {
        throw new Error("Expected the carried emitter.");
      }
      const range = getRuntimeObjectInteractionRangeMeters(emitter);

      tools.startGeodesicCannonCarry("cannon-b");
      // The hand is exactly a pickup range from the emitter, as it is at the moment of a pickup at the edge of the range.
      for (let frame = 0; frame < 10; frame += 1) {
        tools.updateCarriedGeodesicCannonPose(true, handAt(6 - range, 2.5), 1 / 60);
        expect(selectedTool()).toBe("geodesic-cannon-carry");
      }
    });
  });

  it("glides to the hand no faster than the speed cap when told how much time passed", () => {
    const { registry, tools } = setupRooms(4.5, 2.5);
    const frameSeconds = 1 / 60;
    const reachPerFrame = carryMaxSpeedMetersPerSecond * frameSeconds;

    tools.startGeodesicCannonCarry("cannon-b");
    let previous = { cellId: "b", x: 1 };
    let frames = 0;
    // The hand is in `a`, 4.6 m from the emitter's room at x = 1 (in a's frame the emitter is at x = 6).
    for (; frames < 100; frames += 1) {
      tools.updateCarriedGeodesicCannonPose(true, handAt(4.6, 3.2), frameSeconds);
      const emitter = registry.get("cannon-b");
      const x = (emitter?.cellId === "b" ? 5 : 0) + (emitter?.localPose.translation.x ?? 0);
      const previousX = previous.cellId === "b" ? 5 + previous.x : previous.x;
      expect(Math.abs(x - previousX)).toBeLessThanOrEqual(reachPerFrame + 1e-6);
      previous = { cellId: emitter?.cellId ?? "", x: emitter?.localPose.translation.x ?? 0 };
      if (emitter?.cellId === "a" && Math.abs(x - 4.6) < 1e-3) {
        break;
      }
    }
    tools.finishGeodesicCannonCarry();

    expect(frames).toBeGreaterThan(3);
    expect(registry.get("cannon-b")).toMatchObject({ cellId: "a" });
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
  });
});
