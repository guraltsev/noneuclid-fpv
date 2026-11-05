/**
 * Tool gates and the confirmation protocol's world side (design 013 section 8).
 * The engine asks the experience's tool configuration first (a tool outside it is refused with `world/toolDisabled`), then each module's gates in module order; the first refusal wins. A gate is a pure function of the read view.
 * The gates also remember, per participant, which tools were refused at the last look, so that a module's `capabilitiesChanged` yields exactly the tools that are newly refused (the engine turns those into `world/toolRevoked` events).
 */
import type { RuntimeToolId } from "../glue/toolIds";
import type { ToolGate, WorldReadView } from "./moduleTypes";

/** Why a tool is refused. */
export interface ToolRefusal {
  readonly code: string;
  readonly message: string;
}

/** A tool newly refused to a participant. */
export interface RevokedTool extends ToolRefusal {
  readonly toolId: RuntimeToolId;
}

/** The gates of one engine. */
export interface ToolGates {
  /** True for a core tool id or a module's. */
  isKnownTool(toolId: string): boolean;
  /** The first refusal, or undefined when the participant may use the tool. */
  refusal(participantId: string, toolId: RuntimeToolId): ToolRefusal | undefined;
  /** Records the current answers for a participant without reporting anything. */
  remember(participantId: string): void;
  /** Re-asks every tool for the participant; returns those refused now and not at the last look, and remembers the new answers. */
  revoked(participantId: string): readonly RevokedTool[];
}

/** Options of {@link createToolGates}. */
export interface ToolGatesOptions {
  /** The tool configuration: false disables a tool in this world. */
  readonly isToolEnabled: (toolId: RuntimeToolId) => boolean;
  /** Module gates in module order. */
  readonly moduleGates: readonly ToolGate[];
  /** Every tool id of the experience: core tools and modules'. */
  readonly toolIds: readonly RuntimeToolId[];
  readonly read: WorldReadView;
}

/** Creates the gates. */
export function createToolGates(options: ToolGatesOptions): ToolGates {
  const known = new Set<string>(options.toolIds);
  const refusedByParticipant = new Map<string, Set<string>>();

  function refusal(participantId: string, toolId: RuntimeToolId): ToolRefusal | undefined {
    if (!options.isToolEnabled(toolId)) {
      return { code: "world/toolDisabled", message: "This tool is not available in this world." };
    }
    for (const gate of options.moduleGates) {
      const answer = gate({ participantId, toolId, read: options.read });
      if (answer) return { code: answer.code, message: answer.message };
    }
    return undefined;
  }

  return {
    isKnownTool: (toolId) => known.has(toolId),
    refusal,
    remember(participantId) {
      const refused = new Set<string>();
      for (const toolId of options.toolIds) {
        if (refusal(participantId, toolId)) refused.add(toolId);
      }
      refusedByParticipant.set(participantId, refused);
    },
    revoked(participantId) {
      const before = refusedByParticipant.get(participantId) ?? new Set<string>();
      const now = new Set<string>();
      const newlyRefused: RevokedTool[] = [];
      for (const toolId of options.toolIds) {
        const answer = refusal(participantId, toolId);
        if (!answer) continue;
        now.add(toolId);
        if (!before.has(toolId)) newlyRefused.push({ ...answer, toolId });
      }
      refusedByParticipant.set(participantId, now);
      return newlyRefused;
    },
  };
}
