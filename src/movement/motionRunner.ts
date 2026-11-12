/**
 * Runs a {@link MotionScript} for one walker (the player or an NPC), with no renderer and no clock of its own.
 *
 * The caller hands in an environment ({@link MotionEnvironment}): the world, a *trial move* (a pure function that says
 * where a move would end, with collisions and portal crossings: `movePlayer` for the player, `moveDynamicObject` for an
 * NPC), and where objects are. The runner then advances in fixed ticks of {@link MOTION_TICK_SECONDS}, so a script ends
 * in the same place whatever the frame rate; each tick turns the step's channels into one move (yaw and pitch deltas,
 * a displacement in the walker's heading frame) and commits it through the trial move. The same function, called
 * without committing, probes directions when the walker is stuck.
 *
 * Targets in other cells are seen through portals: the runner looks for the nearest image of the target through at most
 * `maxHops` portals (`findNearestImageRoute`) and walks or looks straight at that image, re-planning when the walker
 * crosses a portal. Turns are tracked as commanded angles, so a portal that re-expresses the heading does not disturb
 * them.
 *
 * Errors the runner recognizes, each with the step's policy (see motionScript.ts): stuck (no progress toward the goal
 * for {@link STUCK_WINDOW_SECONDS}; a slide along a wall that still makes progress is not stuck), unreachable (no
 * straight route to the target), target lost (the object is gone), timeout. Everything is in meters, seconds and
 * radians; poses are in the walker's current cell frame (x right, y forward at yaw 0, z up).
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { findNearestImageRoute, type CellPoint } from "../cell-complex/portalRoute";
import { locateDevelopedPoint } from "../cell-complex/segmentWalk";
import { composeRigidTransform3, identityRigidTransform3, invertRigidTransform3, transformPoint3, type RigidTransform3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";
import type { MotionOutcome, MotionScript, MotionStep, MotionTarget } from "./motionScript";
import type { PlayerPose } from "./playerPose";

/** Fixed simulation step of the runner, seconds. */
export const MOTION_TICK_SECONDS = 1 / 60;
/** Length of the window over which progress is judged, seconds. */
export const STUCK_WINDOW_SECONDS = 0.4;
/** A window is stuck when the progress made is below this fraction of the progress asked for. */
const STUCK_PROGRESS_FRACTION = 0.25;
/** Below this much asked-for motion in a window, the window is not judged (the walker was turning or arriving). */
const STUCK_MIN_EXPECTED_METERS = 0.05;
/** Heading counts as on target within this angle. */
const ALIGNED_RADIANS = (0.5 * Math.PI) / 180;
/** Pitch never goes beyond this (movePlayer clamps just under pi / 2). */
const MAX_PITCH_RADIANS = Math.PI / 2 - 0.02;
/** How long a route through portals is reused before it is searched again, seconds (sooner when a cell changes). */
const ROUTE_REFRESH_SECONDS = 0.5;
/** Offsets from the goal direction tried when probing for a detour, radians, in order. */
const DETOUR_OFFSETS = [25, 50, 75, 100, 125, 150].map((degrees) => (degrees * Math.PI) / 180);
/** A probe direction is free when the walker gets this fraction of the probe distance along it. */
const DETOUR_FREE_FRACTION = 0.9;
/** Most ticks run by one `advance` call (a long frame does not make the walker jump far). */
const MAX_TICKS_PER_ADVANCE = 30;
/** Step reports kept for a script that repeats forever. */
const MAX_STEP_REPORTS = 50;

/** What a trial move tells the runner. `movePlayer`'s MoveResult satisfies it. */
export interface MotionTrialMove {
  readonly pose: PlayerPose;
  /** Applied translation in the start cell's frame, meters. */
  readonly appliedDisplacement: Vec3;
  readonly blocked: boolean;
  readonly blockingReason?: string;
  readonly blockingObjectId?: string;
  readonly crossings: readonly { readonly portalId: string }[];
}

/** One move asked of the walker: turn first, then translate by `localDisplacement` in the new heading frame (x right, y forward, z up). */
export interface MotionMoveRequest {
  readonly localDisplacement: Vec3;
  readonly yawDeltaRadians: number;
  readonly pitchDeltaRadians: number;
}

/** Where an object is, for targets: its cell, its feet/base point, and optional size (meters). */
export interface MotionObjectLocation {
  readonly cellId: string;
  readonly position: Vec3;
  readonly radiusMeters?: number;
  readonly heightMeters?: number;
}

