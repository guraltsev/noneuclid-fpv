/**
 * The first-use tip of the tool in hand (design 017 section 8.6), driven by the shell.
 * Role: owns the tip's state (`src/ui/firstUseTips.ts`), the remembered "already seen" set, the desktop card and, in VR, the toast that stands in for the card. The shell tells it when a tool is taken or put away, and once per frame hands it the world's changes; it moves the tip on when the student does what the current step describes (a laser placed, a beam made longer, a measurement or a sign put up).
 * The first time a tool is taken in a session its tip shows; "Try it" on a How to card shows it again. At most one step advances per frame, so one action cannot skip two steps.
 */
import { ChangeOp } from "../../world-objects/runtimeObjectChangeJournal";
import type { RuntimeObjectChangeReader } from "../../world-objects/runtimeObjectChangeJournal";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import {
  advanceTipOnEvent,
  currentTipStep,
  isLastTipStep,
  markTipSeen,
  nextTipStep,
  parseSeenTips,
  renderTipText,
  serializeSeenTips,
  shouldShowFirstUseTip,
  startTip,
  type SeenTips,
  type TipControlNames,
  type TipEvent,
  type TipState,
} from "../../ui/firstUseTips";
import { createTipCard, type TipCard, type TipCardHandlers } from "../dom/tipCard";
import type { SettingsStorage } from "./settingsStorage";

const seenTipsStorageKey = "noneuclid.seenTips";

/**
 * The tip events in the writes of one frame, in order: a laser or a sign added, a measurement added, a beam whose intended length grew. Anything else is no event.
 */
export function tipEventsInChanges(changes: Pick<RuntimeObjectChangeReader<RuntimeWorldObject>, "length" | "opAt" | "kindAt" | "objectAt" | "ring" | "frameStartSeq">): readonly TipEvent[] {
  const events: TipEvent[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const op = changes.opAt(index);
    const kind = changes.kindAt(index);
    if (op === ChangeOp.Added) {
      if (kind === "geodesicEmitters/emitter") events.push("laser-placed");
      else if (kind === "placedFlags/flag") events.push("sign-placed");
      else if (kind === "geodesicMeasurements/length" || kind === "geodesicMeasurements/angle") events.push("measurement-placed");
    } else if (op === ChangeOp.Updated && kind === "geodesicModel/arc") {
      const after = changes.objectAt(index);
      const before = changes.ring.beforeAt(changes.frameStartSeq + index);
      if (
        after.kind === "geodesicModel/arc" &&
        before?.kind === "geodesicModel/arc" &&
        after.intendedLengthMeters > before.intendedLengthMeters
      ) {
        events.push("beam-extended");
      }
    }
  }
  return events;
}

/** What the controller needs from the shell. */
export interface FirstUseTipControllerDeps {
  readonly container: HTMLElement;
  readonly storage: SettingsStorage | undefined;
  /** The names of the controls of the device in use, read each time a step is shown. */
  controlNames(): TipControlNames;
  /** True while a VR session is presenting: the step shows as a toast instead of the card. */
  isXr(): boolean;
  /** Shows a toast. */
  pushToast(text: string): void;
  /** Makes the card; the shell leaves it out, tests give a fake. */
  createCard?(container: HTMLElement, handlers: TipCardHandlers): TipCard;
}

/** Handle to the controller. */
export interface FirstUseTipController {
  /** A tool was taken from the belt; its tip starts when it has not been seen (or when `force`, from a "Try it"). */
  toolTaken(toolId: string, force?: boolean): void;
  /** The tool was put away: the tip ends. */
  toolPutAway(): void;
  /** Hands over the writes of this frame; the tip moves on when one is the event its step waits for. */
  observe(changes: Parameters<typeof tipEventsInChanges>[0]): void;
  /** Forgets which tips were seen, so each shows again. */
  resetSeen(): void;
  /** The tip on show, if any. */
  current(): TipState | undefined;
  /** Hides the card while a VR session presents, shows it again afterwards. */
  setCardAllowed(allowed: boolean): void;
  dispose(): void;
}

/** Creates the controller and its (hidden) card. */
export function createFirstUseTipController(deps: FirstUseTipControllerDeps): FirstUseTipController {
  let seen: SeenTips = new Set();
  try {
    seen = parseSeenTips(deps.storage?.getItem(seenTipsStorageKey));
  } catch {
    seen = new Set();
  }
  let tip: TipState | undefined;
  let cardAllowed = true;

  const card = (deps.createCard ?? createTipCard)(deps.container, {
    onNext() {
      if (tip === undefined) return;
      tip = nextTipStep(tip);
      render(false);
    },
    onGotIt() {
      tip = undefined;
      render(false);
    },
  });

  function persistSeen(): void {
    try {
      deps.storage?.setItem(seenTipsStorageKey, serializeSeenTips(seen));
    } catch {
      // Storage is only a convenience.
    }
  }

  // Shows the tip's current step, or hides the card; `announce` also sends it to VR as a toast.
  function render(announce: boolean): void {
    const step = tip === undefined ? undefined : currentTipStep(tip);
    if (tip === undefined || step === undefined) {
      card.hide();
      return;
    }
    const text = renderTipText(step, deps.controlNames());
    if (deps.isXr()) {
      card.hide();
      if (announce) deps.pushToast(text);
      return;
    }
    if (cardAllowed) card.show(text, !isLastTipStep(tip));
    else card.hide();
  }

  return {
    toolTaken(toolId, force = false) {
      if (!force && !shouldShowFirstUseTip(seen, toolId)) {
        if (tip !== undefined && tip.toolId !== toolId) {
          tip = undefined;
          render(false);
        }
        return;
      }
      tip = startTip(toolId);
      if (tip === undefined) {
        render(false);
        return;
      }
      seen = markTipSeen(seen, toolId);
      persistSeen();
      render(true);
    },
    toolPutAway() {
      tip = undefined;
      render(false);
    },
    observe(changes) {
      if (tip === undefined || changes.length === 0) return;
      for (const event of tipEventsInChanges(changes)) {
        const advanced = advanceTipOnEvent(tip, event);
        if (advanced !== tip) {
          tip = advanced;
          render(true);
          return;
        }
      }
    },
    resetSeen() {
      seen = new Set();
      persistSeen();
    },
    current() {
      return tip;
    },
    setCardAllowed(allowed) {
      if (allowed === cardAllowed) return;
      cardAllowed = allowed;
      render(false);
    },
    dispose() {
      card.dispose();
    },
  };
}
