/**
 * Generic uikit widgets of the in-scene palette panel and disposal of rendered trees.
 * One vocabulary for every page: a scroll area that fills the space left under the header, cards of rows with hairlines between them,
 * a setting row (label and description on the left, its control on the right), switches, segmented step controls, list rows, and buttons in
 * three weights (primary, neutral, danger). Sizes and colors come from tokens.ts.
 */
import { Component, Container, Text } from "@pmndrs/uikit";
import { ChevronRight, House, RotateCw, Trash2 } from "@pmndrs/uikit-lucide";
import {
  actionColor,
  actionHoverColor,
  activeColor,
  activeHoverColor,
  buttonHeight,
  cardRadius,
  contributedActionColor,
  controlRadius,
  dangerColor,
  dangerHoverColor,
  disabledColor,
  dividerColor,
  borderColor,
  fontPx,
  headingTextColor,
  inactiveColor,
  mutedTextColor,
  raisedColor,
  raisedHoverColor,
  rowHeight,
  scrollbarBorderColor,
  scrollbarColor,
  scrollbarWidth,
  sectionColor,
  textColor,
  typeScale,
} from "./tokens";
import { createGeodesicCannonActionIcon, createUnlinkIcon } from "./icons";

// The hover tint of each background color a control can have; a color not listed keeps its color on hover.
const hoverColors: Readonly<Record<string, string>> = {
  [actionColor]: actionHoverColor,
  [activeColor]: activeHoverColor,
  [dangerColor]: dangerHoverColor,
  [inactiveColor]: "#475569",
  [raisedColor]: raisedHoverColor,
  [contributedActionColor]: "#d97706",
};

/**
 * A scrolling column that takes all the height left in its parent column (the page body under the header), with a scrollbar wide enough to grab.
 * The content keeps clear of the scrollbar, so text and controls never run under it.
 */
export function createScrollArea(options: { readonly gap?: number } = {}): Container {
  return new Container({
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    flexDirection: "column",
    gap: options.gap ?? 20,
    overflow: "scroll",
    paddingRight: scrollbarWidth + 12,
    paddingBottom: 8,
    scrollbarWidth,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 3,
    scrollbarBorderRadius: scrollbarWidth / 2,
    scrollbarZIndex: 1004,
  });
}

/** The scroll area under the old name, for pages that list cards. */
export const createSettingsScrollContainer = createScrollArea;

/** A page body that does not scroll: a column that fills the height under the header. */
export function createPageBody(options: { readonly gap?: number } = {}): Container {
  return new Container({
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    flexDirection: "column",
    gap: options.gap ?? 16,
  });
}

/** Small uppercase heading over a card (a group of settings). */
export function createOverline(text: string): Text {
  return new Text({
    text: text.toUpperCase(),
    fontSize: fontPx(typeScale.overline),
    fontWeight: "bold",
    letterSpacing: 1.2,
    color: headingTextColor,
    fill: headingTextColor,
    flexShrink: 0,
    paddingLeft: 4,
  });
}

