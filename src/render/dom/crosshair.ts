/**
 * Desktop crosshair (design 017 section 8.2 item 1): a 6 px white dot with a 1 px dark outline at the screen center, shown while the pointer is locked.
 * It becomes a 16 px ring when a click would do something, and a hollow, dimmed ring with a bar and a short reason beneath when something is aimed at but a click would be ignored (design 018 section 5); the ring takes the selected tool's indicator color. The aim cross on the surface is a separate overlay and is not touched.
 * Role: purely presentational; the shell calls `update` every frame and the DOM is touched only when the state changes. Lifecycle: the creator must call dispose().
 */

import type { CrosshairVisualState } from "../../ui/crosshairDefinition";

/** What the crosshair shows. */
export interface CrosshairState {
  readonly visible: boolean;
  /** "idle" the dot, "ready" the ring, "refused" a hollow ring with a bar and the reason beneath. */
  readonly state: CrosshairVisualState;
  /** Why a click would be ignored; shown under the centre while `state` is "refused". */
  readonly reason?: string;
  /** The selected tool's indicator color (a CSS color); absent shows white. */
  readonly color?: string;
}

/** Handle to the crosshair created by {@link createCrosshair}. */
export interface Crosshair {
  readonly root: HTMLDivElement;
  update(state: CrosshairState): void;
  dispose(): void;
}

/** Creates the hidden crosshair and appends it to `container`. */
export function createCrosshair(container: HTMLElement): Crosshair {
  const root = document.createElement("div");
  root.className = "crosshair";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  const reasonText = document.createElement("span");
  reasonText.className = "crosshair-reason";
  root.append(reasonText);
  container.append(root);
  let last = "";
  return {
    root,
    update(state) {
      const key = `${state.visible}|${state.state}|${state.reason ?? ""}|${state.color ?? ""}`;
      if (key === last) return;
      last = key;
      root.hidden = !state.visible;
      root.classList.toggle("crosshair-ring", state.state === "ready");
      root.classList.toggle("crosshair-refused", state.state === "refused");
      reasonText.textContent = state.state === "refused" ? state.reason ?? "" : "";
      if (state.color !== undefined) root.style.setProperty("--crosshair-color", state.color);
      else root.style.removeProperty("--crosshair-color");
    },
    dispose() {
      root.remove();
    },
  };
}
