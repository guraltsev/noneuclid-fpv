/**
 * `tests/modules/geodesicModel/tieTool.test.ts` - unit tier.
 *
 * The tie tool (design 013 sections 8.3 and 13.1) driven the way the shell drives it, with a fake `ToolContext` whose `pickTargets` returns scripted picks over a real world engine (the geodesic model and the curve shortening flow, write guard on).
 * Two picks of endpoint roles on arcs that connect emitters tie, and the curve then shortens; a duplicate pick is ignored; a geodesic of another emitter and an out-of-range pick are not taken; a refusal from the world is shown and keeps the tool with no picks; success ends the tool and clears its state;
 * ending the tool after one pick takes the highlight off. The experience options are checked here too: with `tieTool: false` there is no tool, no tool id and no emitter-page action, and the tie command still works for scripts.
 */
import { describe, expect, it } from "vitest";
import type { AimPick, AimPickEndpoint, CommandResult, EngineCommandBase, ToolContext, ToolDescriptor, WorldRequestToolCommand } from "../../../src/engine/moduleTypes";
import type { RuntimeToolId } from "../../../src/glue/toolIds";
import { geodesicModelClient, geodesicModelModule } from "../../../src/modules/geodesicModel";
import { geodesicTieToolId, type GeodesicTieAndDetachCommand } from "../../../src/modules/geodesicModel/api";
import { createToolsById, findObjectActionTool, objectActionsFor } from "../../../src/runtime/toolRegistry";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { createFlowTestEngine, createTorusConnectedPairScenario, totalGeodesicLength } from "../../fixtures/world-objects/geodesic";
import { createTestEngine } from "../../support/engine";

const frame60Hz = 1 / 60;

const g1End: AimPickEndpoint = { geodesicId: "g1", role: "end", anchorObjectId: "e2" };
const g2Start: AimPickEndpoint = { geodesicId: "g2", role: "start", anchorObjectId: "e2" };
const g1Start: AimPickEndpoint = { geodesicId: "g1", role: "start", anchorObjectId: "e1" };

function pickOf(endpoint: AimPickEndpoint, withinRange = true): AimPick {
  return { objectId: `${endpoint.geodesicId}:segment`, objectKind: "geodesicModel/segment", cellId: "torus-room", point: { x: 0, y: 0, z: 0 }, withinRange, geodesicEndpoint: endpoint };
}

/** The tie tool over the connected pair of the torus scenario, started from emitter e2, with a fake context that submits to a real engine. */
function setup() {
  const { world, registry } = createTorusConnectedPairScenario();
  const engine = createFlowTestEngine(world, registry);
  const tool: ToolDescriptor = geodesicModelClient().tools[0]!;
  const picks: { current: readonly AimPick[] } = { current: [] };
  const submitted: { readonly ticket: number; readonly command: EngineCommandBase }[] = [];
  const messages: string[] = [];
  const state = { toolState: undefined as unknown, ended: 0 };
  const context: ToolContext = {
    pickTargets: () => picks.current,
    currentPick: () => picks.current[0],
    aimYawRadians: () => 0,
    selectObject: () => undefined,
    showObjectPage: () => undefined,
    submit: (command) => void submitted.push({ ticket: engine.submit("local", command), command }),
    getToolState: <T,>() => state.toolState as T | undefined,
    setToolState: (_moduleId, next) => void (state.toolState = next),
    endTool: () => void (state.ended += 1),
    read: engine.read,
    query: (token) => engine.query(token),
    showMessage: (message) => void messages.push(message),
  };
  /** Steps the world once and gives the tool the result of each command it submitted, as the shell does after a step. */
  function step(): void {
    engine.step(frame60Hz);
    for (const entry of submitted.splice(0)) {
      const result = engine.resultOf(entry.ticket) as CommandResult;
      tool.onResult?.(context, result);
    }
    engine.endFrame();
  }
  function pick(...endpoints: readonly AimPickEndpoint[]): boolean {
    picks.current = endpoints.map((endpoint) => pickOf(endpoint));
    return tool.onPrimaryAction(context);
  }
  const lengthOfCurve = (): number => totalGeodesicLength(registry, "g1") + totalGeodesicLength(registry, "g2");
  const highlighted = (): number => registry.getObjectsOfKind("geodesicModel/segment").filter((segment) => segment.highlightState === "tie-detach-selected").length;
  tool.onStart?.(context, "e2");
  return { tool, engine, registry, context, picks, submitted, messages, state, step, pick, lengthOfCurve, highlighted };
}