/** Row label text: the name of a setting or of a list item. Shrinks and wraps within its row. */
export function createSectionLabel(text: string): Text {
  return new Text({
    text,
    fontSize: fontPx(typeScale.body),
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

/** Secondary text: a description under a label, a line of explanation on a page. */
export function createCaption(text: string, options: { readonly fontSize?: number } = {}): Text {
  return new Text({
    text,
    fontSize: fontPx(options.fontSize ?? typeScale.caption),
    fontWeight: "medium",
    lineHeight: "135%",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

/** Body text of a page: a paragraph in the main text color. */
export function createBodyText(text: string, options: { readonly fontSize?: number } = {}): Text {
  return new Text({
    text,
    fontSize: fontPx(options.fontSize ?? typeScale.body),
    fontWeight: "medium",
    lineHeight: "145%",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  });
}

/** A heading inside a page body (a help card's title). */
export function createHeadingText(text: string): Text {
  return new Text({
    text,
    fontSize: fontPx(typeScale.heading),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

/**
 * A group of settings: an optional overline heading, then a card whose rows are separated by hairlines.
 * Add rows with `addCardRow(group, row)`; the returned container is the whole group.
 */
export function createCard(heading?: string, options: { readonly list?: boolean } = {}): Container {
  const group = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
  });
  if (heading !== undefined) {
    group.add(createOverline(heading));
  }
  const card = new Container({
    width: "100%",
    flexDirection: "column",
    borderRadius: cardRadius,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
    // A list card insets its rows so a selected row's highlight has a margin; a settings card lets its rows run edge to edge between hairlines.
    ...(options.list ? { padding: 6, gap: 2 } : { paddingX: 18 }),
    flexShrink: 0,
  });
  card.userData.paletteCardIsList = options.list === true;
  group.add(card);
  group.userData.paletteCard = card;
  card.userData.paletteCardRowCount = 0;
  return group;
}

/** Adds a row to a card made by `createCard`, with a hairline above it when it is not the first. */
export function addCardRow(group: Container, row: Container): void {
  const card = group.userData.paletteCard as Container;
  const count = card.userData.paletteCardRowCount as number;
  if (count > 0 && card.userData.paletteCardIsList !== true) {
    card.add(new Container({ width: "100%", height: 1, backgroundColor: dividerColor, flexShrink: 0 }));
  }
  card.add(row);
  card.userData.paletteCardRowCount = count + 1;
}

/**
 * A setting row: the label (and an optional description under it) on the left, the control on the right, vertically centered.
 * `control` may be absent for a row that only says something.
 */
export function createSettingRow(label: string, control?: Container, description?: string): Container {
  const row = new Container({
    width: "100%",
    minHeight: rowHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingY: 8,
    flexShrink: 0,
  });
  const text = new Container({ flexDirection: "column", gap: 2, flexGrow: 1, flexShrink: 1 });
  text.add(createSectionLabel(label));
  if (description !== undefined && description !== "") {
    text.add(createCaption(description));
  }
  row.add(text);
  if (control !== undefined) {
    row.add(control);
  }
  return row;
}

/**
 * Labelled single-choice list (a card of rows, the chosen one ticked). Item ids are "<prefix>:<option id>".
 */
export function createChoiceSection(
  label: string,
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  onSelected: (id: string) => void,
  itemPrefix: string,
): Container {
  const group = createCard(label, { list: true });
  for (const option of options) {
    addCardRow(group, createChoiceRow(option.label, option.id === selectedId, () => onSelected(option.id), `${itemPrefix}:${option.id}`));
  }
  return group;
}

/**
 * Single-choice option grid: two columns of rows, the chosen one highlighted with a tick. Item ids are "<prefix>:<option id>".
 */
export function createOptionGrid(
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  itemPrefix: string,
  onSelected: (id: string) => void,
): Container {
  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    flexShrink: 0,
  });

  for (const option of options) {
    const selected = option.id === selectedId;
    const button = createInteractiveSurface({
      width: "48.9%",
      height: 52,
      justifyContent: "space-between",
      paddingX: 16,
      backgroundColor: selected ? activeColor : raisedColor,
      label: option.label,
      labelFontSize: typeScale.button,
      onClick: () => onSelected(option.id),
    });
    if (selected) {
      button.add(createTickMark());
    }
    button.userData.scenePaletteItemId = `${itemPrefix}:${option.id}`;
    grid.add(button);
  }

  return grid;
}

// One row of a choice list: the label, and a tick when it is the chosen one.
function createChoiceRow(label: string, selected: boolean, onClick: () => void, itemId: string): Container {
  const row = createInteractiveSurface({
    width: "100%",
    height: 46,
    label,
    labelFontSize: typeScale.body,
    labelWeight: selected ? "bold" : "medium",
    justifyContent: "space-between",
    paddingX: 12,
    backgroundColor: selected ? selectedRowColor : sectionColor,
    hoverColor: selected ? selectedRowColor : raisedHoverColor,
    onClick,
  });
  row.userData.scenePaletteItemId = itemId;
  if (selected) {
    row.add(createTickMark());
  }
  return row;
}

// Background of the chosen row of a list: a quiet tint of the selection color, with the tick saying which.
const selectedRowColor = "#123f3c";

// The round tick of a chosen option.
function createTickMark(): Container {
  const mark = new Container({
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: textColor,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  });
  mark.add(new Container({ width: 10, height: 10, borderRadius: 5, backgroundColor: activeColor }));
  return mark;
}

/**
 * A setting with a switch: label (and description) on the left, the switch on the right.
 */
export function createToggleRow(
  label: string,
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
  description?: string,
): Container {
  return createSettingRow(label, createToggleButton(enabled, onToggled, itemId), description);
}

/**
 * A switch: a pill track with a knob at the right when on, at the left when off.
 * Clicking calls onToggled with the inverted value of the state captured at build time (state is not read back).
 */
export function createToggleButton(
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
): Container {
  const track = new Container({
    width: 64,
    height: 34,
    flexShrink: 0,
    borderRadius: 17,
    padding: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: enabled ? "flex-end" : "flex-start",
    backgroundColor: enabled ? activeColor : inactiveColor,
    hover: { backgroundColor: enabled ? activeHoverColor : "#475569" },
    pointerEvents: "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  track.add(new Container({
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: textColor,
    pointerEvents: "none",
    renderOrder: 1002,
    depthTest: false,
    depthWrite: false,
  }));
  track.name = enabled ? "On" : "Off";
  track.userData.scenePaletteAction = () => onToggled(!enabled);
  track.userData.scenePaletteItemId = itemId;
  return track;
}

/**
 * A segmented control: the steps side by side in one rounded track, the chosen one filled. Item ids are "<prefix>:<step id>".
 */
export function createSegmentedControl(
  steps: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  onSelected: (id: string) => void,
  itemPrefix: string,
): Container {
  const track = new Container({
    flexDirection: "row",
    flexShrink: 0,
    padding: 4,
    gap: 4,
    borderRadius: controlRadius + 2,
    backgroundColor: surfaceTrackColor,
  });
  for (const step of steps) {
    const selected = step.id === selectedId;
    const segment = createInteractiveSurface({
      width: 104,
      height: 38,
      label: step.label,
      labelFontSize: typeScale.button - 1,
      labelWeight: selected ? "bold" : "medium",
      onClick: () => onSelected(step.id),
      backgroundColor: selected ? activeColor : surfaceTrackColor,
      hoverColor: selected ? activeHoverColor : raisedHoverColor,
      radius: controlRadius - 2,
    });
    segment.userData.scenePaletteItemId = `${itemPrefix}:${step.id}`;
    track.add(segment);
  }
  return track;
}

// The track behind a segmented control.
const surfaceTrackColor = "#0b1220";

/**
 * A setting with exclusive steps (Low, Medium, High): label on the left, a segmented control on the right. Item ids are "<prefix>:<step id>".
 */
export function createStepRow(
  label: string,
  steps: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  onSelected: (id: string) => void,
  itemPrefix: string,
  description?: string,
): Container {
  return createSettingRow(label, createSegmentedControl(steps, selectedId, onSelected, itemPrefix), description);
}

/**
 * A list row that opens something: an optional icon, the label and a description, and a chevron at the right edge.
 * The whole row is the button.
 */
export function createNavigationRow(options: {
  readonly itemId: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: Component<any>;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly tone?: "neutral" | "danger";
  readonly chevron?: boolean;
}): Container {
  const danger = options.tone === "danger";
  const row = new Container({
    width: "100%",
    minHeight: 76,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingX: 20,
    paddingY: 12,
    borderRadius: cardRadius - 4,
    backgroundColor: danger ? "#3b1218" : raisedColor,
    hover: { backgroundColor: danger ? "#5b1820" : raisedHoverColor },
    opacity: options.disabled ? 0.45 : 1,
    pointerEvents: options.disabled ? "none" : "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  row.userData.scenePaletteAction = options.disabled ? undefined : options.onClick;
  row.userData.scenePaletteItemId = options.itemId;
  if (options.icon !== undefined) {
    const badge = new Container({
      width: 48,
      height: 48,
      borderRadius: 12,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: danger ? dangerColor : "#1e3a8a",
      pointerEvents: "none",
    });
    badge.add(options.icon);
    row.add(badge);
  }
  const text = new Container({ flexDirection: "column", gap: 3, flexGrow: 1, flexShrink: 1, pointerEvents: "none" });
  text.add(new Text({
    text: options.label,
    fontSize: fontPx(21),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  if (options.description !== undefined && options.description !== "") {
    text.add(createCaption(options.description));
  }
  row.add(text);
  if (options.chevron !== false) {
    row.add(new ChevronRight({ width: 26, height: 26, color: mutedTextColor, flexShrink: 0 }));
  }
  return row;
}

/**
 * Generic labelled action button with an optional home/reload icon. `tone` picks primary (default), neutral or danger.
 */
export function createActionButton(
  label: string,
  itemId: string,
  onClick: () => void,
  options: {
    readonly icon?: "home" | "reload";
    readonly width?: number;
    readonly backgroundColor?: string;
    readonly tone?: "primary" | "neutral" | "danger";
  } = {},
): Container {
  const tone = options.tone ?? "primary";
  const background = options.backgroundColor
    ?? (tone === "danger" ? dangerColor : tone === "neutral" ? inactiveColor : actionColor);
  const button = createInteractiveSurface({
    width: options.width ?? "auto",
    height: buttonHeight,
    paddingX: 18,
    backgroundColor: background,
    label: "",
    onClick,
  });
  button.userData.scenePaletteItemId = itemId;
  if (options.icon === "home") {
    button.add(new House({ width: 20, height: 20, color: textColor }));
  } else if (options.icon === "reload") {
    button.add(new RotateCw({ width: 20, height: 20, color: textColor }));
  }
  if (label) {
    button.add(createButtonText(label, typeScale.button));
  }
  return button;
}

/** Color of the reason text under a disabled control: warm, so that it reads as "why", not as a label. */
export const disabledReasonColor = "#fcd34d";

/**
 * The small text that says why a control is disabled (design 017 section 8.5). It is always drawn while the control is disabled, not only on hover.
 * `userData.scenePaletteDisabledReason` carries the sentence, so tests and checks can find it without reading pixels.
 */
export function createDisabledReasonText(reason: string, width?: number): Text {
  const text = new Text({
    text: reason,
    fontSize: fontPx(13),
    fontWeight: "medium",
    color: disabledReasonColor,
    fill: disabledReasonColor,
    width,
    flexShrink: 1,
    wordBreak: "break-word",
  });
  text.name = `disabled-reason:${reason}`;
  text.userData.scenePaletteDisabledReason = reason;
  return text;
}

/**
 * A control with its reason under it while it is disabled; the control itself when it is not (or has no reason).
 * `width` is the column's width, at least the control's: a short button can have a wider reason.
 */
export function withDisabledReason(
  control: Container,
  reason: string | undefined,
  width: number | "100%",
): Container {
  if (reason === undefined) {
    return control;
  }
  const column = new Container({
    width,
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    flexShrink: 0,
  });
  column.add(control, createDisabledReasonText(reason, typeof width === "number" ? width : undefined));
  return column;
}

/** The icons a contextual header action can show. */
export type HeaderActionIcon = "add-geodesic" | "carry" | "tie-and-detach" | "trash";

const headerActionIcons: readonly string[] = ["add-geodesic", "carry", "tie-and-detach", "trash"];

/** The header icon for an icon id a tool contributed; throws on an id the palette has no icon for. */
export function headerActionIcon(iconId: string): HeaderActionIcon {
  if (!headerActionIcons.includes(iconId)) throw new Error(`the palette has no icon ${iconId}`);
  return iconId as HeaderActionIcon;
}

/**
 * Icon-and-text button of a page's toolbar ("+ Add beam", "Pick up · G", "Join", "Delete"); disabled ones are dimmed and inert, with their reason drawn under them.
 * The returned Container is the button alone, or the button above its reason; the clickable surface is inside it.
 */
export function createHeaderActionButton(
  itemId: string,
  label: string,
  onClick: () => void,
  options: {
    readonly icon: HeaderActionIcon;
    readonly disabled?: boolean;
    /** Why the button is disabled; drawn under it while it is. */
    readonly disabledReason?: string;
    readonly width?: number;
    readonly backgroundColor?: string;
    /** Text shown when the button is pointed at, for buttons whose id has no entry in the tooltip table. */
    readonly tooltip?: string;
  },
): Container {
  const button = createInteractiveSurface({
    width: options.width ?? "auto",
    height: buttonHeight,
    paddingX: label ? 16 : 10,
    label: "",
    onClick,
    disabled: options.disabled,
    backgroundColor: options.disabled ? disabledColor : (options.backgroundColor ?? actionColor),
  });
  button.userData.scenePaletteItemId = itemId;
  if (options.tooltip !== undefined) {
    button.userData.scenePaletteTooltip = options.tooltip;
  }
  if (options.icon === "trash") {
    button.add(new Trash2({ width: 22, height: 22, color: textColor }));
  } else if (options.icon === "tie-and-detach") {
    button.add(createUnlinkIcon());
  } else if (!(options.icon === "add-geodesic" && label.startsWith("+"))) {
    // "+ Add beam" carries its plus in the label; another plus as an icon would say it twice.
    button.add(createGeodesicCannonActionIcon(options.icon));
  }
  if (label) {
    button.add(createButtonText(label, typeScale.button - 1));
  }
  return withDisabledReason(
    button,
    options.disabled ? options.disabledReason : undefined,
    options.disabled && options.disabledReason !== undefined ? Math.max(options.width ?? 0, 180) : (options.width ?? 180),
  );
}

/**
 * Base clickable Container. The click callback is stored in userData.scenePaletteAction, not on uikit events; disabled buttons store no action and set pointerEvents "none" so rays pass through them.
 * It lights up under the menu cursor (a lighter tint of its color).
 */
export function createInteractiveSurface(options: {
  readonly width: number | `${number}%` | `${number}px` | "auto";
  readonly height: number;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly flexDirection?: "row" | "column";
  readonly positionType?: "static" | "relative" | "absolute";
  readonly positionTop?: number;
  readonly positionRight?: number;
  readonly positionBottom?: number;
  readonly zIndexOffset?: number;
  readonly justifyContent?: "center" | "flex-start" | "space-between";
  readonly paddingLeft?: number;
  readonly paddingX?: number;
  readonly backgroundColor: string;
  /** Hover tint; defaults to the lighter tint of backgroundColor. */
  readonly hoverColor?: string;
  readonly labelFontSize?: number;
  readonly labelWeight?: "medium" | "bold";
  readonly radius?: number;
}): Container {
  const hoverColor = options.hoverColor ?? hoverColors[options.backgroundColor];
  const button = new Container({
    width: options.width,
    height: options.height,
    positionType: options.positionType,
    positionTop: options.positionTop,
    positionRight: options.positionRight,
    positionBottom: options.positionBottom,
    zIndexOffset: options.zIndexOffset,
    borderRadius: options.radius ?? controlRadius,
    flexDirection: options.flexDirection ?? "row",
    flexShrink: 0,
    gap: options.label ? 10 : 8,
    alignItems: "center",
    justifyContent: options.justifyContent ?? "center",
    paddingLeft: options.paddingLeft ?? options.paddingX ?? 0,
    paddingRight: options.paddingX ?? 0,
    backgroundColor: options.disabled ? disabledColor : options.backgroundColor,
    ...(hoverColor !== undefined && !options.disabled ? { hover: { backgroundColor: hoverColor } } : {}),
    opacity: options.disabled ? 0.5 : 1,
    pointerEvents: options.disabled ? "none" : "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  button.userData.scenePaletteAction = options.disabled ? undefined : options.onClick;
  if (options.label) {
    button.add(createButtonText(options.label, options.labelFontSize ?? typeScale.button, options.labelWeight));
  }
  return button;
}

/**
 * Button label text: bold by default, wraps and may shrink.
 */
export function createButtonText(text: string, fontSize: number, fontWeight: "medium" | "bold" = "bold"): Text {
  return new Text({
    text,
    fontSize: fontPx(fontSize),
    fontWeight,
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
    pointerEvents: "none",
  });
}

/**
 * Dispose each top-level child tree.
 */
export function disposeRenderedChildren(children: readonly Container[]): void {
  for (const child of children) {
    disposeComponentTree(child);
  }
}

// Dispose children depth-first, then the component itself.
function disposeComponentTree(component: Component<any>): void {
  for (const child of [...component.children]) {
    if (child instanceof Component) {
      disposeComponentTree(child);
    }
  }
  component.dispose();
}
