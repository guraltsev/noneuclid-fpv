/**
 * `tests/render/emitterModes.test.ts` — unit tier.
 *
 * The tool protocol of the emitter's modes (rotate, aim, carry), driven through the real tool controller, tool host and engine, with the write guard on: each starts through `world/requestTool`, then the relation, and the client enters the tool on the second `ok`. A refusal leaves the tool and the world as they were; a press while a command waits for a tick does nothing; the tool the person chose wins over an answer that arrives late. Rays never reach the world: the tools write the slot, and the fast channel acts on it in a frame with no tick too.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { participantAttachment, type EngineCommandBase, type ParticipantRecord } from "../../src/engine/moduleTypes";
import { createLocalPlayerParticipant } from "../../src/engine/participants";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createGeodesicCannonTools } from "../../src/render/three/geodesicCannonTools";
import type { RootAimRay } from "../../src/render/three/rootAimRay";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import type { AimTarget } from "../../src/interaction/aimTarget";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { createDefaultWorldModules } from "../../src/runtime/experience";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import { getGeodesicSegments } from "../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
import { afterFrame, createModeToolHost } from "../support/carryTools";
import { createTestClientSession } from "../support/clientSession";
import { createTestEngine, runFrame } from "../support/engine";

const frameSeconds = 1 / 60;
const carry = "geodesicEmitters/carry";
const rotate = "geodesicEmitters/rotate";
const aim = "geodesicEmitters/aim";

function ana(): ParticipantRecord {
  return { id: "ana", kind: "remote-player", ownerId: "device-ana", body: { ...createDefaultPlayerPose("a"), position: { x: 1.5, y: 2.5, z: 0 } }, attachments: [] };
}

/** An emitter at (1, 2.5) of room a with a free geodesic of 2 m along +x; the player stands beside it. */
function setup(options: { readonly emittersEnabled?: boolean } = {}) {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  const emitter = createGeodesicEmitterObject({ id: "cannon", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }) });
  registry.add(emitter);
  shootGeodesic({ world, registry, cannon: emitter, geodesicId: "g", maxLengthMeters: 2 });

  const session = createTestClientSession();
  const playerPose = { ...createDefaultPlayerPose("a"), position: { x: 1.5, y: 2.5, z: 0 } };
  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: createDefaultWorldModules(),
    participants: [createLocalPlayerParticipant(playerPose), ana()],
    ...(options.emittersEnabled === false ? { isToolEnabled: (toolId: string) => !toolId.startsWith("geodesicEmitters/") } : {}),
  });
  const messages: string[] = [];
  const dispatch = (command: RuntimeCommand): void => {
    applyRuntimeCommand(session, command);
  };
  const host = createModeToolHost({ engine, session, dispatch, messages, settle: (toolId, result) => tools.settleEmitterMode(toolId, result) });
  const aimed: { rootPoint?: { x: number; y: number; z: number } } = {};
  const tools = createGeodesicCannonTools({
    renderer: { xr: { isPresenting: false } } as unknown as THREE.WebGLRenderer,
    controls: { requestPointerLock: () => Promise.resolve() } as never,
    getWorld: () => world,
    session,
    engine,
    dispatch,
    toolContext: (toolId) => host.contextOf(toolId),
    resolveCurrentAimTarget: () => (aimed.rootPoint ? ({ kind: "floor", rootPoint: aimed.rootPoint } as unknown as AimTarget) : undefined),
    findFocusedRuntimeObject: () => undefined,
    syncDesktopPalette: () => undefined,
  });

  /** A frame with a tick, then the answers. */
  function tick(): void {
    runFrame(engine, frameSeconds);
    afterFrame(tools, engine, host);
  }
  /** A frame with no tick: the fast channel, then the answers (there are none). */
  function noTick(): void {
    engine.applyControls(frameSeconds);
    afterFrame(tools, engine, host);
  }
  const selected = () => session.get().menuState.selectedTool;
  const attachment = (kind: string, who = "local") => participantAttachment(engine.read.participant(who), kind);
  const yaw = () => {
    const object = registry.get("cannon");
    if (object?.kind !== "geodesicEmitters/emitter") throw new Error("the emitter is gone");
    return object.aimYawRadians;
  };
  return { world, registry, session, engine, tools, host, messages, aimed, dispatch, tick, noTick, selected, attachment, yaw };
}

