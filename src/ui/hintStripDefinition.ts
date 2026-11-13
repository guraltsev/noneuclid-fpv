/**
 * The hint strip (design 017 section 8.2 item 3) as renderer-neutral data: up to three inputs that do something right now, each a glyph label and a short text ("Left click", "open Help").
 * Role: pure. The desktop DOM strip (`src/render/dom/hintStrip.ts`) draws it above the tool belt; the VR focus label of job 77 draws the same entries with the VR glyphs, because every glyph label comes from the input-intent table for the given input mode.
 * The strip is a function of the tool in hand, what the aim is on (the focus message's actions), the carry state and whether a menu is open. Every student-visible word comes from the vocabulary module.
 */
import type { RuntimeToolId } from "../glue/toolIds";
import type { RuntimeWorldObject } from "../world-objects/runtimeObjectRegistry";
import { getInputHintGlyph, type InputIntent, type InputMode, type XrLayout } from "./inputIntents";
import { hintStripText, toolNames } from "./vocabulary";
import type { WorldInteractionAction } from "./worldInteractionDefinition";

/** The most entries the strip ever shows. */
export const maxHintStripEntries = 3;

/** One entry of the strip: the input that does something, and what it does. */
export interface HintStripEntry {
  /** The name of the control, for example "Left click" or "Trigger"; may name two controls ("Left click / Right click / F"). */
  readonly glyphLabel: string;
  /** What the control does now, for example "open Help". */
  readonly text: string;
}

/** The focused object, as far as the strip needs it: its kind and the actions its focus message offers under the tool in hand. */
export interface HintStripFocus {
  readonly objectKind: RuntimeWorldObject["kind"];
  readonly actions: readonly WorldInteractionAction[];
}

/** What the strip is built from. */
export interface HintStripSource {
  readonly inputMode: InputMode;
  /** The VR controller layout, which decides the glyph letters; absent on desktop. */
  readonly xrLayout?: XrLayout;
  readonly selectedTool: RuntimeToolId;
  /** The usable focused object; undefined when the aim is on the floor, the sky or an object with no use. */
  readonly focus?: HintStripFocus;
  /** True while a laser or sign is carried. */
  readonly carrying: boolean;
  /** True while a menu is open. */
  readonly menuOpen: boolean;
  /** How far "extend" grows a beam, meters, for the text "extend 2 m". */
  readonly extendLengthMeters?: number;
}

/** Builds the strip: at most three entries, never empty. */
export function createHintStripDefinition(source: HintStripSource): readonly HintStripEntry[] {
  const label = (intent: InputIntent): string => getInputHintGlyph(source.inputMode, intent, source.xrLayout).label;
  const primary = label("primary");
  const menu = label("context-menu");
  const entries = collectEntries(source, label, primary, menu);
  return entries.slice(0, maxHintStripEntries);
}

function collectEntries(
  source: HintStripSource,
  label: (intent: InputIntent) => string,
  primary: string,
  menu: string,
): readonly HintStripEntry[] {
  if (source.menuOpen) {
    return [{ glyphLabel: primary, text: hintStripText.choose }, { glyphLabel: menu, text: hintStripText.close }];
  }
  if (source.carrying) {
    return [{ glyphLabel: label("carry"), text: hintStripText.putDown }];
  }

  const whatsThis: HintStripEntry = { glyphLabel: label("help"), text: hintStripText.whatsThis };
  const inHand = source.selectedTool !== "none";
  const focus = source.focus;
  if (focus === undefined) {
    return emptyAimEntries(source, label, primary, whatsThis);
  }

  const entries: HintStripEntry[] = [];
  const primaryAction = focus.actions.find((action) => action.available && action.intent === "primary");
  const menuAction = focus.actions.find((action) => action.available && action.intent === "context-menu");
  if (primaryAction !== undefined) {
    entries.push({ glyphLabel: primary, text: primaryActionText(primaryAction, source.extendLengthMeters) });
  }
  if (menuAction !== undefined) {
    // With the Hand, Use opens the menu too (design 017 section 7.1), so both controls are named in one entry.
    entries.push({ glyphLabel: inHand || primaryAction !== undefined ? menu : `${primary} / ${menu}`, text: menuAction.label });
  }
  if (focus.objectKind === "geodesicEmitters/emitter" || focus.objectKind === "placedFlags/flag") {
    entries.push({ glyphLabel: label("carry"), text: hintStripText.pickUp });
  }
  return entries.length > 0 ? entries : [whatsThis];
}

// The aim is on the floor: the tool in hand says what a click does there, and how to put the tool away.
function emptyAimEntries(
  source: HintStripSource,
  label: (intent: InputIntent) => string,
  primary: string,
  whatsThis: HintStripEntry,
): readonly HintStripEntry[] {
  switch (source.selectedTool) {
    case "none":
      return [{ glyphLabel: label("switch-tool"), text: hintStripText.tools }, whatsThis];
    case "geodesicEmitters/emitter":
      return [{ glyphLabel: primary, text: hintStripText.placeLaser }, putAwayEntry(label, source.selectedTool)];
    case "placedFlags/flag":
      return [{ glyphLabel: primary, text: hintStripText.placeSign }, putAwayEntry(label, source.selectedTool)];
    default:
      return [putAwayEntry(label, source.selectedTool), whatsThis];
  }
}

function putAwayEntry(label: (intent: InputIntent) => string, tool: RuntimeToolId): HintStripEntry {
  const name = tool in toolNames ? toolNames[tool as keyof typeof toolNames].name : toolNames.none.name;
  return { glyphLabel: label("hand"), text: hintStripText.putAway(name) };
}

function primaryActionText(action: WorldInteractionAction, extendLengthMeters: number | undefined): string {
  switch (action.id) {
    case "open-tutorial":
      return hintStripText.openHelp;
    case "extend-geodesic":
      return hintStripText.extend(extendLengthMeters);
    case "measure-length":
      return hintStripText.measureBeam;
    case "select-protractor-side":
      return hintStripText.pickBeam;
    case "select-protractor-vertex":
      return hintStripText.pickMeetingPoint;
    default:
      return action.label;
  }
}

/** The strip as one line of text: "Left click: open Help · H: what's this?". */
export function formatHintStripLine(entries: readonly HintStripEntry[]): string {
  return entries.map((entry) => `${entry.glyphLabel}: ${entry.text}`).join(" · ");
}
