/**
 * Shared test fake: the shell's tool lookup (`toolsById`) over the default experience's client parts and the shell's own tools with inert handlers, for tests that read descriptors (help, indicators, the wrist).
 */
import { createCoreToolDescriptors } from "../../src/runtime/coreTools";
import { createDefaultClientModules } from "../../src/runtime/experience";
import { createToolsById, type ToolsById } from "../../src/runtime/toolRegistry";

/** The lookup with inert core handlers. */
export function createTestToolsById(): ToolsById {
  return createToolsById(
    createCoreToolDescriptors({
      placeFlag: () => undefined,
      measureLength: () => undefined,
      protractor: () => undefined,
      protractorPrompt: () => "select: vertex",
      carry: () => false,
      rotate: () => false,
      aim: () => false,
    }),
    createDefaultClientModules(),
  );
}
