/**
 * Scripted motion of the local player: runs a motion script (src/movement/motionScript.ts) through the frame loop and
 * serves it as the public API namespace `motion` (`window.noneuclid.api.motion`).
 *
 * While a script runs, the shell calls {@link ScriptedPlayerMotion.advance} instead of applying the input frame's
 * movement; the runner moves the player through `movePlayer`, the same collision and portal rules as the keyboard, in
 * fixed ticks. The run ends early ("cancelled") when the player gives movement input (unless the run said
 * `userInput: "ignore"`), when something else changes the pose (a reset, `debug.setPlayerPose`), when an XR session
 * starts, when a new run replaces it, or when the app is disposed.
 *
 * The API calls resolve when the run ends, with its report (`wait: false` returns at once; poll `motion.status`).
 * The frame loop only runs while the page is visible, so a hidden or minimised window pauses a run.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS, type PlayerBody } from "../../movement/playerBody";
import type { ObstacleBodyState } from "../../movement/developedObstacles";
import { movePlayer, type MoveResult } from "../../movement/movePlayer";
import {
  createMotionRunner,
  locateMotionTarget,
  poseReport,
  type MotionEnvironment,
  type MotionObjectLocation,
  type MotionPoseReport,
  type MotionReport,
  type MotionRunner,
} from "../../movement/motionRunner";
import { MOTION_DEFAULTS, MOTION_SCRIPT_USAGE, normalizeMotionScript, normalizeTarget } from "../../movement/motionScript";
import type { PlayerPose } from "../../movement/playerPose";
import type { RuntimeWorldObjectBase } from "../../world-objects/runtimeObjectBase";
import type { ApiObject } from "../../runtime/apiCall";

/** The id under which the local player names itself in targets (it cannot walk to or look at itself). */
export const LOCAL_PLAYER_TARGET_ID = "player";

/** What the scripted motion reads from and writes to the shell. */
export interface ScriptedPlayerMotionDeps {
  activeWorld(): CompiledCellComplex;
  readPose(): PlayerPose;
  publishPose(pose: PlayerPose): void;
  playerBody(): PlayerBody;
  bodiesInCell(cellId: string): readonly ObstacleBodyState[];
  getObject(id: string): RuntimeWorldObjectBase | undefined;
  isXrPresenting(): boolean;
}

/** Report of a run as the API returns it: the runner's report plus the player's pose now. */
export interface PlayerMotionReport extends MotionReport {
  readonly id: number;
  readonly pose: MotionPoseReport;
}

/** The shell's handle on scripted motion. */
export interface ScriptedPlayerMotion {
  /** True while a run is going. */
  readonly active: boolean;
  /** Whether movement input should end the run this frame. */
  readonly cancelsOnUserInput: boolean;
  /** Advances the run by a frame of `deltaSeconds`; publishes the new pose and returns the committed moves (for cell bookkeeping). */
  advance(deltaSeconds: number): readonly MoveResult[];
  /** Ends the run, if any, with status "cancelled". */
  cancel(reason: string): void;
  /** The `motion` API namespace. */
  readonly api: ApiObject;
  /** Cancels any run ("the app was disposed"). */
  dispose(): void;
}

interface ActiveRun {
  readonly id: number;
  readonly runner: MotionRunner<MoveResult>;
  readonly userInput: "cancel" | "ignore";
  readonly waiters: ((report: PlayerMotionReport) => void)[];
  /** The pose this run last published; a different pose at the next frame means something else moved the player. */
  lastPose: PlayerPose;
}

