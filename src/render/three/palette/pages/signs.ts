/**
 * Sign palette pages: the place-sign options page and the sign editor with its on-panel keyboard.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../../world-objects/toolObjects";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, inactiveColor, sectionColor, textColor, fontPx } from "../tokens";
import { createSignImage } from "../icons";
import { createButtonText, createInteractiveSurface, createSectionLabel } from "../widgets";

const signTypeLabels: Record<PlacedFlagType, string> = {
  WoodenSign1: "Wooden Sign 1",
  WoodenSign2: "Wooden Sign 2",
};

// Key layout of the on-panel sign editor keyboard; Enter, Space and Backspace are added separately.
const signKeyboardRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;

/**
 * Sign type chooser: one tile per flag type option.
 */
export function buildPlaceSignOptionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "place-flag-options" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel("Sign type"));

  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    gap: 12,
  });
  for (const option of content.flagTypeOptions) {
    const tile = createInteractiveSurface({
      width: "49%",
      height: 150,
      label: "",
      labelFontSize: 17,
      flexDirection: "column",
      backgroundColor: option.id === content.selectedFlagType ? activeColor : inactiveColor,
      onClick: () => options.onPlaceFlagTypeSelected?.(option.id as PlacedFlagType),
    });
    const signType = option.id as PlacedFlagType;
    tile.userData.scenePaletteItemId = `sign-type:${option.id}`;
    tile.add(createSignImage(signType, 92), createButtonText(signTypeLabels[signType], 15));
    grid.add(tile);
  }

  panel.add(grid);
  return panel;
}

/**
 * Sign editor: text preview, four key rows from signKeyboardRows, and an Enter / Space / Backspace row.
 */
export function buildEditSignContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "edit-sign" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 382,
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });

  const preview = new Container({
    width: "100%",
    height: 96,
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "#020617",
    borderColor,
    borderWidth: 1,
  });
  preview.add(
    createSectionLabel(`Sign text ${content.message.length}/${content.maxLength}`),
    createSignPreviewLines(content.message),
  );
  panel.add(preview);

  for (const row of signKeyboardRows) {
    panel.add(createKeyboardRow(row, options));
  }

  const backspaceRow = new Container({
    width: "100%",
    height: 42,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  });
  const enter = createInteractiveSurface({
    width: 132,
    height: 42,
    label: "Enter",
    labelFontSize: 15,
    backgroundColor: actionColor,
    onClick: () => options.onSignKeyboardCharacter?.("\n"),
  });
  enter.userData.scenePaletteItemId = "sign-key:Enter";
  const space = createInteractiveSurface({
    width: 156,
    height: 42,
    label: "Space",
    labelFontSize: 15,
    backgroundColor: inactiveColor,
    onClick: () => options.onSignKeyboardCharacter?.(" "),
  });
  space.userData.scenePaletteItemId = "sign-key:Space";
  const backspace = createInteractiveSurface({
    width: 156,
    height: 42,
    label: "Backspace",
    labelFontSize: 15,
    backgroundColor: "#991b1b",
    onClick: () => options.onSignKeyboardBackspace?.(),
  });
  backspace.userData.scenePaletteItemId = "sign-key:Backspace";
  backspaceRow.add(enter, space, backspace);
  panel.add(backspaceRow);

  return panel;
}

// Show the last three lines of the message with a "|" caret on the final line; the cursor is always at the end of the text.
function createSignPreviewLines(message: string): Container {
  const allLines = message.split("\n");
  const cursorLineIndex = allLines.length - 1;
  const firstVisibleLine = Math.max(0, cursorLineIndex - 2);
  const lines = allLines.slice(firstVisibleLine, firstVisibleLine + 3);
  while (lines.length < 3) {
    lines.push("");
  }

  const block = new Container({
    width: "100%",
    height: 62,
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
  });

  for (let index = 0; index < 3; index += 1) {
    const sourceLineIndex = firstVisibleLine + index;
    const line = lines[index] ?? "";
    const displayLine = sourceLineIndex === cursorLineIndex ? `${line}|` : line;
    const text = new Text({
      text: displayLine || " ",
      fontSize: fontPx(18),
      fontWeight: "bold",
      color: textColor,
      fill: textColor,
      flexShrink: 1,
      wordBreak: "break-word",
    });
    text.userData.scenePaletteSignPreviewLine = index;
    text.userData.scenePaletteSignPreviewText = displayLine;
    block.add(text);
  }

  return block;
}

// One row of single-character key buttons.
function createKeyboardRow(
  keys: readonly string[],
  options: ScenePaletteAdapterOptions,
): Container {
  const row = new Container({
    width: "100%",
    height: 38,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  });

  for (const key of keys) {
    const button = createInteractiveSurface({
      width: 48,
      height: 38,
      label: key,
      labelFontSize: 16,
      backgroundColor: inactiveColor,
      onClick: () => options.onSignKeyboardCharacter?.(key),
    });
    button.userData.scenePaletteItemId = `sign-key:${key}`;
    row.add(button);
  }

  return row;
}
