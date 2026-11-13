/**
 * Shared test fake: the shell's tool lookup (`toolsById`) over the default experience's client parts and the shell's own tools with inert handlers, for tests that read descriptors (help, indicators, the wrist).
 */
import { defaultAppConfig, type AppConfig } from "../../src/glue/appConfig";
import { createCoreToolDescriptors } from "../../src/runtime/coreTools";
import { createDefaultClientModules } from "../../src/runtime/experience";
import type { RuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { createToolsById, type ToolsById } from "../../src/runtime/toolRegistry";
import type { InputMode } from "../../src/ui/inputIntents";
import { createPaletteDefinition, type PaletteDefinition } from "../../src/ui/paletteDefinition";

/** The lookup with inert core handlers. */
export function createTestToolsById(): ToolsById {
  return createToolsById(
    createCoreToolDescriptors({
      carry: () => false,
      rotate: () => false,
      aim: () => false,
      emitterModeResult: () => undefined,
    }),
    createDefaultClientModules(),
  );
}

/** The palette definition with the default config, the desktop, the current time and the test tools unless a test says otherwise. */
export function createTestPaletteDefinition(
  state: RuntimeMenuState,
  appConfig: AppConfig = defaultAppConfig,
  inputMode: InputMode = "desktop",
  nowMs: number = Date.now(),
): PaletteDefinition {
  return createPaletteDefinition(state, appConfig, inputMode, nowMs);
}
