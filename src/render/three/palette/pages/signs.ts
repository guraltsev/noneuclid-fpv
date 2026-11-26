/**
 * Sign palette pages: the place-sign options page and the sign editor with its on-panel keyboard.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../../world-objects/toolObjects";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, inactiveColor, raisedColor, surfaceColor, textColor, fontPx } from "../tokens";
import { createSignImage } from "../icons";
import { createButtonText, createCaption, createInteractiveSurface, createPageBody } from "../widgets";

const signTypeLabels: Record<PlacedFlagType, string> = {
  WoodenSign1: "Wooden Sign 1",
  WoodenSign2: "Wooden Sign 2",
};

// Size of a key of the sign editor's keyboard and the gap between keys: ten keys and their gaps fill the panel's width.
const keyWidth = 82;
const keyHeight = 54;
const keyGap = 8;
const keyboardWidth = 10 * keyWidth + 9 * keyGap;

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
  // The page title says "Sign type".
  const panel = createPageBody({ gap: 12 });

  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    gap: 12,
  });
  for (const option of content.flagTypeOptions) {
    const tile = createInteractiveSurface({
      width: "49.4%",
      height: 200,
      label: "",
      labelFontSize: 17,
      flexDirection: "column",
      backgroundColor: option.id === content.selectedFlagType ? activeColor : raisedColor,
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
  const panel = createPageBody({ gap: 18 });

  const preview = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 6,
    paddingX: 18,
    paddingY: 12,
    borderRadius: 14,
    backgroundColor: surfaceColor,
    borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  preview.add(
    createCaption(`Sign text ${content.message.length}/${content.maxLength}`),
    createSignPreviewLines(content.message),
  );
  panel.add(preview);

  // The keyboard: a block as wide as its number row, centered in the space under the preview.
  const keyboard = new Container({
    width: keyboardWidth,
    alignSelf: "center",
    flexDirection: "column",
    gap: keyGap,
    flexShrink: 0,
  });
  for (const row of signKeyboardRows) {
    keyboard.add(createKeyboardRow(row, options));
  }

  const bottomRow = new Container({
    width: "100%",
    height: keyHeight,
    flexDirection: "row",
    gap: keyGap,
    flexShrink: 0,
  });
  const enter = createInteractiveSurface({
    width: 2 * keyWidth + keyGap,
    height: keyHeight,
    label: "Enter",
    labelFontSize: 17,
    backgroundColor: actionColor,
    onClick: () => options.onSignKeyboardCharacter?.("\n"),
  });
  enter.userData.scenePaletteItemId = "sign-key:Enter";
  const space = createInteractiveSurface({
    width: 6 * keyWidth + 5 * keyGap,
    height: keyHeight,
    label: "Space",
    labelFontSize: 17,
    backgroundColor: inactiveColor,
    onClick: () => options.onSignKeyboardCharacter?.(" "),
  });
  space.userData.scenePaletteItemId = "sign-key:Space";
  const backspace = createInteractiveSurface({
    width: 2 * keyWidth + keyGap,
    height: keyHeight,
    label: "Backspace",
    labelFontSize: 17,
    backgroundColor: inactiveColor,
    onClick: () => options.onSignKeyboardBackspace?.(),
  });
  backspace.userData.scenePaletteItemId = "sign-key:Backspace";
  bottomRow.add(enter, space, backspace);
  keyboard.add(bottomRow);
  panel.add(keyboard);

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
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
  });

  for (let index = 0; index < 3; index += 1) {
    const sourceLineIndex = firstVisibleLine + index;
    const line = lines[index] ?? "";
    const displayLine = sourceLineIndex === cursorLineIndex ? `${line}|` : line;
    const text = new Text({
      text: displayLine || " ",
      fontSize: fontPx(20),
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

// One row of single-character key buttons of the sign editor.
function createKeyboardRow(
  keys: readonly string[],
  options: ScenePaletteAdapterOptions,
): Container {
  return createKeypadRow(keys, (key) => options.onSignKeyboardCharacter?.(key), "sign-key:", keyWidth, keyHeight);
}

/**
 * One centered row of single-character key buttons, shared by the sign editor's keyboard and the shape machine's number pad.
 * `onKey` receives the key; each button's palette item id is `itemIdPrefix` followed by the key.
 */
export function createKeypadRow(
  keys: readonly string[],
  onKey: (key: string) => void,
  itemIdPrefix: string,
  keyWidth = 48,
  keyHeight = 38,
): Container {
  const row = new Container({
    width: "100%",
    height: keyHeight,
    flexDirection: "row",
    justifyContent: "center",
    gap: keyHeight > 40 ? keyGap : 6,
    flexShrink: 0,
  });

  for (const key of keys) {
    const button = createInteractiveSurface({
      width: keyWidth,
      height: keyHeight,
      label: key,
      labelFontSize: keyHeight > 40 ? 19 : 16,
      backgroundColor: inactiveColor,
      onClick: () => onKey(key),
    });
    button.userData.scenePaletteItemId = `${itemIdPrefix}${key}`;
    row.add(button);
  }

  return row;
}
