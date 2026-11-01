/**
 * `tests/render/geodesicCannonCarry.test.ts` — unit tier.
 *
 * Carrying a geodesic emitter that anchors a locked geodesic, driven through the real tool controller
 * (`createGeodesicCannonTools`) with plain-value dependencies for the renderer, scene and input.
 *
 * Three things make this behaviour subtle:
 * - The emitter is held at the player's hand, and the hand can be on another face than the one the player stands on.
 *   The emitter belongs to the face the hand is on, found by walking from the player to the hand, so the player's own
 *   position matters: a test must keep the player where a player could stand and the hand elsewhere. A hand behind a wall
 *   does not move the emitter.
 * - The geodesic must follow the emitter at every frame, not only at the end: after each step it still ends in the cell
 *   the emitter is in. Which portals the emitter crossed follows from where it was and where it is, whatever the player did.
 * - An emitter does not have to start on the face the player stands on. Picking it up is a jump to the hand, with no step
 *   to explain it, and the geodesic must still join both emitters through the pickup, the carry and the release.
 *   A drop onto another face works on its own; picking that emitter up again from there has to keep the geodesic too.
 *
 * - The pink glow around the carried emitter is drawn in the player's frame, at the hand, wherever the emitter is stored:
 *   it must stay at the hand when the emitter is on another face than the player.
 *
 * - A face can be turned relative to its neighbour (on the cube, by a quarter turn). An emitter carried onto the next
 *   face keeps its physical direction, so its yaw turns with the face, and its default launch yaw stays equal to the yaw
 *   of its pose. (Picking an emitter up removes its free geodesics, so only locked geodesics are carried.)
 *
 * The checks: the geodesic is still locked, still joins both emitters and ends in the emitter's cell, and the emitter
 * lives in the cell it is in. The geodesic-level rules are in `tests/world-objects/geodesic/carry.test.ts`.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRuntimeMenuState, type RuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { getGeodesicSegments } from "../../src/world-objects/geodesic/segments";
import { getGeodesicConnection, isGeodesicLocked } from "../../src/world-objects/geodesic/lifecycle";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createGeodesicCannonTools, type GeodesicCannonToolState } from "../../src/render/three/geodesicCannonTools";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { createDefaultPlayerPose, type PlayerPose } from "../../src/movement/playerPose";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";

function createHarness(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  startPose: PlayerPose,
) {
  let menuState: RuntimeMenuState = createRuntimeMenuState({ selectedWorldId: "test" });
  let toolState: GeodesicCannonToolState = {};
  let playerPose = startPose;
  const nothing = (): void => {};
  const scene = new THREE.Scene();
  const tools = createGeodesicCannonTools({
    scene,
    renderer: { xr: { isPresenting: false } } as unknown as THREE.WebGLRenderer,
    controls: { requestPointerLock: () => Promise.resolve() } as never,
    runtimeObjectRegistry: registry,
    getWorld: () => world,
    getMenuState: () => menuState,
    setMenuState: (next) => {
      menuState = next;
    },
    getCannonToolState: () => toolState,
    setCannonToolState: (next) => {
      toolState = next;
    },
    getPlayerPose: () => playerPose,
    getDebugLevel: () => "off",
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

  // The player stands in `cellId` at (x, y); how they got there does not matter to the tools.
  function walkInto(cellId: string, x: number, y: number): void {
    playerPose = { ...playerPose, cellId, position: { x, y, z: 0 } };
  }

  return { world, registry, tools, walkInto, scene };
}

function setup() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") {
    throw new Error("Expected the source emitter.");
  }
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

  return createHarness(world, registry, { ...createDefaultPlayerPose("a"), position: { x: 4.5, y: 2.5, z: 0 } });
}

// The cube, with a locked geodesic from a cannon on the front face to one on the right face (3 segments), and the
// player standing next to the second cannon.
function setupCube(playerCell = "right", playerX = -2.4, playerY = -4.4) {
  const world = compileCellComplex(cube);
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({
    id: "cannon-a",
    cellId: "front",
    localPose: yawRigidTransform3(Math.atan2(-0.6299138870477234, 0.776664982411611), { x: 5.356468478410459, y: 1.3724895861593076, z: 0 }),
  }));
  registry.add(createGeodesicCannonObject({
    id: "cannon-b",
    cellId: "right",
    localPose: yawRigidTransform3(0, { x: -2.4644086473935514, y: -4.450135738386821, z: 0 }),
  }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") {
    throw new Error("Expected the source emitter.");
  }
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 12 });

  return createHarness(world, registry, { ...createDefaultPlayerPose(playerCell), position: { x: playerX, y: playerY, z: 0 } });
}

// A hand at (x, y) in the player's cell frame; in VR the carried emitter sits under it.
function handAt(x: number, y: number): RootAimRay {
  return {
    origin: worldPointToThree({ x, y, z: 1.2 }),
    direction: new THREE.Vector3(0, 0, -1),
    quaternion: new THREE.Quaternion(),
  };
}

describe("releasing a carried emitter of a locked geodesic", () => {
  it("keeps the geodesic when the emitter is let go beyond a portal of the player's cell", () => {
    const { registry, tools } = setup();
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);

    tools.startGeodesicCannonCarry("cannon-b");
    // The player stands in cell a; the hand is past a's portal at x = 5, so the emitter sits in b at (0.8, 3).
    tools.updateCarriedGeodesicCannonPose(true, handAt(4.6, 3.2));
    tools.updateCarriedGeodesicCannonPose(true, handAt(5.8, 3));
    expect(registry.get("g-a")).toBeDefined();
    tools.finishGeodesicCannonCarry();

    const released = registry.get("cannon-b");
    expect(released).toMatchObject({ kind: "geodesic-cannon", cellId: "b" });
    expect(registry.get("g-a")).toMatchObject({ kind: "geodesic-interval" });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
  });

  it("re-homes an emitter whose hand is on the next face and keeps the geodesic", () => {
    const { registry, tools, walkInto } = setupCube();

    tools.startGeodesicCannonCarry("cannon-b");
    // The player crosses from right to bottom, then from bottom to back; the hand stays one face ahead of the player.
    walkInto("bottom", 2.9, -7.48);
    tools.updateCarriedGeodesicCannonPose(true, handAt(3.398, -6.97));
    walkInto("back", -2.9, -7.46);
    tools.updateCarriedGeodesicCannonPose(true, handAt(-3.399, -7.969));
    tools.finishGeodesicCannonCarry();

    // The hand was on the bottom face, so the emitter ends there and the geodesic no longer visits back.
    expect(registry.get("cannon-b")).toMatchObject({ kind: "geodesic-cannon", cellId: "bottom" });
    expect(registry.get("g-a")).toMatchObject({ kind: "geodesic-interval" });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(getGeodesicConnection(registry, "g-a")).toMatchObject({ state: "connected" });
  });

  it("keeps the geodesic when an emitter on another face is picked up and let go", () => {
    // The emitter is on the right face; the player stands on the top face, which is next to it.
    const { registry, tools } = setupCube("top", 0, 0);

    tools.startGeodesicCannonCarry("cannon-b");
    tools.updateCarriedGeodesicCannonPose(true, handAt(1, 1));
    tools.updateCarriedGeodesicCannonPose(true, handAt(1.5, 1.2));
    tools.finishGeodesicCannonCarry();

    expect(registry.get("cannon-b")).toMatchObject({ kind: "geodesic-cannon", cellId: "top" });
    expect(registry.get("g-a")).toMatchObject({ kind: "geodesic-interval" });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(getGeodesicConnection(registry, "g-a")).toMatchObject({ state: "connected" });
  });

  it("keeps the geodesic ending in the emitter's cell at every step of a drag across two faces", () => {
    const { registry, tools } = setupCube("right", 0, 0);
    tools.startGeodesicCannonCarry("cannon-b");

    const cellsSeen = new Set<string>();
    for (let step = 1; step <= 40; step += 1) {
      // Straight down the page in the right face's frame: through its wall into the bottom face and on into the next.
      tools.updateCarriedGeodesicCannonPose(true, handAt(0.2 * step - 4, -0.45 * step));
      const emitter = registry.get("cannon-b");
      const tail = getGeodesicSegments(registry, "g-a").at(-1);
      cellsSeen.add(emitter?.cellId ?? "");
      expect(tail?.cellId, `step ${step}`).toBe(emitter?.cellId);
    }
    tools.finishGeodesicCannonCarry();

    expect(cellsSeen.size).toBeGreaterThan(1);
    expect(registry.get("g-a")).toMatchObject({ kind: "geodesic-interval" });
  });

  it("draws the glow of a carried emitter at the hand even when the emitter is on another face", () => {
    const { tools, scene } = setup();
    const glow = (): THREE.Object3D | undefined => scene.getObjectByName("carried-geodesic-emitter-glow");

    tools.startGeodesicCannonCarry("cannon-b");
    tools.updateCarriedGeodesicCannonPose(true, handAt(4.6, 3.2));
    const beside = glow()?.position.clone();
    // The player (in cell a) holds the hand past a's portal, so the emitter is stored in cell b.
    tools.updateCarriedGeodesicCannonPose(true, handAt(5.8, 3));
    const beyond = glow()?.position.clone();

    expect(glow()?.visible).toBe(true);
    expect(beside?.x).toBeCloseTo(worldPointToThree({ x: 4.6, y: 3.2, z: 0 }).x, 6);
    expect(beyond?.x).toBeCloseTo(worldPointToThree({ x: 5.8, y: 3, z: 0 }).x, 6);
    expect(beyond?.z).toBeCloseTo(worldPointToThree({ x: 5.8, y: 3, z: 0 }).z, 6);
  });

  it("turns an emitter with the face it is carried onto, its launch yaw following", () => {
    const { world, registry, tools } = setupCube("right", 0, -6);
    const toBottom = world.cellsById.get("right")?.portals.find((portal) => portal.targetCellId === "bottom");
    const faceTurn = Math.atan2(toBottom?.transformToTarget.rotation.m10 ?? 0, toBottom?.transformToTarget.rotation.m00 ?? 1);
    expect(Math.abs(faceTurn)).toBeGreaterThan(1);

    tools.startGeodesicCannonCarry("cannon-b");
    // The hand is past the wall of the right face, on the bottom face.
    tools.updateCarriedGeodesicCannonPose(true, handAt(0.2, -8.2));
    tools.updateCarriedGeodesicCannonPose(true, handAt(0.3, -8.4));

    const emitter = registry.get("cannon-b");
    if (emitter?.kind !== "geodesic-cannon") {
      throw new Error("Expected the emitter.");
    }
    const poseYaw = Math.atan2(emitter.localPose.rotation.m10, emitter.localPose.rotation.m00);

    expect(emitter.cellId).toBe("bottom");
    expect(Math.cos(poseYaw - faceTurn)).toBeCloseTo(1, 6);
    expect(Math.cos(emitter.aimYawRadians - poseYaw)).toBeCloseTo(1, 6);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });
});
