/**
 * The palette panel header row: left action (plus home and reload on the main page), contextual actions and the right action.
 */
import { Container, Text } from "@pmndrs/uikit";
import { House, RotateCw } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition, PaletteHeaderAction } from "../../../ui/paletteDefinition";
import { resolveVrPaletteHeaderActions } from "../vrPaletteHeaderActions";
import type { ScenePaletteAdapterOptions } from "./adapterTypes";
import { actionColor, textColor } from "./tokens";
import { createHeaderIcon } from "./icons";
import { createButtonText, createHeaderActionButton, createInteractiveSurface } from "./widgets";

/**
 * Header row: left (action, plus home/reload on the main page and a confirm tooltip), center contextual actions, right action. The unused title Text is an empty placeholder.
 */
export function buildHeader(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
): Container {
  const headerActions = resolveVrPaletteHeaderActions(definition);
  // Home and reload buttons are shown only on the main page.
  const showUtilityActions = definition.pageId === "main";
  const header = new Container({
    width: "100%",
    height: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });

  const leftActions = new Container({
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    positionType: "relative",
  });
  leftActions.add(
    createHeaderButton(headerActions.leftAction, () => {
      dispatchHeaderAction(headerActions.leftAction.id, options);
    }),
  );
  if (showUtilityActions) {
    leftActions.add(
      createHeaderUtilityButton("home", false, options.onHomeRequested),
      createHeaderUtilityButton("reload", definition.reloadConfirmationActive, options.onReloadRequested),
    );
  }
  if (showUtilityActions && definition.reloadConfirmationActive) {
    leftActions.add(createReloadConfirmTooltip());
  }
  header.add(leftActions);

  const contextualActions = createContextualHeaderActions(definition, options);
  if (contextualActions.length > 0) {
    const contextualActionRow = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    });
    contextualActionRow.add(...contextualActions);
    header.add(contextualActionRow);
  } else {
    header.add(new Text({
      text: "",
      fontSize: 1,
      opacity: 0,
    }));
  }

  header.add(new Text({
    text: "",
    fontSize: 28,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  }));
  header.add(createHeaderButton(headerActions.rightAction, () => {
    dispatchHeaderAction(headerActions.rightAction.id, options);
  }));

  return header;
}

// Page-specific header buttons: cannon add/carry/tie-and-detach, or the sign trash button; empty otherwise.
function createContextualHeaderActions(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
): Container[] {
  if (definition.content.kind === "geodesic-cannon-actions") {
    const content = definition.content;
    return [
      createHeaderActionButton(
        "geodesic-cannon-action:add-geodesic",
        "",
        () => options.onGeodesicCannonAddRequested?.(content.cannonId),
        { icon: "add-geodesic", disabled: content.addAction.disabled, width: 52 },
      ),
      createHeaderActionButton(
        "geodesic-cannon-action:carry",
        "",
        () => options.onGeodesicCannonCarryRequested?.(content.cannonId),
        { icon: "carry", disabled: content.carryAction.disabled, width: 52 },
      ),
      createHeaderActionButton(
        "geodesic-cannon-action:tie-and-detach",
        "",
        () => options.onGeodesicCannonTieAndDetachRequested?.(content.cannonId),
        { icon: "tie-and-detach", disabled: content.tieAndDetachAction.disabled, backgroundColor: "#b45309", width: 52 },
      ),
    ];
  }

  if (definition.content.kind === "edit-sign") {
    return [
      createHeaderActionButton(
        "sign-action:trash",
        "",
        () => options.onSignDeleteRequested?.(),
        { icon: "trash", backgroundColor: "#7f1d1d", width: 52 },
      ),
    ];
  }

  return [];
}

// Home or reload button. The reload button turns red while a reload confirmation is pending.
function createHeaderUtilityButton(
  actionId: "home" | "reload",
  active: boolean,
  onClick: () => void,
): Container {
  const button = createInteractiveSurface({
    width: 52,
    height: 44,
    label: "",
    onClick,
    backgroundColor: active ? "#991b1b" : actionColor,
  });
  button.name = actionId === "home"
    ? "Home"
    : active ? "Click again to confirm" : "Reload world";
  button.userData.scenePaletteItemId = actionId === "home" ? "go-home" : "reload-world";
  button.add(actionId === "home"
    ? new House({
        width: 24,
        height: 24,
        color: textColor,
        fill: textColor,
      })
    : new RotateCw({
        width: 24,
        height: 24,
        color: textColor,
        fill: textColor,
      }));
  return button;
}

// Small red "Click again to confirm" label positioned above the header's reload button using absolute offsets.
function createReloadConfirmTooltip(): Container {
  const tooltip = new Container({
    width: 162,
    height: 30,
    positionType: "absolute",
    positionTop: -34,
    positionLeft: 128,
    zIndexOffset: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#991b1b",
    borderColor: "#fecaca",
    borderWidth: 1,
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
  tooltip.add(new Text({
    text: "Click again to confirm",
    fontSize: 13,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  }));
  return tooltip;
}

// Standard header button. An action with id "none" becomes an invisible, non-interactive spacer of the same width so the layout stays stable.
function createHeaderButton(
  action: PaletteHeaderAction,
  onClick: () => void,
): Container {
  if (action.id === "none") {
    return new Container({
      width: 64,
      height: 44,
      opacity: 0,
      pointerEvents: "none",
    });
  }

  const button = createInteractiveSurface({
    width: 64,
    height: 44,
    label: "",
    onClick,
    disabled: action.disabled,
    backgroundColor: action.disabled ? "#334155" : actionColor,
  });
  button.name = action.ariaLabel || "palette-header-action";
  button.userData.scenePaletteItemId = action.id;
  const icon = createHeaderIcon(action.id);
  if (icon) {
    button.add(icon);
  } else if (action.label) {
    button.add(createButtonText(action.label, 15));
  }
  return button;
}

// Route "settings" to onLeftAction and every other action (close, back) to onRightAction; "none" is ignored.
function dispatchHeaderAction(
  actionId: PaletteHeaderAction["id"],
  options: ScenePaletteAdapterOptions,
): void {
  if (actionId === "none") {
    return;
  }

  if (actionId === "settings") {
    options.onLeftAction(actionId);
    return;
  }

  options.onRightAction(actionId);
}
