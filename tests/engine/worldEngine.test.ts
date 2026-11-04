/**
 * `tests/engine/worldEngine.test.ts` — unit tier.
 *
 * The world engine of design 013: commands and their results, the step order, events, ids, control slots, the derive pass and its cursors, the realtime view, tool requests and their gates, and the access rule (who may write what). Modules are small fakes defined in this file.
 */
import { describe, expect, it } from "vitest";
import {
  defineModuleToken,
  type AnyModuleDefinition,
  type CommandContext,
  type CommandResult,
  type EngineEventBase,
  type ModuleCreateContext,
  type ModuleTick,
  type StepContext,
  type ToolGate,
  type WorldRequestToolCommand,
} from "../../src/engine/moduleTypes";
import { createLocalPlayerParticipant } from "../../src/engine/participants";
import { createWorldEngine } from "../../src/engine/worldEngine";
import type { RuntimeToolId } from "../../src/glue/toolIds";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { ChangeOp } from "../../src/world-objects/runtimeObjectChangeJournal";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import { createTestEngine } from "../support/engine";

type Handler = { readonly run: (command: never, ctx: CommandContext) => CommandResult; readonly requiresTool?: RuntimeToolId; readonly moduleOnly?: true };

const ok: CommandResult = { ok: true };
const requestTool = (toolId: RuntimeToolId): WorldRequestToolCommand => ({ kind: "world/requestTool", toolId });

/** A record of a kind a fake module declares (the registry's union is closed, so tests cast). */
function thing(id: string, kind: string): RuntimeWorldObject {
  return { id, kind, cellId: "room-a", localPose: identityRigidTransform3, portalRenderable: true } as unknown as RuntimeWorldObject;
}

function fake(
  id: string,
  parts: {
    readonly kinds?: readonly string[];
    readonly commands?: Record<string, Handler>;
    readonly ticks?: readonly ModuleTick[];
    readonly requires?: readonly ReturnType<typeof defineModuleToken>[];
    readonly provides?: ReturnType<typeof defineModuleToken>;
    readonly api?: object;
    readonly queries?: object;
    readonly toolGates?: readonly ToolGate[];
    readonly toolIds?: readonly string[];
    readonly onEvents?: Record<string, (event: EngineEventBase, ctx: StepContext) => void>;
    readonly onCreate?: (objects: RuntimeObjectRegistry, require: ModuleCreateContext["require"]) => void;
  } = {},
): AnyModuleDefinition {
  return {
    id,
    provides: parts.provides,
    requires: parts.requires ?? [],
    objectKinds: (parts.kinds ?? []).map((kind) => ({ kind, label: "real", persistence: "saved" })),
    toolIds: parts.toolIds as RuntimeToolId[] | undefined,
    create: (ctx) => {
      parts.onCreate?.(ctx.objects, ctx.require);
      return {
        api: parts.api ?? {},
        queries: parts.queries ?? {},
        commands: parts.commands ?? {},
        ticks: parts.ticks ?? [],
        toolGates: parts.toolGates,
        onEvents: parts.onEvents,
      };
    },
  };
}

