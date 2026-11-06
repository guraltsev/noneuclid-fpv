/**
 * `tests/modules/modulePublicApi.test.ts` — unit tier.
 *
 * `ModuleInstance.publicApi` (design 013 section 9.1) through the default experience's modules, an engine with the write guard on and the shell's world client: which functions exist, that each wrapper submits its command with every check a client's command gets and resolves with the result, as plain data, and that a read runs in a read-only frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineModuleToken, type AnyModuleDefinition, type CommandResult, type ModuleToken } from "../../src/engine/moduleTypes";
import { createSimulationClock } from "../../src/engine/simulationClock";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { geodesicEmittersModule } from "../../src/modules/geodesicEmitters";
import type { GeodesicEmittersPublicApi } from "../../src/modules/geodesicEmitters/api";
import type { GeodesicModelPublicApi } from "../../src/modules/geodesicModel/api";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { createWorldClient, type WorldClient } from "../../src/render/three/worldClient";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { createDefaultWorldModules, defaultSimulationClockOptions } from "../../src/runtime/experience";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld, createTorusConnectedPairScenario } from "../fixtures/world-objects/geodesic";
import { createTestClientSession } from "../support/clientSession";
import { createTestEngine, runClockFrame, type TestEngineOptions } from "../support/engine";

function setup(options: TestEngineOptions = {}) {
  const session = createTestClientSession();
  const world = compileLargePortalWorld();
  let client: WorldClient | undefined;
  const engine = createTestEngine({
    getWorld: () => world,
    modules: createDefaultWorldModules(),
    submitPublicCommand: (command) => client!.submit(command),
    ...options,
  });
  client = createWorldClient({
    engine,
    session,
    dispatch: (command: RuntimeCommand) => void applyRuntimeCommand(session, command),
    toolStarted: () => {},
    showMessage: () => {},
  });
  const frame = (seconds = 1 / 60): void => {
    engine.applyControls(seconds);
    engine.step(seconds);
    client!.afterStep();
    engine.endFrame();
  };
  /** The promise of `call`, after the frame that answers it. */
  const answered = async (call: () => Promise<CommandResult>): Promise<CommandResult> => {
    const pending = call();
    frame();
    return pending;
  };
  const emitters = engine.publicApis.get("geodesicEmitters") as unknown as GeodesicEmittersPublicApi;
  const model = engine.publicApis.get("geodesicModel") as unknown as GeodesicModelPublicApi;
  const curves = engine.publicApis.get("curveShortening") as unknown as { isAtRest(): boolean };
  return { engine, client: client!, frame, answered, emitters, model, curves };
}

function valueOf<T>(result: CommandResult): T {
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result.value as T;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the default experience's public functions", () => {
  it("are the ones the design names, by module id", () => {
    const { engine } = setup();

    const names = [...engine.publicApis].map(([moduleId, functions]) => [moduleId, Object.keys(functions).sort()]);
    expect(Object.fromEntries(names)).toEqual({
      geodesicModel: ["arcsOfCurve", "tieAndDetach"],
      geodesicEmitters: ["deleteGeodesic", "extend", "place", "remove", "shoot"],
      curveShortening: ["isAtRest"],
    });
  });
});

