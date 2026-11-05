/**
 * `tests/render/worldClient.test.ts` — unit tier.
 *
 * The shell's side of the tool-switch protocol (design 013 section 8.1): selecting a tool asks the world first, switches only when the world accepts, shows the world's message and stays on the old tool when it refuses, and leaves a tool the world revokes. Also `api.world`: `submit` resolves with the command's result after the next step, and `participants` lists the bodies.
 */
import { describe, expect, it } from "vitest";
import type { AnyModuleDefinition, ToolGate } from "../../src/engine/moduleTypes";
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

  it("shows a module gate's message", () => {
    const gate: ToolGate = ({ toolId }) => (toolId === "place-flag" ? { refused: true, code: "inventory/missing", message: "You have not found a flag yet." } : undefined);
    const module: AnyModuleDefinition = {
      id: "inventory",
      requires: [],
      objectKinds: [],
      create: () => ({ api: {}, queries: {}, commands: {}, ticks: [], toolGates: [gate] }),
    };
    const { client, messages, session, frame } = setup({ modules: [module] });

    client.requestTool("place-flag");
    frame();

    expect(messages).toEqual(["You have not found a flag yet."]);
    expect(session.get().menuState.selectedTool).toBe("none");
  });

  it("leaves the selected tool when the world revokes it", () => {
    let revoked = false;
    const gate: ToolGate = ({ toolId }) => (revoked && toolId === "measure-length" ? { refused: true, code: "inventory/taken", message: "The ruler was taken away." } : undefined);
    const module: AnyModuleDefinition = {
      id: "inventory",
      requires: [],
      objectKinds: [],
      create: () => ({
        api: {},
        queries: {},
        commands: {},
        ticks: [{ id: "inventory/notice", phase: "simulate", writes: [], isIdle: () => !revoked, run: (ctx) => ctx.capabilitiesChanged("local") }],
        toolGates: [gate],
      }),
    };
    const { client, session, messages, frame } = setup({ modules: [module] });
    client.requestTool("measure-length");
    frame();
    expect(session.get().menuState.selectedTool).toBe("measure-length");

    revoked = true;
    frame();

    expect(session.get().menuState.selectedTool).toBe("none");
    expect(messages).toEqual(["The ruler was taken away."]);
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

  it("lists the participants", () => {
    const { client } = setup();
    const participants = (client.api.participants as () => { id: string; kind: string }[])();
    expect(participants.map((participant) => [participant.id, participant.kind])).toEqual([["local", "local-player"]]);
  });
});
