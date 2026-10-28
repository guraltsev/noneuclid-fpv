/**
 * Floating tooltip DOM element that follows a screen position, used for object focus hints on desktop.
 * Role: the caller supplies already-formatted plain text and a client-pixel anchor each frame; the module renders it (replacing key names such as F, H, Left click with inline icons), keeps it inside the viewport with a margin, and positions it above the anchor.
 * Positions are CSS pixels relative to the viewport. Lifecycle: the creator must call dispose().
 */
import { publicAssetUrl } from "../../glue/assetUrls";

/** Handle to the tooltip created by {@link createFloatingObjectTooltip}. */
export interface FloatingObjectTooltip {
  /** Root element of the tooltip; hidden unless visible with non-empty text. */
  readonly root: HTMLDivElement;
  /**
   * Shows the tooltip with the given text at the given pixel anchor, or hides it.
   * The tooltip is hidden when visible is false or text is empty. xPixels and yPixels are the anchor in viewport CSS pixels (default viewport center); the box is centered horizontally on x and placed above y, clamped to stay 12 px inside the viewport. Lines are separated by newline characters.
   */
  update(options: {
    readonly visible: boolean;
    /** Plain text; newlines become line breaks and key names become icons. */
    readonly text?: string;
    /** Horizontal anchor, viewport CSS pixels. */
    readonly xPixels?: number;
    /** Vertical anchor (bottom edge of the tooltip), viewport CSS pixels. */
    readonly yPixels?: number;
  }): void;
  /** Removes the tooltip element from the DOM. */
  dispose(): void;
}

/** Creates a hidden tooltip element with class floating-object-tooltip and appends it to container. */
export function createFloatingObjectTooltip(container: HTMLElement): FloatingObjectTooltip {
  const root = document.createElement("div");
  root.className = "floating-object-tooltip";
  root.hidden = true;
  container.append(root);

  return {
    root,
    update(options) {
      root.hidden = !options.visible || !options.text;
      if (root.hidden) {
        return;
      }

      renderTooltipText(root, options.text ?? "");
      // Measure after rendering the text so clamping uses the real size.
      const width = root.offsetWidth;
      const height = root.offsetHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const marginPixels = 12;
      const xPixels = clamp(
        options.xPixels ?? viewportWidth / 2,
        marginPixels + width / 2,
        Math.max(marginPixels + width / 2, viewportWidth - marginPixels - width / 2),
      );
      const yPixels = clamp(
        options.yPixels ?? viewportHeight / 2,
        marginPixels + height,
        Math.max(marginPixels + height, viewportHeight - marginPixels),
      );

      // Anchor the bottom-center of the box at the (clamped) point.
      root.style.transform = `translate(-50%, -100%) translate(${Math.round(xPixels)}px, ${Math.round(yPixels)}px)`;
    },
    dispose() {
      root.remove();
    },
  };
}

// Rebuilds the content: one text/icon run per line, joined by <br>.
function renderTooltipText(root: HTMLDivElement, text: string): void {
  root.replaceChildren();
  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      root.append(document.createElement("br"));
    }
    appendLineWithMouseIcons(root, line);
  });
}

// Replaces the tokens 'Left click', 'Right click' and standalone F, B, H or Y with inline icons.
function appendLineWithMouseIcons(root: HTMLDivElement, line: string): void {
  const pattern = /(Left click|Right click|\b[FBHY]\b)/g;
  let index = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (match.index > index) {
      root.append(document.createTextNode(line.slice(index, match.index)));
    }
    root.append(createHintIcon(match[0]));
    index = match.index + match[0].length;
  }
  if (index < line.length) {
    root.append(document.createTextNode(line.slice(index)));
  }
}

function createHintIcon(label: string): HTMLImageElement {
  const icon = document.createElement("img");
  icon.className = "input-hint-icon input-hint-icon-inline input-hint-icon-inverted";
  icon.src = inlineIconSrcByLabel(label);
  icon.alt = label;
  return icon;
}

// Icon URL for a matched token (empty string if unknown, which cannot happen for matches of the pattern).
function inlineIconSrcByLabel(label: string): string {
  switch (label) {
    case "Left click":
      return publicAssetUrl("icons/mouse-button-left.svg");
    case "Right click":
      return publicAssetUrl("icons/mouse-button-right.svg");
    case "F":
      return publicAssetUrl("icons/f-alphabet.svg");
    case "B":
      return publicAssetUrl("icons/b-alphabet.svg");
    case "H":
      return publicAssetUrl("icons/h-alphabet.svg");
    case "Y":
      return publicAssetUrl("icons/y-alphabet.svg");
  }

  return "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
