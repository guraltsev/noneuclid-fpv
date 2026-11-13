/**
 * Measurement menu page: the title and one sentence about a length or an angle. Its Delete button is in the header, like the Delete of a laser and of a sign.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import { borderColor, mutedTextColor, sectionColor, textColor } from "../tokens";
import { createSectionLabel } from "../widgets";

/**
 * Measurement menu page body: a section label with the menu's title, then the sentence that says what Delete does.
 */
export function buildMeasurementActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "measurement-actions" }>,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 160,
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel(content.title));
  panel.add(new Text({
    text: content.body,
    fontSize: 20,
    fontWeight: "medium",
    color: mutedTextColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  return panel;
}
