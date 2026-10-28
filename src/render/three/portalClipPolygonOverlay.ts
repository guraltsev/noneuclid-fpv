/**
 * Debug overlay that draws each visible portal path's NDC clip polygon as a labelled SVG polygon over the canvas.
 *
 * It maps NDC (x right, y up, [-1,1]) to SVG viewport pixels (origin at top-left, y down) with
 * px = (x+1)/2 * width and py = (1-y)/2 * height, so what is drawn is exactly the region the fragment shader
 * allows for that path. The overlay is DOM-only and touched only when the debug option is on.
 */

import type { Vec2 } from "./visiblePortalPaths";

/** One polygon to draw: its label, CSS color and NDC vertices. */
export interface PortalClipPolygonOverlayEntry {
  readonly pathText: string;
  readonly color: string;
  readonly clipPolygonNdc: readonly Vec2[];
}

/** Handle for the SVG overlay element. */
export interface PortalClipPolygonOverlay {
  /** Replaces the drawn polygons (entries with fewer than 3 vertices are skipped); the SVG is hidden when nothing is drawn. */
  update(
    entries: readonly PortalClipPolygonOverlayEntry[],
    viewportPixels: { readonly width: number; readonly height: number },
  ): void;
  /** Removes all polygons and hides the SVG. */
  clear(): void;
  /** Removes the SVG element from the DOM. */
  dispose(): void;
}

const strokeWidthPixels = 3;

/** Creates a hidden full-container SVG overlay appended to `container` and returns its controller. */
export function createPortalClipPolygonOverlay(container: HTMLElement): PortalClipPolygonOverlay {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("portal-clip-polygon-overlay");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "none";
  container.append(svg);

  return {
    update(entries, viewportPixels) {
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${Math.max(1, viewportPixels.width)} ${Math.max(1, viewportPixels.height)}`);
      svg.style.display = entries.length === 0 ? "none" : "block";

      for (const entry of entries) {
        if (entry.clipPolygonNdc.length < 3) {
          continue;
        }

        const points = entry.clipPolygonNdc
          .map((point) => ndcPointToViewportPixels(point, viewportPixels))
          .map((point) => `${point.x},${point.y}`)
          .join(" ");

        const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", points);
        polygon.setAttribute("fill", entry.color);
        polygon.setAttribute("fill-opacity", "0.12");
        polygon.setAttribute("stroke", entry.color);
        polygon.setAttribute("stroke-width", String(strokeWidthPixels));
        polygon.setAttribute("stroke-linejoin", "round");
        svg.append(polygon);

        const labelPoint = polygonLabelPoint(entry.clipPolygonNdc, viewportPixels);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", String(labelPoint.x + 6));
        label.setAttribute("y", String(labelPoint.y - 6));
        label.setAttribute("fill", entry.color);
        label.setAttribute("font-size", "14");
        label.setAttribute("font-family", 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace');
        label.textContent = entry.pathText;
        svg.append(label);
      }

      svg.style.display = svg.childNodes.length === 0 ? "none" : "block";
    },
    clear() {
      svg.replaceChildren();
      svg.style.display = "none";
    },
    dispose() {
      svg.remove();
    },
  };
}

/** Maps an NDC point to viewport pixels with the origin at the top-left (y flipped). */
export function ndcPointToViewportPixels(
  point: Vec2,
  viewportPixels: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  return {
    x: ((point.x + 1) / 2) * viewportPixels.width,
    y: ((1 - point.y) / 2) * viewportPixels.height,
  };
}

function polygonLabelPoint(
  polygon: readonly Vec2[],
  viewportPixels: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  let x = 0;
  let y = 0;

  for (const point of polygon) {
    const viewportPoint = ndcPointToViewportPixels(point, viewportPixels);
    x += viewportPoint.x;
    y += viewportPoint.y;
  }

  const count = Math.max(1, polygon.length);
  return {
    x: x / count,
    y: y / count,
  };
}
