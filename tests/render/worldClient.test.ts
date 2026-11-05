/**
 * `tests/render/worldClient.test.ts` — unit tier.
 *
 * The shell's side of the tool-switch protocol (design 013 section 8.1): selecting a tool asks the world first, switches only when the world accepts, and shows the world's message and stays on the old tool when it refuses. An event's message is shown. Also `api.world`: `submit` resolves with the command's result after the next step, `participants` lists the bodies, and `stepIndex` counts the steps.
 */
import { describe, expect, it } from "vitest";
import type { AnyModuleDefinition, CommandContext } from "../../src/engine/moduleTypes";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createWorldClient } from "../../src/render/three/worldClient";
import { createTestClientSession } from "../support/clientSession";
import { createTestEngine, type TestEngineOptions } from "../support/engine";

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

    client.requestTool("measure-length");
    expect(session.get().menuState.selectedTool).toBe("none");
    expect(session.get().pendingToolRequest?.toolId).toBe("measure-length");

    frame();
    expect(session.get().menuState.selectedTool).toBe("measure-length");
    expect(session.get().pendingToolRequest).toBeUndefined();
  });

  it("tells the shell which object a tool was started from, only once the world accepted", () => {
    const { client, started, frame } = setup();

    client.requestTool("measure-length", "cannon-a");
    expect(started).toEqual([]);

    frame();
    expect(started).toEqual([{ toolId: "measure-length", objectId: "cannon-a" }]);
  });

  it("shows the world's message and keeps the old tool when the configuration disables it", () => {
    const { client, session, messages, frame } = setup({ isToolEnabled: (toolId) => toolId !== "protractor" });

    client.requestTool("protractor");
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
    client.requestTool("measure-length");
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
