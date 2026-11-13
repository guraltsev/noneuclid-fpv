/**
 * Shape machine palette page (design 017 section 8.9): one picture of the target torus, the Shift and Height rows with their steps and a number pad, the presets, the "Same world as the start" badge, a folded "More" row and the Reshape world button.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import { shapeMachineText } from "../../../../ui/vocabulary";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, inactiveColor, sectionColor, textColor, fontPx } from "../tokens";
import { createDisabledReasonText, createInteractiveSurface, createSectionLabel, withDisabledReason } from "../widgets";
import { createWorldDeformationDiagram } from "../latticeDiagram";
import { createKeypadRow } from "./signs";

type GeometryComputerContent = Extract<PaletteDefinition["content"], { readonly kind: "geometry-computer-actions" }>;

/**
 * Shape machine page: status text, the labelled picture, the badge, a row per parameter (value, -1 m, +1 m), the number pad while a value is typed, the presets, the More row and the Reshape world button.
 */
export function buildGeometryComputerActionsContent(
  content: GeometryComputerContent,
  options: ScenePaletteAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 600,
    flexDirection: "column",
    gap: 8,
    padding: 14,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  const edit = (change: Parameters<NonNullable<ScenePaletteAdapterOptions["onGeometryComputerEditRequested"]>>[1]): void =>
    options.onGeometryComputerEditRequested?.(content.computerId, change);

  panel.add(createSectionLabel("Shape machine"));
  // The picture and the rows say the numbers; the status line is only for a world that is not the torus.
  if (!content.available) {
    panel.add(new Text({
      text: content.statusLabel,
      fontSize: fontPx(18),
      fontWeight: "medium",
      color: textColor,
      fill: textColor,
      flexShrink: 1,
      wordBreak: "break-word",
    }));
  }
  panel.add(createWorldDeformationDiagram(content));

  for (const parameter of content.parameters) {
    panel.add(createParameterRow(content, parameter.axis, options, edit));
  }
  // When the machine is off in this world every control shares one reason: it is drawn once, under the rows.
  const offReason = content.parameters.find((parameter) => parameter.disabled)?.disabledReason;
  if (!content.available && offReason !== undefined) {
    panel.add(createDisabledReasonText(offReason));
  }

  if (content.entry !== undefined) {
    panel.add(createNumberPad(content.entry, edit));
  }

  // While a value is typed the number pad takes the room of the presets and the More row.
  if (content.entry === undefined) {
    panel.add(createPresetSection(content, edit));
    panel.add(createMoreSection(content, edit));
  }

  const goButton = createInteractiveSurface({
    width: "100%",
    height: 52,
    label: content.goAction.label,
    labelFontSize: 20,
    disabled: content.goAction.disabled,
    backgroundColor: content.goAction.disabled ? "#334155" : "#166534",
    onClick: () => options.onGeometryComputerGoRequested?.(content.computerId),
  });
  goButton.userData.scenePaletteItemId = "geometry-computer:go";
  panel.add(withDisabledReason(goButton, content.goAction.disabled ? content.goAction.disabledReason : undefined, "100%"));
  return panel;
}

// One parameter: its name, its value (press it to type a new one) and the -1 m / +1 m steps; a step at the end of its range shows its reason.
function createParameterRow(
  content: GeometryComputerContent,
  axis: "a" | "b",
  options: ScenePaletteAdapterOptions,
  edit: (change: Parameters<NonNullable<ScenePaletteAdapterOptions["onGeometryComputerEditRequested"]>>[1]) => void,
): Container {
  const parameter = content.parameters.find((candidate) => candidate.axis === axis);
  const column = new Container({ width: "100%", flexDirection: "column", gap: 4, flexShrink: 0 });
  if (parameter === undefined) {
    return column;
  }
  const row = new Container({ width: "100%", height: 44, flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 });
  row.add(new Text({
    text: parameter.name,
    width: 120,
    fontSize: fontPx(20),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  }));

  const typing = content.entry?.axis === axis;
  const value = createInteractiveSurface({
    width: 150,
    height: 44,
    label: parameter.valueLabel,
    labelFontSize: 18,
    disabled: parameter.disabled,
    backgroundColor: parameter.disabled ? "#334155" : typing ? activeColor : inactiveColor,
    onClick: () => edit({ kind: "open-entry", axis }),
  });
  value.userData.scenePaletteItemId = `geometry-computer:value:${axis}`;
  row.add(value);

  let limitReason: string | undefined;
  for (const action of content.stepActions.filter((candidate) => candidate.axis === axis)) {
    const button = createInteractiveSurface({
      width: 96,
      height: 44,
      label: action.label,
      labelFontSize: 17,
      disabled: action.disabled,
      backgroundColor: action.disabled ? "#334155" : actionColor,
      onClick: () => options.onGeometryComputerStepTargetRequested?.(content.computerId, action.axis, action.deltaMeters),
    });
    button.userData.scenePaletteItemId = `geometry-computer:step:${action.axis}:${action.deltaMeters}`;
    row.add(button);
    if (action.disabled && content.available) {
      limitReason = action.disabledReason;
    }
  }
  // The reason a step is at the end of its range sits at the end of the row, so the page does not grow.
  if (limitReason !== undefined) {
    row.add(createDisabledReasonText(limitReason));
  }
  column.add(row);
  return column;
}

