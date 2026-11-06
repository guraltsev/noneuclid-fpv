/**
 * `tests/modules/geodesicEmitters/edit.test.ts` — unit tier.
 *
 * The edit relation of the geodesic emitters module and the intended length of a free geodesic, driven through the world engine alone, with the write guard on: `beginEdit` and `endEdit` are commands, the absolute yaw is the control slot `geodesicEmitters/yaw`, and the re-trace runs in `applyControls`, in a frame with no tick too.
 * A free geodesic is a laser of a certain power: a wall or a junction's zone stops the trace and not the intention, so it grows back as soon as nothing stands in the way, across edits.
 */
import { describe, expect, it, vi } from "vitest";
import { participantAttachment, type CommandResult, type EngineCommandBase, type ParticipantRecord } from "../../../src/engine/moduleTypes";
import { createLocalPlayerParticipant } from "../../../src/engine/participants";
import { createDefaultPlayerPose } from "../../../src/movement/playerPose";
import { geodesicEmitterEditAttachmentKind, geodesicEmitterYawSlot, type GeodesicEmittersResult } from "../../../src/modules/geodesicEmitters/api";
import { createDefaultWorldModules } from "../../../src/runtime/experience";
import { arcConnectsEmitters } from "../../../src/world-objects/geodesic/lifecycle";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { arcsAtVertex } from "../../../src/world-objects/geodesic/endpoints";
import { previewVertexRemoval, removeVertex } from "../../../src/world-objects/geodesic/vertices";
import { compileLargePortalWorld, createSymmetricPairScenario, createTorusTiedPairScenario, totalGeodesicLength } from "../../fixtures/world-objects/geodesic";
import { createTestEngine, runFrame } from "../../support/engine";

const frameSeconds = 1 / 60;
// From (1, 2.5) of room a: this yaw runs into the junction at the corner (5, 0), and yaw pi into the wall at x = 0.
const cornerYaw = Math.atan2(-2.5, 4);
const wallYaw = Math.PI;
const lengthMeters = 4.7;

function ana(): ParticipantRecord {
  return { id: "ana", kind: "remote-player", ownerId: "device-ana", body: { ...createDefaultPlayerPose("a"), position: { x: 1.5, y: 2.5, z: 0 } }, attachments: [] };
}

/** Room a with an emitter at (1, 2.5) and a free geodesic of 4.7 m along +x, through the portal into room b; the local player and Ana stand beside it. */
function setup() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  const playerPose = { ...createDefaultPlayerPose("a"), position: { x: 1.5, y: 2.5, z: 0 } };
  let worldIsBroken = false;
  const getWorld = () => (worldIsBroken ? ({} as typeof world) : world);
  const engine = createTestEngine({ registry, getWorld, modules: createDefaultWorldModules(), participants: [createLocalPlayerParticipant(playerPose), ana()] });

  function run(command: EngineCommandBase, who = "local"): CommandResult {
    const ticket = engine.submit(who, command);
    runFrame(engine, frameSeconds);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function value(command: EngineCommandBase): GeodesicEmittersResult {
    const result = run(command);
    if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
    return result.value as GeodesicEmittersResult;
  }
  const placed = value({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 1, y: 2.5, z: 0 }, yawRadians: 0 } as EngineCommandBase);
  const { emitterId } = placed;
  const shot = value({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: 0, lengthMeters } as EngineCommandBase);
  if (shot.outcome !== "shot") throw new Error("expected a shot");
  const arcId = shot.arcId;

  const arc = () => {
    const object = registry.get(arcId);
    if (object?.kind !== "geodesicModel/arc") throw new Error("the arc is gone");
    return object;
  };
  const emitter = () => {
    const object = registry.get(emitterId);
    if (object?.kind !== "geodesicEmitters/emitter") throw new Error("the emitter is gone");
    return object;
  };
  /** One frame with no tick: the slot is written and the fast channel runs, as in `applyControls` of the shell. */
  function frameWithNoTick(yawRadians: number, who = "local"): void {
    engine.setControl(who, geodesicEmitterYawSlot, yawRadians);
    engine.applyControls(frameSeconds);
  }
  /** A whole edit that turns the emitter to `yawRadians` and ends there. */
  function editTo(yawRadians: number): void {
    expect(run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase)).toEqual({ ok: true });
    frameWithNoTick(yawRadians);
    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });
  }
  const edit = (who = "local") => participantAttachment(engine.read.participant(who), geodesicEmitterEditAttachmentKind);
  /** From now on every trace throws: what no expected failure does. */
  const breakWorld = () => void (worldIsBroken = true);
  return { world, registry, engine, emitterId, arcId, arc, emitter, run, value, frameWithNoTick, editTo, edit, breakWorld };
}