/** What the runner needs from the world it runs in. */
export interface MotionEnvironment<M extends MotionTrialMove = MotionTrialMove> {
  world(): CompiledCellComplex;
  /** Pure: where this move would end. Called to commit a tick's move and to probe directions. */
  move(pose: PlayerPose, request: MotionMoveRequest): M;
  /** Where object `id` is now, or undefined when there is no such object. */
  locateObject(id: string): MotionObjectLocation | undefined;
  /** Id of the walker itself (it cannot be its own target). */
  readonly selfObjectId?: string;
  readonly walkerRadiusMeters: number;
  /** Height of the walker's eyes above its feet, for looking up and down. */
  readonly eyeHeightMeters: number;
}

/** A target as seen from the walker: its image in the walker's cell frame, through the portals of `portalIds`. */
export interface DevelopedTarget {
  readonly cellId: string;
  /** Target point in the walker's current cell frame (z: aim height above the walker's floor). */
  readonly local: Vec3;
  readonly portalIds: readonly string[];
  /** Horizontal distance from the walker, meters. */
  readonly distanceMeters: number;
  /** Bearing from the walker's heading, radians, positive to the left. */
  readonly bearingRadians: number;
  /** Elevation from the walker's eyes, radians. */
  readonly elevationRadians: number;
  readonly radiusMeters?: number;
}

/** State of a whole run: still going, or how it ended. */
export type MotionStatus = "running" | "done" | "failed" | "stopped" | "cancelled";
/** State of one step: still going, or how it ended (`skipped` by a `skip` policy). */
export type MotionStepStatus = "running" | "done" | "skipped" | "failed" | "stopped" | "cancelled";

/** Pose in report units: meters and degrees, rounded to micrometers and microdegrees. */
export interface MotionPoseReport {
  readonly cellId: string;
  readonly position: Vec3;
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
}

/** What happened in one run of one step. */
export interface MotionStepReport {
  readonly index: number;
  readonly label?: string;
  readonly repetition: number;
  status: MotionStepStatus;
  reason?: string;
  seconds: number;
  /** Path length actually walked, meters. */
  distanceMeters: number;
  stuckEvents: number;
  retries: number;
  detours: number;
  /** Portals crossed, in order. */
  portals: string[];
  /** Last thing that blocked the walker: a reason ("wall", "forbidden-zone", ...) or "object <id>". */
  blockedBy?: string;
  endPose?: MotionPoseReport;
}

/** State of a whole run. */
export interface MotionReport {
  readonly name?: string;
  status: MotionStatus;
  reason?: string;
  elapsedSeconds: number;
  repetition: number;
  stepIndex: number;
  steps: MotionStepReport[];
}

/** A running script. */
export interface MotionRunner<M extends MotionTrialMove = MotionTrialMove> {
  /** True once the script ended (any status but "running"). */
  readonly finished: boolean;
  /** Runs as many fixed ticks as `deltaSeconds` (plus the carried-over remainder) allows; returns the new pose and the committed moves. */
  advance(pose: PlayerPose, deltaSeconds: number): { readonly pose: PlayerPose; readonly moves: readonly M[] };
  /** Runs exactly one tick. */
  tick(pose: PlayerPose): { readonly pose: PlayerPose; readonly move?: M };
  /** Ends the run with status "cancelled". No-op when finished. */
  cancel(reason: string, pose?: PlayerPose): void;
  /** Live report (a copy). */
  report(): MotionReport;
}

type Phase =
  | { readonly kind: "normal" }
  | { readonly kind: "pause"; remainingSeconds: number }
  | { readonly kind: "backUp"; remainingMeters: number; readonly then: "pause" | "probe"; readonly directionBody: number }
  | { readonly kind: "detour"; remainingMeters: number; readonly directionBody: number };

interface ResolvedTarget {
  readonly target: MotionTarget;
  /** Fixed place for point and relative targets; for objects, the last place seen. */
  place?: CellPoint & { readonly radiusMeters?: number; readonly aimHeight?: number };
  /** Route to the target's nearest image, reused until a cell changes or it is {@link ROUTE_REFRESH_SECONDS} old. */
  route?: { walkerCellId: string; targetCellId: string; age: number; walkerFromTarget: RigidTransform3; portalIds: readonly string[] };
}