describe("the tie tool", () => {
  it("is the tool geodesicModel/tie, started from the object menu of an emitter", () => {
    const { tool } = setup();

    expect(tool.id).toBe(geodesicTieToolId);
    expect(tool.id).toBe("geodesicModel/tie");
    expect(tool.ownerModuleId).toBe("geodesicModel");
    expect(tool.entry).toMatchObject({ kind: "object-action", objectKind: "geodesicEmitters/emitter", action: { actionId: "tie-and-detach" } });
  });

  it("ties two picked ends of connecting arcs, and the curve then shortens", () => {
    const { pick, step, registry, lengthOfCurve, state, picks, tool, context } = setup();
    const lengthBefore = lengthOfCurve();

    expect(pick(g1End)).toBe(true);
    step();
    expect(state.toolState).toMatchObject({ emitterId: "e2", picks: [g1End] });

    picks.current = [pickOf(g2Start)];
    expect(tool.onPrimaryAction(context)).toBe(true);
    step();

    expect(registry.get("g1")).not.toMatchObject({ end: { anchorObjectId: "e2" } });
    expect(registry.get("g2")).not.toMatchObject({ start: { anchorObjectId: "e2" } });
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(1);
    for (let index = 0; index < 20; index += 1) {
      step();
    }
    expect(lengthOfCurve()).toBeLessThan(lengthBefore);
  });

  it("ends the tool and clears its state when the tie succeeds, and the highlight is gone", () => {
    const { pick, step, picks, tool, context, state, highlighted } = setup();

    pick(g1End);
    step();
    expect(highlighted()).toBeGreaterThan(0);
    picks.current = [pickOf(g2Start)];
    tool.onPrimaryAction(context);
    step();

    expect(state.toolState).toBeUndefined();
    expect(state.ended).toBe(1);
    expect(highlighted()).toBe(0);
  });

  it("asks for the second pick with its prompt", () => {
    const { pick, step, tool, context } = setup();

    expect(tool.prompt?.(context)).toBe("select: geodesic 1");
    pick(g1End);
    step();
    expect(tool.prompt?.(context)).toBe("select: geodesic 2");
  });

  it("ignores a duplicate pick", () => {
    const { pick, step, submitted, state } = setup();

    expect(pick(g1End)).toBe(true);
    step();
    expect(pick(g1End)).toBe(true);

    expect(submitted).toHaveLength(0);
    expect(state.toolState).toMatchObject({ picks: [g1End] });
  });

  it("does not take a geodesic end of another emitter", () => {
    const { pick, submitted, state } = setup();

    expect(pick(g1Start)).toBe(false);

    expect(submitted).toHaveLength(0);
    expect(state.toolState).toMatchObject({ picks: [] });
  });

  it("does not take a pick that is out of range", () => {
    const { picks, tool, context, submitted, state } = setup();

    picks.current = [pickOf(g1End, false)];

    expect(tool.onPrimaryAction(context)).toBe(false);
    expect(submitted).toHaveLength(0);
    expect(state.toolState).toMatchObject({ picks: [] });
  });

  it("takes the first pick of the ray that is an end it can use", () => {
    const { picks, tool, context, state } = setup();

    picks.current = [pickOf(g1Start), pickOf(g1End, false), pickOf(g2Start)];

    expect(tool.onPrimaryAction(context)).toBe(true);
    expect(state.toolState).toMatchObject({ picks: [g2Start] });
  });

  it("shows a refusal from the world and keeps the tool with no picks", () => {
    const { pick, step, picks, tool, context, registry, messages, state } = setup();

    pick(g1End);
    step();
    picks.current = [pickOf(g2Start)];
    tool.onPrimaryAction(context);
    // The arc vanishes between the pick and the step, so the world cannot tie it.
    registry.remove("g2");
    step();

    expect(messages).toHaveLength(1);
    expect(state.toolState).toMatchObject({ emitterId: "e2", picks: [] });
    expect(state.ended).toBe(0);
  });

  it("takes the highlight off when the tool ends after one pick", () => {
    const { pick, step, tool, context, highlighted } = setup();

    pick(g1End);
    step();
    expect(highlighted()).toBeGreaterThan(0);
    tool.onEnd?.(context);
    step();

    expect(highlighted()).toBe(0);
  });

  it("marks only the half of the picked end", () => {
    const { pick, step, registry } = setup();

    pick(g1End);
    step();

    const halves = getGeodesicSegments(registry, "g1").filter((segment) => segment.highlightState === "tie-detach-selected");
    expect(halves.length).toBeGreaterThan(0);
    expect(halves.every((segment) => segment.halfRole === "end")).toBe(true);
  });
});

