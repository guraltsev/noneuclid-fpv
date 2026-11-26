/**
 * The palette panel header: a title bar (back or settings on the left, the page title and an optional subtitle, close on the right),
 * a toolbar row under it with the page's own actions (Add beam, Pick up, Delete, ...) when the page has any, and a hairline that separates it from the page body.
 */
import { Container, Text } from "@pmndrs/uikit";
import { House, RotateCw } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition, PaletteHeaderAction } from "../../../ui/paletteDefinition";
import { resolveVrPaletteHeaderActions } from "../vrPaletteHeaderActions";
import type { ScenePaletteAdapterOptions } from "./adapterTypes";
import {
  borderColor,
  contributedActionColor,
  dangerColor,
  disabledColor,
  fontPx,
  inactiveColor,
  mutedTextColor,
  raisedColor,
  textColor,
  typeScale,
} from "./tokens";
import { createHeaderIcon } from "./icons";
import { createButtonText, createHeaderActionButton, createInteractiveSurface, headerActionIcon } from "./widgets";
import { mainMenuText, menuControlText, objectActions, settingsText, surfaceNames, toolNames } from "../../../world-objects/vocabulary";

/** The size of the square header buttons (back, settings, close). */
const headerButtonSize = 48;

/**
 * The title the header shows for a page, and the subtitle under it (empty when there is none).
 * A help card's own title stays in its body; the header names the part of Help it belongs to.
 */
export function paletteTitle(definition: PaletteDefinition): { readonly title: string; readonly subtitle: string } {
  const content = definition.content;
  switch (content.kind) {
    case "main":
      return { title: mainMenuText.title, subtitle: "" };
    case "settings":
      return { title: mainMenuText.settings, subtitle: "" };
    case "debug-settings":
      return { title: settingsText.debugSettingsTitle, subtitle: "" };
    case "place-flag-options":
      return { title: settingsText.signType, subtitle: "" };
    case "edit-sign":
      return { title: settingsText.editSign, subtitle: "" };
    case "measurement-actions":
      return { title: content.title, subtitle: "" };
    case "geodesic-cannon-actions":
      return { title: toolNames["geodesicEmitters/emitter"].name, subtitle: "" };
    case "geometry-computer-actions":
      return { title: shapeMachineTitle, subtitle: "" };
    case "tutorial":
      return { title: surfaceNames.howTo, subtitle: content.view === "index" ? "" : content.pageLabel };
    case "goal":
      return { title: surfaceNames.thingsToTry, subtitle: content.pageLabel };
    case "discoveries":
      return { title: content.title, subtitle: content.countLabel };
    case "question-help":
      return { title: surfaceNames.help, subtitle: "" };
  }
}

// The shape machine's name, as its page has always called it.
const shapeMachineTitle = "Shape machine";

/**
 * Header: the title bar, then the toolbar of the page's actions when it has any, then a hairline.
 */
export function buildHeader(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
): Container {
  const headerActions = resolveVrPaletteHeaderActions(definition);
  // Home and reload buttons are shown only on the VR main page with tool tiles; the main menu lists them as rows otherwise.
  const showUtilityActions = definition.content.kind === "main" && definition.content.toolOptions.length > 0;
  const header = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 14,
    flexShrink: 0,
  });

  const titleBar = new Container({
    width: "100%",
    height: headerButtonSize,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
  });
  // The main menu lists Settings as a row, so its header has no gear; a page without a left action starts with its title.
  const leftAction = definition.content.kind === "main" && !showUtilityActions ? undefined : headerActions.leftAction;
  if (leftAction !== undefined && leftAction.id !== "none") {
    titleBar.add(createHeaderButton(leftAction, () => {
      dispatchHeaderAction(leftAction.id, options);
    }));
  }

  const { title, subtitle } = paletteTitle(definition);
  const titleColumn = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flexGrow: 1,
    flexShrink: 1,
  });
  const titleText = new Text({
    text: title,
    fontSize: fontPx(typeScale.title),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
  });
  titleText.name = "palette-title";
  titleColumn.add(titleText);
  if (subtitle !== "") {
    titleColumn.add(createSubtitleChip(subtitle));
  }
  titleBar.add(titleColumn);

  if (showUtilityActions) {
    titleBar.add(
      createHeaderUtilityButton("home", false, options.onHomeRequested),
      createHeaderUtilityButton("reload", definition.reloadConfirmationActive, options.onReloadRequested),
    );
  }

  titleBar.add(createHeaderButton(headerActions.rightAction, () => {
    dispatchHeaderAction(headerActions.rightAction.id, options);
  }));
  header.add(titleBar);

  const contextualActions = createContextualHeaderActions(definition, options);
  if (contextualActions.length > 0) {
    const toolbar = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      gap: 10,
      flexShrink: 0,
    });
    toolbar.add(...contextualActions);
    header.add(toolbar);
  }

  header.add(new Container({ width: "100%", height: 1, backgroundColor: borderColor, flexShrink: 0 }));
  return header;
}

