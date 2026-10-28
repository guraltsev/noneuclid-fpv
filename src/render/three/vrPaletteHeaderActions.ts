/**
 * Maps the palette definition's header actions onto the layout used by the in-scene (XR and desktop) palette header.
 * Unlike the DOM palette, the in-scene panel always shows a close button on the right; a "back" action is moved to the left slot instead.
 * Pure logic over PaletteDefinition from src/ui/paletteDefinition.ts, with no Three.js dependency.
 */
import type { PaletteDefinition, PaletteHeaderAction } from "../../ui/paletteDefinition";

/**
 * The two header buttons the in-scene palette actually renders.
 */
export interface VrPaletteHeaderActions {
  /** Button drawn at the left edge of the header. */
  readonly leftAction: PaletteHeaderAction;
  /** Button drawn at the right edge of the header; always has id "close" unless the definition already supplied a close action. */
  readonly rightAction: PaletteHeaderAction;
}

/**
 * Resolves the left and right header actions for the in-scene palette from a palette definition.
 * If the definition's right action is "back" it moves to the left slot (discarding the definition's left action) and a synthesized close button takes the right slot;
 * if the right action is already "close" both actions pass through; for any other right action the left action is kept and the right action is replaced by a close button.
 * Pure; the synthesized close action is a fresh object on each call.
 */
export function resolveVrPaletteHeaderActions(
  definition: Pick<PaletteDefinition, "leftAction" | "rightAction">,
): VrPaletteHeaderActions {
  if (definition.rightAction.id === "back") {
    return {
      leftAction: definition.rightAction,
      rightAction: createCloseHeaderAction(),
    };
  }

  if (definition.rightAction.id === "close") {
    return {
      leftAction: definition.leftAction,
      rightAction: definition.rightAction,
    };
  }

  return {
    leftAction: definition.leftAction,
    rightAction: createCloseHeaderAction(),
  };
}

// Fabricates the standard enabled close action ("X") used when the definition has none.
function createCloseHeaderAction(): PaletteHeaderAction {
  return {
    id: "close",
    label: "X",
    ariaLabel: "Close palette",
    disabled: false,
  };
}