interface StepState {
  readonly step: MotionStep;
  readonly report: MotionStepReport;
  elapsed: number;
  started: boolean;
  moveTarget?: ResolvedTarget;
  lookTarget?: ResolvedTarget;
  /** Walk: total length and direction in the body frame at the start (radians from forward, positive left). */
  walkTotal: number;
  walkAngle: number;
  walked: number;
  speed: number;
  turnRate: number;
  turnRemaining: number;
  /** Sum of commanded yaw deltas since the step started. */
  turned: number;
  moveDone: boolean;
  headingDone: boolean;
  pitchDone: boolean;
  phase: Phase;
  windowTime: number;
  windowProgress: number;
  windowExpected: number;
  attempts: number;
  /** Signed progress toward the goal since the step started (backing up counts negative). */
  netProgress: number;
  /** Highest `netProgress` at a stuck event; the attempt count starts again only beyond it, so regaining ground lost by backing up does not count. */
  stuckMark: number;
  /** +1: detour to the left of the goal, -1: to the right, 0: not chosen yet. */
  detourSide: number;
}

/** Creates a runner for `script` in `env`. Nothing happens until `advance` or `tick` is called. */
export function createMotionRunner<M extends MotionTrialMove>(script: MotionScript, env: MotionEnvironment<M>): MotionRunner<M> {
  const report: MotionReport = {
    ...(script.name !== undefined ? { name: script.name } : {}),
    status: "running",
    elapsedSeconds: 0,
    repetition: 0,
    stepIndex: 0,
    steps: [],
  };
  let accumulator = 0;
  let state: StepState | undefined = createStepState(script.steps[0], 0);
  report.steps.push(state.report);

  function createStepState(step: MotionStep, repetition: number): StepState {
    return {
      step,
      report: {
        index: step.index,
        ...(step.label !== undefined ? { label: step.label } : {}),
        repetition,
        status: "running",
        seconds: 0,
        distanceMeters: 0,
        stuckEvents: 0,
        retries: 0,
        detours: 0,
        portals: [],
      },
      elapsed: 0,
      started: false,
      walkTotal: 0,
      walkAngle: 0,
      walked: 0,
      speed: step.speedMetersPerSecond,
      turnRate: (step.turnRateDegreesPerSecond * Math.PI) / 180,
      turnRemaining: 0,
      turned: 0,
      moveDone: step.move === undefined,
      headingDone: step.heading === undefined || step.heading.kind === "faceMotion",
      pitchDone: step.pitchDegrees === undefined,
      phase: { kind: "normal" },
      windowTime: 0,
      windowProgress: 0,
      windowExpected: 0,
      attempts: 0,
      netProgress: 0,
      stuckMark: 0,
      detourSide: 0,
    };
  }

  /** Resolves relative and point targets and converts absolute yaw and durations into rates, from the pose at the start of the step. */
  function startStep(s: StepState, pose: PlayerPose): string | undefined {
    s.started = true;
    const { step } = s;
    if (step.move?.kind === "walk") {
      s.walkTotal = Math.hypot(step.move.forward, step.move.right);
      s.walkAngle = Math.atan2(-step.move.right, step.move.forward);
      s.moveDone = s.walkTotal <= 1e-9;
      if (step.durationSeconds !== undefined) s.speed = s.walkTotal / step.durationSeconds;
    } else if (step.move?.kind === "to") {
      s.moveTarget = { target: step.move.target };
      const error = resolveFixedTarget(s.moveTarget, pose, false);
      if (error) return error;
    }
    if (step.heading?.kind === "turn") {
      s.turnRemaining = (step.heading.degrees * Math.PI) / 180;
    } else if (step.heading?.kind === "yaw") {
      s.turnRemaining = wrapAngle((step.heading.degrees * Math.PI) / 180 - pose.yawRadians);
    } else if (step.heading?.kind === "lookAt") {
      s.lookTarget = { target: step.heading.target };
      const error = resolveFixedTarget(s.lookTarget, pose, true);
      if (error) return error;
    }
    if (step.heading?.kind === "turn" || step.heading?.kind === "yaw") {
      s.headingDone = Math.abs(s.turnRemaining) <= 1e-9;
      if (step.durationSeconds !== undefined && !s.headingDone) s.turnRate = Math.abs(s.turnRemaining) / step.durationSeconds;
    }
    if (step.move?.kind === "to" && step.durationSeconds !== undefined) {
      const seen = developTarget(s, s.moveTarget!, pose, false);
      if (seen && typeof seen !== "string") s.speed = Math.max(1e-3, (seen.distanceMeters - stopDistance(s, seen)) / step.durationSeconds);
    }
    return undefined;
  }

  /** Fixes the place of a point or relative target; checks that an object target exists. Returns an error text for a bad target. */
  function resolveFixedTarget(resolved: ResolvedTarget, pose: PlayerPose, forLooking: boolean): string | undefined {
    const { target } = resolved;
    if (target.kind === "point") {
      if (!env.world().cellsById.has(target.cellId)) return `unknown cell "${target.cellId}"`;
      resolved.place = { cellId: target.cellId, point: target.point, ...(target.hasHeight || !forLooking ? { aimHeight: target.point.z } : {}) };
      return undefined;
    }
    if (target.kind === "relative") {
      const cos = Math.cos(pose.yawRadians);
      const sin = Math.sin(pose.yawRadians);
      const developed = {
        x: pose.position.x + cos * target.right - sin * target.forward,
        y: pose.position.y + sin * target.right + cos * target.forward,
      };
      const located = locateDevelopedPoint(env.world(), pose.cellId, pose.position, developed);
      // Behind a wall the point stays in the start cell's frame, outside the cell; walking there ends stuck at the wall.
      const place = located.status === "end"
        ? { cellId: located.cellId, point: transformPoint3(located.cellFromStart, { x: developed.x, y: developed.y, z: pose.position.z }) }
        : { cellId: pose.cellId, point: { x: developed.x, y: developed.y, z: pose.position.z } };
      resolved.place = { ...place, aimHeight: pose.position.z + env.eyeHeightMeters + target.up };
      return undefined;
    }
    if (target.objectId === env.selfObjectId) return `"${target.objectId}" is the walker itself`;
    if (!env.locateObject(target.objectId)) return `unknown object "${target.objectId}"`;
    return undefined;
  }

  /** The target as seen now, or an error text ("unreachable: ...", "lost: ..."). Refreshes an object's place. */
  function developTarget(s: StepState, resolved: ResolvedTarget, pose: PlayerPose, forLooking: boolean): DevelopedTarget | string {
    if (resolved.target.kind === "object") {
      const location = env.locateObject(resolved.target.objectId);
      if (location) {
        resolved.place = {
          cellId: location.cellId,
          point: location.position,
          ...(location.radiusMeters !== undefined ? { radiusMeters: location.radiusMeters } : {}),
          aimHeight: location.position.z + (location.heightMeters !== undefined ? location.heightMeters / 2 : 0),
        };
      } else if (s.step.onTargetLost !== "lastKnown" || !resolved.place) {
        return `lost: object "${resolved.target.objectId}" no longer exists`;
      }
    }
    const place = resolved.place!;
    let route = resolved.route;
    if (!route || route.walkerCellId !== pose.cellId || route.targetCellId !== place.cellId || route.age >= ROUTE_REFRESH_SECONDS) {
      const found = findNearestImageRoute(env.world(), { cellId: pose.cellId, point: pose.position }, { cellId: place.cellId, point: place.point }, s.step.maxHops);
      if (!found) {
        resolved.route = undefined;
        return `unreachable: no straight route from cell "${pose.cellId}" to "${place.cellId}" through at most ${s.step.maxHops} portals`;
      }
      let targetFromWalker: RigidTransform3 = identityRigidTransform3;
      for (const hop of found.hops) targetFromWalker = composeRigidTransform3(hop.transformToTarget, targetFromWalker);
      route = {
        walkerCellId: pose.cellId,
        targetCellId: place.cellId,
        age: 0,
        walkerFromTarget: invertRigidTransform3(targetFromWalker),
        portalIds: found.hops.map((hop) => hop.sourcePortalId),
      };
      resolved.route = route;
    }
    const aimHeight = place.aimHeight ?? (forLooking ? pose.position.z + env.eyeHeightMeters : place.point.z);
    const local = transformPoint3(route.walkerFromTarget, { x: place.point.x, y: place.point.y, z: aimHeight });
    return describeDeveloped(place.cellId, local, route.portalIds, pose, env.eyeHeightMeters, place.radiusMeters);
  }

  function stopDistance(s: StepState, seen: DevelopedTarget): number {
    const move = s.step.move;
    if (move?.kind === "to" && move.stopAtMeters !== undefined) return move.stopAtMeters;
    if (move?.kind === "to" && move.target.kind === "object") {
      return seen.radiusMeters !== undefined ? seen.radiusMeters + env.walkerRadiusMeters + 0.2 : 0.5;
    }
    return 0.01;
  }

  /** Ends the current step with `status` and moves on; "failed" and "stopped" end the script. */
  function endStep(status: MotionStepStatus, pose: PlayerPose, reason?: string): void {
    const s = state!;
    s.report.status = status;
    if (reason !== undefined) s.report.reason = reason;
    s.report.endPose = poseReport(pose);
    if (status === "failed" || status === "stopped" || status === "cancelled") {
      finish(status === "failed" ? "failed" : status === "stopped" ? "stopped" : "cancelled", reason === undefined ? undefined : `step ${s.step.index}: ${reason}`);
      return;
    }
    let nextIndex = s.step.index + 1;
    if (nextIndex >= script.steps.length) {
      report.repetition += 1;
      if (report.repetition >= script.repeat) {
        finish("done");
        return;
      }
      nextIndex = 0;
    }
    report.stepIndex = nextIndex;
    state = createStepState(script.steps[nextIndex], report.repetition);
    report.steps.push(state.report);
    if (report.steps.length > MAX_STEP_REPORTS) report.steps.splice(0, report.steps.length - MAX_STEP_REPORTS);
  }

  function applyOutcome(outcome: MotionOutcome, pose: PlayerPose, reason: string): void {
    endStep(outcome === "fail" ? "failed" : outcome === "skip" ? "skipped" : "stopped", pose, reason);
  }

  function finish(status: Exclude<MotionStatus, "running">, reason?: string): void {
    report.status = status;
    if (reason !== undefined) report.reason = reason;
    state = undefined;
  }

  /** Classifies a target error and applies the matching policy. */
  function targetError(s: StepState, pose: PlayerPose, error: string): void {
    if (error.startsWith("lost:")) {
      const policy = s.step.onTargetLost;
      applyOutcome(policy === "lastKnown" ? "fail" : policy, pose, error);
    } else {
      applyOutcome(s.step.onUnreachable, pose, error);
    }
  }

  function tick(pose: PlayerPose): { pose: PlayerPose; move?: M } {
    const s = state;
    if (!s) return { pose };
    const dt = MOTION_TICK_SECONDS;
    if (!s.started) {
      const error = startStep(s, pose);
      if (error) {
        targetError(s, pose, error.startsWith("unknown object") ? `lost: ${error}` : error);
        return { pose };
      }
    }
    s.elapsed += dt;
    s.report.seconds = s.elapsed;
    report.elapsedSeconds += dt;
    if (s.moveTarget?.route) s.moveTarget.route.age += dt;
    if (s.lookTarget?.route) s.lookTarget.route.age += dt;

    const { step } = s;
    if (step.waitSeconds !== undefined) {
      if (s.elapsed + 1e-9 >= step.waitSeconds) endStep("done", pose);
      return { pose };
    }

    // --- Translation: goal direction (cell frame) and how far is left.
    let goal: { x: number; y: number } | undefined;
    let remaining = 0;
    if (!s.moveDone && step.move) {
      if (step.move.kind === "to") {
        const seen = developTarget(s, s.moveTarget!, pose, false);
        if (typeof seen === "string") {
          targetError(s, pose, seen);
          return { pose };
        }
        const stopAt = stopDistance(s, seen);
        if (seen.distanceMeters <= stopAt + 1e-3) {
          s.moveDone = true;
        } else {
          const dx = seen.local.x - pose.position.x;
          const dy = seen.local.y - pose.position.y;
          goal = { x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) };
          remaining = seen.distanceMeters - stopAt;
        }
      } else {
        remaining = s.walkTotal - s.walked;
        if (remaining <= 1e-4) {
          s.moveDone = true;
        } else {
          const angle = pose.yawRadians + s.walkAngle - (step.move.frame === "start" ? s.turned : 0);
          goal = { x: -Math.sin(angle), y: Math.cos(angle) };
        }
      }
    }

    // The direction actually walked: the goal, or the back-up / detour direction of the stuck handling.
    let walkDirection = goal;
    let speedLimit = s.speed;
    const phase = s.phase;
    if (goal && phase.kind === "pause") {
      walkDirection = undefined;
      phase.remainingSeconds -= dt;
      if (phase.remainingSeconds <= 0) s.phase = { kind: "normal" };
    } else if (goal && (phase.kind === "backUp" || phase.kind === "detour")) {
      const angle = pose.yawRadians + phase.directionBody;
      walkDirection = { x: -Math.sin(angle), y: Math.cos(angle) };
      speedLimit = Math.min(s.speed, phase.remainingMeters / dt);
    }

    // --- Heading.
    let yawStep = 0;
    let pitchStep = 0;
    const maxTurn = s.turnRate * dt;
    let pitchGoal = step.pitchDegrees === undefined ? undefined : (step.pitchDegrees * Math.PI) / 180;
    if (step.heading?.kind === "turn" || step.heading?.kind === "yaw") {
      yawStep = clamp(s.turnRemaining, maxTurn);
      s.turnRemaining -= yawStep;
      if (Math.abs(s.turnRemaining) <= 1e-9) s.headingDone = true;
    } else if (step.heading?.kind === "lookAt") {
      const seen = developTarget(s, s.lookTarget!, pose, true);
      if (typeof seen === "string") {
        targetError(s, pose, seen);
        return { pose };
      }
      yawStep = clamp(seen.bearingRadians, maxTurn);
      pitchGoal ??= clampPitch(seen.elevationRadians);
      s.headingDone = Math.abs(seen.bearingRadians - yawStep) <= ALIGNED_RADIANS;
    } else if (step.heading?.kind === "faceMotion" && walkDirection && phase.kind !== "backUp") {
      const error = wrapAngle(Math.atan2(-walkDirection.x, walkDirection.y) - pose.yawRadians);
      yawStep = clamp(error, maxTurn);
      // Turn on the spot first; walk at full speed only when facing the way.
      speedLimit *= Math.max(0, Math.cos(error - yawStep));
    }
    if (pitchGoal !== undefined) {
      pitchStep = clamp(pitchGoal - pose.pitchRadians, maxTurn);
      const pitchAligned = Math.abs(pitchGoal - pose.pitchRadians - pitchStep) <= ALIGNED_RADIANS;
      if (step.pitchDegrees !== undefined) s.pitchDone = pitchAligned;
      else if (step.heading?.kind === "lookAt") s.headingDone = s.headingDone && pitchAligned;
    }

    // --- Displacement this tick, cell frame.
    let length = 0;
    if (walkDirection) {
      length = Math.max(0, speedLimit * dt);
      if (phase.kind === "normal") length = Math.min(length, remaining);
    }
    const newYaw = pose.yawRadians + yawStep;
    const dx = walkDirection ? walkDirection.x * length : 0;
    const dy = walkDirection ? walkDirection.y * length : 0;
    const cos = Math.cos(newYaw);
    const sin = Math.sin(newYaw);
    const request: MotionMoveRequest = {
      localDisplacement: { x: cos * dx + sin * dy, y: -sin * dx + cos * dy, z: 0 },
      yawDeltaRadians: yawStep,
      pitchDeltaRadians: pitchStep,
    };
    if (length === 0 && yawStep === 0 && pitchStep === 0) {
      return finishTick(s, pose, undefined);
    }
    const move = env.move(pose, request);
    s.turned += yawStep;
    const applied = move.appliedDisplacement;
    s.report.distanceMeters += Math.hypot(applied.x, applied.y);
    for (const crossing of move.crossings) s.report.portals.push(crossing.portalId);
    if (move.blocked) {
      const by = move.blockingObjectId !== undefined ? `object ${move.blockingObjectId}` : move.blockingReason;
      if (by !== undefined) s.report.blockedBy = by;
    }

    // --- Progress toward the goal and stuck handling.
    if (goal && walkDirection) {
      const progress = applied.x * goal.x + applied.y * goal.y;
      const along = applied.x * walkDirection.x + applied.y * walkDirection.y;
      if (step.move?.kind === "walk" && phase.kind === "normal") s.walked += progress;
      s.netProgress += progress;
      if (s.attempts > 0 && s.netProgress - s.stuckMark >= step.onStuck.resetAfterMeters) {
        s.attempts = 0;
        s.stuckMark = s.netProgress;
      }
      if (phase.kind === "backUp" || phase.kind === "detour") {
        phase.remainingMeters -= Math.max(along, 0);
        if (phase.remainingMeters <= 1e-3) {
          s.phase = phase.kind === "backUp" && phase.then === "pause"
            ? { kind: "pause", remainingSeconds: step.onStuck.pauseSeconds }
            : phase.kind === "backUp"
              ? probeDetour(s, move.pose, rotateIntoPose(goal, pose, move.pose))
              : { kind: "normal" };
        }
      }
      const expected = phase.kind === "normal" || phase.kind === "detour" ? length : 0;
      s.windowExpected += expected;
      s.windowProgress += phase.kind === "normal" ? progress : Math.max(along, 0);
    }
    s.windowTime += dt;
    if (s.windowTime >= STUCK_WINDOW_SECONDS) {
      const stuck = s.windowExpected >= STUCK_MIN_EXPECTED_METERS && s.windowProgress < STUCK_PROGRESS_FRACTION * s.windowExpected;
      s.windowTime = 0;
      s.windowProgress = 0;
      s.windowExpected = 0;
      if (stuck && goal) {
        if (!handleStuck(s, move.pose, rotateIntoPose(goal, pose, move.pose))) return { pose: move.pose, move };
      }
    }
    return finishTick(s, move.pose, move);
  }

  /** Expresses a cell-frame direction of `before`'s cell in `after`'s cell (they differ when a portal was crossed): via the change of yaw. */
  function rotateIntoPose(direction: { x: number; y: number }, before: PlayerPose, after: PlayerPose): { x: number; y: number } {
    const turn = after.yawRadians - before.yawRadians;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { x: cos * direction.x - sin * direction.y, y: sin * direction.x + cos * direction.y };
  }

  /** Reacts to a stuck window by the step's policy; returns false when the step ended. */
  function handleStuck(s: StepState, pose: PlayerPose, goal: { x: number; y: number }): boolean {
    const policy = s.step.onStuck;
    s.report.stuckEvents += 1;
    s.stuckMark = Math.max(s.stuckMark, s.netProgress);
    const blocked = s.report.blockedBy !== undefined ? ` (blocked by ${s.report.blockedBy})` : "";
    if (policy.strategy === "none" || s.attempts >= policy.attempts) {
      applyOutcome(policy.then, pose, `stuck${blocked} after ${s.attempts} attempt(s)`);
      return false;
    }
    s.attempts += 1;
    const goalBody = wrapAngle(Math.atan2(-goal.x, goal.y) - pose.yawRadians);
    if (policy.strategy === "retry") {
      s.report.retries += 1;
      s.phase = policy.backUpMeters > 0
        ? { kind: "backUp", remainingMeters: policy.backUpMeters, then: "pause", directionBody: wrapAngle(goalBody + Math.PI) }
        : { kind: "pause", remainingSeconds: policy.pauseSeconds };
      return true;
    }
    s.phase = probeDetour(s, pose, goal);
    return true;
  }

  /** Probes directions around the goal and starts a detour along the first free one; backs up first when none is free. */
  function probeDetour(s: StepState, pose: PlayerPose, goal: { x: number; y: number }): Phase {
    const policy = s.step.onStuck;
    const goalAngle = Math.atan2(-goal.x, goal.y);
    const sides = s.detourSide === 0 ? [1, -1] : [s.detourSide, -s.detourSide];
    for (const offset of DETOUR_OFFSETS) {
      for (const side of sides) {
        const angle = goalAngle + side * offset;
        if (probeFree(pose, angle, policy.detourMeters)) {
          s.detourSide = side;
          s.report.detours += 1;
          return { kind: "detour", remainingMeters: policy.detourMeters, directionBody: wrapAngle(angle - pose.yawRadians) };
        }
      }
    }
    // Wedged: step back from the goal, then probe again.
    return policy.backUpMeters > 0
      ? { kind: "backUp", remainingMeters: policy.backUpMeters, then: "probe", directionBody: wrapAngle(goalAngle + Math.PI - pose.yawRadians) }
      : { kind: "normal" };
  }

  /** Whether walking `meters` in cell-frame direction `angle` (yaw convention) from `pose` gets nearly all the way, by trial moves only. */
  function probeFree(pose: PlayerPose, angle: number, meters: number): boolean {
    const pieces = 4;
    let probe = pose;
    let along = 0;
    let direction = { x: -Math.sin(angle), y: Math.cos(angle) };
    for (let i = 0; i < pieces; i += 1) {
      const cos = Math.cos(probe.yawRadians);
      const sin = Math.sin(probe.yawRadians);
      const dx = direction.x * (meters / pieces);
      const dy = direction.y * (meters / pieces);
      const result = env.move(probe, { localDisplacement: { x: cos * dx + sin * dy, y: -sin * dx + cos * dy, z: 0 }, yawDeltaRadians: 0, pitchDeltaRadians: 0 });
      along += result.appliedDisplacement.x * direction.x + result.appliedDisplacement.y * direction.y;
      direction = rotateIntoPose(direction, probe, result.pose);
      probe = result.pose;
    }
    return along >= DETOUR_FREE_FRACTION * meters;
  }

  function finishTick(s: StepState, pose: PlayerPose, move: M | undefined): { pose: PlayerPose; move?: M } {
    if (state !== s) return { pose, ...(move ? { move } : {}) };
    const { step } = s;
    const durationReached = step.durationSeconds === undefined || s.elapsed + 1e-9 >= step.durationSeconds;
    const present: boolean[] = [];
    if (step.move) present.push(s.moveDone);
    if (step.heading && step.heading.kind !== "faceMotion") present.push(s.headingDone);
    if (step.pitchDegrees !== undefined) present.push(s.pitchDone);
    const done = step.until === "move" && step.move
      ? s.moveDone
      : step.until === "heading" && step.heading && step.heading.kind !== "faceMotion"
        ? s.headingDone
        : step.until === "any"
          ? present.some(Boolean)
          : present.every(Boolean);
    if (done && durationReached) {
      endStep("done", pose);
    } else if (s.elapsed >= step.timeoutSeconds) {
      applyOutcome(step.onTimeout, pose, `timeout after ${step.timeoutSeconds} s`);
    }
    return { pose, ...(move ? { move } : {}) };
  }

  return {
    get finished() {
      return report.status !== "running";
    },
    advance(pose, deltaSeconds) {
      const moves: M[] = [];
      accumulator += Math.max(0, deltaSeconds);
      let ticks = 0;
      let current = pose;
      while (accumulator + 1e-12 >= MOTION_TICK_SECONDS && ticks < MAX_TICKS_PER_ADVANCE && state) {
        accumulator -= MOTION_TICK_SECONDS;
        ticks += 1;
        const result = tick(current);
        current = result.pose;
        if (result.move) moves.push(result.move);
      }
      if (ticks === MAX_TICKS_PER_ADVANCE) accumulator = 0;
      return { pose: current, moves };
    },
    tick,
    cancel(reason, pose) {
      if (!state) return;
      state.report.status = "cancelled";
      state.report.reason = reason;
      if (pose) state.report.endPose = poseReport(pose);
      finish("cancelled", reason);
    },
    report() {
      return structuredClone(report);
    },
  };
}

