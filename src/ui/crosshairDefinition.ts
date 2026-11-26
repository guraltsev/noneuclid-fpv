/**
 * The crosshair's state (design 018 section 5 item 1) as renderer-neutral data: "idle" (nothing to do here), "ready" (a left click does something now) or "refused" (something relevant is under the aim but the click would be ignored, with the reason in a few words).
 * Role: pure. The desktop DOM crosshair (`src/render/dom/crosshair.ts`) draws it; the shell builds its input from the aim pick each frame and shows the reason as a toast when the player clicks while it is "refused".
 * Whether a click acts comes from the same predicates the tool clients use (`src/world-objects/toolClickRules.ts`). Aiming at empty floor or sky with a tool that needs an object is "idle", never "refused", so walking is not nagged; decor (an asset with no use) is idle too.
 */
import type { RuntimeToolId } from "../glue/toolIds";
import {
  crossingPickKind,
  floorPickKind,
  laserPickKind,
  laserToolAcceptsClick,
  protractorAcceptsCenterClick,
  rulerAcceptsClick,
  segmentPickKind,
  signToolAcceptsClick,
} from "../world-objects/toolClickRules";
import { crosshairReasons } from "../world-objects/vocabulary";

/** How the crosshair looks. */
export type CrosshairVisualState = "idle" | "ready" | "refused";

/** The crosshair's state and, when refused, why. */
export interface CrosshairDefinition {
  readonly state: CrosshairVisualState;
  /** Two to four words; present exactly when `state` is "refused". */
  readonly reason?: string;
}

/** What the aim rests on, as the tools see it (the current aim pick). */
export interface CrosshairAim {
  /** "floor", or the kind of the object hit. */
  readonly objectKind: string;
  /** The hit is within the interaction range. The floor is never "within range"; the rules for it do not ask. */
  readonly withinRange: boolean;
  /** The object has an action under the Hand (a menu, Help, a tool to take), in range or not. */
  readonly usableByHand?: boolean;
  /** The Protractor's step: picking the centre (a laser or meeting point), or a side (a beam). */
  readonly protractorStep?: "center" | "side";
  /** At the side step: the aimed object is a valid side of the picked centre. */
  readonly protractorSideValid?: boolean;
}

/** What the crosshair is built from. */
export interface CrosshairSource {
  readonly selectedTool: RuntimeToolId;
  /** The aim pick; undefined for the sky or when nothing is hit. */
  readonly aim?: CrosshairAim;
  readonly menuOpen: boolean;
}

const idle: CrosshairDefinition = { state: "idle" };
const ready: CrosshairDefinition = { state: "ready" };

function refused(reason: string): CrosshairDefinition {
  return { state: "refused", reason };
}

/** Whether the aim rests on an object that matters in play: decor (an asset with no use) never counts. */
function isGameplayObject(aim: CrosshairAim): boolean {
  return aim.objectKind !== floorPickKind && aim.objectKind !== "asset";
}

/** Builds the crosshair's state from the tool in hand and the aim. */
export function createCrosshairDefinition(source: CrosshairSource): CrosshairDefinition {
  const aim = source.aim;
  if (source.menuOpen || aim === undefined) return idle;
  switch (source.selectedTool) {
    case "none":
      if (aim.usableByHand !== true) return idle;
      return aim.withinRange ? ready : refused(crosshairReasons.tooFar);
    case "geodesicEmitters/emitter":
      if (laserToolAcceptsClick(aim.objectKind, aim.withinRange)) return ready;
      if (aim.objectKind === laserPickKind) return refused(crosshairReasons.tooFar);
      return isGameplayObject(aim) ? refused(crosshairReasons.aimAtFloor) : idle;
    case "placedFlags/flag":
      if (signToolAcceptsClick(aim.objectKind)) return ready;
      return isGameplayObject(aim) ? refused(crosshairReasons.aimAtFloor) : idle;
    case "geodesicMeasurements/length":
      if (rulerAcceptsClick(aim.objectKind, aim.withinRange)) return ready;
      if (aim.objectKind === segmentPickKind) return refused(crosshairReasons.tooFar);
      return isGameplayObject(aim) ? refused(crosshairReasons.aimAtBeam) : idle;
    case "geodesicMeasurements/protractor":
      return protractorDefinition(aim);
    case "geodesicModel/tie":
      if (aim.objectKind !== segmentPickKind) return idle;
      return aim.withinRange ? ready : refused(crosshairReasons.tooFar);
    case "geodesicEmitters/carry":
    case "geodesicEmitters/rotate":
    case "geodesicEmitters/aim":
      // These modes end with any click.
      return ready;
    default:
      // The Map and the aim mode of the shell: a click dismisses or accepts anywhere, so nothing to announce.
      return idle;
  }
}

function protractorDefinition(aim: CrosshairAim): CrosshairDefinition {
  if (aim.protractorStep === "side") {
    if (aim.protractorSideValid === true && aim.withinRange) return ready;
    if (aim.protractorSideValid === true) return refused(crosshairReasons.tooFar);
    return isGameplayObject(aim) ? refused(crosshairReasons.aimAtBeam) : idle;
  }
  if (protractorAcceptsCenterClick(aim.objectKind, aim.withinRange)) return ready;
  if (aim.objectKind === laserPickKind || aim.objectKind === crossingPickKind) return refused(crosshairReasons.tooFar);
  return isGameplayObject(aim) ? refused(crosshairReasons.aimAtLaserOrMeetingPoint) : idle;
}

/** Minimum time between two toasts of the same refusal reason, milliseconds. */
export const refusalToastIntervalMs = 1500;

/** Decides whether a click on a refused crosshair shows its reason as a toast: at most once per {@link refusalToastIntervalMs} for the same reason. */
export interface RefusalToastGate {
  /** True when the toast for `reason` should be shown now (and records that it was). */
  shouldShow(reason: string, nowMs: number): boolean;
}

/** Creates a gate with no history. */
export function createRefusalToastGate(): RefusalToastGate {
  let lastReason: string | undefined;
  let lastShownMs = Number.NEGATIVE_INFINITY;
  return {
    shouldShow(reason, nowMs) {
      if (reason === lastReason && nowMs - lastShownMs < refusalToastIntervalMs) return false;
      lastReason = reason;
      lastShownMs = nowMs;
      return true;
    },
  };
}
