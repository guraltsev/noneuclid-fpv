/**
 * Small DOM badge showing the currently selected desktop tool (icon, name, and a selection prompt) near the HUD.
 * Role: purely presentational. The caller passes the selected tool's descriptor, the current sign style and the tool's prompt each time the selection or prompt changes; the module toggles CSS classes (desktop-tool-indicator-*) that decide which icon is shown (by the descriptor's icon id), and sets the label, prompt and aria-label text.
 * The indicator is hidden for the none and aim tools, which have no descriptor.
 * Lifecycle: the creator must call dispose() to remove the element.
 */
import { publicAssetUrl } from "../../glue/assetUrls";
import type { ToolDescriptor } from "../../engine/moduleTypes";
import type { PlacedFlagType } from "../../world-objects/toolObjects";

// Sign icon image per flag type.
const signIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};
const rayToolIconSource = publicAssetUrl("flashlight/Lightsaber.png");
const carryToolIconSource = publicAssetUrl("icons/carry.svg");
const protractorToolIconSource = publicAssetUrl("icons/protractor.png");
const measureLengthToolIconSource = publicAssetUrl("icons/ruler.svg");
const worldMapToolIconSource = publicAssetUrl("icons/world-map.svg");

/** Handle to the tool indicator created by {@link createDesktopToolIndicator}. */
export interface DesktopToolIndicator {
  /** Root element; hidden when no tool badge should be displayed. */
  readonly root: HTMLDivElement;
  /**
   * Updates the indicator for the selected tool's descriptor (undefined for none and aim: hidden).
   * flagType picks the sign icon and style regardless of the tool. promptText is the tool's prompt while it asks the player to select something, else undefined.
   */
  setTool(tool: ToolDescriptor | undefined, flagType: PlacedFlagType, promptText?: string): void;
  /** Removes the indicator element from the DOM. */
  dispose(): void;
}

/** Creates the hidden tool indicator, with all icon images pre-created, and appends it to container. */
export function createDesktopToolIndicator(container: HTMLElement): DesktopToolIndicator {
  const root = document.createElement("div");
  root.className = "desktop-tool-indicator";
  root.hidden = true;

  const icon = document.createElement("span");
  icon.className = "desktop-tool-indicator-icon";
  icon.setAttribute("aria-hidden", "true");

  const aimIcon = createSvgIcon("desktop-tool-indicator-svg", "0 0 24 24", [
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["path", { d: "M12 2v4" }],
    ["path", { d: "M12 18v4" }],
    ["path", { d: "M2 12h4" }],
    ["path", { d: "M18 12h4" }],
  ]);
  aimIcon.classList.add("desktop-tool-indicator-aim-icon");

  const signIcon = document.createElement("img");
  signIcon.className = "desktop-tool-indicator-sign-icon";
  signIcon.alt = "";
  signIcon.decoding = "async";

  const rayIcon = document.createElement("img");
  rayIcon.className = "desktop-tool-indicator-ray-icon";
  rayIcon.alt = "";
  rayIcon.decoding = "async";
  rayIcon.src = rayToolIconSource;
  const carryIcon = document.createElement("img");
  carryIcon.className = "desktop-tool-indicator-carry-icon";
  carryIcon.alt = "";
  carryIcon.decoding = "async";
  carryIcon.src = carryToolIconSource;
  const protractorIcon = document.createElement("img");
  protractorIcon.className = "desktop-tool-indicator-protractor-icon";
  protractorIcon.alt = "";
  protractorIcon.decoding = "async";
  protractorIcon.src = protractorToolIconSource;
  protractorIcon.setAttribute("aria-hidden", "true");
  const measureIcon = document.createElement("img");
  measureIcon.className = "desktop-tool-indicator-measure-icon";
  measureIcon.alt = "";
  measureIcon.decoding = "async";
  measureIcon.src = measureLengthToolIconSource;
  measureIcon.setAttribute("aria-hidden", "true");
  const worldMapIcon = document.createElement("img");
  worldMapIcon.className = "desktop-tool-indicator-world-map-icon";
  worldMapIcon.alt = "";
  worldMapIcon.decoding = "async";
  worldMapIcon.src = worldMapToolIconSource;
  worldMapIcon.setAttribute("aria-hidden", "true");
  icon.append(aimIcon, signIcon, rayIcon, carryIcon, protractorIcon, measureIcon, worldMapIcon);

  const label = document.createElement("span");
  label.className = "desktop-tool-indicator-label";
  const prompt = document.createElement("span");
  prompt.className = "desktop-tool-indicator-prompt";

  const text = document.createElement("span");
  text.className = "desktop-tool-indicator-text";
  text.append(label, prompt);

  root.append(icon, text);
  container.append(root);

  return {
    root,
    setTool(tool, flagType, promptText) {
      // The aim tool uses the crosshair instead of a badge, so it is hidden along with none: neither has a descriptor.
      root.hidden = tool === undefined;
      const iconId = tool?.iconId;
      root.classList.toggle("desktop-tool-indicator-place-flag", iconId === "sign");
      root.classList.toggle("desktop-tool-indicator-measure-length", iconId === "length");
      // The ray icon stands for every emitter tool that has no icon of its own here.
      root.classList.toggle("desktop-tool-indicator-geodesic-cannon", iconId === "ray" || iconId === "rotate" || iconId === "aim");
      root.classList.toggle("desktop-tool-indicator-geodesic-cannon-carry", iconId === "carry");
      root.classList.toggle("desktop-tool-indicator-protractor", iconId === "protractor");
      root.classList.toggle("desktop-tool-indicator-world-map", iconId === "map");
      root.classList.toggle("desktop-tool-indicator-WoodenSign1", flagType === "WoodenSign1");
      root.classList.toggle("desktop-tool-indicator-WoodenSign2", flagType === "WoodenSign2");
      signIcon.src = signIconSources[flagType];
      label.textContent = tool === undefined ? "" : tool.badgeLabel ?? tool.label;
      prompt.textContent = promptText ?? "";
      // Prompt text is only shown for tools that ask the player to select something.
      prompt.hidden = promptText === undefined;
      root.ariaLabel = tool === undefined
        ? "No selected tool"
        : promptText === undefined
          ? `Selected tool: ${tool.label}`
          : `Selected tool: ${tool.label}, ${promptText}`;
    },
    dispose() {
      root.remove();
    },
  };
}

// Builds an inline stroke-style SVG from [tagName, attributes] pairs.
function createSvgIcon(
  className: string,
  viewBox: string,
  children: readonly [string, Record<string, string>][],
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add(className);
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  for (const [tagName, attributes] of children) {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    for (const [name, value] of Object.entries(attributes)) {
      child.setAttribute(name, value);
    }
    svg.append(child);
  }

  return svg;
}