describe("the tie tool in an experience", () => {
  it("is on the emitter page, available when the emitter has two ends on connecting arcs", () => {
    const { engine } = setup();
    const toolsById = createToolsById([], [geodesicModelClient()]);
    const context = { query: (token) => engine.query(token) } as ToolContext;

    const actions = objectActionsFor(toolsById, "geodesicEmitters/emitter", "e2", () => context);

    expect(actions).toEqual([expect.objectContaining({ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", enabled: true })]);
    expect(findObjectActionTool(toolsById, "geodesicEmitters/emitter", "tie-and-detach")?.id).toBe(geodesicTieToolId);
    expect(objectActionsFor(toolsById, "geodesicEmitters/emitter", "nobody", () => context)[0]?.enabled).toBe(false);
    expect(objectActionsFor(toolsById, "asset", "e2", () => context)).toEqual([]);
  });

  it("has no tool and no page action with tieTool false; the command still works", () => {
    const client = geodesicModelClient({ tieTool: false });
    const toolsById = createToolsById([], [client]);
    const { world, registry } = createTorusConnectedPairScenario();
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule({ tieTool: false })] });
    const context = { query: (token) => engine.query(token) } as ToolContext;

    expect(client.tools).toEqual([]);
    expect(objectActionsFor(toolsById, "geodesicEmitters/emitter", "e2", () => context)).toEqual([]);
    const requestCommand: WorldRequestToolCommand = { kind: "world/requestTool", toolId: geodesicTieToolId };
    const request = engine.submit("local", requestCommand);
    const tie: GeodesicTieAndDetachCommand = { kind: "geodesicModel/tieAndDetach", emitterId: "e2", first: g1End, second: g2Start };
    const ticket = engine.submit("local", tie);
    engine.step(0);

    expect(engine.resultOf(request)).toMatchObject({ ok: false, refusal: { code: "world/unknownTool" } });
    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
  });

  it("requires the tool for the tie command by default", () => {
    const { world, registry } = createTorusConnectedPairScenario();
    const disabled: RuntimeToolId = geodesicTieToolId;
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule()], isToolEnabled: (toolId) => toolId !== disabled });
    const tie: GeodesicTieAndDetachCommand = { kind: "geodesicModel/tieAndDetach", emitterId: "e2", first: g1End, second: g2Start };

    const ticket = engine.submit("local", tie);
    engine.step(0);

    expect(engine.resultOf(ticket)).toMatchObject({ ok: false, refusal: { code: "world/capabilityMissing" } });
  });
});
