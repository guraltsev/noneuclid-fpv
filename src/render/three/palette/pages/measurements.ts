/**
 * Measurement menu page: one sentence about a length or an angle. The title is in the header, and its Delete button is in the header toolbar, like the Delete of a laser and of a sign.
 */
import { Container } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import { typeScale } from "../tokens";
import { createBodyText, createPageBody } from "../widgets";

/**
 * Measurement menu page body: the sentence that says what Delete does.
 */
export function buildMeasurementActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "measurement-actions" }>,
): Container {
  const page = createPageBody();
  page.add(createBodyText(content.body, { fontSize: typeScale.body + 1 }));
  return page;
}
