/**
 * The Discoveries palette page (design 017 sections 9.4 and 9.5): the discoveries found, each with its name and question, and "??? - teaser" lines for the rest, in a scrolling column. "Across an edge", once found, carries the invitation to see where the faces are glued and the Show edges button.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { DiscoveryPaletteEntry, PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { activeColor, borderColor, inactiveColor, mutedTextColor, raisedColor, sectionColor, textColor, fontPx, typeScale } from "../tokens";
import { createCaption, createInteractiveSurface, createPageBody, createScrollArea } from "../widgets";

/** The page: title and count, a line of text and the entries. */
export function buildDiscoveriesContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "discoveries" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  // The title and the count are in the header.
  const panel = createPageBody({ gap: 14 });
  panel.add(createCaption(content.body, { fontSize: typeScale.body }));

  const list = createScrollArea({ gap: 10 });
  for (const entry of content.entries) {
    list.add(buildEntry(entry, options));
  }
  panel.add(list);
  return panel;
}

// One discovery: a found one in a lighter card with its name and question, a teaser as a dim line.
function buildEntry(entry: DiscoveryPaletteEntry, options: ScenePaletteAdapterOptions): Container {
  const card = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    paddingX: 18,
    paddingY: 14,
    borderRadius: 14,
    backgroundColor: entry.found ? raisedColor : sectionColor,
    borderColor: entry.found ? activeColor : borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  card.userData.scenePaletteItemId = `discovery:${entry.id}`;
  card.add(new Text({
    text: entry.title,
    fontSize: fontPx(entry.found ? 21 : 18),
    fontWeight: entry.found ? "bold" : "medium",
    color: entry.found ? textColor : mutedTextColor,
    fill: entry.found ? textColor : mutedTextColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  if (entry.text !== "") {
    card.add(new Text({ text: entry.text, fontSize: fontPx(19), fontWeight: "medium", lineHeight: "140%", color: textColor, fill: textColor, flexShrink: 0, wordBreak: "break-word" }));
  }
  if (entry.showEdges !== undefined) {
    const { invitation, action, shown } = entry.showEdges;
    card.add(new Text({ text: invitation, fontSize: fontPx(18), fontWeight: "medium", color: mutedTextColor, fill: mutedTextColor, flexShrink: 0, wordBreak: "break-word" }));
    const button = createInteractiveSurface({
      width: "auto",
      paddingX: 20,
      height: 44,
      label: action.label,
      labelFontSize: typeScale.button,
      disabled: action.disabled,
      backgroundColor: shown ? inactiveColor : activeColor,
      onClick: () => options.onShowEdgesToggled?.(!shown),
    });
    button.userData.scenePaletteItemId = "discoveries:show-edges";
    card.add(button);
  }
  return card;
}
