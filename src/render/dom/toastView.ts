/**
 * Desktop view of the toast queue (design 017 section 8.3): white text on dark translucent pills, bottom center, above where the tool belt will be.
 * Role: purely presentational. The shell calls `render(toasts)` every frame with `queue.visible()`; the DOM is rebuilt only when the set of toasts (or the pointer-lock state) changed. The container is an `aria-live="polite"` region, so a screen reader announces each new toast.
 * An action shows as a small button, clickable only while the pointer is unlocked; for "undo" the key hint "(U)" follows the label. `onAction` receives the action id.
 * Lifecycle: the creator must call dispose() to remove the element.
 */
import type { Toast } from "../../ui/toastQueue";

/** Handle to the view created by {@link createToastView}. */
export interface ToastView {
  /** Root element (the live region). */
  readonly root: HTMLDivElement;
  /** Draws `toasts`; cheap to call every frame. */
  render(toasts: readonly Toast[]): void;
  /** Removes the element. */
  dispose(): void;
}

/** Creates the empty view and appends it to `container`. */
export function createToastView(container: HTMLElement, onAction: (actionId: string, toast: Toast) => void): ToastView {
  const root = document.createElement("div");
  root.className = "toast-view";
  root.setAttribute("aria-live", "polite");
  root.setAttribute("role", "status");
  container.append(root);
  let lastKey = "";

  return {
    root,
    render(toasts) {
      const locked = document.pointerLockElement != null;
      const key = `${locked ? "L" : "U"}|${toasts.map((toast) => `${toast.id}:${toast.text}:${toast.action?.id ?? ""}`).join("|")}`;
      if (key === lastKey) return;
      lastKey = key;
      root.replaceChildren();
      for (const toast of toasts) {
        const pill = document.createElement("div");
        pill.className = "toast-view-toast";
        const text = document.createElement("span");
        text.className = "toast-view-text";
        text.textContent = toast.text;
        pill.append(text);
        if (toast.action) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "toast-view-action";
          button.textContent = toast.action.id === "undo" ? `${toast.action.label} (U)` : toast.action.label;
          button.disabled = locked;
          const actionId = toast.action.id;
          button.addEventListener("click", () => onAction(actionId, toast));
          pill.append(button);
        }
        root.append(pill);
      }
    },
    dispose() {
      root.remove();
    },
  };
}