const starts = [
  ["rotate", rotate, "startGeodesicCannonRotation"],
  ["aim", aim, "startGeodesicCannonAim"],
  ["carry", carry, "startGeodesicCannonCarry"],
] as const;

describe("starting an emitter's mode", () => {
  it.each(starts)("%s enters only after the world has answered the gate and the relation", (_name, toolId, start) => {
    const { tools, tick, selected } = setup();

    tools[start]("cannon");
    expect(selected()).toBe("none");
    tick();
    expect(selected()).toBe("none");
    tick();

    expect(selected()).toBe(toolId);
  });

  it.each(starts)("%s is refused with its message while emitters are disabled", (_name, _toolId, start) => {
    const { tools, tick, selected, messages, registry, attachment } = setup({ emittersEnabled: false });
    const version = registry.getVersion();

    tools[start]("cannon");
    tick();
    tick();

    expect(selected()).toBe("none");
    expect(messages).toEqual(["This tool is not available in this world."]);
    expect(registry.getVersion()).toBe(version);
    expect(attachment("carry")).toBeUndefined();
    expect(attachment("geodesicEmitters/edit")).toBeUndefined();
  });

  it.each(starts)("%s does nothing for a second press while the answer is awaited", (_name, toolId, start) => {
    const { tools, noTick, tick, selected, messages, engine, host } = setup();
    let answers = 0;
    const context = host.contextOf(toolId);
    const submit = context.submit;
    context.submit = (command: EngineCommandBase) => {
      answers += 1;
      submit(command);
    };

    tools[start]("cannon");
    noTick();
    tools[start]("cannon");
    tick();
    tools[start]("cannon");
    noTick();
    tools[start]("cannon");
    tick();

    expect(answers).toBe(2);
    expect(selected()).toBe(toolId);
    expect(messages).toEqual([]);
    expect(engine.read.participant("local")?.attachments).toHaveLength(1);
  });

  it("a pickup the world refuses leaves the geodesics and the tool as they were", () => {
    const { registry, engine, tools, tick, selected, messages, attachment } = setup();
    engine.submit("ana", { kind: "geodesicEmitters/beginEdit", emitterId: "cannon", arcId: "g" } as EngineCommandBase);
    tick();

    tools.startGeodesicCannonCarry("cannon");
    tick();
    tick();

    expect(selected()).toBe("none");
    expect(messages).toEqual(["Being edited by ana."]);
    expect(registry.get("g")).toBeDefined();
    expect(getGeodesicSegments(registry, "g").length).toBeGreaterThan(0);
    expect(attachment("carry")).toBeUndefined();
  });

  it("an edit the world refuses leaves the tool as it was", () => {
    const { engine, tools, tick, selected, messages } = setup();
    engine.submit("ana", { kind: "carry/attach", objectId: "cannon" } as EngineCommandBase);
    tick();

    tools.startGeodesicCannonRotation("cannon");
    tick();
    tick();

    expect(selected()).toBe("none");
    expect(messages).toEqual(["Already held by ana."]);
  });

  it("an accepted pickup lifts the plain geodesic and enters the tool", () => {
    const { registry, tools, tick, selected, attachment } = setup();

    tools.startGeodesicCannonCarry("cannon");
    tick();
    expect(registry.get("g")).toBeDefined();
    tick();

    expect(selected()).toBe(carry);
    expect(registry.get("g")).toBeUndefined();
    expect(attachment("carry")).toMatchObject({ objectId: "cannon" });
    expect(attachment("carry")?.activeGeodesicId).toBeUndefined();
  });

  it.each(starts)("%s stops when the person chooses another tool before the gate answers", (_name, _toolId, start) => {
    const { tools, tick, selected, dispatch, engine, registry } = setup();
    const version = registry.getVersion();

    tools[start]("cannon");
    dispatch({ kind: "select-tool", toolId: "protractor" });
    tick();
    tick();

    expect(selected()).toBe("protractor");
    expect(engine.read.participant("local")?.attachments).toEqual([]);
    expect(registry.getVersion()).toBe(version);
  });

  it.each(starts)("%s ends the relation when the person chose another tool while it was asked", (_name, _toolId, start) => {
    const { tools, tick, selected, dispatch, engine } = setup();

    tools[start]("cannon");
    tick();
    dispatch({ kind: "select-tool", toolId: "protractor" });
    tick();
    tick();

    expect(selected()).toBe("protractor");
    expect(engine.read.participant("local")?.attachments).toEqual([]);
  });

  it("a pickup abandoned after the gate has still lifted: the plain geodesic is not restored", () => {
    const { registry, tools, tick, dispatch } = setup();

    tools.startGeodesicCannonCarry("cannon");
    tick();
    dispatch({ kind: "select-tool", toolId: "protractor" });
    tick();
    tick();

    expect(registry.get("g")).toBeUndefined();
  });
});

