/**
 * Tool gates and the confirmation protocol's world side (design 013 section 8).
 * The engine asks the experience's tool configuration: a tool outside it is refused with `world/toolDisabled`.
 */
import type { RuntimeToolId } from "../glue/toolIds";

/** Why a tool is refused. */
export interface ToolRefusal {
  readonly code: string;
  readonly message: string;
}

/** The gates of one engine. */
export interface ToolGates {
  /** True for a core tool id or a module's. */
  isKnownTool(toolId: string): boolean;
  /** The refusal, or undefined when the tool may be used. */
  refusal(toolId: RuntimeToolId): ToolRefusal | undefined;
}

/** Options of {@link createToolGates}. */
export interface ToolGatesOptions {
  /** The tool configuration: false disables a tool in this world. */
  readonly isToolEnabled: (toolId: RuntimeToolId) => boolean;
  /** Every tool id of the experience: core tools and modules'. */
  readonly toolIds: readonly RuntimeToolId[];
}

/** Creates the gates. */
export function createToolGates(options: ToolGatesOptions): ToolGates {
  const known = new Set<string>(options.toolIds);
  return {
    isKnownTool: (toolId) => known.has(toolId),
    refusal(toolId) {
      if (options.isToolEnabled(toolId)) return undefined;
      return { code: "world/toolDisabled", message: "This tool is not available in this world." };
    },
  };
}
