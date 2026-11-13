/**
 * The desktop hint strip (design 017 section 8.2 item 3): one line just above the tool belt that names up to three inputs that do something right now, each as a key cap and a short text.
 * Role: presentational. The shell calls `update` every frame with the renderer-neutral entries of `src/ui/hintStripDefinition.ts`, or `undefined` to hide the line (hints switched off, VR, pointer unlocked); the DOM is rebuilt only when the entries change.
 * Lifecycle: the creator calls dispose() to remove the element.
 */
import type { HintStripEntry } from "../../ui/hintStripDefinition";

/** Handle to the strip created by {@link createHintStrip}. */
export interface HintStrip {
  readonly root: HTMLDivElement;
  /** Shows the entries, or hides the strip when `entries` is undefined or empty. */
  update(entries: readonly HintStripEntry[] | undefined): void;
  /** Removes the strip from the DOM. */
  dispose(): void;
}

/** Creates a hidden strip with class hint-strip and appends it to `container`. */
export function createHintStrip(container: HTMLElement): HintStrip {
  const root = document.createElement("div");
  root.className = "hint-strip";
  root.hidden = true;
  root.setAttribute("aria-live", "off");
  container.append(root);

  let lastSignature = "";

  return {
    root,
    update(entries) {
      const shown = entries !== undefined && entries.length > 0;
      root.hidden = !shown;
      const signature = shown ? entries.map((entry) => `${entry.glyphLabel}\u0000${entry.text}`).join("\u0001") : "";
      if (!shown || signature === lastSignature) return;
      lastSignature = signature;
      root.replaceChildren();
      entries.forEach((entry, index) => {
        const item = document.createElement("span");
        item.className = "hint-strip-entry";
        const key = document.createElement("kbd");
        key.className = "hint-strip-key";
        key.textContent = entry.glyphLabel;
        const text = document.createElement("span");
        text.textContent = entry.text;
        item.append(key, text);
        if (index > 0) item.classList.add("hint-strip-entry-separated");
        root.append(item);
      });
    },
    dispose() {
      root.remove();
    },
  };
}
