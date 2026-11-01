/**
 * Geometry computer palette page: target stepping controls, the lattice diagram and the go button.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, sectionColor, textColor } from "../tokens";
import { createInteractiveSurface, createSectionLabel } from "../widgets";
import { createWorldDeformationDiagram } from "../latticeDiagram";

/**
 * Geometry computer page: status text, deformation diagram, coordinate readout, a 4-column grid of step buttons and a Go button.
 */
export function buildGeometryComputerActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geometry-computer-actions" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 600,
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel("World deformation"));
  panel.add(new Text({
    text: content.statusLabel,
    fontSize: 18,
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  panel.add(createWorldDeformationDiagram(content));

  panel.add(new Text({
    text: `X = ${content.widthMeters} m   current white (${content.current.aMeters}, ${content.current.bMeters})   target green (${content.target.aMeters}, ${content.target.bMeters})`,
    fontSize: 16,
    fontWeight: "medium",
    color: "#bbf7d0",
    fill: "#bbf7d0",
    flexShrink: 1,
    wordBreak: "break-word",
  }));

  const presetGrid = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
  });
  for (let index = 0; index < content.stepActions.length; index += 4) {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    });
    for (const action of content.stepActions.slice(index, index + 4)) {
      const button = createInteractiveSurface({
        width: "24%",
        height: 44,
        label: action.label,
        labelFontSize: 15,
        disabled: action.disabled,
        backgroundColor: action.disabled ? "#334155" : actionColor,
        onClick: () => options.onGeometryComputerStepTargetRequested?.(content.computerId, action.axis, action.deltaMeters),
      });
      button.userData.scenePaletteItemId = `geometry-computer:step:${action.axis}:${action.deltaMeters}`;
      row.add(button);
    }
    presetGrid.add(row);
  }

  const goButton = createInteractiveSurface({
    width: "100%",
    height: 56,
    label: content.goAction.label,
    labelFontSize: 20,
    disabled: content.goAction.disabled,
    backgroundColor: content.goAction.disabled ? "#334155" : "#166534",
    onClick: () => options.onGeometryComputerGoRequested?.(content.computerId),
  });
  goButton.userData.scenePaletteItemId = "geometry-computer:go";

  panel.add(presetGrid, goButton);
  return panel;
}