// The page counter or found count next to the title: a quiet pill.
function createSubtitleChip(text: string): Container {
  const chip = new Container({
    paddingX: 12,
    paddingY: 4,
    borderRadius: 999,
    backgroundColor: raisedColor,
    flexShrink: 0,
    alignItems: "center",
  });
  chip.add(new Text({
    text,
    fontSize: fontPx(typeScale.caption),
    fontWeight: "bold",
    color: mutedTextColor,
    fill: mutedTextColor,
    whiteSpace: "pre",
    flexShrink: 0,
  }));
  return chip;
}

// Page-specific toolbar buttons: cannon add, carry and the actions tools contribute, or the sign or measurement Delete; empty otherwise.
function createContextualHeaderActions(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
): Container[] {
  if (definition.content.kind === "geodesic-cannon-actions") {
    const content = definition.content;
    return [
      createHeaderActionButton(
        "geodesic-cannon-action:add-geodesic",
        content.addAction.label,
        () => options.onGeodesicCannonAddRequested?.(content.cannonId),
        { icon: "add-geodesic", disabled: content.addAction.disabled, disabledReason: content.addAction.disabledReason },
      ),
      createHeaderActionButton(
        "geodesic-cannon-action:carry",
        content.carryAction.label,
        () => options.onGeodesicCannonCarryRequested?.(content.cannonId),
        { icon: "carry", disabled: content.carryAction.disabled, disabledReason: content.carryAction.disabledReason, backgroundColor: inactiveColor },
      ),
      ...content.objectActions.map((action) => createHeaderActionButton(
        `geodesic-cannon-action:${action.actionId}`,
        action.label,
        () => options.onObjectActionRequested?.("geodesicEmitters/emitter", content.cannonId, action.actionId),
        { icon: headerActionIcon(action.iconId), disabled: !action.enabled, disabledReason: action.disabledReason, backgroundColor: contributedActionColor, tooltip: action.tooltip },
      )),
      createHeaderActionButton(
        "geodesic-cannon-action:delete-laser",
        content.deleteAction.label,
        () => options.onGeodesicCannonDeleteLaserRequested?.(content.cannonId),
        { icon: "trash", disabled: content.deleteAction.disabled, disabledReason: content.deleteAction.disabledReason, backgroundColor: dangerColor, tooltip: content.deleteAction.tooltip },
      ),
    ];
  }

  if (definition.content.kind === "edit-sign") {
    const content = definition.content;
    return [
      createHeaderActionButton(
        "sign-action:trash",
        content.deleteAction.label,
        () => options.onSignDeleteRequested?.(),
        { icon: "trash", disabled: content.deleteAction.disabled, disabledReason: content.deleteAction.disabledReason, backgroundColor: dangerColor, tooltip: menuControlText.deleteSignTooltip },
      ),
    ];
  }

  if (definition.content.kind === "measurement-actions") {
    const content = definition.content;
    return [
      createHeaderActionButton(
        "measurement-action:delete",
        content.deleteAction.label,
        () => options.onMeasurementDeleteRequested?.(content.measurementKind, content.measurementId),
        { icon: "trash", disabled: content.deleteAction.disabled, disabledReason: content.deleteAction.disabledReason, backgroundColor: dangerColor, tooltip: content.deleteAction.tooltip },
      ),
    ];
  }

  return [];
}

// Home or reload button. The reload button turns red while a reload confirmation is pending, and its label says so.
function createHeaderUtilityButton(
  actionId: "home" | "reload",
  active: boolean,
  onClick: () => void,
): Container {
  const button = createInteractiveSurface({
    width: active ? "auto" : headerButtonSize,
    height: headerButtonSize,
    paddingX: active ? 14 : 0,
    label: "",
    onClick,
    backgroundColor: active ? dangerColor : raisedColor,
  });
  button.name = actionId === "home"
    ? objectActions.goHome
    : active ? mainMenuText.startOverConfirm : objectActions.startOver;
  button.userData.scenePaletteItemId = actionId === "home" ? "go-home" : "reload-world";
  button.add(actionId === "home"
    ? new House({ width: 24, height: 24, color: textColor })
    : new RotateCw({ width: 24, height: 24, color: textColor }));
  if (active) {
    button.add(createButtonText(mainMenuText.startOverConfirm, typeScale.caption));
  }
  return button;
}

// Square header button (back, settings, close). An action with id "none" becomes an invisible, non-interactive spacer of the same size so the title stays put.
function createHeaderButton(
  action: PaletteHeaderAction,
  onClick: () => void,
): Container {
  if (action.id === "none") {
    return new Container({
      width: headerButtonSize,
      height: headerButtonSize,
      flexShrink: 0,
      opacity: 0,
      pointerEvents: "none",
    });
  }

  const button = createInteractiveSurface({
    width: headerButtonSize,
    height: headerButtonSize,
    label: "",
    onClick,
    disabled: action.disabled,
    backgroundColor: action.disabled ? disabledColor : raisedColor,
  });
  button.name = action.ariaLabel || "palette-header-action";
  button.userData.scenePaletteItemId = action.id;
  const icon = createHeaderIcon(action.id);
  if (icon) {
    button.add(icon);
  } else if (action.label) {
    button.add(createButtonText(action.label, typeScale.button));
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