describe("api.geodesicEmitters", () => {
  it("places, shoots, extends, deletes and removes, resolving with each command's result", async () => {
    const { answered, emitters, engine } = setup();

    const placed = await answered(() => emitters.place("a", { x: 3, y: 2.5, z: 0 }, 0));
    const { emitterId } = valueOf<{ emitterId: string }>(placed);
    expect(placed).toEqual({ ok: true, value: { outcome: "placed", emitterId, arcIds: [] } });

    const shot = await answered(() => emitters.shoot(emitterId, 0, 1));
    const { arcId } = valueOf<{ arcId: string }>(shot);
    expect(shot).toEqual({ ok: true, value: { outcome: "shot", emitterId, arcId } });

    expect(await answered(() => emitters.extend(arcId, 1))).toEqual({ ok: true, value: { outcome: "extended", emitterId, arcId } });
    expect(await answered(() => emitters.deleteGeodesic(emitterId, arcId))).toEqual({ ok: true, value: { outcome: "geodesicDeleted", emitterId, arcId } });
    expect(await answered(() => emitters.remove(emitterId))).toEqual({ ok: true, value: { outcome: "removed", emitterId, arcIds: [] } });
    expect(engine.read.objects.get(emitterId)).toBeUndefined();
  });

  it("answers with the world's refusal, and the gate of a client's command holds", async () => {
    const { answered, emitters } = setup({ isToolEnabled: (toolId) => toolId !== "geodesicEmitters/emitter" });

    expect(await answered(() => emitters.place("a", { x: 3, y: 2.5, z: 0 }, 0))).toMatchObject({ ok: false, refusal: { code: "world/capabilityMissing" } });
  });

  it("gives a result that survives the trip through JSON unchanged", async () => {
    const { answered, emitters } = setup();

    const placed = await answered(() => emitters.place("a", { x: 3, y: 2.5, z: 0 }, 0));
    const refused = await answered(() => emitters.remove("no-such-emitter"));

    expect(JSON.parse(JSON.stringify(placed))).toEqual(placed);
    expect(JSON.parse(JSON.stringify(refused))).toEqual(refused);
  });

  it("waits for the tick: a frame with no tick leaves the promise open, the next tick answers", async () => {
    const { engine, client, emitters } = setup();
    const clock = createSimulationClock(defaultSimulationClockOptions);
    let answer: CommandResult | undefined;

    void emitters.place("a", { x: 3, y: 2.5, z: 0 }, 0).then((result) => {
      answer = result;
    });
    const frameWithNoTick = (): number => {
      const { ticks } = runClockFrame({ ...engine, endFrame: () => { client.afterStep(); engine.endFrame(); } }, clock, 1 / 1000);
      return ticks;
    };
    expect(frameWithNoTick()).toBe(0);
    await Promise.resolve();
    expect(answer).toBeUndefined();

    let frames = 0;
    while (frameWithNoTick() === 0) frames += 1;
    await vi.advanceTimersByTimeAsync(0);
    expect(frames).toBeGreaterThan(0);
    expect(answer).toMatchObject({ ok: true, value: { outcome: "placed" } });
  });

  it("throws at once on an engine with no client, so a wrapper cannot wait for nobody", () => {
    const registry = createRuntimeObjectRegistry();
    const engine = createTestEngine({ registry, modules: [geodesicModelModule(), geodesicEmittersModule()] });
    const emitters = engine.publicApis.get("geodesicEmitters") as unknown as GeodesicEmittersPublicApi;

    expect(() => emitters.remove("e")).toThrow(/no client takes public commands/);
  });
});

describe("api.geodesicModel and api.curveShortening", () => {
  it("ties, reads the curve's arcs and tells when the flow has come to rest", async () => {
    const { world, registry } = createTorusConnectedPairScenario();
    const { answered, frame, model, curves } = setup({ registry, getWorld: () => world });
    const first = { geodesicId: "g1", role: "end", anchorObjectId: "e2" } as const;
    const second = { geodesicId: "g2", role: "start", anchorObjectId: "e2" } as const;

    expect(curves.isAtRest()).toBe(true);
    const tied = await answered(() => model.tieAndDetach("e2", first, second));
    const { vertexId } = valueOf<{ vertexId: string }>(tied);

    expect([...model.arcsOfCurve(vertexId)].sort()).toEqual(["g1", "g2"]);
    expect(curves.isAtRest()).toBe(false);

    for (let frames = 0; frames < 2000 && !curves.isAtRest(); frames += 1) frame();
    expect(curves.isAtRest()).toBe(true);
    expect(model.arcsOfCurve(vertexId)).toEqual([]);
  });

  it("answers a tie at something that is no emitter with the model's refusal", async () => {
    const { answered, model } = setup();
    const end = { geodesicId: "g", role: "end", anchorObjectId: "e" } as const;

    expect(await answered(() => model.tieAndDetach("e", end, { ...end, role: "start" }))).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notAnEmitter" } });
  });
});

