/**
 * `tests/modules/carry.test.ts` — unit tier.
 *
 * The carry module (design 013 section 7) driven through the world engine alone, with no tool and no renderer: who carries what is the participant's attachment,
 * `carry/attach` and `carry/detach` are commands, the hand is the `carry/offset` control slot, the move runs in step phase 3, and the hand's leash ends a carry
 * with a `carry/dropped` event. The rules of the move itself are in `tests/world-objects/carry.test.ts`; the tool built on this is in `tests/render/geodesicCannonCarry.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { participantAttachment, type AnyModuleDefinition, type EngineEventBase, type ModuleTick, type ParticipantRecord } from "../../src/engine/moduleTypes";
import { createLocalPlayerParticipant } from "../../src/engine/participants";
import { handCarryLeashMeters } from "../../src/interaction/handCarry";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { carryOffsetSlot, type CarryCommand, type CarryOffset } from "../../src/modules/carry/api";
import { carryModule } from "../../src/modules/carry";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { getGeodesicConnection } from "../../src/world-objects/geodesic/lifecycle";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { getRuntimeObjectInteractionRangeMeters } from "../../src/world-objects/interactionRange";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
import { createTestEngine } from "../support/engine";

const frameSeconds = 1 / 60;

function ana(): ParticipantRecord {
  return { id: "ana", kind: "remote-player", ownerId: "device-ana", body: { ...createDefaultPlayerPose("a"), position: { x: 3.5, y: 2.5, z: 0 } }, attachments: [] };
}

/** Rooms a and b glued side by side with a locked geodesic from an emitter in a to one in b; the local player stands in a at (3.5, 2.5). */
function setup(options: { readonly participants?: readonly ParticipantRecord[]; readonly extraModules?: readonly AnyModuleDefinition[] } = {}) {
  const world: CompiledCellComplex = compileLargePortalWorld();
  const registry: RuntimeObjectRegistry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "cannon-b", cellId: "b", localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }) }));
  const source = registry.get("cannon-a");
  if (source?.kind !== "geodesic-cannon") throw new Error("Expected the source emitter.");
  shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [carryModule(), ...(options.extraModules ?? [])],
    playerPose: { ...createDefaultPlayerPose("a"), position: { x: 3.5, y: 2.5, z: 0 } },
    ...(options.participants === undefined ? {} : { participants: [createLocalPlayerParticipant({ ...createDefaultPlayerPose("a"), position: { x: 3.5, y: 2.5, z: 0 } }), ...options.participants] }),
  });
  const events: EngineEventBase[] = [];
  /** Submits as `who`, steps, returns the result and keeps the step's events. */
  function run(who: string, command: CarryCommand, seconds = 0) {
    const ticket = engine.submit(who, command);
    engine.step(seconds);
    const result = engine.resultOf(ticket);
    engine.forEachEvent((event) => events.push(event));
    engine.endFrame();
    return result;
  }
  function step(seconds: number): void {
    engine.step(seconds);
    engine.forEachEvent((event) => events.push(event));
    engine.endFrame();
  }
  function hand(x: number, y: number, leashMeters = 5): void {
    const offset: CarryOffset = { x, y, leashMeters };
    engine.setControl("local", carryOffsetSlot, offset);
  }
  return { world, registry, engine, events, run, step, hand };
}

