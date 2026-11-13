/**
 * The pause card, the desktop main menu (design 017 sections 7.5 and 8.1): a DOM overlay that dims the scene by 35 percent and shows the activity title, a one-line description, "Click to play", the controls table and the main-menu actions.
 * Role: purely presentational. The shell builds the content with `createPauseCardDefinition`, calls `setVisible` each frame from `document.pointerLockElement` (read every time, never cached, so a headless stub works), and handles the callbacks. A click on "Click to play" or anywhere on the card outside the actions calls `onPlay`; the actions call `onAction`, and "Start over" first asks "Remove everything you placed?" with Yes and No and calls `onStartOver` only on Yes.
 * Lifecycle: the creator must call dispose() to remove the element.
 */
import type { PauseCardActionId, PauseCardDefinition } from "../../ui/pauseCardDefinition";
import { pauseCardText } from "../../ui/vocabulary";

/** Callbacks of the card. */
export interface PauseCardHandlers {
  /** The player wants to play: request pointer lock. */
  onPlay(): void;
  /** Help, Settings or Go home was chosen. */
  onAction(action: Exclude<PauseCardActionId, "start-over">): void;
  /** Start over was confirmed. */
  onStartOver(): void;
}

/** Handle to the card created by {@link createPauseCard}. */
export interface PauseCard {
  /** Root element: the dimming overlay. */
  readonly root: HTMLDivElement;
  /** Shows or hides the card; hiding also cancels a pending start-over question. Cheap to call every frame. */
  setVisible(visible: boolean): void;
  /** Whether the card is showing. */
  isVisible(): boolean;
  /** Removes the element. */
  dispose(): void;
}

const actionLabels: Readonly<Record<PauseCardActionId, string>> = {
  help: pauseCardText.help,
  settings: pauseCardText.settings,
  "go-home": pauseCardText.goHome,
  "start-over": pauseCardText.startOver,
};

/** Creates the hidden card and appends it to `container`. */
export function createPauseCard(container: HTMLElement, definition: PauseCardDefinition, handlers: PauseCardHandlers): PauseCard {
  const root = document.createElement("div");
  root.className = "pause-card-overlay";
  root.hidden = true;
  const card = document.createElement("div");
  card.className = "pause-card";
  card.setAttribute("role", "dialog");

  const title = document.createElement("h2");
  title.className = "pause-card-title";
  title.textContent = definition.title;
  card.append(title);
  if (definition.description !== undefined) {
    const description = document.createElement("p");
    description.className = "pause-card-description";
    description.textContent = definition.description;
    card.append(description);
  }

  const play = document.createElement("button");
  play.type = "button";
  play.className = "pause-card-play";
  play.textContent = pauseCardText.clickToPlay;
  card.append(play);

  const table = document.createElement("table");
  table.className = "pause-card-controls";
  for (const row of definition.controls) {
    const tr = document.createElement("tr");
    const verb = document.createElement("th");
    verb.scope = "row";
    verb.textContent = row.verb;
    const control = document.createElement("td");
    control.textContent = row.glyphLabel;
    tr.append(verb, control);
    table.append(tr);
  }
  card.append(table);

  const actions = document.createElement("div");
  actions.className = "pause-card-actions";
  const question = document.createElement("div");
  question.className = "pause-card-question";
  question.hidden = true;
  const questionText = document.createElement("span");
  questionText.textContent = pauseCardText.startOverQuestion;
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = pauseCardText.yes;
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = pauseCardText.no;
  question.append(questionText, yes, no);
  const actionButtons = document.createElement("div");
  actionButtons.className = "pause-card-action-buttons";
  const setAsking = (asking: boolean): void => {
    question.hidden = !asking;
    actionButtons.hidden = asking;
  };
  for (const action of definition.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = actionLabels[action];
    button.addEventListener("click", () => {
      if (action === "start-over") setAsking(true);
      else handlers.onAction(action);
    });
    actionButtons.append(button);
  }
  yes.addEventListener("click", () => {
    setAsking(false);
    handlers.onStartOver();
  });
  no.addEventListener("click", () => setAsking(false));
  actions.append(actionButtons, question);
  card.append(actions);

  root.append(card);
  container.append(root);

  // A click on the card outside the actions, and on the dimmed scene around it, starts play.
  root.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (actions.contains(target) && target !== actions) return;
    handlers.onPlay();
  });

  return {
    root,
    setVisible(visible) {
      if (root.hidden === !visible) return;
      root.hidden = !visible;
      if (!visible) setAsking(false);
    },
    isVisible: () => !root.hidden,
    dispose() {
      root.remove();
    },
  };
}