describe("commands and results", () => {
  it("applies a command at the next step and stores its result under the ticket", () => {
    const seen: string[] = [];
    const engine = createTestEngine({
      modules: [fake("a", { commands: { "a/go": { run: (_c, ctx) => (seen.push(ctx.participantId), { ok: true, value: { n: 1 } }) } } })],
    });
    const ticket = engine.submit("local", { kind: "a/go" });
    expect(engine.resultOf(ticket)).toBeUndefined();
    engine.step(0);
    expect(engine.resultOf(ticket)).toEqual({ ok: true, value: { n: 1 } });
    expect(seen).toEqual(["local"]);
  });

  it("applies commands in arrival order, and a refused command changes nothing", () => {
    const order: string[] = [];
    const registry = createTestEngine().registry;
    const engine = createTestEngine({
      registry,
      modules: [
        fake("a", {
          kinds: ["a/thing"],
          commands: {
            "a/first": { run: () => (order.push("first"), registry.add(thing("t1", "a/thing")), ok) },
            "a/refuse": { run: () => ({ ok: false, refusal: { code: "a/no", message: "No." } }) },
            "a/second": { run: () => (order.push("second"), ok) },
          },
        }),
      ],
    });
    engine.submit("local", { kind: "a/first" });
    const refused = engine.submit("local", { kind: "a/refuse" });
    engine.submit("local", { kind: "a/second" });
    engine.step(1 / 60);
    expect(order).toEqual(["first", "second"]);
    expect(engine.resultOf(refused)).toEqual({ ok: false, refusal: { code: "a/no", message: "No." } });
    expect(registry.getVersion()).toBe(1);
  });

  it("refuses an unknown command, an unknown participant and a negative step duration", () => {
    const engine = createTestEngine();
    const unknownCommand = engine.submit("local", { kind: "a/nothing" });
    const unknownParticipant = engine.submit("nobody", { kind: "a/nothing" });
    engine.step(0);
    expect(engine.resultOf(unknownCommand)).toMatchObject({ ok: false, refusal: { code: "world/unknownCommand" } });
    expect(engine.resultOf(unknownParticipant)).toMatchObject({ ok: false, refusal: { code: "world/unknownParticipant" } });
    expect(() => engine.step(-1)).toThrow(RangeError);
  });

  it("contains a throwing handler as world/internalError and rethrows it once the step is done", () => {
    const after: string[] = [];
    const engine = createTestEngine({
      modules: [
        fake("a", {
          commands: { "a/boom": { run: () => { throw new Error("bug"); } }, "a/after": { run: () => (after.push("ran"), ok) } },
        }),
      ],
    });
    const boom = engine.submit("local", { kind: "a/boom" });
    engine.submit("local", { kind: "a/after" });
    expect(() => engine.step(0)).toThrow("bug");
    expect(engine.resultOf(boom)).toMatchObject({ ok: false, refusal: { code: "world/internalError" } });
    expect(after).toEqual(["ran"]);
  });

  it("runs a zero-second step: it applies commands and counts the step", () => {
    const engine = createTestEngine({ modules: [fake("a", { commands: { "a/go": { run: () => ok } } })] });
    const ticket = engine.submit("local", { kind: "a/go" });
    engine.step(0);
    expect(engine.resultOf(ticket)).toEqual(ok);
    expect(engine.read.stepIndex).toBe(1);
  });

  it("clears results, events and both journals at endFrame", () => {
    const registry = createTestEngine().registry;
    const engine = createTestEngine({
      registry,
      modules: [fake("a", { kinds: ["a/thing"], commands: { "a/go": { run: (_c, ctx) => (registry.add(thing("t1", "a/thing")), ctx.emit({ kind: "a/went" }), ok) } } })],
    });
    const ticket = engine.submit("local", { kind: "a/go" });
    engine.step(0);
    engine.publishBody("local", createDefaultPlayerPose("room-b"));
    const events: string[] = [];
    engine.forEachEvent((event) => events.push(event.kind));
    expect(events).toEqual(["a/went"]);
    expect(registry.changes.length).toBe(1);
    expect(engine.read.participantChanges.length).toBe(1);

    engine.endFrame();
    expect(engine.resultOf(ticket)).toBeUndefined();
    engine.forEachEvent((event) => events.push(event.kind));
    expect(events).toEqual(["a/went"]);
    expect(registry.changes.length).toBe(0);
    expect(engine.read.participantChanges.length).toBe(0);
  });

  it("allocates ids by family from engine counters, skipping taken ids, and prefixes a module's ids with its id", () => {
    const registry = createTestEngine().registry;
    registry.add(thing("geodesic:1", "geo-mouse"));
    const engine = createTestEngine({
      registry,
      modules: [fake("a", { commands: { "a/mint": { run: (_c, ctx) => ({ ok: true, value: ctx.ids.next("vertex") }) } } })],
    });
    expect([engine.ids.next("geodesic"), engine.ids.next("geodesic"), engine.ids.next("geodesic"), engine.ids.next("flag")]).toEqual([
      "geodesic:0",
      "geodesic:2",
      "geodesic:3",
      "flag:0",
    ]);
    const ticket = engine.submit("local", { kind: "a/mint" });
    engine.step(0);
    expect(engine.resultOf(ticket)).toEqual({ ok: true, value: "a/vertex:0" });
  });

  it("refuses a module event whose kind does not carry the module's id", () => {
    const engine = createTestEngine({ modules: [fake("a", { commands: { "a/go": { run: (_c, ctx) => (ctx.emit({ kind: "b/went" }), ok) } } })] });
    engine.submit("local", { kind: "a/go" });
    expect(() => engine.step(0)).toThrow(/emitted the event "b\/went"/);
  });
});