describe("carry/attach and carry/detach", () => {
  it("attaches the object to the participant, opens the offset slot and detaches again", () => {
    const { engine, registry, run, step, hand, events } = setup();

    expect(run("local", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({ ok: true });
    expect(participantAttachment(engine.read.participant("local"), "carry")).toEqual({ kind: "carry", objectId: "cannon-b", arrived: false });

    // The slot is open: the hand set before a step moves the emitter at that step.
    hand(5.6, 2.5);
    step(1);
    expect(registry.get("cannon-b")?.localPose.translation.x).toBeLessThan(1);

    expect(run("local", { kind: "carry/detach" })).toEqual({ ok: true });
    expect(participantAttachment(engine.read.participant("local"), "carry")).toBeUndefined();
    expect(events.some((event) => event.kind === "carry/released" && (event as { objectId?: string }).objectId === "cannon-b")).toBe(true);

    // The slot is closed: a hand set now is ignored and the emitter stays.
    const before = registry.get("cannon-b");
    hand(2, 2.5);
    step(1);
    expect(registry.get("cannon-b")).toBe(before);
  });

  it("refuses a second pickup of an object that someone else carries, first come first served", () => {
    const { engine, run } = setup({ participants: [ana()] });

    expect(run("local", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({ ok: true });
    expect(run("ana", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({
      ok: false,
      refusal: { code: "carry/alreadyCarried", message: "Already carried by local." },
    });
    expect(participantAttachment(engine.read.participant("ana"), "carry")).toBeUndefined();

    // Once the first carrier lets go, the object can be taken.
    run("local", { kind: "carry/detach" });
    expect(run("ana", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({ ok: true });
  });

  it("refuses what cannot be carried, what is out of reach, and a second object", () => {
    const { registry, run } = setup();
    registry.add({ ...(registry.get("cannon-a") as object), id: "flag", kind: "placed-flag" } as never);

    expect(run("local", { kind: "carry/attach", objectId: "nothing" })).toMatchObject({ ok: false, refusal: { code: "carry/notCarriable" } });
    expect(run("local", { kind: "carry/attach", objectId: "flag" })).toMatchObject({ ok: false, refusal: { code: "carry/notCarriable" } });

    const far = setup();
    far.engine.publishBody("local", { ...createDefaultPlayerPose("a"), position: { x: 0.2, y: 0.2, z: 0 } });
    expect(far.run("local", { kind: "carry/attach", objectId: "cannon-b" })).toMatchObject({ ok: false, refusal: { code: "carry/outOfReach" } });

    expect(run("local", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({ ok: true });
    expect(run("local", { kind: "carry/attach", objectId: "cannon-a" })).toMatchObject({ ok: false, refusal: { code: "carry/alreadyCarried" } });
  });

  it("changes nothing for a repeated pickup of the same object or a detach of nothing", () => {
    const { engine, run } = setup();

    expect(run("local", { kind: "carry/detach" })).toEqual({ ok: true });
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    const held = engine.read.participant("local");
    expect(run("local", { kind: "carry/attach", objectId: "cannon-b" })).toEqual({ ok: true });
    expect(engine.read.participant("local")).toBe(held);
  });

  it("starts a pickup after a release as not arrived", () => {
    const { engine, run, hand, step } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    hand(4.6, 2.5);
    step(1);
    expect(participantAttachment(engine.read.participant("local"), "carry")?.arrived).toBe(true);

    run("local", { kind: "carry/detach" });
    run("local", { kind: "carry/attach", objectId: "cannon-a" });
    expect(participantAttachment(engine.read.participant("local"), "carry")).toMatchObject({ objectId: "cannon-a", arrived: false });
  });

  it("keeps the module-only drop away from clients", () => {
    const { run } = setup();

    expect(run("local", { kind: "carry/drop", participantId: "local", reason: "leash" })).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
  });
});

describe("the carry move in step phase 3", () => {
  it("moves the emitter before the simulate ticks and keeps its geodesic joined", () => {
    const seen: number[] = [];
    const watcher = {
      id: "watch",
      requires: [],
      objectKinds: [],
      create: (ctx: { objects: RuntimeObjectRegistry }) => ({
        api: {},
        queries: {},
        commands: {},
        ticks: [
          { id: "watch/look", phase: "simulate", writes: [], run: () => void seen.push(ctx.objects.get("cannon-b")!.localPose.translation.x) } satisfies ModuleTick,
        ],
      }),
    };
    const { registry, run, hand, step } = setup({ extraModules: [watcher as never] });
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    hand(5.6, 2.5);
    seen.length = 0;

    step(frameSeconds);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(registry.get("cannon-b")?.localPose.translation.x);
    expect(seen[0]).not.toBe(1);
    expect(getGeodesicConnection(registry, "g-a")).toMatchObject({ incomingEmitterId: "cannon-b", state: "connected" });
  });

  it("carries an emitter through a portal and keeps the geodesic locked and joined", () => {
    const { registry, run, hand, step, events } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });

    // The hand is in room a at x = 4.6; the emitter hangs in room b at x = 1 (x = 6 in a's frame), so it comes back through the portal at x = 5.
    hand(4.6, 3.2);
    for (let frame = 0; frame < 100; frame += 1) step(frameSeconds);

    expect(registry.get("cannon-b")).toMatchObject({ kind: "geodesic-cannon", cellId: "a" });
    expect(getGeodesicConnection(registry, "g-a")).toMatchObject({ outgoingEmitterId: "cannon-a", incomingEmitterId: "cannon-b", state: "connected" });
    expect(events.some((event) => event.kind === "carry/moved")).toBe(true);
  });

  it("marks the attachment arrived once the emitter is at the hand", () => {
    const { engine, run, hand, step } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    hand(4.6, 2.5);

    step(1);

    expect(participantAttachment(engine.read.participant("local"), "carry")).toMatchObject({ objectId: "cannon-b", arrived: true });

    // The arrival is recorded once: later steps at the hand write no attachment again.
    const record = engine.read.participant("local");
    step(1);
    expect(engine.read.participant("local")).toBe(record);
  });
});

describe("the hand lets go", () => {
  it("ends the carry in the world and emits carry/dropped when the emitter is beyond the leash", () => {
    const { engine, registry, run, hand, step, events } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    const emitter = registry.get("cannon-b")!;
    const leash = handCarryLeashMeters({ pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(emitter), handReachMeters: 0 });

    // The emitter (x = 6 in a's frame) is farther from the hand than the leash, and no time passes for it to follow.
    hand(6 - (leash + 0.1), 2.5, leash);
    step(0);

    expect(events).toContainEqual(expect.objectContaining({ kind: "carry/dropped", participantId: "local", objectId: "cannon-b", reason: "leash" }));
    expect(events).toContainEqual(expect.objectContaining({ kind: "carry/released", objectId: "cannon-b" }));
    expect(participantAttachment(engine.read.participant("local"), "carry")).toBeUndefined();
    expect(registry.get("cannon-b")).toMatchObject({ kind: "geodesic-cannon" });
  });

  it("holds an emitter within the leash", () => {
    const { engine, registry, run, hand, step, events } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });
    const emitter = registry.get("cannon-b")!;
    const leash = handCarryLeashMeters({ pickupRangeMeters: getRuntimeObjectInteractionRangeMeters(emitter), handReachMeters: 0 });

    hand(6 - (leash - 0.1), 2.5, leash);
    step(0);

    expect(events.some((event) => event.kind === "carry/dropped")).toBe(false);
    expect(participantAttachment(engine.read.participant("local"), "carry")).toBeDefined();
  });

  it("ends the carry when the carried object no longer exists", () => {
    const { engine, registry, run, step, events } = setup();
    run("local", { kind: "carry/attach", objectId: "cannon-b" });

    registry.remove("cannon-b");
    step(0);

    expect(events).toContainEqual(expect.objectContaining({ kind: "carry/dropped", objectId: "cannon-b", reason: "missing" }));
    expect(participantAttachment(engine.read.participant("local"), "carry")).toBeUndefined();
  });
});
