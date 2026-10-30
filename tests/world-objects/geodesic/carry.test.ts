import { describe, expect, it } from "vitest";
import { moveDynamicObject } from "../.././../src/movement/moveDynamicObject";
import {
  createRuntimeObjectRegistry,
  runtimeObjectToDynamicObjectState,
} from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamStartOffsetMeters,
} from "../../../src/world-objects/geodesic/objects";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { getGeodesicConnection, isGeodesicLocked } from "../../../src/world-objects/geodesic/lifecycle";
import { liftGeodesicEndpoint } from "../../../src/world-objects/geodesic/endpoints";
import { rebuildConnectedGeodesicBetweenEmitters, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import {
  updateLockedGeodesicPortalWordForCarriedAnchorTraversal,
  updateLockedGeodesicPortalWordForCarriedAnchorTraversals,
} from "../../../src/world-objects/geodesic/intervals";
import { applyAnchorCrossingTraversals } from "../../../src/world-objects/geodesic/portalWord";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import {
  totalGeodesicLength,
  getCannonGeodesicIds,
  getCannonGeodesicYaw,
  getCannonPoseYaw,
  normalizeYaw,
  createCarryPortalTransition,
  createCarryPortalTraversal,
  compileLargePortalWorld,
  compileThreeCellPortalWorld,
  compileTorusLoopWorld,
  compileTwoCellCylinderWorld,
} from "./fixtures";

describe("geodesic cannon world objects: carry", () => {
  it("ignores stale carried portal transitions that do not match the carried endpoint move", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0.75, y: 1, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 2.75, y: 1, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    const beforeMove = registry.get("cannon-b");
    if (beforeMove?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...beforeMove,
      localPose: yawRigidTransform3(Math.PI, { x: 3, y: 1.25, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: beforeMove,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "a", "ab"),
      carriedPortalWord: [createCarryPortalTraversal(world, "a", "ab")],
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("rebuilds locked emitter-to-emitter geodesics after an endpoint moves across a portal", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 3, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });
    const expectedYaw = Math.atan2(0.5, 2);

    expect(rebuilt.map((segment) => segment.cellId)).toEqual(["a", "b"]);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(Math.hypot(2, 0.5) - geodesicRayBeamStartOffsetMeters);
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(expectedYaw);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps the portal clone while carrying a locked endpoint in a wrapping cell", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 4, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: -4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 8 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: -3.5, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
    });

    expect(rebuilt.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.map((segment) => segment.cellId).every((cellId) => cellId === "torus-room")).toBe(true);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(0);
  });

  it("does not unlock or hide a carried geodesic when the direct clone is too short", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 4, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: -4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 8 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 4.05, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    const sourceYaw = Math.atan2(rebuilt[0]?.direction.y ?? 0, rebuilt[0]?.direction.x ?? 1);
    expect(getCannonPoseYaw(registry, "cannon-a")).toBeCloseTo(sourceYaw);
    expect(getCannonPoseYaw(registry, "cannon-b")).toBeCloseTo(normalizeYaw(sourceYaw + Math.PI));
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("derives a same-cell portal carry transition from the carried endpoint motion", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 5, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: 7.4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "torus-room",
    }));

    registry.update({
      ...incoming,
      localPose: yawRigidTransform3(Math.PI, { x: -7.4, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: incoming,
    });

    expect(rebuilt.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "torus-room",
      sourcePortalId: "right-left",
      targetCellId: "torus-room",
      targetPortalId: "left-right",
    }]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps the portal word unchanged during same-cell fixed-face carry without player traversal", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "torus-room",
    }));

    registry.update({
      ...incoming,
      localPose: yawRigidTransform3(Math.PI, { x: 2.5, y: 0.25, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: incoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps a carried endpoint connected when it crosses back through the portal", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const carryWord = [
      ...collectGeodesicPortalWord(world, registry, "g-a"),
      createCarryPortalTraversal(world, "b", "ba"),
    ];
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "b", "ba"),
      carriedPortalWord: carryWord,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-a"]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
  });

  it("updates a locked interval portal word from carried endpoint player traversal before rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);

    registry.update({
      ...incoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const nextWord = updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
      registry,
      geodesicId: "g-a",
      carriedAnchorObjectId: "cannon-b",
      traversal: createCarryPortalTraversal(world, "b", "ba"),
    });
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });

    expect(nextWord).toEqual([]);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("normalizes an out-of-cell carried emitter through one portal on release before final rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5.2, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const releaseMove = moveDynamicObject({
      world,
      object: runtimeObjectToDynamicObjectState(incoming),
      displacement: { x: 0, y: 0, z: 0 },
      ignoreForbiddenZones: true,
    });
    expect(releaseMove.crossedPortal).toBe(true);
    expect(releaseMove.crossedPortalId).toBe("ab");
    registry.update({
      ...incoming,
      cellId: releaseMove.object.cellId,
      localPose: releaseMove.object.localPose,
    });

    const nextWord = updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
      registry,
      geodesicId: "g-a",
      carriedAnchorObjectId: "cannon-b",
      traversal: createCarryPortalTraversal(world, "a", "ab"),
    });
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });

    expect(nextWord).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);
    expect(rebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("rebuilds a live carried geodesic to a formal out-of-bounds emitter without mutating the word", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5.2, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const strictRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });
    expect(strictRebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(liveRebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(liveRebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");
  });

  it("preserves a locked interval after a failed live carry rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
      portalWord: [{
        sourceCellId: "a",
        sourcePortalId: "missing",
        targetCellId: "b",
        targetPortalId: "ba",
      }],
    }));

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });

    expect(liveRebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");

    const finalRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
    });

    expect(finalRebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
  });

  it("destroys a locked interval during live carry when the rebuilt path crosses a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(liveRebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
    expect(getGeodesicSegments(registry, "g-a")).toEqual([]);
  });

  it("derives a different-cell portal carry transition from endpoint cells without player transition state", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

    const previousIncoming = registry.get("cannon-b");
    if (previousIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...previousIncoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: previousIncoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps a carried endpoint connected after the final drop rebuild", () => {
    const world = compileThreeCellPortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "front",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "left",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "front",
      sourcePortalId: "front-left",
      targetCellId: "left",
      targetPortalId: "left-front",
    }]);

    const previousIncoming = registry.get("cannon-b");
    if (previousIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    const carriedIncoming = {
      ...previousIncoming,
      cellId: "back",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    };
    registry.update(carriedIncoming);

    const carryWord = [
      ...collectGeodesicPortalWord(world, registry, "g-a"),
      createCarryPortalTraversal(world, "left", "left-back"),
    ];
    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: previousIncoming,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "left", "left-back"),
      carriedPortalWord: carryWord,
    });
    expect(liveRebuilt.length).toBeGreaterThan(0);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);

    const dropRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedPortalWord: carryWord,
    });

    expect(dropRebuilt.length).toBeGreaterThan(0);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-a"]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual(carryWord);
  });

  describe("loop words under anchor portal crossings (job 05)", () => {
    const torusLoopSetup = (startY: number, wordIds: readonly string[]) => {
      const world = compileTorusLoopWorld();
      const registry = createRuntimeObjectRegistry();
      const cannon = createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "torus-room",
        localPose: yawRigidTransform3(0, { x: 0, y: startY, z: 0 }),
      });
      registry.add(cannon);
      registry.add(createGeodesicIntervalObject({
        id: "g-loop",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-a",
        startCellId: "torus-room",
        portalWord: wordIds.map((id) => createCarryPortalTraversal(world, "torus-room", id)),
      }));
      return { world, registry, cannon };
    };

    it("conjugates a same-emitter torus loop when its emitter is carried across the top portal", () => {
      const { world, registry, cannon } = torusLoopSetup(6, ["top-bottom", "right-left"]);
      const py = createCarryPortalTraversal(world, "torus-room", "top-bottom");
      const px = createCarryPortalTraversal(world, "torus-room", "right-left");
      rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15 * Math.SQRT2, 6);

      registry.update({ ...cannon, localPose: yawRigidTransform3(0, { x: 0, y: -7.4, z: 0 }) });
      expect(updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
        registry,
        geodesicId: "g-loop",
        carriedAnchorObjectId: "cannon-a",
        traversal: py,
      })).toEqual([px, py]);
      rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });

      const segments = getGeodesicSegments(registry, "g-loop");
      expect(segments).toHaveLength(3);
      expect(segments[segments.length - 1].terminal).toMatchObject({ kind: "emitter-hit", emitterId: "cannon-a" });
      expect(collectGeodesicPortalWord(world, registry, "g-loop")).toEqual([px, py]);
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15 * Math.SQRT2, 6);
    });

    it("folds two crossings of one frame in order, like two single updates (job 13 part C)", () => {
      const sequential = torusLoopSetup(6, ["top-bottom", "right-left"]);
      const combined = torusLoopSetup(6, ["top-bottom", "right-left"]);
      const py = createCarryPortalTraversal(sequential.world, "torus-room", "top-bottom");
      const px = createCarryPortalTraversal(sequential.world, "torus-room", "right-left");
      const common = { geodesicId: "g-loop", carriedAnchorObjectId: "cannon-a" } as const;

      updateLockedGeodesicPortalWordForCarriedAnchorTraversal({ registry: sequential.registry, ...common, traversal: py });
      const expected = updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
        registry: sequential.registry,
        ...common,
        traversal: px,
      });
      const folded = updateLockedGeodesicPortalWordForCarriedAnchorTraversals({
        registry: combined.registry,
        ...common,
        traversals: [py, px],
      });

      expect(expected).toBeDefined();
      expect(folded).toEqual(expected);
      expect(combined.registry.get("g-loop")).toMatchObject({ portalWord: expected });
    });

    it("applies one anchor-crossing traversal per crossing in order (curve shortening loop, job 13 part C)", () => {
      const { world, registry } = torusLoopSetup(6, ["top-bottom"]);
      const interval = registry.get("g-loop");
      if (interval?.kind !== "geodesic-interval") {
        throw new Error("expected an interval");
      }
      const py = createCarryPortalTraversal(world, "torus-room", "top-bottom");
      const px = createCarryPortalTraversal(world, "torus-room", "right-left");
      const input = { interval, anchorObjectId: "cannon-a" } as const;

      const once = applyAnchorCrossingTraversals({ ...input, traversals: [px] });
      const twice = applyAnchorCrossingTraversals({ ...input, traversals: [px, py] });
      const second = applyAnchorCrossingTraversals({ interval: { ...interval, portalWord: once ?? [] }, anchorObjectId: "cannon-a", traversals: [py] });

      expect(once).toBeDefined();
      expect(twice).toEqual(second);
      expect(applyAnchorCrossingTraversals({ ...input, anchorObjectId: "someone-else", traversals: [px, py] })).toBeUndefined();
    });

    it("conjugates a torus loop when the crossing is inferred from the emitter's motion", () => {
      const { world, registry, cannon: before } = torusLoopSetup(7.4, ["top-bottom", "right-left"]);
      const py = createCarryPortalTraversal(world, "torus-room", "top-bottom");
      const px = createCarryPortalTraversal(world, "torus-room", "right-left");
      rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });

      registry.update({ ...before, localPose: yawRigidTransform3(0, { x: 0, y: -7.4, z: 0 }) });
      rebuildConnectedGeodesicBetweenEmitters({
        world,
        registry,
        geodesicId: "g-loop",
        carriedEmitterId: "cannon-a",
        carriedEmitterBeforeMove: before,
      });

      expect(registry.get("g-loop")).toMatchObject({ kind: "geodesic-interval", portalWord: [px, py] });
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15 * Math.SQRT2, 6);
    });

    it("fails to rebuild a horizontal torus loop carried across the perpendicular portal instead of making it diagonal", () => {
      const { world, registry, cannon } = torusLoopSetup(6, ["right-left"]);
      const py = createCarryPortalTraversal(world, "torus-room", "top-bottom");
      const px = createCarryPortalTraversal(world, "torus-room", "right-left");
      rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15, 6);

      registry.update({ ...cannon, localPose: yawRigidTransform3(0, { x: 0, y: -7.4, z: 0 }) });
      expect(updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
        registry,
        geodesicId: "g-loop",
        carriedAnchorObjectId: "cannon-a",
        traversal: py,
      })).toEqual([createCarryPortalTraversal(world, "torus-room", "bottom-top"), px, py]);

      expect(rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" })).toEqual([]);
      expect(registry.get("g-loop")).toBeUndefined();
    });

    it("keeps a same-emitter loop through a portal crossing in a two-cell world", () => {
      for (const mode of ["explicit", "inferred"] as const) {
        const world = compileTwoCellCylinderWorld();
        const registry = createRuntimeObjectRegistry();
        const before = createGeodesicCannonObject({
          id: "cannon-a",
          cellId: "a",
          localPose: yawRigidTransform3(0, { x: 4.9, y: 2.5, z: 0 }),
        });
        registry.add(before);
        const ab = createCarryPortalTraversal(world, "a", "ab");
        const bRight = createCarryPortalTraversal(world, "b", "b-right");
        registry.add(createGeodesicIntervalObject({
          id: "g-loop",
          startAnchorObjectId: "cannon-a",
          endAnchorObjectId: "cannon-a",
          startCellId: "a",
          portalWord: [ab, bRight],
        }));
        rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });
        expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(10, 6);

        registry.update({ ...before, cellId: "b", localPose: yawRigidTransform3(0, { x: 0.1, y: 2.5, z: 0 }) });
        if (mode === "explicit") {
          expect(updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
            registry,
            geodesicId: "g-loop",
            carriedAnchorObjectId: "cannon-a",
            traversal: ab,
          })).toEqual([bRight, ab]);
          rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });
        } else {
          rebuildConnectedGeodesicBetweenEmitters({
            world,
            registry,
            geodesicId: "g-loop",
            carriedEmitterId: "cannon-a",
            carriedEmitterBeforeMove: before,
          });
        }

        expect(registry.get("g-loop")).toMatchObject({
          kind: "geodesic-interval",
          startCellId: "b",
          cellId: "b",
          portalWord: [bRight, ab],
        });
        expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(10, 6);
      }
    });

    it("refuses to lift an interval whose word does not chain between its anchors' cells", () => {
      const world = compileLargePortalWorld();
      const registry = createRuntimeObjectRegistry();
      registry.add(createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
      }));
      registry.add(createGeodesicCannonObject({
        id: "cannon-b",
        cellId: "b",
        localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
      }));
      const bad = createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-b",
        startCellId: "a",
        portalWord: [],
      });
      expect(liftGeodesicEndpoint({ world, registry, interval: bad, sourceRole: "start" })).toBeUndefined();
      expect(liftGeodesicEndpoint({ world, registry, interval: bad, sourceRole: "end" })).toBeUndefined();

      const good = createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-b",
        startCellId: "a",
        portalWord: [createCarryPortalTraversal(world, "a", "ab")],
      });
      const lifted = liftGeodesicEndpoint({ world, registry, interval: good, sourceRole: "start" });
      expect(lifted?.targetPointInSourceCell.x).toBeCloseTo(6, 6);
    });

    it("reduces the portal word when an interval is created", () => {
      const world = compileLargePortalWorld();
      const interval = createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-b",
        startCellId: "a",
        portalWord: [
          createCarryPortalTraversal(world, "a", "ab"),
          createCarryPortalTraversal(world, "b", "ba"),
        ],
      });
      expect(interval.portalWord).toEqual([]);
    });
  });
});