describe("a free geodesic's intended length", () => {
  it("is set by shoot, and the real path is what a length reports", () => {
    const { registry, arc, arcId } = setup();

    expect(arc().intendedLengthMeters).toBe(lengthMeters);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(lengthMeters);
  });

  it.each([
    ["a corner", cornerYaw, "forbidden-zone-hit"],
    ["a wall", wallYaw, "wall-hit"],
  ])("survives the end of the edit stopped at %s, and the next edit grows it back", (_name, yaw, terminal) => {
    const { registry, arc, arcId, editTo } = setup();

    editTo(yaw);
    expect(getGeodesicSegments(registry, arcId).at(-1)?.terminal.kind).toBe(terminal);
    expect(totalGeodesicLength(registry, arcId)).toBeLessThan(lengthMeters);
    expect(arc().intendedLengthMeters).toBe(lengthMeters);

    editTo(0);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(lengthMeters);
    expect(getGeodesicSegments(registry, arcId).at(-1)?.terminal.kind).toBe("open");
  });

  it("is raised by extend", () => {
    const { registry, run, arc, arcId } = setup();

    expect(run({ kind: "geodesicEmitters/extend", arcId, lengthMeters: 1 } as EngineCommandBase)).toMatchObject({ ok: true });

    expect(arc().intendedLengthMeters).toBeCloseTo(lengthMeters + 1);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(lengthMeters + 1);
  });

  it("goes on with the continuation when a stopped geodesic is cut", () => {
    const { registry, value, editTo, arcId } = setup();
    editTo(cornerYaw);
    const segment = getGeodesicSegments(registry, arcId)[0]!;
    const point = { x: segment.start.x + segment.direction.x, y: segment.start.y + segment.direction.y, z: 0 };

    const placed = value({ kind: "geodesicEmitters/place", cellId: "a", point, yawRadians: 0 } as EngineCommandBase);

    if (placed.outcome !== "placed") throw new Error("expected a placement");
    const continuation = registry.get(placed.arcIds.find((id) => id !== arcId)!);
    expect(continuation).toMatchObject({ kind: "geodesicModel/arc" });
    expect((continuation as { readonly intendedLengthMeters: number }).intendedLengthMeters).toBeCloseTo(lengthMeters - 1);
    expect(getGeodesicSegments(registry, continuation!.id).at(-1)?.terminal.kind).toBe("forbidden-zone-hit");
  });

  it("is the sum of the real lengths on an arc merged at a taut vertex", () => {
    const { world, registry } = createSymmetricPairScenario(2, 0);
    const preview = previewVertexRemoval(world, registry, { vertexId: "free", arcs: arcsAtVertex(registry, "free") });
    expect(preview.kind).toBe("merge");

    const [mergedId] = removeVertex(registry, "free", preview);

    expect(registry.get(mergedId!)).toMatchObject({ intendedLengthMeters: expect.closeTo(4, 6) });
  });
});

