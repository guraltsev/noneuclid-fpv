/**
 * Desktop crosshair (design 017 section 8.2 item 1): a 6 px white dot with a 1 px dark outline at the screen center, shown while the pointer is locked.
 * It becomes a 16 px ring when the aim has a usable target (the shell's focus state) and takes the selected tool's indicator color. The red aim cross is a separate overlay and is not touched.
 * Role: purely presentational; the shell calls `update` every frame and the DOM is touched only when the state changes. Lifecycle: the creator must call dispose().
 */

/** What the crosshair shows. */
export interface CrosshairState {
  readonly visible: boolean;
  /** The aim rests on something that can be used: show the ring. */
  readonly usable: boolean;
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
  container.append(root);
  let last = "";
  return {
    root,
    update(state) {
      const key = `${state.visible}|${state.usable}|${state.color ?? ""}`;
      if (key === last) return;
      last = key;
      root.hidden = !state.visible;
      root.classList.toggle("crosshair-ring", state.usable);
      if (state.color !== undefined) root.style.setProperty("--crosshair-color", state.color);
      else root.style.removeProperty("--crosshair-color");
    },
    dispose() {
      root.remove();
    },
  };
}
