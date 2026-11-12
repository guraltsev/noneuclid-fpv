/**
 * Motion scripts: a plain-data description of how a walker (the player or an NPC) moves and looks, and its normalization.
 *
 * A script is a list of steps run one after another. A step has up to three channels that run at the same time:
 * - translation: `walk` (a distance in the walker's body frame) or `to` (walk to a target);
 * - heading: `turn` (relative), `yaw` (absolute), `lookAt` (keep facing a target) or `face: "motion"` (face where it walks);
 * - `pitch` (absolute look elevation).
 * so "walk 3 m while turning 90 degrees" is one step, `{ walk: 3, turn: 90, duration: 2 }`. A step ends when its
 * channels are done (`until`), and each step says what to do when the walker is stuck, the target is unreachable or
 * lost, or the step times out. The input form accepts shorthands (a bare step, a number for `walk`, a string for an
 * object id); {@link normalizeMotionScript} turns any input into the canonical {@link MotionScript} and rejects
 * unknown keys and bad values with the path of the offending field. Units: meters, seconds, degrees in the input.
 * Angles follow the yaw convention of the world: positive turns are counterclockwise seen from above, that is to the left.
 *
 * The format is the same for the public API (`motion.run`), for tests and for NPC behaviors; it is deliberately
 * JSON, not a text language (see _docs/design/016-scripted-motion.md).
 */
import type { Vec3 } from "../math/vec3";

/** What happens to the script when a step cannot be completed: abort it ("fail"), continue with the next step ("skip"), or end it without error ("stop"). */
export type MotionOutcome = "fail" | "skip" | "stop";

/**
 * A place or thing to walk to or look at.
 * - `object`: a runtime object by id, followed while it moves (`"player"` is the local player, for NPCs);
 * - `point`: a point in a cell's frame (meters; `z` is height above the floor, default 0 when walking, eye height when looking);
 * - `relative`: a point given relative to the walker when the step starts (meters ahead, to the right, up), then fixed.
 */
export type MotionTarget =
  | { readonly kind: "object"; readonly objectId: string }
  | { readonly kind: "point"; readonly cellId: string; readonly point: Vec3; readonly hasHeight: boolean }
  | { readonly kind: "relative"; readonly forward: number; readonly right: number; readonly up: number };

/** Translation channel of a step. */
export type MotionMove =
  /** Walk `forward`/`right` meters in the body frame. `frame: "body"` follows the heading as it turns (an arc with a turn); `"start"` keeps the direction the step started with. */
  | { readonly kind: "walk"; readonly forward: number; readonly right: number; readonly frame: "body" | "start" }
  /** Walk to a target until within `stopAtMeters` of it (undefined: chosen from the target, see the runner). */
  | { readonly kind: "to"; readonly target: MotionTarget; readonly stopAtMeters?: number };

/** Heading channel of a step. */
export type MotionHeading =
  | { readonly kind: "turn"; readonly degrees: number }
  | { readonly kind: "yaw"; readonly degrees: number }
  /** Turn to the target, and pitch to it too unless `pitch` is set on the step; keeps tracking while the step runs. */
  | { readonly kind: "lookAt"; readonly target: MotionTarget }
  /** Turn toward the direction of travel; translation slows down while the heading is far off (turns on the spot first). */
  | { readonly kind: "faceMotion" };

/** How the runner reacts when the walker makes no progress. */
export interface MotionStuckPolicy {
  /** "retry": back up, pause, try again. "detour": probe directions around the obstacle and walk round it. "none": apply `then` at once. */
  readonly strategy: "retry" | "detour" | "none";
  /** Stuck events handled before `then` applies. The count starts again after `resetAfterMeters` of progress. */
  readonly attempts: number;
  /** Seconds to stand still before retrying. */
  readonly pauseSeconds: number;
  /** Meters to step back before retrying ("retry"), or before probing when no direction is free ("detour"). */
  readonly backUpMeters: number;
  /** Meters walked along a detour direction before heading for the goal again. */
  readonly detourMeters: number;
  /** Progress (meters) beyond the furthest point of the last stuck event after which the attempt count starts again, so a long wall can take many detours. */
  readonly resetAfterMeters: number;
  readonly then: MotionOutcome;
}