describe("control slots", () => {
  it("samples the latest value of an open slot at the step and ignores a closed one", () => {
    const sampled: unknown[] = [];
    const tick: ModuleTick = { id: "a/read", phase: "simulate", writes: [], run: (ctx) => void sampled.push(ctx.control("local", "a/offset")) };
    const engine = createTestEngine({
      modules: [
        fake("a", {
          ticks: [tick],
          commands: { "a/open": { run: (_c, ctx) => (ctx.openControl("local", "a/offset"), ok) }, "a/close": { run: (_c, ctx) => (ctx.closeControl("local", "a/offset"), ok) } },
        }),
      ],
    });
    engine.setControl("local", "a/offset", 1);
    engine.step(0);
    expect(sampled).toEqual([undefined]);

    engine.submit("local", { kind: "a/open" });
    engine.setControl("local", "a/offset", 2);
    engine.step(0);
    engine.setControl("local", "a/offset", 3);
    engine.setControl("local", "a/offset", 4);
    engine.step(0);
    expect(sampled).toEqual([undefined, undefined, 4]);

    engine.submit("local", { kind: "a/close" });
    engine.step(0);
    expect(sampled[3]).toBeUndefined();
  });
});

describe("the step order and the derive pass", () => {
  it("runs commands, then simulate ticks, then derive ticks, in module order", () => {
    const log: string[] = [];
    const tokenA = defineModuleToken<unknown>("a");
    const engine = createTestEngine({
      modules: [
        fake("b", { requires: [tokenA], ticks: [{ id: "b/sim", phase: "simulate", writes: [], run: () => void log.push("b sim") }, { id: "b/derive", phase: "derive", writes: [], wants: () => true, run: () => void log.push("b derive") }] }),
        fake("a", {
          provides: tokenA,
          commands: { "a/go": { run: () => (log.push("a command"), ok) } },
          ticks: [{ id: "a/derive", phase: "derive", writes: [], wants: () => true, run: () => void log.push("a derive") }, { id: "a/sim", phase: "simulate", writes: [], run: () => void log.push("a sim") }],
        }),
      ],
    });
    engine.submit("local", { kind: "a/go" });
    engine.step(0);
    expect(log).toEqual(["a command", "a sim", "b sim", "a derive", "b derive"]);
  });

  it("skips a simulate tick that says it is idle", () => {
    let runs = 0;
    let idle = true;
    const engine = createTestEngine({
      modules: [fake("a", { ticks: [{ id: "a/sim", phase: "simulate", writes: [], isIdle: () => idle, run: () => void (runs += 1) }] })],
    });
    engine.step(0);
    idle = false;
    engine.step(0);
    expect(runs).toBe(1);
  });

  it("wakes a derive tick only on a subscribed write or when it wants to, and hands it the unseen journal range", () => {
    const registry = createTestEngine().registry;
    const ranges: [number, number][] = [];
    let wants = false;
    const tokenA = defineModuleToken<unknown>("a");
    const engine = createTestEngine({
      registry,
      modules: [
        fake("a", { provides: tokenA, kinds: ["a/thing", "a/other"] }),
        fake("b", {
          requires: [tokenA],
          ticks: [{ id: "b/watch", phase: "derive", writes: [], subscribes: ["a/thing"], wants: () => wants, run: (ctx) => void ranges.push([ctx.changesFrom, ctx.changesTo]) }],
        }),
      ],
    });
    engine.step(0);
    expect(ranges).toEqual([]);

    registry.add(thing("o1", "a/other"));
    engine.step(0);
    expect(ranges).toEqual([]);

    registry.add(thing("t1", "a/thing"));
    engine.step(0);
    expect(ranges).toEqual([[0, 2]]);

    engine.step(0);
    expect(ranges).toEqual([[0, 2]]);

    wants = true;
    registry.add(thing("o2", "a/other"));
    engine.step(0);
    expect(ranges).toEqual([[0, 2], [2, 3]]);
  });

  it("starts every cursor again after endFrame clears the journal", () => {
    const registry = createTestEngine().registry;
    const ranges: [number, number][] = [];
    const engine = createTestEngine({
      registry,
      modules: [
        fake("a", {
          kinds: ["a/thing"],
          ticks: [{ id: "a/watch", phase: "derive", writes: [], subscribes: ["a/thing"], run: (ctx) => void ranges.push([ctx.changesFrom, ctx.changesTo]) }],
        }),
      ],
    });
    registry.add(thing("t1", "a/thing"));
    engine.step(0);
    engine.endFrame();
    registry.add(thing("t2", "a/thing"));
    engine.step(0);
    expect(ranges).toEqual([[0, 1], [0, 1]]);
  });

  it("runs a module's event handlers before its derive ticks, over the events since their own cursor", () => {
    const log: string[] = [];
    const tokenA = defineModuleToken<unknown>("a");
    const engine = createTestEngine({
      modules: [
        fake("a", { provides: tokenA, commands: { "a/ping": { run: (_c, ctx) => (ctx.emit({ kind: "a/pinged", message: "hi" }), ok) } } }),
        fake("b", {
          requires: [tokenA],
          onEvents: { "a/pinged": (event) => void log.push(`handled ${event.message}`) },
          ticks: [{ id: "b/derive", phase: "derive", writes: [], wants: () => true, run: () => void log.push("derive") }],
        }),
      ],
    });
    engine.submit("local", { kind: "a/ping" });
    engine.step(0);
    engine.step(0);
    expect(log).toEqual(["handled hi", "derive", "derive"]);
  });
});

