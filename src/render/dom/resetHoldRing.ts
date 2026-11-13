/**
 * Desktop ring that shows how long R has been held (design 017 section 8.8): a small SVG circle around the screen center whose stroke fills as the hold progresses.
 * Role: purely presentational. The shell calls `render(progress)` every frame with `desktopControls.resetHoldProgress` (0 to 1); the ring is hidden at 0 and the DOM is touched only when the visible state changes.
 * Lifecycle: the creator must call dispose() to remove the element.
 */

/** Handle to the ring created by {@link createResetHoldRing}. */
export interface ResetHoldRing {
  /** Root element. */
  readonly root: HTMLDivElement;
  /** Draws the ring for `progress` in 0..1; 0 hides it. Cheap to call every frame. */
  render(progress: number): void;
  /** Removes the element. */
  dispose(): void;
}

const radius = 28;
const circumference = 2 * Math.PI * radius;
const svgNamespace = "http://www.w3.org/2000/svg";

/** Creates the hidden ring and appends it to `container`. */
export function createResetHoldRing(container: HTMLElement): ResetHoldRing {
  const root = document.createElement("div");
  root.className = "reset-hold-ring";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  const track = document.createElementNS(svgNamespace, "circle");
  const arc = document.createElementNS(svgNamespace, "circle");
  for (const circle of [track, arc]) {
    circle.setAttribute("cx", "32");
    circle.setAttribute("cy", "32");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", "5");
  }
  track.setAttribute("stroke", "rgb(255 255 255 / 25%)");
  arc.setAttribute("stroke", "#ffffff");
  arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute("stroke-dasharray", String(circumference));
  arc.setAttribute("transform", "rotate(-90 32 32)");
  svg.append(track, arc);
  root.append(svg);
  container.append(root);
  let lastShown = -1;

  return {
    root,
    render(progress) {
      const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      // A hundredth of the ring is below what the eye sees; skip the DOM write.
      const step = Math.round(clamped * 100);
      if (step === lastShown) return;
      lastShown = step;
      root.hidden = step === 0;
      arc.setAttribute("stroke-dashoffset", String(circumference * (1 - clamped)));
    },
    dispose() {
      root.remove();
    },
  };
}
