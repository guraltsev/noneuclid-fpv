/**
 * First-use tips (design 017 section 8.6): the first time a tool is taken in a session, a small tip shows the first step of how to use it, and moves on to the next step when the student does what the step describes.
 * Role: pure and renderer-neutral. This module holds the steps of every tool, the tip's state transitions and the remembered "already seen" set; the shell supplies the events (it watches the world's changes), the clock-free state and the storage, and a DOM card (desktop) or a toast (VR) draws the current step.
 * A step's text names the controls with placeholders (`{use}`, `{menu}`, `{hand}`) that `renderTipText` fills with the names of the controls of the current device, so the tip is right on desktop and in every VR layout.
 */
import { firstUseTipText } from "./vocabulary";

/** What the student did that finishes a step. */
export type TipEvent = "laser-placed" | "beam-extended" | "measurement-placed" | "sign-placed";

/** One step of a tip: its text with placeholders, and the event that moves on to the next step (none: the student moves on with "Next"). */
export interface TipStep {
  readonly text: string;
  readonly advanceOn?: TipEvent;
}

/** The belt tools that have a tip. */
export type TipToolId =
  | "geodesicEmitters/emitter"
  | "geodesicMeasurements/length"
  | "geodesicMeasurements/protractor"
  | "placedFlags/flag"
  | "worldMap/map";

/** The steps of each tool's tip, in order. */
export const firstUseTips: Readonly<Record<TipToolId, readonly TipStep[]>> = {
  "geodesicEmitters/emitter": [
    { text: firstUseTipText.laserPlace, advanceOn: "laser-placed" },
    { text: firstUseTipText.laserExtend, advanceOn: "beam-extended" },
    { text: firstUseTipText.laserMenu },
  ],
  "geodesicMeasurements/length": [
    { text: firstUseTipText.rulerMeasure, advanceOn: "measurement-placed" },
    { text: firstUseTipText.rulerDone },
  ],
  "geodesicMeasurements/protractor": [
    { text: firstUseTipText.protractorMeasure, advanceOn: "measurement-placed" },
    { text: firstUseTipText.rulerDone },
  ],
  "placedFlags/flag": [
    { text: firstUseTipText.signPlace, advanceOn: "sign-placed" },
    { text: firstUseTipText.signMenu },
  ],
  "worldMap/map": [
    { text: firstUseTipText.mapShown },
  ],
};

/** The steps of a tool's tip; empty for the Hand and for any tool without one. */
export function tipStepsFor(toolId: string): readonly TipStep[] {
  return (firstUseTips as Readonly<Record<string, readonly TipStep[] | undefined>>)[toolId] ?? [];
}

/** The tip on show: whose it is and which step. */
export interface TipState {
  readonly toolId: string;
  readonly stepIndex: number;
}

/** Starts the tip of a tool at its first step; undefined for a tool without a tip. */
export function startTip(toolId: string): TipState | undefined {
  return tipStepsFor(toolId).length === 0 ? undefined : { toolId, stepIndex: 0 };
}

/** The step the tip is on; undefined when the state does not name a step. */
export function currentTipStep(tip: TipState): TipStep | undefined {
  return tipStepsFor(tip.toolId)[tip.stepIndex];
}

/** True when the tip is on its last step. */
export function isLastTipStep(tip: TipState): boolean {
  return tip.stepIndex >= tipStepsFor(tip.toolId).length - 1;
}

/** The tip after "Next": the next step, or undefined (the tip ends) after the last. */
export function nextTipStep(tip: TipState): TipState | undefined {
  return isLastTipStep(tip) ? undefined : { toolId: tip.toolId, stepIndex: tip.stepIndex + 1 };
}

/** The tip after an event: it moves on when the event is the one the current step waits for; otherwise it is unchanged. Returns undefined when the last step's event ended it. */
export function advanceTipOnEvent(tip: TipState, event: TipEvent): TipState | undefined {
  const step = currentTipStep(tip);
  if (step === undefined || step.advanceOn !== event) return tip;
  return nextTipStep(tip);
}

/** The names of the controls of the current device that a step's placeholders stand for. */
export interface TipControlNames {
  readonly use: string;
  readonly menu: string;
  readonly hand: string;
}

/** Fills the placeholders of a step's text with the control names. */
export function renderTipText(step: TipStep, names: TipControlNames): string {
  return step.text.replace("{use}", names.use).replace("{menu}", names.menu).replace("{hand}", names.hand);
}

/** The tools whose tip has been seen this session or before, as the set a store remembers. */
export type SeenTips = ReadonlySet<string>;

/** True when the tool's tip has not been seen yet and the tool has a tip. */
export function shouldShowFirstUseTip(seen: SeenTips, toolId: string): boolean {
  return tipStepsFor(toolId).length > 0 && !seen.has(toolId);
}

/** The set with `toolId` added. */
export function markTipSeen(seen: SeenTips, toolId: string): SeenTips {
  return seen.has(toolId) ? seen : new Set([...seen, toolId]);
}

/** The stored form of a seen set: a JSON array of tool ids. */
export function serializeSeenTips(seen: SeenTips): string {
  return JSON.stringify([...seen].sort());
}

/** The seen set from its stored form; anything unreadable gives the empty set. */
export function parseSeenTips(raw: string | null | undefined): SeenTips {
  if (raw === null || raw === undefined) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((entry): entry is string => typeof entry === "string")) : new Set();
  } catch {
    return new Set();
  }
}