/** Creates the scripted-motion controller; nothing runs until `motion.run` (or a shortcut) is called. */
export function createScriptedPlayerMotion(deps: ScriptedPlayerMotionDeps): ScriptedPlayerMotion {
  let active: ActiveRun | undefined;
  let lastReport: PlayerMotionReport | undefined;
  let nextId = 1;

  const environment: MotionEnvironment<MoveResult> = {
    world: deps.activeWorld,
    move: (pose, request) =>
      movePlayer({
        world: deps.activeWorld(),
        pose,
        body: deps.playerBody(),
        ...request,
        coordinateFrame: "global",
        bodiesInCell: deps.bodiesInCell,
      }),
    locateObject: (id) => locateObject(deps.getObject(id)),
    selfObjectId: LOCAL_PLAYER_TARGET_ID,
    get walkerRadiusMeters() {
      return deps.playerBody().radiusMeters;
    },
    eyeHeightMeters: DEFAULT_PLAYER_EYE_HEIGHT_METERS,
  };

  function reportOf(run: ActiveRun): PlayerMotionReport {
    return { id: run.id, ...run.runner.report(), pose: poseReport(deps.readPose()) };
  }

  /** Records the final report, wakes the callers waiting on the run and forgets it. */
  function settle(run: ActiveRun): void {
    lastReport = reportOf(run);
    if (active === run) active = undefined;
    for (const waiter of run.waiters) waiter(lastReport);
  }

  function cancel(reason: string): void {
    const run = active;
    if (!run) return;
    run.runner.cancel(reason, deps.readPose());
    settle(run);
  }

  function start(input: unknown, options: unknown): Promise<PlayerMotionReport> | PlayerMotionReport {
    const { wait, userInput } = readRunOptions(options);
    if (deps.isXrPresenting()) {
      throw new Error("motion: scripted motion is not available while presenting in XR");
    }
    const script = normalizeMotionScript(input);
    cancel("replaced by a new motion");
    const run: ActiveRun = {
      id: nextId,
      runner: createMotionRunner(script, environment),
      userInput,
      waiters: [],
      lastPose: deps.readPose(),
    };
    nextId += 1;
    active = run;
    if (!wait) return reportOf(run);
    return new Promise((resolve) => run.waiters.push(resolve));
  }

  /** Merges a shortcut's main field into an optional step object (`extra` must be a plain object). */
  function step(main: Record<string, unknown>, extra: unknown): Record<string, unknown> {
    if (extra === undefined) return main;
    if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
      throw new Error("motion: the second argument is a step object, for example {speed: 1, onStuck: 'skip'}");
    }
    return { ...extra, ...main };
  }

  const api = {
    /** run(script, {wait = true, userInput = "cancel"}): runs a script; see `motion.usage()`. */
    run: (script: unknown, options?: unknown) => start(script, options),
    walk: (meters: unknown, extra?: unknown) => start(step({ walk: meters }, extra), undefined),
    turn: (degrees: unknown, extra?: unknown) => start(step({ turn: degrees }, extra), undefined),
    walkTo: (target: unknown, extra?: unknown) => start(step({ to: target }, extra), undefined),
    lookAt: (target: unknown, extra?: unknown) => start(step({ lookAt: target }, extra), undefined),
    /** Ends the current run; returns its report (or the last one). */
    stop: () => {
      cancel("stopped by motion.stop");
      return lastReport ?? null;
    },
    /** The current run's report, else the last finished one, else null. */
    status: () => (active ? reportOf(active) : lastReport ?? null),
    /** locate(target, maxHops = 4): where a target is from the player: distance, bearing (positive = left), elevation, portals. */
    locate: (target: unknown, maxHops?: unknown) => {
      const hops = maxHops === undefined ? MOTION_DEFAULTS.maxHops : Number(maxHops);
      const pose = deps.readPose();
      const seen = locateMotionTarget(environment, pose, normalizeTarget(target, "target"), hops);
      if (typeof seen === "string") throw new Error(`motion.locate: ${seen}`);
      const round = (value: number): number => Math.round(value * 1e4) / 1e4;
      return {
        cellId: seen.cellId,
        portals: seen.portalIds,
        distanceMeters: round(seen.distanceMeters),
        bearingDegrees: round((seen.bearingRadians * 180) / Math.PI),
        elevationDegrees: round((seen.elevationRadians * 180) / Math.PI),
        inPlayerFrame: { x: round(seen.local.x), y: round(seen.local.y), z: round(seen.local.z) },
        player: poseReport(pose),
      };
    },
    /** The script format, with examples. */
    usage: () => ({
      ...MOTION_SCRIPT_USAGE,
      calls: {
        run: "run(script, {wait = true, userInput: 'cancel'|'ignore'}) -> report when the run ends",
        walk: "walk(meters, step?)",
        turn: "turn(degrees, step?)  positive = left",
        walkTo: "walkTo(target, step?)",
        lookAt: "lookAt(target, step?)",
        stop: "stop() -> report",
        status: "status() -> report of the current or last run",
        locate: "locate(target, maxHops?) -> distance, bearing, elevation, portals",
      },
      notes: [
        "A run ends when the player moves, the pose is set from outside, XR starts or another run starts.",
        "The page only advances while visible: keep the window in front.",
        "Over the server backend a call times out after 30 s: use {wait: false} and poll motion.status.",
      ],
    }),
  };

  return {
    get active() {
      return active !== undefined;
    },
    get cancelsOnUserInput() {
      return active?.userInput === "cancel";
    },
    advance(deltaSeconds) {
      const run = active;
      if (!run) return [];
      const pose = deps.readPose();
      if (deps.isXrPresenting()) {
        cancel("an XR session started");
        return [];
      }
      if (!samePose(pose, run.lastPose)) {
        cancel("the pose was changed from outside the motion (reset, teleport or debug.setPlayerPose)");
        return [];
      }
      const result = run.runner.advance(pose, deltaSeconds);
      if (result.moves.length > 0) {
        deps.publishPose(result.pose);
        run.lastPose = deps.readPose();
      }
      if (run.runner.finished) settle(run);
      return result.moves;
    },
    cancel,
    api,
    dispose() {
      cancel("the app was disposed");
    },
  };
}

function locateObject(object: RuntimeWorldObjectBase | undefined): MotionObjectLocation | undefined {
  if (!object) return undefined;
  return {
    cellId: object.cellId,
    position: object.localPose.translation,
    ...(object.collision ? { radiusMeters: object.collision.radius, heightMeters: object.collision.height } : {}),
  };
}

function readRunOptions(options: unknown): { wait: boolean; userInput: "cancel" | "ignore" } {
  if (options === undefined || options === null) return { wait: true, userInput: "cancel" };
  if (typeof options !== "object" || Array.isArray(options)) throw new Error("motion.run: options must be {wait?, userInput?}");
  const { wait, userInput, ...rest } = options as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) throw new Error(`motion.run: unknown option ${unknown.join(", ")}; allowed: wait, userInput`);
  if (wait !== undefined && typeof wait !== "boolean") throw new Error("motion.run: wait must be true or false");
  if (userInput !== undefined && userInput !== "cancel" && userInput !== "ignore") throw new Error("motion.run: userInput must be 'cancel' or 'ignore'");
  return { wait: wait ?? true, userInput: userInput ?? "cancel" };
}

function samePose(a: PlayerPose, b: PlayerPose): boolean {
  const close = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-9;
  return a.cellId === b.cellId
    && close(a.position.x, b.position.x)
    && close(a.position.y, b.position.y)
    && close(a.position.z, b.position.z)
    && close(a.yawRadians, b.yawRadians)
    && close(a.pitchRadians, b.pitchRadians);
}