describe("what crosses the boundary", () => {
  it("keeps a caller's edit of a refusal away from the next caller", async () => {
    const { answered, emitters, model } = setup();
    const end = { geodesicId: "g", role: "end", anchorObjectId: "e" } as const;
    const edit = (result: CommandResult): void => {
      const mutable = result as { ok: boolean; refusal?: { code: string } };
      mutable.ok = true;
      mutable.refusal!.code = "edited";
    };

    edit(await answered(() => emitters.remove("no-such-emitter")));
    expect(await answered(() => emitters.remove("no-such-emitter"))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/notAnEmitter" } });

    const placed = await answered(() => emitters.place("a", { x: 3, y: 2.5, z: 0 }, 0));
    const { emitterId } = valueOf<{ emitterId: string }>(placed);
    edit(await answered(() => emitters.shoot(emitterId, 0, 0)));
    expect(await answered(() => emitters.shoot(emitterId, 0, 0))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/tooShort" } });

    edit(await answered(() => model.tieAndDetach("e", end, { ...end, role: "start" })));
    expect(await answered(() => model.tieAndDetach("e", end, { ...end, role: "start" }))).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notAnEmitter" } });
  });

  it("refuses what is not plain data, in the frame of the call, and places nothing", async () => {
    const { answered, emitters, model, engine } = setup();
    const withFunction = { x: 3, y: 2.5, z: 0, f: () => 1 };
    const notPlain = { ok: false, refusal: { code: "world/notPlainData" } };

    expect(await answered(() => emitters.place("a", withFunction, 0))).toMatchObject(notPlain);
    expect(await answered(() => emitters.place("a", undefined as never, 0))).toMatchObject(notPlain);
    expect(await answered(() => model.tieAndDetach("e", undefined as never, undefined as never))).toMatchObject(notPlain);
    expect(engine.read.objects.getObjectsOfKind("geodesicEmitters/emitter")).toEqual([]);
  });

  it("answers plain data of the wrong shape with a refusal and no frame error", async () => {
    const { answered, emitters, model } = setup();
    const end = { geodesicId: "g", role: "end", anchorObjectId: "e" } as const;

    expect(await answered(() => emitters.place("a", null as never, 0))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/blocked" } });
    expect(await answered(() => emitters.place(7 as never, { x: 3, y: 2.5, z: 0 }, 0))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/blocked" } });
    expect(await answered(() => emitters.shoot("e", "0" as never, "5" as never))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/notAnEmitter" } });
    expect(await answered(() => emitters.remove({} as never))).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/notAnEmitter" } });
    expect(await answered(() => model.tieAndDetach("e", null as never, end))).toMatchObject({ ok: false, refusal: { code: "geodesicModel/notAttached" } });
    expect(await answered(() => model.tieAndDetach("e", {} as never, {} as never))).toMatchObject({ ok: false });
  });
});

describe("a public function under the write guard", () => {
  it("may not write: it holds reads and wrappers, never a write of its own", () => {
    const writer: AnyModuleDefinition = {
      id: "writer",
      requires: [],
      objectKinds: [{ kind: "writer/thing", label: "real", persistence: "saved" }],
      create: (context) => ({
        api: {},
        queries: {},
        commands: {},
        ticks: [],
        publicApi: { write: () => context.objects.add(createGeodesicEmitterObject({ id: "e", cellId: "a", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }) })) },
      }),
    };
    const engine = createTestEngine({ modules: [writer] });

    expect(() => (engine.publicApis.get("writer")!.write as () => void)()).toThrow(/write guard: a write of .* during a read-only call of module writer/);
  });

  it("may not write through a dependency's api either: what a read calls is still that read", () => {
    const token = defineModuleToken<{ add(): void }>("emitters");
    const provider: AnyModuleDefinition = {
      id: "geodesicEmitters",
      provides: token as ModuleToken<unknown, unknown>,
      requires: [],
      objectKinds: [{ kind: "geodesicEmitters/emitter", label: "real", persistence: "saved" }],
      create: (context) => ({
        api: { add: () => context.objects.add(createGeodesicEmitterObject({ id: "e", cellId: "a", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }) })) },
        queries: {},
        commands: {},
        ticks: [],
      }),
    };
    const caller: AnyModuleDefinition = {
      id: "caller",
      requires: [token as ModuleToken<unknown, unknown>],
      objectKinds: [],
      create: (context) => {
        const dependency = context.require(token as ModuleToken<{ add(): void }, unknown>);
        return { api: {}, queries: {}, commands: {}, ticks: [], publicApi: { go: () => dependency.add() } };
      },
    };
    const engine = createTestEngine({ modules: [provider, caller] });

    expect(() => (engine.publicApis.get("caller")!.go as () => void)()).toThrow(/write guard: a write of .* during a read-only call of module caller/);
    expect(engine.read.objects.get("e")).toBeUndefined();
  });
});
