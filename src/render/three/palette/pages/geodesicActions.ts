/**
 * Geodesic cannon palette page: a scrollable list with one row per geodesic.
 */
import { Container } from "@pmndrs/uikit";
import { Trash2 } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, inactiveColor, scrollbarBorderColor, scrollbarColor, sectionColor, textColor } from "../tokens";
import { createGeodesicCannonActionIcon, createConnectedGeodesicSegmentStatus } from "../icons";
import { createButtonText, createInteractiveSurface, createSectionLabel } from "../widgets";
import { objectActions, toolNames } from "../../../../world-objects/vocabulary";

/**
 * Geodesic cannon page: a scrollable list with one row per geodesic (label, connected-status icon or Aim button, delete button).
 */
export function buildGeodesicCannonActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geodesic-cannon-actions" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 522,
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel(toolNames["geodesicEmitters/emitter"].name));

  const list = new Container({
    width: "100%",
    height: 316,
    flexDirection: "column",
    gap: 8,
    overflow: "scroll",
    paddingRight: 18,
    scrollbarWidth: 12,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 6,
    scrollbarZIndex: 1004,
  });

  for (const geodesic of content.geodesics) {
    const row = new Container({
      width: "100%",
      height: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: 8,
      borderRadius: 14,
      backgroundColor: inactiveColor,
      borderColor,
      borderWidth: 1,
    });
    row.add(createButtonText(geodesic.label, 18));

    const deleteButton = createInteractiveSurface({
      width: 46,
      height: 42,
      label: "",
      disabled: geodesic.deleteDisabled,
      backgroundColor: geodesic.deleteDisabled ? "#334155" : "#7f1d1d",
      onClick: () => options.onGeodesicCannonDeleteRequested?.(content.cannonId, geodesic.id),
    });
    deleteButton.userData.scenePaletteItemId = `geodesic-cannon-action:delete:${geodesic.id}`;
    deleteButton.add(new Trash2({
      width: 24,
      height: 24,
      color: textColor,
      fill: textColor,
    }));

    if (geodesic.connected) {
      const status = createInteractiveSurface({
        width: 52,
        height: 42,
        label: "",
        labelFontSize: 15,
        disabled: true,
        backgroundColor: "#334155",
        onClick: () => {},
      });
      status.name = geodesic.connectionSymbolLabel ?? "Linked beam: a beam from one laser to another";
      status.add(createConnectedGeodesicSegmentStatus());
      row.add(status);
    }

    if (!geodesic.connected) {
      const aimButton = createInteractiveSurface({
        width: 112,
        height: 42,
        label: objectActions.aim,
        labelFontSize: 16,
        disabled: false,
        backgroundColor: actionColor,
        onClick: () => options.onGeodesicCannonAimRequested?.(content.cannonId, geodesic.id),
      });
      aimButton.userData.scenePaletteItemId = `geodesic-cannon-action:aim:${geodesic.id}`;
      aimButton.add(createGeodesicCannonActionIcon("aim"));

      row.add(aimButton);
    }

    row.add(deleteButton);
    list.add(row);
  }

  panel.add(list);
  return panel;
}
