/**
 * The desktop tool belt (design 017 section 7.4): a row of slots at the bottom centre of the screen, one per entry of the renderer-neutral belt definition (`src/ui/toolBeltDefinition.ts`): its key, its icon, and the name under the slot in hand.
 * Role: presentational. The shell calls `update` with the definition each frame; the module rebuilds the slots only when the definition (or the sign style or the tool's prompt) changed. A disabled slot is greyed. Hovering a slot, possible only while the pointer is unlocked, shows its subtitle (or its disabled reason) above the belt; clicking one selects it.
 * Lifecycle: the creator calls dispose() to remove the element.
 */
import type { ToolBeltDefinition, ToolBeltIconId, ToolBeltSlot } from "../../ui/toolBeltDefinition";

/** What the belt tells the shell. */
export interface ToolBeltHandlers {
  /** A slot was clicked (only possible with the pointer unlocked). */
  onSelect(slot: ToolBeltSlot): void;
}

/** Handle to the belt created by {@link createToolBelt}. */
export interface ToolBelt {
  readonly root: HTMLDivElement;
  /** Shows `definition`; `promptText` is the tool's prompt while it asks the player to select something. */
  update(definition: ToolBeltDefinition, promptText: string | undefined): void;
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

  function createIcon(slot: ToolBeltSlot): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "tool-belt-icon";
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.append(createIconSvg(slot.icon));
    return wrapper;
  }

  function rebuild(definition: ToolBeltDefinition, promptText: string | undefined): void {
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
      button.append(key, createIcon(slot), name);
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
    update(definition, promptText) {
      const signature = JSON.stringify([definition.slots.map((slot) => [slot.toolId, slot.enabled, slot.active]), promptText ?? ""]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      rebuild(definition, promptText);
    },
    dispose() {
      root.remove();
    },
  };
}

// One style for every icon: 24 x 24 outline strokes in the current colour, so the belt reads as one family.
const iconPaths: Record<ToolBeltIconId, readonly string[]> = {
  // An open hand.
  hand: ["M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V3.5a1.5 1.5 0 0 1 3 0V11M14 11V5a1.5 1.5 0 0 1 3 0v8M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 14.5a1.6 1.6 0 0 1 2.5-2L8 15"],
  // A source with a ray leaving it.
  laser: ["M3 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M6.5 15.5 21 5", "M16 4.5 21 5 20 10"],
  // A ruler with ticks.
  ruler: ["M3 15.5 15.5 3 21 8.5 8.5 21z", "M7 11.5l2.5 2.5M10 8.5l1.5 1.5M13 5.5l2.5 2.5M4.5 15l1.5 1.5"],
  // A protractor: half disc with ticks and a centre mark.
  protractor: ["M3 19a9 9 0 0 1 18 0z", "M12 19v-2.5M6.4 14.4l1.8 1.1M17.6 14.4l-1.8 1.1M8.2 10.3l1.4 1.5M15.8 10.3l-1.4 1.5"],
  // A signpost: a board on a post.
  sign: ["M4 4h16v9H4z", "M12 13v8M8 21h8", "M7.5 8h9"],
  // A folded map with a pin.
  map: ["M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z", "M9 4v13.5M15 6.5V20"],
  // Three bars.
  menu: ["M4 7h16M4 12h16M4 17h16"],
};

function createIconSvg(icon: ToolBeltIconId): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of iconPaths[icon]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
