/**
 * Tests of the pure tool belt definition: the slot order and keys, the config leaving tools out, the map shown disabled with its reason in a world without one, the active slot, and the wheel's stepping over the enabled slots.
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig, type AppConfig } from "../../src/glue/appConfig";
import { beltSlotForKey, createToolBeltDefinition, isEmitterMode, stepBeltSlot } from "../../src/ui/toolBeltDefinition";

function belt(overrides: { config?: AppConfig; worldHasMap?: boolean; selectedTool?: string } = {}) {
  return createToolBeltDefinition({
    appConfig: overrides.config ?? defaultAppConfig,
    worldHasMap: overrides.worldHasMap ?? true,
    selectedTool: (overrides.selectedTool ?? "none") as never,
  });
}

describe("tool belt definition", () => {
  it("lists the Hand, the five tools and the main menu in order with their keys", () => {
    const slots = belt().slots;
    expect(slots.map((slot) => slot.key)).toEqual(["0", "1", "2", "3", "4", "5", "Esc"]);
    expect(slots.map((slot) => slot.name)).toEqual(["Hand", "Laser", "Ruler", "Protractor", "Sign", "Map", "Main menu"]);
    expect(slots.map((slot) => slot.toolId)).toEqual([
      "hand",
      "geodesicEmitters/emitter",
      "geodesicMeasurements/length",
      "geodesicMeasurements/protractor",
      "placedFlags/flag",
      "worldMap/map",
      "main-menu",
    ]);
    expect(slots.every((slot) => slot.subtitle.length > 0 && slot.enabled)).toBe(true);
  });

  it("leaves out a tool the config switches off", () => {
    const config: AppConfig = { ...defaultAppConfig, tools: { ...defaultAppConfig.tools, distances: false, angles: false } };
    expect(belt({ config }).slots.map((slot) => slot.name)).toEqual(["Hand", "Laser", "Sign", "Map", "Main menu"]);
  });

  it("shows the map disabled with its reason in a world without one", () => {
    const map = belt({ worldHasMap: false }).slots.find((slot) => slot.toolId === "worldMap/map");
    expect(map).toMatchObject({ enabled: false, disabledReason: "No map for this world", key: "5" });
    expect(belt().slots.find((slot) => slot.toolId === "worldMap/map")?.disabledReason).toBeUndefined();
  });

  it("marks the Hand, the tool in hand, or the laser for its modes as active", () => {
    const active = (selectedTool: string) => belt({ selectedTool }).slots.filter((slot) => slot.active).map((slot) => slot.name);
    expect(active("none")).toEqual(["Hand"]);
    expect(active("geodesicMeasurements/protractor")).toEqual(["Protractor"]);
    expect(active("geodesicEmitters/rotate")).toEqual(["Laser"]);
    expect(active("geodesicModel/tie")).toEqual(["Laser"]);
  });

  it("tells the laser's own modes from the laser itself", () => {
    expect(isEmitterMode("geodesicEmitters/carry")).toBe(true);
    expect(isEmitterMode("geodesicEmitters/rotate")).toBe(true);
    expect(isEmitterMode("geodesicEmitters/emitter")).toBe(false);
    expect(isEmitterMode("none")).toBe(false);
  });

  it("finds a slot by key", () => {
    expect(beltSlotForKey(belt(), "2")?.name).toBe("Ruler");
    expect(beltSlotForKey(belt(), "9")).toBeUndefined();
  });

  it("steps the wheel over the Hand and enabled tools, wrapping, skipping menu and map", () => {
    const definition = belt({ worldHasMap: false });
    expect(stepBeltSlot(definition, "hand", 1)?.name).toBe("Laser");
    expect(stepBeltSlot(definition, "placedFlags/flag", 1)?.name).toBe("Hand");
    expect(stepBeltSlot(definition, "hand", -1)?.name).toBe("Sign");
    expect(stepBeltSlot(definition, "geodesicEmitters/emitter", -1)?.name).toBe("Hand");
  });
});
