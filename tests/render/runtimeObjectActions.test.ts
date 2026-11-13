/**
 * `tests/render/runtimeObjectActions.test.ts` — unit tier.
 *
 * `createRuntimeObjectActions` holds what the player does to runtime objects through the aim and the home button. These
 * tests drive the handle with a shell session, a real registry and a compiled one-room world, and stub the
 * rest of the shell: typing on a sign asks the world, the text growing before it answers, going home dispatches the world's
 * starting pose and clears the rig, and teleporting home first cancels an open menu.
 */
import { readLocalPlayerPose } from "../../src/engine/worldEngine";
import { createTestEngine } from "../support/engine";
import { describe, expect, it, vi } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import type { ClientSessionState } from "../../src/runtime/clientSession";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { createRuntimeObjectRegistry, createRuntimeStaticAssetObject } from "../../src/world-objects/runtimeObjectRegistry";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import { createRuntimeObjectActions } from "../../src/render/three/runtimeObjectActions";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
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

function createHarness(target: AimTarget | undefined, sessionOverrides: Partial<ClientSessionState> = {}) {
  const session = createTestClientSession(sessionOverrides);
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({ registry, playerPose: createDefaultPlayerPose("room") });
  const commands: RuntimeCommand[] = [];
  const messages: (readonly [string, string])[] = [];
  const removedFlags: string[] = [];
  const takenTools: string[] = [];
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
    getGeodesicLabelsById: () => ({}),
    getConnectedGeodesicIds: () => [],
    objectActionsFor: () => [],
    createGeometryComputerMenuOptions: () => {
      throw new Error("not used");
    },
    setFlagMessage: (flagId, message) => void messages.push([flagId, message]),
    removeFlag: (flagId) => void removedFlags.push(flagId),
    takeStandTool: (toolId) => void takenTools.push(toolId),
    removeLength: none,
    removeAngle: none,
    removeGeodesicRuntimeObjects: none,
    clearProtractorToolFeedback: none,
  });
  return { actions, registry, commands, messages, removedFlags, takenTools, rigResets, engine };
}

describe("createRuntimeObjectActions", () => {
  function editingSign() {
    const flag = createPlacedFlagObject({ id: "flag", cellId: "room", localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }), flagType: "WoodenSign1", message: "A1" });
    const menuState = { ...createRuntimeMenuState({ selectedWorldId: "test" }), isOpen: true, editSignOptions: { flagId: flag.id, message: flag.message } };
    const harness = createHarness(undefined, { menuState });
    harness.registry.add(flag);
    return harness;
  }

  it("asks the world for each key of a sign, and writes nothing itself", () => {
    const { actions, registry, commands, messages } = editingSign();
    const version = registry.getVersion();

    actions.appendEditingSignCharacter("B");
    actions.backspaceEditingSignMessage();

    // The stub of `dispatch` leaves the page as it is: both keys act on "A1".
    expect(messages).toEqual([["flag", "A1B"], ["flag", "A"]]);
    expect(commands).toEqual([{ kind: "set-editing-sign-message", message: "A1B" }, { kind: "set-editing-sign-message", message: "A" }]);
    expect(registry.getVersion()).toBe(version);
  });

  it("closes the page of a sign that is gone, asking nothing", () => {
    const { actions, registry, commands, messages, removedFlags } = editingSign();
    registry.remove("flag");

    actions.appendEditingSignCharacter("B");
    actions.deleteEditingSign();

    expect(messages).toEqual([]);
    expect(removedFlags).toEqual([]);
    expect(commands).toEqual([{ kind: "close-menu" }, { kind: "close-menu" }]);
  });

  it("asks the world to delete the sign, and closes the page", () => {
    const { actions, registry, commands, removedFlags } = editingSign();
    const version = registry.getVersion();

    actions.deleteEditingSign();

    expect(removedFlags).toEqual(["flag"]);
    expect(commands).toEqual([{ kind: "close-menu" }]);
    expect(registry.getVersion()).toBe(version);
  });

  it("closes the menu when a tool asks for the page of an emitter that is gone", () => {
    const { actions, commands } = createHarness(undefined);

    actions.showObjectPage("gone");

    expect(commands).toEqual([{ kind: "close-menu" }]);
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

  it("takes the tool of a tool stand item when it is used, and opens nothing", () => {
    const item = createRuntimeStaticAssetObject(
      { id: "item", kind: "asset", assetPath: "toolstand/laser.glb", position: { x: 1, y: 1, z: 0.6 }, standsTool: "geodesicEmitters/emitter" },
      "room",
    );
    const { actions, registry, commands, takenTools } = createHarness({ object: item } as unknown as AimTarget);
    registry.add(item);

    const used = actions.tryUseFocusedObjectPrimaryInteraction({} as RootAimRay);

    expect(used).toBe(true);
    expect(takenTools).toEqual(["geodesicEmitters/emitter"]);
    expect(commands).toEqual([]);
  });

  it("rejects a debug pose in a cell the world does not have", () => {
    const { actions, commands } = createHarness(undefined);

    expect(() => actions.debugSetPlayerPose("nowhere", 0, 0, 0)).toThrow(/no cell "nowhere"/);
    expect(commands).toEqual([]);
  });
});
