/**
 * `tests/render/worldClient.test.ts` — unit tier.
 *
 * The shell's side of the tool-switch protocol (design 013 section 8.1): selecting a tool asks the world first, switches only when the world accepts, and shows the world's message and stays on the old tool when it refuses. An event's message is shown. Also `api.world`: `submit` resolves with the command's result after the next step, `participants` lists the bodies, and `stepIndex` counts the steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyModuleDefinition, CommandContext } from "../../src/engine/moduleTypes";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { commandAnswerDeadlineMs, createWorldClient } from "../../src/render/three/worldClient";
import { createTestClientSession } from "../support/clientSession";
import { createTestEngine, type TestEngineOptions } from "../support/engine";

// A submitted command starts a deadline, and a unit test runs no real timer.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(options: TestEngineOptions = {}) {
  const engine = createTestEngine(options);
  const session = createTestClientSession();
  const messages: string[] = [];
  const started: { toolId: string; objectId: string | undefined }[] = [];
  const client = createWorldClient({
    engine,
    session,
    dispatch: (command: RuntimeCommand) => void applyRuntimeCommand(session, command),
    toolStarted: (toolId, objectId) => void started.push({ toolId, objectId }),
    showMessage: (message) => void messages.push(message),
  });
  const frame = (): void => {
    engine.step(1 / 60);
    client.afterStep();
    engine.endFrame();
  };
  return { engine, session, client, messages, started, frame };
}

describe("selecting a tool", () => {
  it("keeps the old tool until the world accepts, then switches", () => {
    const { client, session, frame } = setup();

    client.requestTool("geodesicEmitters/carry");
    expect(session.get().menuState.selectedTool).toBe("none");
    expect(session.get().pendingToolRequest?.toolId).toBe("geodesicEmitters/carry");

    frame();
    expect(session.get().menuState.selectedTool).toBe("geodesicEmitters/carry");
    expect(session.get().pendingToolRequest).toBeUndefined();
  });

  it("tells the shell which object a tool was started from, only once the world accepted", () => {
    const { client, started, frame } = setup();

    client.requestTool("geodesicEmitters/carry", "cannon-a");
    expect(started).toEqual([]);

    frame();
    expect(started).toEqual([{ toolId: "geodesicEmitters/carry", objectId: "cannon-a" }]);
  });

  it("shows the world's message and keeps the old tool when the configuration disables it", () => {
    const { client, session, messages, frame } = setup({ isToolEnabled: (toolId) => toolId !== "geodesicEmitters/rotate" });

    client.requestTool("geodesicEmitters/rotate");
    frame();

    expect(session.get().menuState.selectedTool).toBe("none");
    expect(session.get().pendingToolRequest).toBeUndefined();
    expect(messages).toEqual(["This tool is not available in this world."]);
  });

});

describe("the event sink", () => {
  it("shows the message of an event that has one", () => {
    const module: AnyModuleDefinition = {
      id: "notice",
      requires: [],
      objectKinds: [],
      create: () => ({
        api: {},
        queries: {},
        commands: {
          "notice/post": {
            run: (_command: never, ctx: CommandContext) => {
              ctx.emit({ kind: "notice/silent" });
              ctx.emit({ kind: "notice/posted", message: "The notice was posted." });
              return { ok: true };
            },
          },
        },
        ticks: [],
      }),
    };
    const { engine, messages, frame } = setup({ modules: [module] });

    engine.submit("local", { kind: "notice/post" });
    frame();

    expect(messages).toEqual(["The notice was posted."]);
  });
});

describe("a caller who waits for an answer", () => {
  const submitted = { kind: "world/requestTool", toolId: "aim" } as const;

  it("is answered with a refusal when the app goes, a world change and a restart included", async () => {
    const { client } = setup();

    const pending = client.submit(submitted);
    client.dispose();

    expect(await pending).toEqual({ ok: false, refusal: { code: "world/disposed", message: "The world was closed." } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is answered at once after the app has gone, through a function kept from before", async () => {
    const { engine, client, frame } = setup();
    const keptSubmit = client.api.submit as (command: unknown) => Promise<unknown>;
    client.dispose();

    expect(await keptSubmit(submitted)).toMatchObject({ ok: false, refusal: { code: "world/disposed" } });
    const before = engine.read.stepIndex;
    frame();
    expect(engine.read.stepIndex).toBe(before + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gets a refusal of its own, whatever an earlier caller did to theirs", async () => {
    const { client } = setup();
    client.dispose();

    const first = (await client.submit(submitted)) as { refusal: { code: string } };
    first.refusal.code = "edited";

    expect(await client.submit(submitted)).toMatchObject({ refusal: { code: "world/disposed" } });
  });

  it("is told the world ran no step, and the command is taken back and never runs", async () => {
    let runs = 0;
    const counting: AnyModuleDefinition = {
      id: "counting",
      requires: [],
      objectKinds: [],
      create: () => ({
        api: {},
        queries: {},
        commands: { "counting/count": { run: () => { runs += 1; return { ok: true }; } } },
        ticks: [],
      }),
    };
    const { client, frame } = setup({ modules: [counting] });

    const pending = client.submit({ kind: "counting/count" });
    await vi.advanceTimersByTimeAsync(commandAnswerDeadlineMs);

    expect(await pending).toMatchObject({ ok: false, refusal: { code: "world/noAnswer" } });
    frame();
    expect(runs).toBe(0);
  });

  it("has its deadline dropped once answered", async () => {
    const { client, frame } = setup();

    const pending = client.submit(submitted);
    frame();

    expect(await pending).toMatchObject({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the answer when showing a message throws in the same frame", async () => {
    const broken: AnyModuleDefinition = {
      id: "notice",
      requires: [],
      objectKinds: [],
      create: () => ({
        api: {},
        queries: {},
        commands: {
          "notice/post": {
            run: (_command: never, ctx: CommandContext) => {
              ctx.emit({ kind: "notice/posted", message: "The notice was posted." });
              return { ok: true };
            },
          },
        },
        ticks: [],
      }),
    };
    const engine = createTestEngine({ modules: [broken] });
    const session = createTestClientSession();
    const client = createWorldClient({
      engine,
      session,
      dispatch: (command: RuntimeCommand) => void applyRuntimeCommand(session, command),
      toolStarted: () => {},
      showMessage: () => {
        throw new Error("no screen");
      },
    });

    const pending = client.submit({ kind: "notice/post" });
    engine.step(1 / 60);
    expect(() => client.afterStep()).toThrow("no screen");
    engine.endFrame();

    expect(await pending).toEqual({ ok: true });
  });
});

describe("api.world", () => {
  it("resolves a submitted command with its result after the next step", async () => {
    const { client, frame } = setup({ isToolEnabled: () => false });
    const submit = client.api.submit as (command: unknown) => Promise<unknown>;

    const pending = submit({ kind: "world/requestTool", toolId: "aim" });
    frame();

    expect(await pending).toMatchObject({ ok: false, refusal: { code: "world/toolDisabled" } });
    expect(() => submit({ nope: 1 })).toThrow(/string kind/);
  });

  it("answers a caller and a pending tool request when a handler throws", async () => {
    const broken: AnyModuleDefinition = {
      id: "broken",
      requires: [],
      objectKinds: [],
      create: () => ({
        api: {},
        queries: {},
        commands: { "broken/boom": { run: () => { throw new Error("boom"); } } },
        ticks: [],
      }),
    };
    const isToolEnabled = (): boolean => {
      throw new Error("configuration");
    };
    const { engine, client, session, messages } = setup({ modules: [broken], isToolEnabled });
    const submit = client.api.submit as (command: unknown) => Promise<unknown>;

    const pending = submit({ kind: "broken/boom" });
    client.requestTool("geodesicEmitters/carry");
    // The shell's frame: the step and the client's read are separate guarded phases.
    expect(() => engine.step(1 / 60)).toThrow("boom");
    client.afterStep();
    engine.endFrame();

    expect(await pending).toMatchObject({ ok: false, refusal: { code: "world/internalError" } });
    expect(session.get().pendingToolRequest).toBeUndefined();
    expect(session.get().menuState.selectedTool).toBe("none");
    expect(messages).toEqual(["The command failed inside the world."]);
  });

  it("counts the engine's steps", () => {
    const { client, frame } = setup();
    const stepIndex = client.api.stepIndex as () => number;

    expect(stepIndex()).toBe(0);
    frame();
    frame();
    expect(stepIndex()).toBe(2);
  });

  it("lists the participants", () => {
    const { client } = setup();
    const participants = (client.api.participants as () => { id: string; kind: string }[])();
    expect(participants.map((participant) => [participant.id, participant.kind])).toEqual([["local", "local-player"]]);
  });
});