/** One step of a script, with all defaults filled in. */
export interface MotionStep {
  readonly index: number;
  readonly label?: string;
  readonly move?: MotionMove;
  readonly heading?: MotionHeading;
  /** Absolute pitch to reach, degrees. */
  readonly pitchDegrees?: number;
  /** Pause step: stand still this long. */
  readonly waitSeconds?: number;
  /** When set, rates are chosen so every relative channel finishes in this time, and the step lasts at least this long. */
  readonly durationSeconds?: number;
  /** Which channels must be done for the step to end. */
  readonly until: "all" | "any" | "move" | "heading";
  readonly speedMetersPerSecond: number;
  readonly turnRateDegreesPerSecond: number;
  readonly timeoutSeconds: number;
  /** Most portals between the walker and a target that the runner looks through. */
  readonly maxHops: number;
  readonly onStuck: MotionStuckPolicy;
  readonly onUnreachable: MotionOutcome;
  readonly onTimeout: MotionOutcome;
  /** "lastKnown": keep going to where the object was last seen. */
  readonly onTargetLost: MotionOutcome | "lastKnown";
}

/** A normalized script. */
export interface MotionScript {
  readonly name?: string;
  readonly steps: readonly MotionStep[];
  /** How many times the steps run; `Infinity` for an NPC that patrols forever. */
  readonly repeat: number;
}

/** Defaults of every step unless the script's `defaults` or the step override them. */
export const MOTION_DEFAULTS = {
  speedMetersPerSecond: 2.5,
  turnRateDegreesPerSecond: 120,
  timeoutSeconds: 60,
  maxHops: 4,
  until: "all",
  onUnreachable: "fail",
  onTimeout: "fail",
  onTargetLost: "fail",
  onStuck: {
    strategy: "detour",
    attempts: 4,
    pauseSeconds: 0.2,
    backUpMeters: 0.3,
    detourMeters: 1,
    resetAfterMeters: 2,
    then: "fail",
  },
} as const satisfies Omit<MotionStep, "index" | "label" | "move" | "heading" | "pitchDegrees" | "waitSeconds" | "durationSeconds">;

/** Error for an invalid script; the message starts with the path of the offending field (for example `steps[2].turn`). */
export class MotionScriptError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "MotionScriptError";
  }
}

/** Keys a step may hold, with a one-line description each; the source of {@link MOTION_SCRIPT_USAGE}. */
const STEP_KEYS: Readonly<Record<string, string>> = {
  walk: "meters forward (negative: back), or {forward, right, frame: 'body'|'start'}",
  to: "target to walk to: object id, {object}, {cell, x, y}, or {forward, right} relative to the start of the step",
  stopAt: "with `to`: stop this many meters from the target",
  turn: "degrees, positive = left (counterclockwise), or {left: deg} / {right: deg}",
  yaw: "absolute heading in the current cell's frame, degrees",
  lookAt: "target to keep facing (and pitching to, unless `pitch` is given)",
  face: "'motion' (turn toward the direction of travel; default with `to`) or 'keep'",
  pitch: "absolute look elevation, degrees",
  wait: "seconds to stand still (alone in its step)",
  duration: "seconds; relative channels finish together in this time",
  until: "'all' (default), 'any', 'move' or 'heading': which channels end the step",
  label: "name shown in the report",
};

/** Keys allowed in a step and in a script's `defaults`: pacing and error policies. */
const POLICY_KEYS: Readonly<Record<string, string>> = {
  speed: `meters per second (default ${MOTION_DEFAULTS.speedMetersPerSecond})`,
  turnRate: `degrees per second (default ${MOTION_DEFAULTS.turnRateDegreesPerSecond})`,
  timeout: `seconds per step (default ${MOTION_DEFAULTS.timeoutSeconds})`,
  maxHops: `portals to look through for a target (default ${MOTION_DEFAULTS.maxHops})`,
  onStuck: "'detour' (default), 'retry', 'fail', 'skip', 'stop', or {strategy, attempts, pause, backUp, detour, resetAfter, then}",
  onUnreachable: "'fail' (default), 'skip' or 'stop': no straight route through at most maxHops portals",
  onTimeout: "'fail' (default), 'skip' or 'stop'",
  onTargetLost: "'fail' (default), 'skip', 'stop' or 'lastKnown': the object disappeared",
};

/** Human-readable summary of the input format, served by the public API's help. */
export const MOTION_SCRIPT_USAGE = {
  script: "a step, a list of steps, or {steps, defaults?, repeat?: n|'forever', name?}",
  step: { ...STEP_KEYS, ...POLICY_KEYS },
  examples: [
    { walk: 3 },
    [{ turn: 90 }, { walk: 2, lookAt: "marmot-1" }],
    { to: { cell: "face-c", x: 1, y: 2 }, onStuck: { strategy: "retry", attempts: 2, then: "skip" } },
    { walk: 4, turn: -90, duration: 3 },
    { steps: [{ to: { forward: 3 } }, { turn: 180 }], repeat: "forever" },
  ],
};