describe("rotating and aiming", () => {
  function rotating() {
    const scene = setup();
    scene.tools.startGeodesicCannonRotation("cannon", "g");
    scene.tick();
    scene.tick();
    return scene;
  }

  it("turns the emitter and its geodesic in a frame with no tick", () => {
    const { registry, tools, noTick, yaw, engine } = rotating();
    const stepIndex = engine.read.stepIndex;

    tools.updateActiveGeodesicCannonRotation(0.5, false);
    noTick();

    expect(engine.read.stepIndex).toBe(stepIndex);
    expect(yaw()).toBeCloseTo(0.5);
    const first = getGeodesicSegments(registry, "g")[0]!;
    expect(Math.atan2(first.direction.y, first.direction.x)).toBeCloseTo(0.5);
  });

  it("adds up the turns of frames with no tick", () => {
    const { tools, noTick, yaw } = rotating();

    tools.updateActiveGeodesicCannonRotation(0.25, false);
    noTick();
    tools.updateActiveGeodesicCannonRotation(0.25, false);
    noTick();

    expect(yaw()).toBeCloseTo(0.5);
  });

  it("aims at the target through the slot, in a frame with no tick", () => {
    const scene = setup();
    scene.tools.startGeodesicCannonAim("cannon", "g");
    scene.tick();
    scene.tick();
    scene.aimed.rootPoint = { x: 1, y: 4.5, z: 0 };

    scene.tools.updateActiveGeodesicCannonAim(false, { origin: worldPointToThree({ x: 1, y: 4.5, z: 1.2 }), direction: new THREE.Vector3(0, 0, -1), quaternion: new THREE.Quaternion() } satisfies RootAimRay);
    scene.noTick();

    expect(scene.yaw()).toBeCloseTo(Math.PI / 2);
  });

  it("stays in the tool until endEdit is answered, and a second press does nothing", () => {
    const { tools, noTick, tick, selected, attachment, yaw, host } = rotating();
    let submitted = 0;
    const context = host.contextOf(rotate);
    const submit = context.submit;
    context.submit = (command: EngineCommandBase) => {
      submitted += 1;
      submit(command);
    };

    tools.updateActiveGeodesicCannonRotation(0.5, true);
    noTick();
    expect(selected()).toBe(rotate);
    expect(yaw()).toBeCloseTo(0.5);

    tools.updateActiveGeodesicCannonRotation(0.5, true);
    noTick();
    expect(yaw()).toBeCloseTo(0.5);

    tick();
    expect(submitted).toBe(1);
    expect(selected()).toBe("none");
    expect(attachment("geodesicEmitters/edit")).toBeUndefined();
  });

  it("tells the world when the tool was left some other way", () => {
    const { tools, tick, dispatch, selected, attachment } = rotating();

    dispatch({ kind: "select-tool", toolId: "protractor" });
    tools.updateCarriedGeodesicCannonPose(false, undefined);
    tick();

    expect(selected()).toBe("protractor");
    expect(attachment("geodesicEmitters/edit")).toBeUndefined();
  });

  it("switches from rotate to aim on the same emitter, keeping the relation", () => {
    const { tools, tick, selected, attachment } = rotating();

    tools.startGeodesicCannonAim("cannon", "g");
    tick();
    tick();

    expect(selected()).toBe(aim);
    tools.updateCarriedGeodesicCannonPose(false, undefined);
    tick();
    expect(attachment("geodesicEmitters/edit")).toMatchObject({ objectId: "cannon" });
  });

  it("turns the attached emitter from its own yaw when the selection moves to another", () => {
    const { registry, tools, noTick, yaw, dispatch } = rotating();
    registry.add(createGeodesicEmitterObject({ id: "other", cellId: "a", localPose: yawRigidTransform3(2, { x: 3, y: 4, z: 0 }) }));
    dispatch({ kind: "set-cannon-tool-state", state: { selectedCannonId: "other" } });

    tools.updateActiveGeodesicCannonRotation(0.5, false);
    noTick();

    expect(yaw()).toBeCloseTo(0.5);
    expect(registry.get("other")).toMatchObject({ aimYawRadians: 2 });
  });

  it("aims the attached emitter, not the selected one", () => {
    const scene = setup();
    scene.tools.startGeodesicCannonAim("cannon", "g");
    scene.tick();
    scene.tick();
    scene.registry.add(createGeodesicEmitterObject({ id: "other", cellId: "a", localPose: yawRigidTransform3(0, { x: 3, y: 2.5, z: 0 }) }));
    scene.dispatch({ kind: "set-cannon-tool-state", state: { selectedCannonId: "other" } });
    scene.aimed.rootPoint = { x: 1, y: 4.5, z: 0 };

    scene.tools.updateActiveGeodesicCannonAim(false, { origin: worldPointToThree({ x: 1, y: 4.5, z: 1.2 }), direction: new THREE.Vector3(0, 0, -1), quaternion: new THREE.Quaternion() } satisfies RootAimRay);
    scene.noTick();

    expect(scene.yaw()).toBeCloseTo(Math.PI / 2);
  });

  it("leaves the tool when the emitter is gone", () => {
    const { engine, tools, tick, selected, attachment } = rotating();
    engine.submit("local", { kind: "geodesicEmitters/remove", emitterId: "cannon" } as EngineCommandBase);
    tick();

    tools.updateActiveGeodesicCannonRotation(0.5, false);
    expect(selected()).toBe("none");

    tools.updateCarriedGeodesicCannonPose(false, undefined);
    tick();
    expect(attachment("geodesicEmitters/edit")).toBeUndefined();
  });
});

describe("putting a carried emitter down", () => {
  function carrying() {
    const scene = setup();
    scene.tools.startGeodesicCannonCarry("cannon");
    scene.tick();
    scene.tick();
    return scene;
  }

  it("stays in the tool until detach is answered, and a second press does nothing", () => {
    const { tools, noTick, tick, selected, attachment, host } = carrying();
    let submitted = 0;
    const context = host.contextOf(carry);
    const submit = context.submit;
    context.submit = (command: EngineCommandBase) => {
      submitted += 1;
      submit(command);
    };

    expect(tools.finishGeodesicCannonCarry()).toBe(true);
    noTick();
    expect(selected()).toBe(carry);
    expect(tools.finishGeodesicCannonCarry()).toBe(true);
    tick();

    expect(submitted).toBe(1);
    expect(selected()).toBe("none");
    expect(attachment("carry")).toBeUndefined();
  });
});