/**
 * Where `target` is as seen from `pose`: its nearest image through at most `maxHops` portals, in the walker's frame.
 * Returns an error text when the object does not exist or no straight route reaches it. Used by `motion.locate`.
 */
export function locateMotionTarget(
  env: Pick<MotionEnvironment, "world" | "locateObject" | "eyeHeightMeters">,
  pose: PlayerPose,
  target: MotionTarget,
  maxHops: number,
): DevelopedTarget | string {
  let place: CellPoint & { radiusMeters?: number };
  let aimHeight: number;
  if (target.kind === "object") {
    const location = env.locateObject(target.objectId);
    if (!location) return `unknown object "${target.objectId}"`;
    place = { cellId: location.cellId, point: location.position, ...(location.radiusMeters !== undefined ? { radiusMeters: location.radiusMeters } : {}) };
    aimHeight = location.position.z + (location.heightMeters ?? 0) / 2;
  } else if (target.kind === "point") {
    if (!env.world().cellsById.has(target.cellId)) return `unknown cell "${target.cellId}"`;
    place = { cellId: target.cellId, point: target.point };
    aimHeight = target.hasHeight ? target.point.z : pose.position.z + env.eyeHeightMeters;
  } else {
    return "a relative target is already given relative to the walker";
  }
  const found = findNearestImageRoute(env.world(), { cellId: pose.cellId, point: pose.position }, place, maxHops);
  if (!found) return `unreachable: no straight route from cell "${pose.cellId}" to "${place.cellId}" through at most ${maxHops} portals`;
  let targetFromWalker: RigidTransform3 = identityRigidTransform3;
  for (const hop of found.hops) targetFromWalker = composeRigidTransform3(hop.transformToTarget, targetFromWalker);
  const local = transformPoint3(invertRigidTransform3(targetFromWalker), { x: place.point.x, y: place.point.y, z: aimHeight });
  return describeDeveloped(place.cellId, local, found.hops.map((hop) => hop.sourcePortalId), pose, env.eyeHeightMeters, place.radiusMeters);
}