describe("the yaw slot", () => {
  it("the yaw set in a frame with no tick is applied in that frame", () => {
    const { registry, engine, run, emitterId, arcId, emitter, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    const stepIndex = engine.read.stepIndex;

    frameWithNoTick(1);

    expect(engine.read.stepIndex).toBe(stepIndex);
    expect(emitter().aimYawRadians).toBeCloseTo(1);
    const first = getGeodesicSegments(registry, arcId)[0]!;
    expect(Math.atan2(first.direction.y, first.direction.x)).toBeCloseTo(1);
  });

  it("writes nothing while the emitter already has the yaw", () => {
    const { registry, run, emitterId, arcId, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    frameWithNoTick(1);
    const version = registry.getVersion();

    frameWithNoTick(1);

    expect(registry.getVersion()).toBe(version);
  });

  it("does nothing while beginEdit waits for a tick, and works from the frame after it", () => {
    const { engine, emitter, emitterId, arcId, frameWithNoTick } = setup();

    engine.submit("local", { kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    frameWithNoTick(1);
    expect(emitter().aimYawRadians).toBe(0);

    engine.step(frameSeconds);
    engine.applyControls(frameSeconds);
    expect(emitter().aimYawRadians).toBe(0);

    frameWithNoTick(1);
    expect(emitter().aimYawRadians).toBeCloseTo(1);
  });

  it("is still applied while endEdit waits for a tick, and ignored once the edit has ended", () => {
    const { engine, registry, run, emitter, emitterId, arcId, edit, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);

    engine.submit("local", { kind: "geodesicEmitters/endEdit" });
    frameWithNoTick(1);
    expect(emitter().aimYawRadians).toBeCloseTo(1);
    expect(edit()).toBeDefined();

    engine.step(frameSeconds);
    expect(edit()).toBeUndefined();
    const version = registry.getVersion();
    frameWithNoTick(2);
    expect(emitter().aimYawRadians).toBeCloseTo(1);
    expect(registry.getVersion()).toBe(version);
  });

  it("starts empty in a new edit: the old yaw is not applied again", () => {
    const { run, emitter, emitterId, arcId, editTo, engine } = setup();
    editTo(1);
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    run({ kind: "geodesicEmitters/endEdit" });
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);

    engine.applyControls(frameSeconds);

    expect(emitter().aimYawRadians).toBeCloseTo(1);
  });

  it("turns only the emitter of an edit with no geodesic", () => {
    const { registry, run, emitter, emitterId, arcId, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId } as EngineCommandBase);

    frameWithNoTick(1);

    expect(emitter().aimYawRadians).toBeCloseTo(1);
    const first = getGeodesicSegments(registry, arcId)[0]!;
    expect(first.direction.y).toBeCloseTo(0);
  });

  it("creates nothing for a geodesic deleted during the edit", () => {
    const { registry, run, emitter, emitterId, arcId, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    run({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId } as EngineCommandBase);

    frameWithNoTick(1);

    expect(emitter().aimYawRadians).toBeCloseTo(1);
    expect(registry.get(arcId)).toBeUndefined();
    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });
    expect(registry.get(arcId)).toBeUndefined();
  });

  it("ends the edit in the world, with no command, when the emitter is removed", () => {
    const { registry, engine, run, emitterId, arcId, edit } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    run({ kind: "geodesicEmitters/remove", emitterId } as EngineCommandBase);
    const version = registry.getVersion();

    engine.applyControls(frameSeconds);

    expect(edit()).toBeUndefined();
    expect(registry.getVersion()).toBe(version);
    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });
  });

  it("does not leave applyControls when a re-trace fails: the emitter has turned", () => {
    const { run, emitter, emitterId, arcId, breakWorld, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    breakWorld();
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => frameWithNoTick(1)).not.toThrow();

    expect(emitter().aimYawRadians).toBeCloseTo(1);
    expect(warned).toHaveBeenCalledOnce();
    warned.mockRestore();
  });
});

describe("an arc freed from a tied curve", () => {
  /** The tied pair of the torus with the world's modules; `arcId` leaves `e1` with the tied vertex at its other end. */
  function tied() {
    const { world, registry } = createTorusTiedPairScenario();
    const playerPose = { ...createDefaultPlayerPose("torus-room"), position: { x: -2.5, y: 0, z: 0 } };
    const engine = createTestEngine({ registry, getWorld: () => world, modules: createDefaultWorldModules(), playerPose });
    function run(command: EngineCommandBase): CommandResult {
      const ticket = engine.submit("local", command);
      runFrame(engine, frameSeconds);
      const result = engine.resultOf(ticket) as CommandResult;
      engine.endFrame();
      return result;
    }
    return { registry, engine, run };
  }

  it("is refused with blocked while it is tied", () => {
    const { run } = tied();

    expect(run({ kind: "geodesicEmitters/beginEdit", emitterId: "e1", arcId: "g1" } as EngineCommandBase)).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/blocked" } });
  });

  it("turns and ends with the emitter at its end role, the arc then leaving from the emitter", () => {
    const { registry, engine, run } = tied();
    expect(run({ kind: "geodesicEmitters/deleteGeodesic", emitterId: "e1", arcId: "g1" } as EngineCommandBase)).toMatchObject({ ok: true });
    expect(registry.get("g2")).toMatchObject({ end: { anchorObjectId: "e1" } });
    expect(run({ kind: "geodesicEmitters/beginEdit", emitterId: "e1", arcId: "g2" } as EngineCommandBase)).toEqual({ ok: true });

    engine.setControl("local", geodesicEmitterYawSlot, 0.3);
    expect(() => engine.applyControls(frameSeconds)).not.toThrow();
    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });

    expect(participantAttachment(engine.read.participant("local"), geodesicEmitterEditAttachmentKind)).toBeUndefined();
    expect(registry.get("g2")).toMatchObject({ start: { anchorObjectId: "e1", role: "start" }, end: { role: "end" } });
    const first = getGeodesicSegments(registry, "g2")[0]!;
    expect(Math.atan2(first.direction.y, first.direction.x)).toBeCloseTo(0.3);
  });
});