/**
 * Turns script input (shorthands allowed) into a {@link MotionScript}.
 * Throws {@link MotionScriptError} naming the offending field for unknown keys, wrong types, non-finite or out-of-range numbers, a step with two channels of the same kind, or `wait` combined with a channel.
 */
export function normalizeMotionScript(input: unknown): MotionScript {
  if (Array.isArray(input)) {
    return { steps: normalizeSteps(input, {}, "steps"), repeat: 1 };
  }
  if (!isRecord(input)) {
    throw new MotionScriptError("script", "expected a step, a list of steps, or {steps, ...}");
  }
  if (!("steps" in input)) {
    return { steps: normalizeSteps([input], {}, "steps"), repeat: 1 };
  }
  checkKeys(input, ["steps", "defaults", "repeat", "name"], "script");
  if (!Array.isArray(input.steps)) {
    throw new MotionScriptError("steps", "expected a list of steps");
  }
  const defaults = input.defaults === undefined ? {} : input.defaults;
  if (!isRecord(defaults)) {
    throw new MotionScriptError("defaults", "expected an object");
  }
  checkKeys(defaults, Object.keys(POLICY_KEYS), "defaults");
  const repeat = input.repeat === undefined
    ? 1
    : input.repeat === "forever"
      ? Infinity
      : positiveInteger(input.repeat, "repeat");
  const name = input.name === undefined ? undefined : string(input.name, "name");
  return { ...(name !== undefined ? { name } : {}), steps: normalizeSteps(input.steps, defaults, "steps"), repeat };
}

function normalizeSteps(steps: readonly unknown[], defaults: Record<string, unknown>, path: string): MotionStep[] {
  if (steps.length === 0) {
    throw new MotionScriptError(path, "a script needs at least one step");
  }
  return steps.map((step, index) => normalizeStep(step, index, defaults, `${path}[${index}]`));
}

