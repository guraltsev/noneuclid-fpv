/**
 * The cards of How to (design 017 section 8.6), generated against the world.
 * Role: pure. `selectHowToPages` takes the world's tutorial pages and the tool belt and returns the pages in the order How to shows them (pages without a tool first, "Basics" among them, then one card per tool in belt order), leaves out the card of a tool the config switches off, and keeps the card of a tool the world cannot support together with the reason. `settingsSections` and `lostSentence` generate the sentences that depend on the config and the device, so the text cannot drift from the bindings.
 */
import type { TutorialPageSpec } from "../cell-complex/specs";
import type { AppConfig } from "../glue/appConfig";
import { getInputHintGlyph, type InputMode, type XrLayout } from "./inputIntents";
import type { ToolBeltDefinition } from "./toolBeltDefinition";
import { lostGuidanceFor, settingsText } from "./vocabulary";

/** The pages How to shows, and the reasons given for the tools the world cannot support. */
export interface HowToSelection {
  readonly pages: readonly TutorialPageSpec[];
  /** Tool id to the reason its card is disabled; only unsupported tools are listed. */
  readonly toolDisabledReasons: Readonly<Record<string, string>>;
}

/**
 * Orders and filters the tutorial pages against the belt. A page with a `toolId` is shown when the belt has the tool (disabled or not) and is dropped when the belt does not (the config switched the tool off); pages without a `toolId` come first in their own order. Without a belt every page stays in its own order.
 */
export function selectHowToPages(pages: readonly TutorialPageSpec[], belt: ToolBeltDefinition | undefined): HowToSelection {
  if (belt === undefined) return { pages, toolDisabledReasons: {} };
  const general = pages.filter((page) => page.toolId === undefined);
  const toolPages: TutorialPageSpec[] = [];
  const toolDisabledReasons: Record<string, string> = {};
  for (const slot of belt.slots) {
    const page = pages.find((candidate) => candidate.toolId === slot.toolId);
    if (page === undefined) continue;
    toolPages.push(page);
    if (!slot.enabled && slot.disabledReason !== undefined) toolDisabledReasons[slot.toolId] = slot.disabledReason;
  }
  return { pages: [...general, ...toolPages], toolDisabledReasons };
}

/** The sections Settings has with this config: always Controls, Display and Comfort, plus the ones the config adds. */
export function settingsSections(config: AppConfig): readonly string[] {
  const sections: string[] = [settingsText.controls, settingsText.display, settingsText.comfort];
  if (config.menu.worldSelectionSectionEnabled) sections.push("World");
  if (config.menu.configSelectionSectionEnabled) sections.push("Config");
  if (config.menu.debugSectionEnabled) sections.push("Debug");
  return sections;
}

/** The sentence for a student who is lost, from the main-menu binding of this device and layout: "Lost? Press Esc and choose Go home." */
export function lostSentence(inputMode: InputMode, layout?: XrLayout): string {
  // VR without a known layout is two controllers, the default.
  const label = getInputHintGlyph(inputMode, "main-menu", inputMode === "xr" ? layout ?? "two-controllers" : layout).label;
  // A label that already says "Hold" (one controller) is the whole instruction; the others are a key to press.
  return lostGuidanceFor(/^Hold\b/.test(label) ? label : `Press ${label}`);
}
