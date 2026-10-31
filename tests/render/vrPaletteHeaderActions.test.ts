import { describe, expect, it } from "vitest";
import {
  createRuntimeMenuState,
  showRuntimeMenuDebugSettings,
  showRuntimeMenuSettings,
} from "../../src/runtime/runtimeMenuState";
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";
import { resolveVrPaletteHeaderActions } from "../../src/render/three/vrPaletteHeaderActions";

describe("vrPaletteHeaderActions", () => {
  it("keeps settings and close available on the main VR menu", () => {
    const definition = createPaletteDefinition(createRuntimeMenuState({
      selectedWorldId: "cube",
      debugOverlayEnabled: true,
    }));
    const actions = resolveVrPaletteHeaderActions(definition);

    expect(actions.leftAction.id).toBe("settings");
    expect(actions.rightAction.id).toBe("close");
  });

  it("puts back on the left and close on the right for the VR settings submenu", () => {
    const definition = createPaletteDefinition(showRuntimeMenuSettings(createRuntimeMenuState({
      selectedWorldId: "cube",
      debugOverlayEnabled: true,
    })));
    const actions = resolveVrPaletteHeaderActions(definition);

    expect(actions.leftAction.id).toBe("back");
    expect(actions.rightAction.id).toBe("close");
  });

  it("puts back on the left and close on the right for the VR debug submenu", () => {
    const definition = createPaletteDefinition(showRuntimeMenuDebugSettings(createRuntimeMenuState({
      selectedWorldId: "cube",
      debugOverlayEnabled: true,
    })));
    const actions = resolveVrPaletteHeaderActions(definition);

    expect(actions.leftAction.id).toBe("back");
    expect(actions.rightAction.id).toBe("close");
  });
});
