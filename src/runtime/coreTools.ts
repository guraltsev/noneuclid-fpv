/**
 * The descriptors of the tools the shell defines itself (design 013 section 8.3): the emitter's carry, rotate and aim sub-modes.
 * Their behavior stays in the shell (carry, rotate and aim are the client's sources for the world's control slots, section 7); a descriptor only calls the handler the shell passes in. The tools modules contribute come from the modules' client parts.
 * "none" and "aim" are not tools with descriptors: with neither selected the primary action acts on the focused object.
 */
import type { CommandResult, ToolDescriptor } from "../engine/moduleTypes";

/** The emitter's sub-modes. */
export type EmitterModeToolId = "geodesicEmitters/carry" | "geodesicEmitters/rotate" | "geodesicEmitters/aim";

/** What the shell does for each core tool; each handler reads the current frame's input itself. */
export interface CoreToolHandlers {
  /** Carry, every frame: finishes the carry when the primary action was requested; true then. */
  carry(): boolean;
  /** Rotate, every frame; true when the primary action was requested. */
  rotate(): boolean;
  /** Aim, every frame; true when the primary action was requested. */
  aim(): boolean;
  /** The world answered a command of one of the emitter's sub-modes. */
  emitterModeResult(toolId: EmitterModeToolId, result: CommandResult): void;
}

/** The descriptors of the core tools. */
export function createCoreToolDescriptors(handlers: CoreToolHandlers): readonly ToolDescriptor[] {
  const subMode = { ownerModuleId: "core", entry: { kind: "sub-mode" } } as const;
  return [
    {
      ...subMode,
      id: "geodesicEmitters/carry",
      label: "Carry",
      helpTitle: "Carry emitter",
      helpBody: "Moves the selected geodesic emitter while preserving its editable rays.",
      helpRows: [{ input: "primary", label: "place emitter" }],
      indicatorColor: "#fb7ac8",
      iconId: "carry",
      showsAimCross: false,
      runsEveryFrame: true,
      onPrimaryAction: () => handlers.carry(),
      onResult: (_tool, result) => handlers.emitterModeResult("geodesicEmitters/carry", result),
    },
    {
      ...subMode,
      id: "geodesicEmitters/rotate",
      label: "Turn",
      badgeLabel: "Rotate",
      helpTitle: "Rotate ray",
      helpBody: "Turns the selected geodesic around its emitter.",
      helpRows: [{ input: "primary", label: "finish rotation" }],
      indicatorColor: "#a78bfa",
      iconId: "rotate",
      showsAimCross: false,
      runsEveryFrame: true,
      onPrimaryAction: () => handlers.rotate(),
      onResult: (_tool, result) => handlers.emitterModeResult("geodesicEmitters/rotate", result),
    },
    {
      ...subMode,
      id: "geodesicEmitters/aim",
      label: "Aim ray",
      badgeLabel: "Aim",
      helpTitle: "Aim ray",
      helpBody: "Points the selected geodesic toward the aimed location.",
      helpRows: [{ input: "primary", label: "accept aim" }],
      indicatorColor: "#facc15",
      iconId: "aim",
      showsAimCross: true,
      runsEveryFrame: true,
      onPrimaryAction: () => handlers.aim(),
      onResult: (_tool, result) => handlers.emitterModeResult("geodesicEmitters/aim", result),
    },
  ];
}