describe("the realtime view", () => {
  it("hands out the registry's own records and the body published before the step", () => {
    const registry = createTestEngine().registry;
    const record = thing("m1", "geo-mouse");
    registry.add(record);
    const engine = createTestEngine({ registry });
    expect(engine.read.objects.get("m1")).toBe(registry.get("m1"));
    expect(engine.read.objects.get("m1")).toBe(record);

    const body = { ...createDefaultPlayerPose("room-b"), position: { x: 1, y: 2, z: 0 } };
    expect(engine.publishBody("local", body)).toBe(true);
    engine.step(1 / 60);
    expect(engine.read.participant("local")?.body).toBe(body);
    expect(engine.read.participantChanges.opAt(0)).toBe(ChangeOp.Updated);
  });
});

describe("tool requests and gates", () => {
  it("accepts a tool the configuration enables and refuses one it disables, with a message", () => {
    const engine = createTestEngine({ isToolEnabled: (toolId) => toolId !== "protractor" });
    const accepted = engine.submit("local", requestTool("measure-length"));
    const refused = engine.submit("local", requestTool("protractor"));
    const unknown = engine.submit("local", requestTool("no-such-tool" as RuntimeToolId));
    engine.step(0);
    expect(engine.resultOf(accepted)).toEqual({ ok: true, value: { toolId: "measure-length" } });
    expect(engine.resultOf(refused)).toEqual({ ok: false, refusal: { code: "world/toolDisabled", message: "This tool is not available in this world." } });
    expect(engine.resultOf(unknown)).toMatchObject({ ok: false, refusal: { code: "world/unknownTool" } });
  });

  it("asks a module's gates after the configuration and shows the first refusal", () => {
    const gate: ToolGate = ({ toolId }) => (toolId === "place-flag" ? { refused: true, code: "inventory/missing", message: "You have not found a flag yet." } : undefined);
    const engine = createTestEngine({ modules: [fake("inventory", { toolGates: [gate] })] });
    const flag = engine.submit("local", requestTool("place-flag"));
    const aim = engine.submit("local", requestTool("aim"));
    engine.step(0);
    expect(engine.resultOf(flag)).toEqual({ ok: false, refusal: { code: "inventory/missing", message: "You have not found a flag yet." } });
    expect(engine.resultOf(aim)).toMatchObject({ ok: true });
  });

  it("refuses a command whose tool the participant may not use, but not a dispatched one", () => {
    let allowed = false;
    const gate: ToolGate = ({ toolId }) => (toolId === ("a/tool" as RuntimeToolId) && !allowed ? { refused: true, code: "a/denied", message: "Denied." } : undefined);
    const tokenA = defineModuleToken<unknown>("a");
    const results: CommandResult[] = [];
    const engine = createTestEngine({
      modules: [
        fake("a", { provides: tokenA, toolGates: [gate], toolIds: ["a/tool"], commands: { "a/use": { requiresTool: "a/tool" as RuntimeToolId, run: () => ok } } }),
        fake("b", { requires: [tokenA], ticks: [{ id: "b/use", phase: "simulate", writes: [], run: (ctx) => void results.push(ctx.dispatch({ kind: "a/use" })) }] }),
      ],
    });
    const ticket = engine.submit("local", { kind: "a/use" });
    engine.step(0);
    expect(engine.resultOf(ticket)).toEqual({ ok: false, refusal: { code: "world/capabilityMissing", message: "Denied." } });
    expect(results).toEqual([ok]);

    allowed = true;
    const second = engine.submit("local", { kind: "a/use" });
    engine.step(0);
    expect(engine.resultOf(second)).toEqual(ok);
  });

  it("emits world/toolRevoked for a tool that capabilitiesChanged finds newly refused", () => {
    let revoked = false;
    const gate: ToolGate = ({ toolId }) => (revoked && toolId === "protractor" ? { refused: true, code: "inventory/taken", message: "The protractor was taken away." } : undefined);
    const engine = createTestEngine({
      modules: [fake("inventory", { toolGates: [gate], commands: { "inventory/take": { run: () => ((revoked = true), ok) } }, ticks: [{ id: "inventory/notice", phase: "simulate", writes: [], isIdle: () => !revoked, run: (ctx) => ctx.capabilitiesChanged("local") }] })],
    });
    engine.step(0);
    const events: EngineEventBase[] = [];
    engine.forEachEvent((event) => events.push(event));
    expect(events).toEqual([]);

    engine.submit("local", { kind: "inventory/take" });
    engine.step(0);
    engine.step(0);
    engine.forEachEvent((event) => events.push(event));
    expect(events).toEqual([{ kind: "world/toolRevoked", participantId: "local", toolId: "protractor", message: "The protractor was taken away." }]);
  });
});

