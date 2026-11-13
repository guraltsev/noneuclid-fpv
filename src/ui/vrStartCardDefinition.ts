/**
 * The VR start card (design 017 section 8.1) as plain data: the controllers of the current layout with the verb on each button ("Trigger: Use").
 * Role: pure and renderer-neutral. `src/render/three/xrStartCard.ts` draws it as a panel in front of the player; it is rebuilt when the layout changes. The control names come from the input-intent table (`getInputHintGlyph`), so the card cannot drift from the bindings; every word comes from the vocabulary module.
 */
import type { XrLayout } from "../glue/xrLayout";
import { getInputHintGlyph, type InputIntent } from "./inputIntents";
import { toolNames, verbNames, vrBeltText } from "./vocabulary";

/** One line of the card: the control, and the verb it performs. */
export interface VrStartCardRow {
  readonly glyphLabel: string;
  readonly verb: string;
}

/** A group of rows under one heading (a hand, or the single controller). */
export interface VrStartCardSection {
  readonly heading: string;
  readonly rows: readonly VrStartCardRow[];
}

/** The card's content. */
export interface VrStartCardDefinition {
  readonly title: string;
  readonly sections: readonly VrStartCardSection[];
  readonly dismissText: string;
}

/** The text lines of the card, as shown: the title, then each heading and its rows ("Trigger: Use"), then the dismiss line. */
export function vrStartCardLines(definition: VrStartCardDefinition): readonly string[] {
  return [
    definition.title,
    ...definition.sections.flatMap((section) => [section.heading, ...section.rows.map((row) => `${row.glyphLabel}: ${row.verb}`)]),
    definition.dismissText,
  ];
}

/**
 * Builds the card for `layout`. `leftHanded` only matters with two controllers: the pointer hand is then the left one, so the face letters and the belt hand's names swap sides.
 */
export function createVrStartCardDefinition(layout: XrLayout, leftHanded = false): VrStartCardDefinition {
  const glyph = (intent: InputIntent): string => getInputHintGlyph("xr", intent, layout).label;
  const primary = glyph("primary");
  const menu = glyph("context-menu");
  if (layout !== "two-controllers") {
    return {
      title: vrBeltText.startCardTitle,
      sections: [{
        heading: vrBeltText.oneControllerHeading,
        rows: [
          { glyphLabel: glyph("move"), verb: `${verbNames.walk} and turn` },
          { glyphLabel: primary, verb: verbNames.use },
          { glyphLabel: menu, verb: verbNames.menu },
          { glyphLabel: glyph("carry"), verb: verbNames.pickUp },
          { glyphLabel: glyph("help"), verb: verbNames.whatsThis },
          { glyphLabel: glyph("main-menu"), verb: verbNames.mainMenu },
          { glyphLabel: glyph("switch-tool"), verb: verbNames.switchTool },
        ],
      }],
      dismissText: vrBeltText.startCardDismiss,
    };
  }
  // The default table names the default hands (pointer right, belt left); left-handed swaps the sides.
  const beltSide = leftHanded ? "Right" : "Left";
  const lowerPointer = leftHanded ? "X" : "A";
  const upperPointer = leftHanded ? "Y" : "B";
  const lowerBelt = leftHanded ? "A" : "X";
  return {
    title: vrBeltText.startCardTitle,
    sections: [
      {
        heading: vrBeltText.pointerHandHeading,
        rows: [
          { glyphLabel: primary, verb: verbNames.use },
          { glyphLabel: menu, verb: verbNames.menu },
          { glyphLabel: lowerPointer, verb: verbNames.pickUp },
          { glyphLabel: upperPointer, verb: verbNames.whatsThis },
          { glyphLabel: "Stick left or right", verb: "Turn" },
        ],
      },
      {
        heading: vrBeltText.beltHandHeading,
        rows: [
          { glyphLabel: `${beltSide} stick`, verb: `${verbNames.walk} and turn` },
          { glyphLabel: `${beltSide} trigger`, verb: verbNames.switchTool },
          { glyphLabel: `${beltSide} grip`, verb: toolNames.none.name },
          { glyphLabel: lowerBelt, verb: verbNames.mainMenu },
        ],
      },
    ],
    dismissText: vrBeltText.startCardDismiss,
  };
}