// The number pad: what was typed so far, the digits (the sign editor's key rows) and Back, Cancel and OK.
function createNumberPad(
  entry: NonNullable<GeometryComputerContent["entry"]>,
  edit: (change: Parameters<NonNullable<ScenePaletteAdapterOptions["onGeometryComputerEditRequested"]>>[1]) => void,
): Container {
  const pad = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    borderRadius: 16,
    backgroundColor: "#020617",
    borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  const line = new Container({ width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 });
  line.add(new Text({
    text: entry.prompt,
    fontSize: fontPx(16),
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  const shown = new Text({
    text: `${entry.text}|`,
    fontSize: fontPx(24),
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  });
  line.add(shown);
  pad.add(line);
  const digit = (key: string): void => edit({ kind: "entry-digit", digit: key });
  pad.add(createKeypadRow(["1", "2", "3", "4", "5"], digit, "geometry-computer:key:", 64));
  pad.add(createKeypadRow(["6", "7", "8", "9", "0"], digit, "geometry-computer:key:", 64));

  const controls = new Container({ width: "100%", height: 40, flexDirection: "row", justifyContent: "center", gap: 8, flexShrink: 0 });
  for (const [id, label, color, change] of [
    ["back", shapeMachineText.backspace, "#991b1b", { kind: "entry-backspace" }],
    ["cancel", shapeMachineText.cancel, inactiveColor, { kind: "entry-cancel" }],
    ["ok", shapeMachineText.ok, "#166534", { kind: "entry-apply" }],
  ] as const) {
    const button = createInteractiveSurface({
      width: 132,
      height: 40,
      label,
      labelFontSize: 16,
      backgroundColor: color,
      onClick: () => edit(change),
    });
    button.userData.scenePaletteItemId = `geometry-computer:key:${id}`;
    controls.add(button);
  }
  pad.add(controls);
  return pad;
}

// The presets: generic targets measured from the world's starting torus.
function createPresetSection(
  content: GeometryComputerContent,
  edit: (change: Parameters<NonNullable<ScenePaletteAdapterOptions["onGeometryComputerEditRequested"]>>[1]) => void,
): Container {
  const section = new Container({ width: "100%", flexDirection: "column", gap: 6, flexShrink: 0 });
  section.add(createSectionLabel(shapeMachineText.presetsHeading));
  const row = new Container({ width: "100%", flexDirection: "row", justifyContent: "space-between", gap: 8, flexShrink: 0 });
  for (const preset of content.presets) {
    const button = createInteractiveSurface({
      width: "24%",
      height: 52,
      label: preset.label,
      labelFontSize: 15,
      disabled: preset.disabled,
      backgroundColor: preset.disabled ? "#334155" : actionColor,
      onClick: () => edit({ kind: "set-target", aMeters: preset.aMeters, bMeters: preset.bMeters }),
    });
    button.userData.scenePaletteItemId = `geometry-computer:preset:${preset.id}`;
    row.add(button);
  }
  section.add(row);
  return section;
}

// The collapsed "More" row; unfolded it gives the width and the modulus of the two shapes.
function createMoreSection(
  content: GeometryComputerContent,
  edit: (change: Parameters<NonNullable<ScenePaletteAdapterOptions["onGeometryComputerEditRequested"]>>[1]) => void,
): Container {
  const section = new Container({ width: "100%", flexDirection: "column", gap: 6, flexShrink: 0 });
  const toggle = createInteractiveSurface({
    width: 140,
    height: 36,
    label: content.moreOpen ? shapeMachineText.less : shapeMachineText.more,
    labelFontSize: 15,
    disabled: !content.available,
    backgroundColor: !content.available ? "#334155" : inactiveColor,
    onClick: () => edit({ kind: "toggle-more" }),
  });
  toggle.userData.scenePaletteItemId = "geometry-computer:more";
  section.add(toggle);
  if (content.moreOpen) {
    // Diagram colours: current white, target green.
    const colors = ["#bbf7d0", "#f8fafc", "#34d399"];
    content.moreLines.forEach((line, index) => {
      const color = colors[index] ?? textColor;
      section.add(new Text({
        text: line,
        fontSize: fontPx(16),
        fontWeight: "medium",
        color,
        fill: color,
        flexShrink: 1,
        wordBreak: "break-word",
      }));
    });
  }
  return section;
}