describe("geodesicEmitters/endEdit", () => {
  it("connects a geodesic that reaches an emitter, which rotating alone does not", () => {
    const { registry, run, emitterId, arcId, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 1, y: 4, z: 0 }, yawRadians: 0 } as EngineCommandBase);
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);

    frameWithNoTick(Math.PI / 2);
    expect(arcConnectsEmitters(registry, arcId)).toBe(false);

    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });
    expect(arcConnectsEmitters(registry, arcId)).toBe(true);
  });

  it("snaps a geodesic almost on an emitter's ray onto it", () => {
    const { registry, run, emitter, emitterId, arcId, frameWithNoTick } = setup();
    run({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 1, y: 4, z: 0 }, yawRadians: 0 } as EngineCommandBase);
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    frameWithNoTick(Math.PI / 2 + 0.01);

    run({ kind: "geodesicEmitters/endEdit" });

    expect(emitter().aimYawRadians).toBeCloseTo(Math.PI / 2);
    expect(arcConnectsEmitters(registry, arcId)).toBe(true);
  });

  it("ends the edit even when the last trace fails", () => {
    const { engine, run, emitterId, arcId, edit, breakWorld } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);
    breakWorld();

    const ticket = engine.submit("local", { kind: "geodesicEmitters/endEdit" });
    expect(() => engine.step(frameSeconds)).toThrow();

    expect(engine.resultOf(ticket)).toMatchObject({ ok: false, refusal: { code: "world/internalError" } });
    expect(edit()).toBeUndefined();
  });

  it("does nothing with no edit", () => {
    const { registry, run } = setup();
    const version = registry.getVersion();

    expect(run({ kind: "geodesicEmitters/endEdit" })).toEqual({ ok: true });
    expect(registry.getVersion()).toBe(version);
  });
});

describe("geodesicEmitters/beginEdit", () => {
  const refusedWith = (result: CommandResult, code: string) => expect(result).toMatchObject({ ok: false, refusal: { code } });

  it("holds the relation and opens the slot", () => {
    const { run, emitterId, arcId, edit } = setup();

    expect(run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase)).toEqual({ ok: true });

    expect(edit()).toMatchObject({ kind: geodesicEmitterEditAttachmentKind, objectId: emitterId, activeGeodesicId: arcId });
  });

  it("takes another geodesic of the same emitter when asked again", () => {
    const { run, emitterId, arcId, edit } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId } as EngineCommandBase);

    expect(run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase)).toEqual({ ok: true });

    expect(edit()?.activeGeodesicId).toBe(arcId);
  });

  it("refuses an emitter someone else edits", () => {
    const { run, emitterId, arcId, edit } = setup();
    run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase);

    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase, "ana"), "geodesicEmitters/alreadyEdited");

    expect(edit("ana")).toBeUndefined();
  });

  it("refuses an emitter someone carries", () => {
    const { run, emitterId } = setup();
    expect(run({ kind: "carry/attach", objectId: emitterId } as EngineCommandBase, "ana")).toEqual({ ok: true });

    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId } as EngineCommandBase), "geodesicEmitters/alreadyEdited");
  });

  it("refuses a second emitter while one is edited", () => {
    const { run, value, emitterId } = setup();
    const other = value({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 4, z: 0 }, yawRadians: 0 } as EngineCommandBase);
    run({ kind: "geodesicEmitters/beginEdit", emitterId } as EngineCommandBase);

    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId: other.emitterId } as EngineCommandBase), "geodesicEmitters/alreadyEdited");
  });

  it("refuses what is no emitter, a geodesic of another emitter, and one that connects emitters", () => {
    const { registry, run, value, emitterId, arcId, editTo } = setup();
    const other = value({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 1, y: 4, z: 0 }, yawRadians: 0 } as EngineCommandBase);

    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId: arcId } as EngineCommandBase), "geodesicEmitters/notAnEmitter");
    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId: other.emitterId, arcId } as EngineCommandBase), "geodesicEmitters/notAttached");

    editTo(Math.PI / 2);
    expect(arcConnectsEmitters(registry, arcId)).toBe(true);
    refusedWith(run({ kind: "geodesicEmitters/beginEdit", emitterId, arcId } as EngineCommandBase), "geodesicEmitters/blocked");
  });
});
