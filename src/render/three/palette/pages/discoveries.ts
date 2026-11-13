/**
 * The Discoveries palette page (design 017 sections 9.4 and 9.5): the discoveries found, each with its name and question, and "??? - teaser" lines for the rest, in a scrolling column. "Across an edge", once found, carries the invitation to see where the faces are glued and the Show edges button.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { DiscoveryPaletteEntry, PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { activeColor, borderColor, inactiveColor, mutedTextColor, sectionColor, textColor, fontPx } from "../tokens";
import { createInteractiveSurface, createSettingsScrollContainer } from "../widgets";

/** The page: title and count, a line of text and the entries. */
export function buildDiscoveriesContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "discoveries" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 382,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  const titleRow = new Container({ width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, flexShrink: 0 });
  titleRow.add(new Text({ text: content.title, fontSize: fontPx(34), fontWeight: "bold", color: textColor, fill: textColor, flexShrink: 0 }));
  if (content.countLabel !== "") {
    titleRow.add(new Text({ text: content.countLabel, fontSize: fontPx(18), fontWeight: "bold", color: mutedTextColor, fill: mutedTextColor, flexShrink: 0 }));
  }
  panel.add(titleRow);
  panel.add(new Text({ text: content.body, fontSize: fontPx(20), fontWeight: "medium", color: mutedTextColor, fill: mutedTextColor, flexShrink: 0, wordBreak: "break-word" }));

  const list = createSettingsScrollContainer();
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
    padding: 12,
    borderRadius: 14,
    backgroundColor: entry.found ? "#1e293b" : "#0b1220",
    borderColor: entry.found ? "#38bdf8" : borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  card.userData.scenePaletteItemId = `discovery:${entry.id}`;
  card.add(new Text({
    text: entry.title,
    fontSize: fontPx(entry.found ? 22 : 18),
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
      width: 200,
      height: 44,
      label: action.label,
      labelFontSize: 18,
      disabled: action.disabled,
      backgroundColor: shown ? inactiveColor : activeColor,
      onClick: () => options.onShowEdgesToggled?.(!shown),
    });
    button.userData.scenePaletteItemId = "discoveries:show-edges";
    card.add(button);
  }
  return card;
}
