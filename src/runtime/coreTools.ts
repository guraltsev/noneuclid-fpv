/**
 * The descriptors of the tools the shell defines itself (design 013 section 8.3): sign, geodesic ray, length, protractor, and the emitter's carry, rotate and aim sub-modes.
 * Their behavior stays in the shell (carry, rotate and aim update from the input each frame, section 16); a descriptor only calls the handler the shell passes in. The tools modules contribute come from the modules' client parts.
 * "none" and "aim" are not tools with descriptors: with neither selected the primary action acts on the focused object.
 */
import type { ToolDescriptor } from "../engine/moduleTypes";

/** What the shell does for each core tool; each handler reads the current frame's input itself. */
export interface CoreToolHandlers {
  placeFlag(): void;
  useGeodesicCannon(): void;
  measureLength(): void;
  protractor(): void;
  /** The protractor's prompt, from its picks. */
  protractorPrompt(): string;
  /** Carry, every frame: finishes the carry when the primary action was requested; true then. */
  carry(): boolean;
  /** Rotate, every frame; true when the primary action was requested. */
  rotate(): boolean;
  /** Aim, every frame; true when the primary action was requested. */
  aim(): boolean;
}

/** The descriptors of the core tools. */
export function createCoreToolDescriptors(handlers: CoreToolHandlers): readonly ToolDescriptor[] {
  const base = { ownerModuleId: "core", entry: { kind: "main-tool" } } as const;
  return [
    {
      ...base,
      id: "place-flag",
      label: "Sign",
      helpTitle: "Sign tool",
      helpBody: "Places a note on the floor where you aim.",
      helpRows: [{ input: "primary", label: "place sign" }, { input: "context-menu", label: "open tools" }],
      indicatorColor: "#22c55e",
      iconId: "sign",
      showsAimCross: true,
      onPrimaryAction: () => (handlers.placeFlag(), true),
    },
    {
      ...base,
      id: "geodesicEmitters/emitter",
      label: "Geodesic emitter",
      badgeLabel: "Ray",
      helpTitle: "Ray tool",
      helpBody: "Places geodesic emitters and starts locally straight rays.",
      helpRows: [{ input: "primary", label: "place or continue ray" }, { input: "context-menu", label: "open choices" }],
      indicatorColor: "#facc15",
      iconId: "ray",
      showsAimCross: true,
      onPrimaryAction: () => (handlers.useGeodesicCannon(), true),
    },
    {
      ...base,
      id: "measure-length",
      label: "Length",
      helpTitle: "Length tool",
      helpBody: "Measures total length along a selected geodesic.",
      helpRows: [{ input: "primary", label: "choose geodesic" }, { input: "context-menu", label: "open choices" }],
      indicatorColor: "#22c55e",
      iconId: "length",
      showsAimCross: true,
      prompt: () => "select: geodesic",
      onPrimaryAction: () => (handlers.measureLength(), true),
    },
    {
      ...base,
      id: "protractor",
      label: "Protractor",
      helpTitle: "Protractor tool",
      helpBody: "Measures the angle between two geodesic sides at a vertex.",
      helpRows: [{ input: "primary", label: "select vertex or side" }, { input: "context-menu", label: "open choices" }],
      indicatorColor: "#fb7185",
      iconId: "protractor",
      showsAimCross: true,
      prompt: () => handlers.protractorPrompt(),
      onPrimaryAction: () => (handlers.protractor(), true),
    },
    {
      ...base,
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
    },
    {
      ...base,
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
    },
    {
      ...base,
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
    },
  ];
}
