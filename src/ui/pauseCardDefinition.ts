/**
 * The pause card, the desktop main menu (design 017 sections 7.5 and 8.1), as plain data: the activity title, a one-line description, the controls table and the main-menu actions.
 * Role: pure and renderer-neutral. `src/render/dom/pauseCard.ts` draws it. The controls rows are generated from the input-intent table (`getInputHintGlyph`), so the card cannot drift from the bindings; every student-visible word comes from the vocabulary module.
 */
import type { TutorialPageSpec } from "../cell-complex/specs";
import { getInputHintGlyph } from "./inputIntents";
import { pauseCardText, verbNames } from "./vocabulary";

/** One row of the controls table: the verb and the name of the control that performs it. */
export interface PauseCardControl {
  readonly verb: string;
  readonly glyphLabel: string;
}

/** The main-menu actions, in the order they show. */
export type PauseCardActionId = "help" | "settings" | "go-home" | "start-over";

/** The card's content. `description` is absent when the world has no goal text. */
export interface PauseCardDefinition {
  readonly title: string;
  readonly description?: string;
  readonly controls: readonly PauseCardControl[];
  readonly actions: readonly PauseCardActionId[];
}

/** What the card is built from: the world's name, the config's display name when it has one, and the first goal text. */
export interface PauseCardSource {
  /** The config's display name; wins over the world's name when present. */
  readonly configDisplayName?: string;
  /** The world's catalog id or name, for example "001-basic-cube". */
  readonly worldName: string;
  /** The goal pages of the world's help cube, in order. */
  readonly goalPages?: readonly TutorialPageSpec[];
}

/** "001-basic-cube" becomes "Basic cube": the leading number and the dashes and underscores go. */
export function prettyWorldName(worldName: string): string {
  const words = worldName.replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim();
  if (words.length === 0) return worldName;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The first sentence of a text, without its line breaks; empty when the text is blank. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^.*?[.!?](?=\s|$)/.exec(flat);
  return match === null ? flat : match[0];
}

/** The controls table: Look, Walk, Use, Menu, Switch tool, What's this?, from the intent table. */
export function createPauseCardControls(): readonly PauseCardControl[] {
  const label = (intent: Parameters<typeof getInputHintGlyph>[1]): string => getInputHintGlyph("desktop", intent).label;
  return [
    { verb: verbNames.look, glyphLabel: label("look") },
    { verb: verbNames.walk, glyphLabel: label("move") },
    { verb: verbNames.use, glyphLabel: label("primary") },
    { verb: verbNames.menu, glyphLabel: label("context-menu") },
    { verb: verbNames.switchTool, glyphLabel: pauseCardText.switchToolControl },
    { verb: verbNames.whatsThis, glyphLabel: label("help") },
  ];
}

/** Builds the card for a world. */
export function createPauseCardDefinition(source: PauseCardSource): PauseCardDefinition {
  const configName = source.configDisplayName?.trim();
  const title = configName !== undefined && configName.length > 0 ? configName : prettyWorldName(source.worldName);
  const firstBody = source.goalPages?.[0]?.body;
  const description = firstBody === undefined ? "" : firstSentence(firstBody);
  return {
    title,
    ...(description.length > 0 ? { description } : {}),
    controls: createPauseCardControls(),
    actions: ["help", "settings", "go-home", "start-over"],
  };
}
