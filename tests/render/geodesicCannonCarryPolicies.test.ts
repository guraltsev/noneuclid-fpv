/**
 * `tests/render/geodesicCannonCarryPolicies.test.ts` — unit tier.
 *
 * The carry tool sends displacement steps and applies the carry contract's answer (`src/world-objects/carry.ts`, tested in
 * `tests/world-objects/carry.test.ts`); these tests drive the real tool (`createGeodesicCannonTools`) through the agreed policies:
 * - the emitter stops just short of a wall that stands between it and the hand;
 * - a step that sweeps across a junction ends the carry and leaves the emitter at its last valid position;
 * - the emitter glides to the hand at no more than the speed cap when the tool is told how much time passed.
 * `tests/render/geodesicCannonCarry.test.ts` keeps the release, re-homing, glow and yaw behaviour.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose, type PlayerPose } from "../../src/movement/playerPose";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { createTestAppSession } from "../support/appSession";
import { carryMaxSpeedMetersPerSecond } from "../../src/world-objects/carry";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { isGeodesicLocked } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createGeodesicCannonTools } from "../../src/render/three/geodesicCannonTools";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";

function createHarness(world: CompiledCellComplex, registry: RuntimeObjectRegistry, playerPose: PlayerPose) {
  const session = createTestAppSession({ playerPose });
  const nothing = (): void => {};
  const tools = createGeodesicCannonTools({
    scene: new THREE.Scene(),
    renderer: { xr: { isPresenting: false } } as unknown as THREE.WebGLRenderer,
    controls: { requestPointerLock: () => Promise.resolve() } as never,
    runtimeObjectRegistry: registry,
    getWorld: () => world,
    session,
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
    refreshMeasuredGeodesicLengthsForGeodesic: nothing,
    removeMeasuredGeodesicLengthsForGeodesic: nothing,
    removeProtractorAnglesForGeodesic: nothing,
    removeProtractorAnglesForMissingVertices: nothing,
    refreshProtractorAnglesForGeodesic: nothing,
    refreshProtractorAnglesForGeodesics: nothing,
  });

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
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("drops the emitter at its last valid position when a step sweeps across a junction", () => {
    // Two rooms; the emitter hangs in b at x = 1.6, y = 4.7. The hand is in a at y = 4.7, so the glide crosses the portal 0.3 m from the corner
    // (0, 5): inside the exclusion zone (0.15 m) widened by the emitter's body, though the portal itself is open.
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "lamp", cellId: "b", localPose: yawRigidTransform3(0, { x: 1.6, y: 4.7, z: 0 }) }));
    const { tools, selectedTool } = createHarness(world, registry, { ...createDefaultPlayerPose("a"), position: { x: 3.5, y: 2.5, z: 0 } });

    tools.startGeodesicCannonCarry("lamp");
    expect(selectedTool()).toBe("geodesic-cannon-carry");
    tools.updateCarriedGeodesicCannonPose(true, handAt(4, 4.7));

    // It followed the hand for one step, then the next step would have swept the corner: the carry ended and the emitter stays put.
    expect(selectedTool()).toBe("none");
    expect(registry.get("lamp")).toMatchObject({ kind: "geodesic-cannon", cellId: "b" });
    expect(registry.get("lamp")?.localPose.translation.x).toBeCloseTo(0.6, 6);
    expect(registry.get("lamp")?.localPose.translation.y).toBeCloseTo(4.7, 6);
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
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });
});
