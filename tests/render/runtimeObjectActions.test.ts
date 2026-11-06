/**
 * `tests/render/runtimeObjectActions.test.ts` — unit tier.
 *
 * `createRuntimeObjectActions` holds what the player does to runtime objects through the aim and the home button. These
 * tests drive the handle with a shell session, a real registry and a compiled one-room world, and stub the
 * rest of the shell: placing a sign from a floor aim adds a `placed-flag` record and ends the tool, a non-floor aim places
 * nothing, going home dispatches the world's starting pose and clears the rig, and teleporting home first cancels an open
 * menu.
 */
import { readLocalPlayerPose } from "../../src/engine/worldEngine";
import { createTestEngine } from "../support/engine";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import type { ClientSessionState } from "../../src/runtime/clientSession";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createRuntimeObjectActions } from "../../src/render/three/runtimeObjectActions";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import { createTestClientSession } from "../support/clientSession";

const world = compileCellComplex({
  startingPosition: { cellId: "room", position: { x: 1, y: 2, z: 0 }, yawRadians: 0.5 },
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
});

const aimRay: RootAimRay = {
  origin: new THREE.Vector3(0, 1.6, 0),
  direction: new THREE.Vector3(0, -1, 0),
  quaternion: new THREE.Quaternion(),
};

const floorTarget: AimTarget = {
  kind: "floor",
  cellId: "room",
  localEyePosition: { x: 0, y: -2, z: 1.6 },
  localPoint: { x: 1, y: 0.5, z: 0 },
  localNormal: { x: 0, y: 0, z: 1 },
  rootPoint: { x: 1, y: 0.5, z: 0 },
  rootNormal: { x: 0, y: 0, z: 1 },
  distanceMeters: 2,
  hopCount: 0,
};

function createHarness(target: AimTarget | undefined, sessionOverrides: Partial<ClientSessionState> = {}) {
  const session = createTestClientSession(sessionOverrides);
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({ registry, playerPose: createDefaultPlayerPose("room") });
  const commands: RuntimeCommand[] = [];
  const syncedFlagIds: string[] = [];
  const rigResets = vi.fn();
  const none = vi.fn();
  const actions = createRuntimeObjectActions({
    session,
    engine,
    dispatch: (command) => commands.push(command),
    runtimeObjectRegistry: registry,
    getWorld: () => world,
    appConfig: defaultAppConfig,
    initialPlayerPose: createDefaultPlayerPose("room"),
    xrRig: { reset: rigResets },
    objectHost: { placeAt: () => false },
    dynamicObjectRuntimes: [],
    cellMeshes: new Map(),
    staticAssetOwners: [],
    resolveCurrentAimTarget: () => target,
    targetIsWithinInteractionRange: () => true,
    logVerboseAimClick: none,
    findFocusedRuntimeObject: () => undefined,
    extendGeodesic: () => false,
    getGeodesicDisplayName: (geodesicId) => geodesicId,
    getGeodesicLabelsById: () => ({}),
    getConnectedGeodesicIds: () => [],
    objectActionsFor: () => [],
    createGeometryComputerMenuOptions: () => {
      throw new Error("not used");
    },
    syncPlacedFlagRuntime: (flag) => syncedFlagIds.push(flag.id),
    removePlacedFlagRuntime: none,
    syncMeasuredGeodesicLengthRuntime: none,
    removeMeasuredGeodesicLengthRuntime: none,
    syncProtractorAngleRuntime: none,
    removeProtractorAngleRuntime: none,
    removePlacedFlags: none,
    removeMeasuredGeodesicLengths: none,
    removeProtractorAngles: none,
    removeGeodesicRuntimeObjects: none,
    syncSelectableHitboxDebug: none,
    syncDesktopPalette: none,
    clearProtractorToolFeedback: none,
    resolveProtractorDirectedSelectionFromAimTarget: () => undefined,
  });
  return { actions, registry, commands, syncedFlagIds, rigResets, engine };
}

describe("createRuntimeObjectActions", () => {
  it("places a sign at the aimed floor point and ends the placing tool", () => {
    const { actions, registry, commands, syncedFlagIds } = createHarness(floorTarget);

    actions.tryPlaceFlagFromAim(aimRay);

    const flags = registry.getAll().filter((object) => object.kind === "placedFlags/flag");
    expect(flags).toHaveLength(1);
    expect(flags[0].cellId).toBe("room");
    expect(flags[0].localPose.translation).toEqual({ x: 1, y: 0.5, z: 0 });
    expect(syncedFlagIds).toEqual([flags[0].id]);
    expect(commands).toContainEqual({ kind: "clear-selected-tool" });
  });

  it("closes the menu when a tool asks for the page of an emitter that is gone", () => {
    const { actions, commands } = createHarness(undefined);

    actions.showObjectPage("gone");

    expect(commands).toEqual([{ kind: "close-menu" }]);
  });

  it("places nothing when the aim hits something other than the floor", () => {
    const { actions, registry, commands } = createHarness({ ...floorTarget, kind: "object" });

    actions.tryPlaceFlagFromAim(aimRay);

    expect(registry.getAll()).toEqual([]);
    expect(commands).toEqual([]);
  });

  it("places nothing without an aim ray", () => {
    const { actions, registry } = createHarness(floorTarget);

    actions.tryPlaceFlagFromAim(undefined);

    expect(registry.getAll()).toEqual([]);
  });

  it("sends the player to the starting position and resets the rig", () => {
    const { actions, engine, rigResets } = createHarness(undefined);

    actions.resetPlayerToHome();

    expect(readLocalPlayerPose(engine)).toEqual({ cellId: "room", position: { x: 1, y: 2, z: 0 }, yawRadians: 0.5, pitchRadians: 0 });
    expect(rigResets).toHaveBeenCalledTimes(1);
  });

  it("cancels an open menu before teleporting home", () => {
    const menuState = { ...createRuntimeMenuState({ selectedWorldId: "test" }), isOpen: true };
    const { actions, commands, engine } = createHarness(undefined, { menuState });
    const publish = engine.publishBody.bind(engine);
    const commandsWhenPublished: number[] = [];
    engine.publishBody = (participantId, body) => {
      commandsWhenPublished.push(commands.length);
      return publish(participantId, body);
    };

    actions.teleportPlayerHome();

    expect(commandsWhenPublished).toEqual([1]);

    expect(commands.map((command) => command.kind)).toEqual(["cancel-menu-and-tool"]);
    expect(readLocalPlayerPose(engine).position).toEqual({ x: 1, y: 2, z: 0 });
  });

  it("rejects a debug pose in a cell the world does not have", () => {
    const { actions, commands } = createHarness(undefined);

    expect(() => actions.debugSetPlayerPose("nowhere", 0, 0, 0)).toThrow(/no cell "nowhere"/);
    expect(commands).toEqual([]);
  });
});
