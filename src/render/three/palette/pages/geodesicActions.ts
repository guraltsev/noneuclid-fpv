/**
 * Geodesic cannon palette page: a scrollable list with one row per geodesic.
 */
import { Container } from "@pmndrs/uikit";
import { Trash2 } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, dangerColor, inactiveColor, sectionColor, textColor, typeScale } from "../tokens";
import { createGeodesicCannonActionIcon, createConnectedGeodesicSegmentStatus } from "../icons";
import { createButtonText, createInteractiveSurface, createOverline, createPageBody, createScrollArea, withDisabledReason } from "../widgets";
import { objectActions } from "../../../../world-objects/vocabulary";

// The heading over the list of a laser's beams.
const geodesicListHeading = "Beams";

/**
 * Geodesic cannon page: a scrollable list with one row per geodesic (label, connected-status icon or Aim button, delete button).
 */
export function buildGeodesicCannonActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geodesic-cannon-actions" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  // The page title names the laser; its own actions are in the header toolbar.
  const panel = createPageBody({ gap: 10 });
  panel.add(createOverline(geodesicListHeading));

  const list = createScrollArea({ gap: 8 });

  for (const geodesic of content.geodesics) {
    const row = new Container({
      width: "100%",
      minHeight: 64,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingX: 18,
      paddingY: 10,
      borderRadius: 12,
      backgroundColor: sectionColor,
      borderColor,
      borderWidth: 1,
    });
    const label = createButtonText(geodesic.label, typeScale.body, "medium");
    row.add(label);
    row.add(new Container({ flexGrow: 1 }));

    const deleteButton = createInteractiveSurface({
      width: 112,
      height: 42,
      label: objectActions.delete,
      labelFontSize: typeScale.button - 1,
      disabled: geodesic.deleteDisabled,
      backgroundColor: dangerColor,
      onClick: () => options.onGeodesicCannonDeleteRequested?.(content.cannonId, geodesic.id),
    });
    deleteButton.userData.scenePaletteItemId = `geodesic-cannon-action:delete:${geodesic.id}`;
    deleteButton.add(new Trash2({ width: 20, height: 20, color: textColor }));

    if (geodesic.connected) {
      const status = createInteractiveSurface({
        width: 52,
        height: 42,
        label: "",
        labelFontSize: 15,
        disabled: true,
        backgroundColor: inactiveColor,
        onClick: () => {},
      });
      status.name = geodesic.connectionSymbolLabel ?? "Linked beam: a beam from one laser to another";
      status.add(createConnectedGeodesicSegmentStatus());
      row.add(status);
    }

    // A linked beam cannot be aimed: its Aim button stays, greyed out, with the reason under it.
    const aimButton = createInteractiveSurface({
      width: 112,
      height: 42,
      label: objectActions.aim,
      labelFontSize: typeScale.button - 1,
      disabled: geodesic.aimDisabled,
      backgroundColor: actionColor,
      onClick: () => options.onGeodesicCannonAimRequested?.(content.cannonId, geodesic.id),
    });
    aimButton.userData.scenePaletteItemId = `geodesic-cannon-action:aim:${geodesic.id}`;
    aimButton.add(createGeodesicCannonActionIcon("aim"));
    row.add(withDisabledReason(aimButton, geodesic.aimDisabled ? geodesic.aimDisabledReason : undefined, geodesic.aimDisabled ? 180 : 112));

    row.add(withDisabledReason(deleteButton, geodesic.deleteDisabled ? geodesic.deleteDisabledReason : undefined, geodesic.deleteDisabled ? 180 : 112));
    list.add(row);
  }

  panel.add(list);
  return panel;
}
