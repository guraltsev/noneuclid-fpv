/**
 * Small DOM badge showing the currently selected desktop tool (icon, name, and a selection prompt) near the HUD.
 * Role: purely presentational. The caller passes the selected tool id, the current sign style and optional prompt strings each time the selection or prompt changes; the module toggles CSS classes (desktop-tool-indicator-*) that decide which icon is shown, and sets the label, prompt and aria-label text.
 * The indicator is hidden for the none and aim tools.
 * Lifecycle: the creator must call dispose() to remove the element.
 */
import { publicAssetUrl } from "../../glue/assetUrls";
import type { RuntimeToolId } from "../../runtime/runtimeMenuState";
import type { PlacedFlagType } from "../../world-objects/placedFlags";

// Sign icon image per flag type.
const signIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};
const rayToolIconSource = publicAssetUrl("flashlight/Lightsaber.png");
const carryToolIconSource = publicAssetUrl("icons/carry.svg");
const protractorToolIconSource = publicAssetUrl("icons/protractor.png");
const measureLengthToolIconSource = publicAssetUrl("icons/ruler.svg");

/** Handle to the tool indicator created by {@link createDesktopToolIndicator}. */
export interface DesktopToolIndicator {
  /** Root element; hidden when no tool badge should be displayed. */
  readonly root: HTMLDivElement;
  /**
   * Updates the indicator for the selected tool.
   * flagType picks the sign icon and style regardless of the tool. protractorPrompt (default "select: vertex") is shown for the protractor tool and tieAndDetachPrompt (default "select: geodesic 1") for the tie-and-detach tool; the measure-length tool shows a fixed "select: geodesic" prompt.
   */
  setTool(
    toolId: RuntimeToolId,
    flagType: PlacedFlagType,
    options?: {
      readonly protractorPrompt?: string;
      readonly tieAndDetachPrompt?: string;
    },
  ): void;
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
  icon.append(aimIcon, signIcon, rayIcon, carryIcon, protractorIcon, measureIcon);

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
    setTool(toolId, flagType, indicatorOptions = {}) {
      // The aim tool uses the crosshair instead of a badge, so it is hidden along with none.
      root.hidden = toolId === "none" || toolId === "aim";
      root.classList.toggle("desktop-tool-indicator-aim", toolId === "aim");
      root.classList.toggle("desktop-tool-indicator-place-flag", toolId === "place-flag");
      root.classList.toggle("desktop-tool-indicator-measure-length", toolId === "measure-length");
      root.classList.toggle(
        "desktop-tool-indicator-geodesic-cannon",
        toolId === "geodesic-cannon" ||
          toolId === "geodesic-cannon-rotate" ||
          toolId === "geodesic-cannon-aim" ||
          toolId === "geodesic-cannon-tie-detach",
      );
      root.classList.toggle("desktop-tool-indicator-geodesic-cannon-carry", toolId === "geodesic-cannon-carry");
      root.classList.toggle("desktop-tool-indicator-protractor", toolId === "protractor");
      root.classList.toggle("desktop-tool-indicator-WoodenSign1", flagType === "WoodenSign1");
      root.classList.toggle("desktop-tool-indicator-WoodenSign2", flagType === "WoodenSign2");
      signIcon.src = signIconSources[flagType];
      // Short display name per tool; empty for tools without a badge.
      label.textContent = toolId === "geodesic-cannon-rotate"
        ? "Rotate"
        : toolId === "geodesic-cannon-carry"
          ? "Carry"
        : toolId === "geodesic-cannon-aim"
          ? "Aim"
        : toolId === "geodesic-cannon-tie-detach"
          ? "Tie"
          : toolId === "measure-length"
            ? "Length"
          : toolId === "protractor"
            ? "Protractor"
          : toolId === "geodesic-cannon"
            ? "Ray"
            : toolId === "place-flag"
              ? "Sign"
              : "";
      prompt.textContent = toolId === "protractor"
        ? indicatorOptions.protractorPrompt ?? "select: vertex"
        : toolId === "geodesic-cannon-tie-detach"
          ? indicatorOptions.tieAndDetachPrompt ?? "select: geodesic 1"
        : toolId === "measure-length"
          ? "select: geodesic"
          : "";
      // Prompt text is only shown for tools that ask the player to select something.
      prompt.hidden = toolId !== "protractor" &&
        toolId !== "measure-length" &&
        toolId !== "geodesic-cannon-tie-detach";
      root.ariaLabel = toolId === "place-flag"
        ? "Selected tool: sign"
        : toolId === "geodesic-cannon"
          ? "Selected tool: geodesic ray"
          : toolId === "measure-length"
            ? "Selected tool: measure length, select geodesic"
          : toolId === "protractor"
            ? `Selected tool: protractor, ${prompt.textContent}`
          : toolId === "geodesic-cannon-rotate"
            ? "Selected tool: rotate geodesic ray emitter"
            : toolId === "geodesic-cannon-carry"
              ? "Selected tool: carry geodesic ray emitter"
            : toolId === "geodesic-cannon-aim"
              ? "Selected tool: aim geodesic ray emitter"
            : toolId === "geodesic-cannon-tie-detach"
              ? `Selected tool: tie and detach, ${prompt.textContent}`
              : "No selected tool";
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