describe("the access rule", () => {
  it("refuses publishBody for a participant another device owns", () => {
    const registry = createTestEngine().registry;
    const ana = { id: "ana", kind: "remote-player" as const, ownerId: "device-ana", body: createDefaultPlayerPose("room-a") };
    const engine = createWorldEngine({ registry, getWorld: () => ({}) as never, participants: [createLocalPlayerParticipant(createDefaultPlayerPose("room-a")), ana] });
    expect(engine.publishBody("ana", createDefaultPlayerPose("room-b"))).toBe(false);
    expect(engine.publishBody("nobody", createDefaultPlayerPose("room-b"))).toBe(false);
    expect(engine.read.participant("ana")?.body.cellId).toBe("room-a");
    expect(engine.read.participantChanges.length).toBe(0);
  });

  it("returns a module's queries, never its api", () => {
    const token = defineModuleToken<{ mutate(): void }, { peek(): number }>("a");
    const engine = createTestEngine({ modules: [fake("a", { provides: token, api: { mutate: () => undefined }, queries: { peek: () => 7 } })] });
    const queries = engine.query(token);
    expect(queries.peek()).toBe(7);
    expect(Object.keys(queries)).toEqual(["peek"]);
    expect(() => engine.query(defineModuleToken<unknown>("missing"))).toThrow(/no module in the experience provides missing/);
  });

  it("throws when a module writes during a queries call or a kind it does not declare", () => {
    let guarded: RuntimeObjectRegistry | undefined;
    const token = defineModuleToken<unknown, { sneak(): void }>("a");
    const engine = createTestEngine({
      modules: [
        fake("a", {
          provides: token,
          kinds: ["a/thing"],
          onCreate: (objects) => void (guarded = objects),
          queries: { sneak: () => guarded!.add(thing("q1", "a/thing")) },
          commands: {
            "a/own": { run: () => (guarded!.add(thing("own1", "a/thing")), ok) },
            "a/foreign": { run: () => (guarded!.add(thing("foreign1", "geo-mouse")), ok) },
          },
        }),
      ],
    });
    expect(() => engine.query(token).sneak()).toThrow(/read-only call of module a/);
    const own = engine.submit("local", { kind: "a/own" });
    const foreign = engine.submit("local", { kind: "a/foreign" });
    expect(() => engine.step(0)).toThrow(/module a wrote "geo-mouse", which it does not declare/);
    expect(engine.resultOf(own)).toEqual(ok);
    expect(engine.resultOf(foreign)).toMatchObject({ ok: false, refusal: { code: "world/internalError" } });
  });

  it("counts writes through a dependency's api and through dispatch as the providing module's", () => {
    let guardedB: RuntimeObjectRegistry | undefined;
    let guardedA: RuntimeObjectRegistry | undefined;
    let apiOfA: { spawn(): void } | undefined;
    const tokenA = defineModuleToken<{ spawn(): void }>("a");
    const engine = createTestEngine({
      modules: [
        fake("a", {
          provides: tokenA,
          kinds: ["a/thing"],
          onCreate: (objects) => void (guardedA = objects),
          api: { spawn: () => guardedA!.add(thing("spawned", "a/thing")) },
          commands: { "a/spawn": { run: () => (guardedA!.add(thing("dispatched", "a/thing")), ok) } },
        }),
        fake("b", {
          requires: [tokenA],
          onCreate: (objects, require) => {
            guardedB = objects;
            apiOfA = require(tokenA);
          },
          ticks: [
            {
              id: "b/act",
              phase: "simulate",
              writes: [],
              run: (ctx) => {
                ctx.dispatch({ kind: "a/spawn" });
                apiOfA!.spawn();
                expect(() => guardedB!.add(thing("own", "a/thing"))).toThrow(/module b wrote "a\/thing"/);
              },
            },
          ],
        }),
      ],
    });
    engine.step(0);
    expect(engine.registry.get("dispatched")).toBeDefined();
    expect(engine.registry.get("spawned")).toBeDefined();
  });

  it("returns a dispatched command's result synchronously and journals its writes in the same step", () => {
    const registry = createTestEngine().registry;
    const tokenA = defineModuleToken<unknown>("a");
    const seen: { result?: CommandResult; length?: number } = {};
    const engine = createTestEngine({
      registry,
      modules: [
        fake("a", {
          provides: tokenA,
          kinds: ["a/thing"],
          commands: { "a/spawn": { run: () => (registry.add(thing("t1", "a/thing")), { ok: true, value: "t1" }) } },
        }),
        fake("b", {
          requires: [tokenA],
          ticks: [{ id: "b/act", phase: "simulate", writes: [], run: (ctx) => { seen.result = ctx.dispatch({ kind: "a/spawn" }); seen.length = ctx.objects.changes.length; } }],
        }),
      ],
    });
    engine.step(0);
    expect(seen).toEqual({ result: { ok: true, value: "t1" }, length: 1 });
    expect(registry.changes.kindAt(0)).toBe("a/thing");
  });

  it("refuses a client's moduleOnly command with world/moduleOnly", () => {
    const tokenA = defineModuleToken<unknown>("a");
    const results: CommandResult[] = [];
    const engine = createTestEngine({
      modules: [
        fake("a", { provides: tokenA, commands: { "a/remove": { moduleOnly: true, run: () => ok } } }),
        fake("b", { requires: [tokenA], ticks: [{ id: "b/act", phase: "simulate", writes: [], run: (ctx) => void results.push(ctx.dispatch({ kind: "a/remove" })) }] }),
      ],
    });
    const ticket = engine.submit("local", { kind: "a/remove" });
    engine.step(0);
    expect(engine.resultOf(ticket)).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
    expect(results).toEqual([ok]);
  });

  it("throws when a module dispatches the command of a module it does not require, or nests past 8", () => {
    const depths: number[] = [];
    let depth = 0;
    const engine = createTestEngine({
      modules: [
        fake("a", { commands: { "a/loop": { run: (_c, ctx) => { depth += 1; depths.push(depth); return ctx.dispatch({ kind: "a/loop" }); } } } }),
        fake("c", { commands: { "c/go": { run: () => ok } } }),
        fake("b", { ticks: [{ id: "b/act", phase: "simulate", writes: [], run: (ctx) => void ctx.dispatch({ kind: "c/go" }) }] }),
      ],
    });
    expect(() => engine.step(0)).toThrow(/dispatched c\/go, a command of c, which is not in its requires/);

    const loopEngine = createTestEngine({
      modules: [fake("a", { commands: { "a/loop": { run: (_c, ctx) => { depth += 1; depths.push(depth); return ctx.dispatch({ kind: "a/loop" }); } } } })],
    });
    depth = 0;
    depths.length = 0;
    loopEngine.submit("local", { kind: "a/loop" });
    expect(() => loopEngine.step(0)).toThrow(/nests deeper than 8/);
    expect(depths.length).toBe(9);
  });
});
