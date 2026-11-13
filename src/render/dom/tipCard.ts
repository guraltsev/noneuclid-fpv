/**
 * The desktop first-use tip (design 017 section 8.6): a small card pinned beside the tool belt that shows one step of how to use the tool in hand, with "Next" (when there is a later step) and "Got it".
 * Role: presentational. The shell calls `show` with the step's text, or `hide`; the buttons call the handlers, and can be clicked only while the pointer is unlocked (as the belt's slots can). The card is a polite live region, so a screen reader announces each step.
 * Lifecycle: the creator calls dispose() to remove the element.
 */
import { helpText } from "../../ui/vocabulary";

/** What the card tells the shell. */
export interface TipCardHandlers {
  /** "Next" was pressed. */
  onNext(): void;
  /** "Got it" was pressed. */
  onGotIt(): void;
}

/** Handle to the card created by {@link createTipCard}. */
export interface TipCard {
  readonly root: HTMLDivElement;
  /** Shows a step; `hasNext` decides whether the "Next" button shows. */
  show(text: string, hasNext: boolean): void;
  /** Hides the card. */
  hide(): void;
  /** Removes the card from the DOM. */
  dispose(): void;
}

/** Creates a hidden card with class tip-card and appends it to `container`. */
export function createTipCard(container: HTMLElement, handlers: TipCardHandlers): TipCard {
  const root = document.createElement("div");
  root.className = "tip-card";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  const text = document.createElement("p");
  text.className = "tip-card-text";
  const buttons = document.createElement("div");
  buttons.className = "tip-card-buttons";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "tip-card-button";
  next.textContent = helpText.tipNext;
  next.tabIndex = -1;
  next.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onNext();
  });
  const gotIt = document.createElement("button");
  gotIt.type = "button";
  gotIt.className = "tip-card-button tip-card-button-primary";
  gotIt.textContent = helpText.tipGotIt;
  gotIt.tabIndex = -1;
  gotIt.addEventListener("click", (event) => {
    event.preventDefault();
    handlers.onGotIt();
  });
  buttons.append(next, gotIt);
  root.append(text, buttons);
  container.append(root);

  return {
    root,
    show(message, hasNext) {
      text.textContent = message;
      next.hidden = !hasNext;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    dispose() {
      root.remove();
    },
  };
}
