/**
 * Generic uikit widgets of the in-scene palette panel (buttons, toggles, option grids, section labels, the interactive surface) and disposal of rendered trees.
 */
import { Component, Container, Text } from "@pmndrs/uikit";
import { House, RotateCw, Trash2 } from "@pmndrs/uikit-lucide";
import { actionColor, activeColor, inactiveColor, mutedTextColor, scrollbarBorderColor, scrollbarColor, textColor } from "./tokens";
import { createGeodesicCannonActionIcon, createUnlinkIcon } from "./icons";

/**
 * Fixed 400 pixel tall scrolling column with a styled scrollbar.
 */
export function createSettingsScrollContainer(): Container {
  return new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
    height: 400,
    overflow: "scroll",
    paddingRight: 24,
    scrollbarWidth: 14,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 7,
    scrollbarZIndex: 1004,
  });
}

/** Muted section heading text that shrinks and wraps within its row. */
export function createSectionLabel(text: string): Text {
  return new Text({
    text,
    fontSize: 16,
    fontWeight: "medium",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

/**
 * Labelled single-choice option grid.
 */
export function createChoiceSection(
  label: string,
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  onSelected: (id: string) => void,
  itemPrefix: string,
): Container {
  const section = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
  });
  section.add(createSectionLabel(label));
  section.add(createOptionGrid(options, selectedId, itemPrefix, onSelected));
  return section;
}

/**
 * Two-column grid of option buttons; the selected one is highlighted. Item ids are "<prefix>:<option id>".
 */
export function createOptionGrid(
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  itemPrefix: string,
  onSelected: (id: string) => void,
): Container {
  const grid = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 6,
  });

  for (let index = 0; index < options.length; index += 2) {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    });

    for (const option of options.slice(index, index + 2)) {
      const button = createInteractiveSurface({
        width: "49%",
        height: 34,
        justifyContent: "flex-start",
        paddingLeft: 12,
        backgroundColor: option.id === selectedId ? activeColor : "#1f2937",
        label: option.label,
        labelFontSize: 15,
        onClick: () => onSelected(option.id),
      });
      button.userData.scenePaletteItemId = `${itemPrefix}:${option.id}`;
      row.add(button);
    }

    grid.add(row);
  }

  return grid;
}

/**
 * Label plus On/Off toggle.
 */
export function createToggleRow(
  label: string,
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  row.add(createSectionLabel(label));
  row.add(createToggleButton(enabled, onToggled, itemId));
  return row;
}

/**
 * On/Off button; clicking calls onToggled with the inverted value of the state captured at build time (state is not read back).
 */
export function createToggleButton(
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
): Container {
  const button = createInteractiveSurface({
    width: 96,
    height: 34,
    label: enabled ? "On" : "Off",
    labelFontSize: 15,
    onClick: () => onToggled(!enabled),
    backgroundColor: enabled ? activeColor : inactiveColor,
  });
  button.userData.scenePaletteItemId = itemId;
  return button;
}

/**
 * Generic labelled action button with an optional home/reload icon.
 */
export function createActionButton(
  label: string,
  itemId: string,
  onClick: () => void,
  options: {
    readonly icon?: "home" | "reload";
    readonly width?: number;
    readonly backgroundColor?: string;
  } = {},
): Container {
  const button = createInteractiveSurface({
    width: options.width ?? 112,
    height: 36,
    backgroundColor: options.backgroundColor ?? actionColor,
    label,
    labelFontSize: 15,
    onClick,
  });
  button.userData.scenePaletteItemId = itemId;
  if (options.icon === "home") {
    button.add(new House({
      width: 20,
      height: 20,
      color: textColor,
      fill: textColor,
    }));
  } else if (options.icon === "reload") {
    button.add(new RotateCw({
      width: 20,
      height: 20,
      color: textColor,
      fill: textColor,
    }));
  }
  return button;
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
 * Square icon button for contextual header actions; disabled ones are dimmed and inert.
 */
export function createHeaderActionButton(
  itemId: string,
  label: string,
  onClick: () => void,
  options: {
    readonly icon: HeaderActionIcon;
    readonly disabled?: boolean;
    readonly width?: number;
    readonly backgroundColor?: string;
    /** Text shown when the button is pointed at, for buttons whose id has no entry in the tooltip table. */
    readonly tooltip?: string;
  },
): Container {
  const button = createInteractiveSurface({
    width: options.width ?? 52,
    height: 44,
    label,
    labelFontSize: 13,
    onClick,
    disabled: options.disabled,
    backgroundColor: options.disabled ? "#334155" : (options.backgroundColor ?? actionColor),
  });
  button.userData.scenePaletteItemId = itemId;
  if (options.tooltip !== undefined) {
    button.userData.scenePaletteTooltip = options.tooltip;
  }
  if (options.icon === "trash") {
    button.add(new Trash2({
      width: 22,
      height: 22,
      color: textColor,
      fill: textColor,
    }));
  } else if (options.icon === "tie-and-detach") {
    button.add(createUnlinkIcon());
  } else {
    button.add(createGeodesicCannonActionIcon(options.icon));
  }
  return button;
}

/**
 * Base clickable Container. The click callback is stored in userData.scenePaletteAction, not on uikit events; disabled buttons store no action and set pointerEvents "none" so rays pass through them.
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
  readonly justifyContent?: "center" | "flex-start";
  readonly paddingLeft?: number;
  readonly backgroundColor: string;
  readonly labelFontSize?: number;
}): Container {
  const button = new Container({
    width: options.width,
    height: options.height,
    positionType: options.positionType,
    positionTop: options.positionTop,
    positionRight: options.positionRight,
    positionBottom: options.positionBottom,
    zIndexOffset: options.zIndexOffset,
    borderRadius: 12,
    flexDirection: options.flexDirection ?? "row",
    gap: options.label ? 8 : 10,
    alignItems: "center",
    justifyContent: options.justifyContent ?? "center",
    paddingLeft: options.paddingLeft ?? 0,
    backgroundColor: options.backgroundColor,
    borderColor: "#93c5fd",
    borderWidth: 1,
    opacity: options.disabled ? 0.45 : 1,
    pointerEvents: options.disabled ? "none" : "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  button.userData.scenePaletteAction = options.disabled ? undefined : options.onClick;
  if (options.label) {
    button.add(createButtonText(options.label, options.labelFontSize ?? 15));
  }
  return button;
}

/**
 * Bold label text that wraps and may shrink.
 */
export function createButtonText(text: string, fontSize: number): Text {
  return new Text({
    text,
    fontSize,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
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
