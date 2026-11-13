/**
 * `tests/modules/worldMap.test.ts` - unit tier.
 *
 * The world map tool: the engine knows it and the primary action dismisses it. Whether a world has a map is one decision, `appConfigForWorld`, and its reach is checked here: a solid keeps the tool, any other surface loses it from the palette and from the world's gate, and a config can switch it off anywhere.
 */
import { describe, expect, it, vi } from "vitest";
import { cube, dodecahedron, genus2Torus, torus, torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CommandResult, EngineCommandBase, ToolContext, ToolDescriptor } from "../../src/engine/moduleTypes";
import { appConfigForWorld, defaultAppConfig, getEnabledMainTools, isRuntimeToolEnabled, normalizeAppConfig } from "../../src/glue/appConfig";
import { worldMapClient, worldMapModule, worldMapToolId } from "../../src/modules/worldMap";
import { createTestEngine } from "../support/engine";
import { createToolBeltDefinition } from "../../src/ui/toolBeltDefinition";

const tool = worldMapClient().tools[0] as ToolDescriptor;

function toolIdsOnPalette(config: typeof defaultAppConfig): readonly string[] {
  return createToolBeltDefinition({ appConfig: config, worldHasMap: true, selectedTool: "none" }).slots.map((slot) => slot.toolId);
}

function requestTool(isToolEnabled: (toolId: string) => boolean): CommandResult {
  const engine = createTestEngine({ modules: [worldMapModule()], isToolEnabled });
  const ticket = engine.submit("local", { kind: "world/requestTool", toolId: worldMapToolId } as EngineCommandBase);
  engine.step(0);
  return engine.resultOf(ticket) as CommandResult;
}

describe("the map tool", () => {
  it("is a tool of the main list, with no aim cross", () => {
    expect(tool.id).toBe(worldMapToolId);
    expect(tool.entry.kind).toBe("main-tool");
    expect(tool.showsAimCross).toBe(false);
  });

  it("ends on the primary action, and takes the input", () => {
    const endTool = vi.fn();
    expect(tool.onPrimaryAction({ endTool } as unknown as ToolContext)).toBe(true);
    expect(endTool).toHaveBeenCalledOnce();
  });

  it("is known to the engine", () => {
    expect(requestTool(() => true)).toMatchObject({ ok: true });
  });

  it("is refused by the world where it is off", () => {
    expect(requestTool((toolId) => toolId !== worldMapToolId)).toMatchObject({ ok: false, refusal: { code: "world/toolDisabled" } });
  });
});

describe("appConfigForWorld", () => {
  it.each([["cube", cube], ["dodecahedron", dodecahedron]] as const)("keeps the tool in the %s", (_name, spec) => {
    const config = appConfigForWorld(defaultAppConfig, compileCellComplex(spec));
    expect(isRuntimeToolEnabled(config, worldMapToolId)).toBe(true);
    expect(toolIdsOnPalette(config)).toContain(worldMapToolId);
  });

  it.each([["torus", torus], ["torus moduli", torusModuli], ["genus 2", genus2Torus]] as const)("takes the tool away in the %s, and no other", (_name, spec) => {
    const config = appConfigForWorld(defaultAppConfig, compileCellComplex(spec));
    expect(isRuntimeToolEnabled(config, worldMapToolId)).toBe(false);
    expect(toolIdsOnPalette(config)).not.toContain(worldMapToolId);
    expect(getEnabledMainTools(config)).toHaveLength(getEnabledMainTools(defaultAppConfig).length - 1);
  });

  it("does not turn on a tool the config turned off", () => {
    const off = normalizeAppConfig({ tools: { worldMap: false } });
    expect(appConfigForWorld(off, compileCellComplex(cube)).tools.worldMap).toBe(false);
  });
});