function describeDeveloped(
  cellId: string,
  local: Vec3,
  portalIds: readonly string[],
  pose: PlayerPose,
  eyeHeightMeters: number,
  radiusMeters: number | undefined,
): DevelopedTarget {
  const dx = local.x - pose.position.x;
  const dy = local.y - pose.position.y;
  const distanceMeters = Math.hypot(dx, dy);
  return {
    cellId,
    local,
    portalIds,
    distanceMeters,
    bearingRadians: distanceMeters <= 1e-9 ? 0 : wrapAngle(Math.atan2(-dx, dy) - pose.yawRadians),
    elevationRadians: Math.atan2(local.z - (pose.position.z + eyeHeightMeters), Math.max(distanceMeters, 1e-9)),
    ...(radiusMeters !== undefined ? { radiusMeters } : {}),
  };
}

/** Pose in report units (meters, degrees), rounded. */
export function poseReport(pose: PlayerPose): MotionPoseReport {
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return {
    cellId: pose.cellId,
    position: { x: round(pose.position.x), y: round(pose.position.y), z: round(pose.position.z) },
    yawDegrees: round((pose.yawRadians * 180) / Math.PI),
    pitchDegrees: round((pose.pitchRadians * 180) / Math.PI),
  };
}

/** Angle in (-pi, pi]. */
function wrapAngle(radians: number): number {
  const wrapped = radians - 2 * Math.PI * Math.round(radians / (2 * Math.PI));
  return wrapped <= -Math.PI ? wrapped + 2 * Math.PI : wrapped;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function clampPitch(radians: number): number {
  return clamp(radians, MAX_PITCH_RADIANS);
}
