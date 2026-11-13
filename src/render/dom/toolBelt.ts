/**
 * The desktop tool belt (design 017 section 7.4): a row of slots at the bottom centre of the screen, one per entry of the renderer-neutral belt definition (`src/ui/toolBeltDefinition.ts`): its key, its icon, and the name under the slot in hand.
 * Role: presentational. The shell calls `update` with the definition each frame; the module rebuilds the slots only when the definition (or the sign style or the tool's prompt) changed. A disabled slot is greyed. Hovering a slot, possible only while the pointer is unlocked, shows its subtitle (or its disabled reason) above the belt; clicking one selects it.
 * Lifecycle: the creator calls dispose() to remove the element.
 */
import { publicAssetUrl } from "../../glue/assetUrls";
import type { ToolBeltDefinition, ToolBeltIconId, ToolBeltSlot } from "../../ui/toolBeltDefinition";
import type { PlacedFlagType } from "../../world-objects/toolObjects";

const signIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};

// Image per icon id; "invert" icons are dark line art that is drawn light on the dark belt.
const iconImages: Partial<Record<ToolBeltIconId, { readonly src: string; readonly invert: boolean }>> = {
  laser: { src: publicAssetUrl("flashlight/Lightsaber.png"), invert: false },
  ruler: { src: publicAssetUrl("icons/ruler.svg"), invert: true },
  protractor: { src: publicAssetUrl("icons/protractor.png"), invert: false },
  map: { src: publicAssetUrl("icons/world-map.svg"), invert: true },
};

/** What the belt tells the shell. */
export interface ToolBeltHandlers {
  /** A slot was clicked (only possible with the pointer unlocked). */
  onSelect(slot: ToolBeltSlot): void;
}

/** Handle to the belt created by {@link createToolBelt}. */
export interface ToolBelt {
  readonly root: HTMLDivElement;
  /** Shows `definition`; `flagType` picks the sign's picture, `promptText` is the tool's prompt while it asks the player to select something. */
  update(definition: ToolBeltDefinition, flagType: PlacedFlagType, promptText: string | undefined): void;
  /** Removes the belt from the DOM. */
  dispose(): void;
}

/** Creates the belt and appends it to `container`. */
export function createToolBelt(container: HTMLElement, handlers: ToolBeltHandlers, ariaLabel: string): ToolBelt {
  const root = document.createElement("div");
  root.className = "tool-belt";
  root.setAttribute("role", "toolbar");
  root.ariaLabel = ariaLabel;
  const hint = document.createElement("div");
  hint.className = "tool-belt-hint";
  hint.hidden = true;
  const row = document.createElement("div");
  row.className = "tool-belt-row";
  root.append(hint, row);
  container.append(root);

  let lastSignature = "";

  function createIcon(slot: ToolBeltSlot, flagType: PlacedFlagType): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "tool-belt-icon";
    wrapper.setAttribute("aria-hidden", "true");
    if (slot.icon === "hand") {
      wrapper.append(createHandSvg());
    } else if (slot.icon === "menu") {
      wrapper.textContent = "☰";
      wrapper.classList.add("tool-belt-icon-text");
    } else {
      const image = document.createElement("img");
      const source = slot.icon === "sign" ? { src: signIconSources[flagType], invert: false } : iconImages[slot.icon];
      image.alt = "";
      image.decoding = "async";
      if (source !== undefined) {
        image.src = source.src;
        if (source.invert) image.classList.add("tool-belt-icon-invert");
      }
      wrapper.append(image);
    }
    return wrapper;
  }

  function rebuild(definition: ToolBeltDefinition, flagType: PlacedFlagType, promptText: string | undefined): void {
    row.replaceChildren();
    for (const slot of definition.slots) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-belt-slot";
      button.classList.toggle("tool-belt-slot-active", slot.active);
      button.classList.toggle("tool-belt-slot-disabled", !slot.enabled);
      button.dataset.toolId = slot.toolId;
      button.setAttribute("aria-disabled", String(!slot.enabled));
      button.setAttribute("aria-pressed", String(slot.active));
      button.ariaLabel = `${slot.name} (${slot.key})${slot.enabled ? "" : `: ${slot.disabledReason ?? ""}`}`;
      // Focus would make Space and Enter press a slot while walking; the belt is mouse and key shortcuts only.
      button.tabIndex = -1;
      const key = document.createElement("span");
      key.className = "tool-belt-key";
      key.textContent = slot.key;
      const name = document.createElement("span");
      name.className = "tool-belt-name";
      name.textContent = slot.name;
      button.append(key, createIcon(slot, flagType), name);
      if (slot.active && promptText !== undefined) {
        const prompt = document.createElement("span");
        prompt.className = "tool-belt-prompt";
        prompt.textContent = promptText;
        button.append(prompt);
      }
      button.addEventListener("mouseenter", () => {
        hint.textContent = slot.enabled ? slot.subtitle : slot.disabledReason ?? slot.subtitle;
        hint.hidden = false;
      });
      button.addEventListener("mouseleave", () => {
        hint.hidden = true;
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        handlers.onSelect(slot);
      });
      row.append(button);
    }
  }

  return {
    root,
    update(definition, flagType, promptText) {
      const signature = JSON.stringify([definition.slots.map((slot) => [slot.toolId, slot.enabled, slot.active]), flagType, promptText ?? ""]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      rebuild(definition, flagType, promptText);
    },
    dispose() {
      root.remove();
    },
  };
}

// A simple open hand: a palm and four fingers and a thumb as strokes.
function createHandSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v8M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 14.5a1.6 1.6 0 0 1 2.5-2L8 15");
  svg.append(path);
  return svg;
}