function normalizeStep(input: unknown, index: number, defaults: Record<string, unknown>, path: string): MotionStep {
  if (!isRecord(input)) {
    throw new MotionScriptError(path, "expected a step object such as {walk: 2}");
  }
  checkKeys(input, [...Object.keys(STEP_KEYS), ...Object.keys(POLICY_KEYS)], path);
  const field = (key: string): unknown => (input[key] !== undefined ? input[key] : defaults[key]);
  const at = (key: string): string => (input[key] !== undefined ? `${path}.${key}` : `defaults.${key}`);

  if (input.walk !== undefined && input.to !== undefined) {
    throw new MotionScriptError(path, "a step has one translation: `walk` or `to`, not both");
  }
  const headingKeys = ["turn", "yaw", "lookAt", "face"].filter((key) => input[key] !== undefined);
  if (headingKeys.length > 1) {
    throw new MotionScriptError(path, `a step has one heading channel; got ${headingKeys.join(" and ")}`);
  }

  let move: MotionMove | undefined;
  if (input.walk !== undefined) {
    move = normalizeWalk(input.walk, `${path}.walk`);
  } else if (input.to !== undefined) {
    const stopAtMeters = input.stopAt === undefined ? undefined : nonNegative(input.stopAt, `${path}.stopAt`);
    move = { kind: "to", target: normalizeTarget(input.to, `${path}.to`), ...(stopAtMeters !== undefined ? { stopAtMeters } : {}) };
  }
  if (input.stopAt !== undefined && move?.kind !== "to") {
    throw new MotionScriptError(`${path}.stopAt`, "only applies to a `to` step");
  }

  let heading: MotionHeading | undefined;
  if (input.turn !== undefined) {
    heading = { kind: "turn", degrees: normalizeTurn(input.turn, `${path}.turn`) };
  } else if (input.yaw !== undefined) {
    heading = { kind: "yaw", degrees: finite(input.yaw, `${path}.yaw`) };
  } else if (input.lookAt !== undefined) {
    heading = { kind: "lookAt", target: normalizeTarget(input.lookAt, `${path}.lookAt`) };
  } else if (input.face !== undefined) {
    const face = oneOf(input.face, ["motion", "keep"] as const, `${path}.face`);
    heading = face === "motion" ? { kind: "faceMotion" } : undefined;
  } else if (move?.kind === "to") {
    heading = { kind: "faceMotion" };
  }

  const pitchDegrees = input.pitch === undefined ? undefined : finite(input.pitch, `${path}.pitch`);
  if (pitchDegrees !== undefined && Math.abs(pitchDegrees) >= 90) {
    throw new MotionScriptError(`${path}.pitch`, "must be strictly between -90 and 90 degrees");
  }
  const waitSeconds = input.wait === undefined ? undefined : nonNegative(input.wait, `${path}.wait`);
  if (waitSeconds !== undefined && (move || heading || pitchDegrees !== undefined)) {
    throw new MotionScriptError(`${path}.wait`, "a wait step only waits; use `duration` to pace a moving step");
  }
  if (waitSeconds === undefined && !move && !heading && pitchDegrees === undefined) {
    throw new MotionScriptError(path, "the step does nothing: give walk, to, turn, yaw, lookAt, pitch or wait");
  }
  const durationSeconds = input.duration === undefined ? undefined : positive(input.duration, `${path}.duration`);
  const label = input.label === undefined ? undefined : string(input.label, `${path}.label`);

  return {
    index,
    ...(label !== undefined ? { label } : {}),
    ...(move ? { move } : {}),
    ...(heading ? { heading } : {}),
    ...(pitchDegrees !== undefined ? { pitchDegrees } : {}),
    ...(waitSeconds !== undefined ? { waitSeconds } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    until: input.until === undefined ? MOTION_DEFAULTS.until : oneOf(input.until, ["all", "any", "move", "heading"] as const, `${path}.until`),
    speedMetersPerSecond: field("speed") === undefined ? MOTION_DEFAULTS.speedMetersPerSecond : positive(field("speed"), at("speed")),
    turnRateDegreesPerSecond: field("turnRate") === undefined ? MOTION_DEFAULTS.turnRateDegreesPerSecond : positive(field("turnRate"), at("turnRate")),
    timeoutSeconds: field("timeout") === undefined ? MOTION_DEFAULTS.timeoutSeconds : positive(field("timeout"), at("timeout")),
    maxHops: field("maxHops") === undefined ? MOTION_DEFAULTS.maxHops : boundedInteger(field("maxHops"), 0, 8, at("maxHops")),
    onStuck: field("onStuck") === undefined ? MOTION_DEFAULTS.onStuck : normalizeStuckPolicy(field("onStuck"), at("onStuck")),
    onUnreachable: field("onUnreachable") === undefined ? MOTION_DEFAULTS.onUnreachable : outcome(field("onUnreachable"), at("onUnreachable")),
    onTimeout: field("onTimeout") === undefined ? MOTION_DEFAULTS.onTimeout : outcome(field("onTimeout"), at("onTimeout")),
    onTargetLost: field("onTargetLost") === undefined
      ? MOTION_DEFAULTS.onTargetLost
      : oneOf(field("onTargetLost"), ["fail", "skip", "stop", "lastKnown"] as const, at("onTargetLost")),
  };
}

function normalizeWalk(value: unknown, path: string): MotionMove {
  if (typeof value === "number") {
    return { kind: "walk", forward: finite(value, path), right: 0, frame: "body" };
  }
  if (!isRecord(value)) {
    throw new MotionScriptError(path, "expected meters forward, or {forward, right, frame}");
  }
  checkKeys(value, ["forward", "right", "back", "left", "frame"], path);
  const forward = (value.forward === undefined ? 0 : finite(value.forward, `${path}.forward`)) - (value.back === undefined ? 0 : finite(value.back, `${path}.back`));
  const right = (value.right === undefined ? 0 : finite(value.right, `${path}.right`)) - (value.left === undefined ? 0 : finite(value.left, `${path}.left`));
  const frame = value.frame === undefined ? "body" : oneOf(value.frame, ["body", "start"] as const, `${path}.frame`);
  return { kind: "walk", forward, right, frame };
}

function normalizeTurn(value: unknown, path: string): number {
  if (typeof value === "number") {
    return finite(value, path);
  }
  if (!isRecord(value)) {
    throw new MotionScriptError(path, "expected degrees (positive = left) or {left: deg} / {right: deg}");
  }
  checkKeys(value, ["left", "right"], path);
  if ((value.left === undefined) === (value.right === undefined)) {
    throw new MotionScriptError(path, "give exactly one of left and right");
  }
  return value.left !== undefined ? finite(value.left, `${path}.left`) : -finite(value.right, `${path}.right`);
}

/** Normalizes a target: a string is an object id; objects are `{object}`, `{cell, x, y, z?}` or `{forward?, right?, up?}`. */
export function normalizeTarget(value: unknown, path: string): MotionTarget {
  if (typeof value === "string") {
    if (value.length === 0) throw new MotionScriptError(path, "empty object id");
    return { kind: "object", objectId: value };
  }
  if (!isRecord(value)) {
    throw new MotionScriptError(path, "expected an object id, {object}, {cell, x, y, z?} or {forward, right, up}");
  }
  if (value.object !== undefined) {
    checkKeys(value, ["object"], path);
    return { kind: "object", objectId: string(value.object, `${path}.object`) };
  }
  if (value.cell !== undefined) {
    checkKeys(value, ["cell", "x", "y", "z"], path);
    return {
      kind: "point",
      cellId: string(value.cell, `${path}.cell`),
      point: { x: finite(value.x, `${path}.x`), y: finite(value.y, `${path}.y`), z: value.z === undefined ? 0 : finite(value.z, `${path}.z`) },
      hasHeight: value.z !== undefined,
    };
  }
  checkKeys(value, ["forward", "right", "up", "back", "left"], path);
  const forward = (value.forward === undefined ? 0 : finite(value.forward, `${path}.forward`)) - (value.back === undefined ? 0 : finite(value.back, `${path}.back`));
  const right = (value.right === undefined ? 0 : finite(value.right, `${path}.right`)) - (value.left === undefined ? 0 : finite(value.left, `${path}.left`));
  const up = value.up === undefined ? 0 : finite(value.up, `${path}.up`);
  if (forward === 0 && right === 0 && up === 0 && Object.keys(value).length === 0) {
    throw new MotionScriptError(path, "expected an object id, {object}, {cell, x, y, z?} or {forward, right, up}");
  }
  return { kind: "relative", forward, right, up };
}

function normalizeStuckPolicy(value: unknown, path: string): MotionStuckPolicy {
  const base = MOTION_DEFAULTS.onStuck;
  if (typeof value === "string") {
    if (value === "retry" || value === "detour") return { ...base, strategy: value };
    return { ...base, strategy: "none", then: outcome(value, path) };
  }
  if (!isRecord(value)) {
    throw new MotionScriptError(path, "expected 'detour', 'retry', 'fail', 'skip', 'stop' or {strategy, attempts, ...}");
  }
  checkKeys(value, ["strategy", "attempts", "pause", "backUp", "detour", "resetAfter", "then"], path);
  return {
    strategy: value.strategy === undefined ? base.strategy : oneOf(value.strategy, ["retry", "detour", "none"] as const, `${path}.strategy`),
    attempts: value.attempts === undefined ? base.attempts : boundedInteger(value.attempts, 0, 1000, `${path}.attempts`),
    pauseSeconds: value.pause === undefined ? base.pauseSeconds : nonNegative(value.pause, `${path}.pause`),
    backUpMeters: value.backUp === undefined ? base.backUpMeters : nonNegative(value.backUp, `${path}.backUp`),
    detourMeters: value.detour === undefined ? base.detourMeters : positive(value.detour, `${path}.detour`),
    resetAfterMeters: value.resetAfter === undefined ? base.resetAfterMeters : positive(value.resetAfter, `${path}.resetAfter`),
    then: value.then === undefined ? base.then : outcome(value.then, `${path}.then`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new MotionScriptError(`${path}.${key}`, `unknown key; allowed: ${allowed.join(", ")}`);
    }
  }
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MotionScriptError(path, `expected a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function positive(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number <= 0) throw new MotionScriptError(path, "must be greater than 0");
  return number;
}

function nonNegative(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number < 0) throw new MotionScriptError(path, "must not be negative");
  return number;
}

function boundedInteger(value: unknown, min: number, max: number, path: string): number {
  const number = finite(value, path);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new MotionScriptError(path, `must be an integer from ${min} to ${max}`);
  }
  return number;
}

function positiveInteger(value: unknown, path: string): number {
  const number = finite(value, path);
  if (!Number.isInteger(number) || number < 1) throw new MotionScriptError(path, "must be a whole number of at least 1, or 'forever'");
  return number;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new MotionScriptError(path, "expected a non-empty string");
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new MotionScriptError(path, `expected one of ${allowed.map((entry) => `'${entry}'`).join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

function outcome(value: unknown, path: string): MotionOutcome {
  return oneOf(value, ["fail", "skip", "stop"] as const, path);
}
