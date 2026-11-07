/**
 * Motion of the simple geodesic creatures (the mouse and the butterfly), with no renderer: the state a creature owns, how it advances each frame, and how it follows geometry changes.
 * Each creature owns an invisible leader that walks its geodesic exactly with the segment-walk kernel, at the spec speed, every frame: the leader is authoritative, and nothing the creature meets slows or turns it. The leader leaves a trail (one straight piece per cell it crosses). The creature steers toward a chase point on that trail, at most `creatureLeashMeters` ahead of it along the trail and never past the leader, plus a sinusoidal sideways wobble (faded out near forbidden zones around portal junction vertices) and, for butterflies, a bounded vertical bob, with swept collision against walls, forbidden zones and other bodies. So a blocked creature goes round the obstacle, then catches up with the leader along its trail, at up to `creatureCatchUpFactor` times its speed; a detour around a forbidden zone keeps the zone's vertex on the side the geodesic passes it.
 * Units are meters, seconds and radians; positions and displacements are in the current cell's local frame (x right, y forward, z up). The behavior registers its record in the runtime object registry and publishes every change of its pose there; the Three.js model that shows it lives in `render/three/creatures/simpleGeoCreatureView`.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import type { SimpleGeoCreatureObjectSpec } from "../../cell-complex/specs";
import { walkDevelopedSegment } from "../../cell-complex/segmentWalk";
import { transformPoseWithCellMaps, type CellDeformationMap } from "../../cell-complex/worldGeometryDeformations";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  orthonormalizeYawRigidTransform3,
  transformDirection3,
  yawRigidTransform3,
  type RigidTransform3,
} from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import { getDynamicObjectCollisionBounds, testCellCollision } from "../../movement/collision";
import { depenetrateDynamicObject } from "../../movement/depenetrateDynamicObject";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import {
  AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
  moveDynamicObject,
} from "../../movement/moveDynamicObject";
import { createSimpleGeoCreatureRuntimeObject } from "../simpleGeoCreature";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import type { RuntimeCreatureObject } from "../runtimeObjectBase";
import { runtimeObjectToDynamicObjectState } from "../runtimeObjectBase";
import type { WorldObjectOwner } from "../worldObjectOwner";

/**
 * The motion state of one creature, owned by its view.
 * `state` is the current cell, pose and collision shape (cell-local, meters, radians); `cellId` reports the creature's current cell.
 */
export interface SimpleGeoCreatureBehavior extends WorldObjectOwner {
  readonly objectId: string;
  readonly cellId: string;
  /** Current cell, pose and collision shape; replaced (not mutated) by every update. */
  readonly state: DynamicObjectState;
  /** Advances the creature by `deltaSeconds`; `obstacles` are collision states (same-cell ones are tested) that the creature will not move into. No-op for non-positive `deltaSeconds`. */
  update(world: CompiledCellComplex, deltaSeconds: number, obstacles?: readonly DynamicObjectState[]): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped; when `nextWorld` is given, both poses are then pushed out of obstacles in it. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
  /** The invisible leader and the map from its cell frame to the creature's cell frame (for tests and debugging). */
  leaderForDebug(): { readonly cellId: string; readonly localPose: RigidTransform3; readonly creatureFromLeader: RigidTransform3 };
  /** Restores the initial (possibly deformation-remapped) pose and oscillation phases. */
  reset(): void;
}

/**
 * The chase point that the creature steers to runs at most this many meters ahead of the creature along the leader's trail (sideways distance does not count, so a creature going wide round a forbidden zone does not hold it back). It only shapes the creature's motion: the leader never waits.
 */
export const creatureLeashMeters = 0.5;
/** The creature may move toward its chase point at up to this multiple of its speed, so it catches up with the leader after a detour. */
const creatureCatchUpFactor = 1.5;
/** Margin added to the sum of radii when deciding that a creature touches a forbidden zone, in meters. */
const forbiddenZoneContactMarginMeters = 1e-5;
const tau = Math.PI * 2;
const butterflyVerticalRateBucketSeconds = 0.1;
const butterflyVerticalRateMinHz = 0.85;
const butterflyVerticalRateMaxHz = 2;
const butterflyVerticalRateMinMultiplier = 1.31;
const butterflyVerticalRateMaxMultiplier = 1.73;
const butterflyVerticalMagnitudeFractionOfHeight = 0.1;
const butterflyVerticalMagnitudeMaxMeters = 0.08;
const forbiddenZoneLateralStopClearanceMeters = 0.5;
const forbiddenZoneLateralFadeMeters = 0.5;

/** One straight piece of a leader's trail: the part of its geodesic in one cell. */
interface TrailPiece {
  readonly cellId: string;
  /** Arc length along the geodesic where the piece starts, meters. */
  readonly startMeters: number;
  /** The leader's pose where the piece starts, in the cell's frame. */
  readonly start: RigidTransform3;
  /** Map from the previous piece's cell frame to this piece's cell frame (the portal crossing); identity for the first piece. */
  readonly fromPrevious: RigidTransform3;
}

/** The pose on a trail piece at arc length `meters`, in the piece's cell frame. */
function poseOnTrailPiece(piece: TrailPiece, meters: number): RigidTransform3 {
  const forward = transformDirection3(piece.start, vec3(0, 1, 0));
  const along = meters - piece.startMeters;

  return {
    rotation: piece.start.rotation,
    translation: vec3(
      piece.start.translation.x + forward.x * along,
      piece.start.translation.y + forward.y * along,
      piece.start.translation.z,
    ),
  };
}

/**
 * Creates the behavior for a creature starting in `startCellId`.
 * Registers the object in `registry` when given (throwing if the id already exists) and claims ownership of its registry record, so only the creature itself writes the record afterwards; `place` (the `WorldObjectOwner` placement command), `reset` and `transformGeometry` re-seed the leader on the creature. The leader advances at the spec speed along its forward axis exactly on the geodesic every frame; the creature moves toward a chase point on the leader's trail plus the lateral wobble and butterfly bob, so with nothing in the way the chase point is the leader and the creature's path is the geodesic plus a bounded oscillation, and after a detour it catches up along the trail and returns to the same geodesic.
 */
export function createSimpleGeoCreatureBehavior(
  objectSpec: SimpleGeoCreatureObjectSpec,
  startCellId: string,
  registry?: RuntimeObjectRegistry,
): SimpleGeoCreatureBehavior {
  const initialObject = createSimpleGeoCreatureRuntimeObject(objectSpec, startCellId);
  registry?.add(initialObject);
  const publish = registry ? registry.claimOwnership(objectSpec.id) : (): void => {};
  let record: RuntimeCreatureObject = initialObject;
  let initialState = runtimeObjectToDynamicObjectState(initialObject);
  let state = initialState;
  let elapsedSeconds = 0;
  let lastLateralOffsetMeters = 0;
  let verticalOscillationPhaseRadians = initialButterflyVerticalOscillationPhaseRadians(objectSpec);
  // The bob is measured from its value at the start, so the creature starts at its authored height.
  let verticalBaselineMeters = butterflyVerticalOscillationHeightOffset(objectSpec, verticalOscillationPhaseRadians);
  // The leader's trail from the chase point to the leader: pieces of the geodesic, one per cell, at arc lengths (meters along the geodesic) from the last seeding.
  // `leaderMeters` is the leader's arc length, so the leader is at the end of the last piece. The chase point is at `chaseMeters` on the first piece, and
  // `creatureFromChase` maps that piece's cell frame to the creature's cell frame along the paths actually walked (the trail's crossings and the creature's).
  let trail: TrailPiece[] = [];
  let leaderMeters = 0;
  let chaseMeters = 0;
  let creatureFromChase: RigidTransform3 = identityRigidTransform3;
  let warnedLeaderWalk = false;
  // Set when the last step stopped at a forbidden zone because the chase point lies a little behind round it; the chase point then moves on whatever the leash says.
  let waitingForChase = false;
  const seedLeaderOnCreature = (): void => {
    trail = [{ cellId: state.cellId, startMeters: 0, start: state.localPose, fromPrevious: identityRigidTransform3 }];
    leaderMeters = 0;
    chaseMeters = 0;
    creatureFromChase = identityRigidTransform3;
    waitingForChase = false;
  };
  seedLeaderOnCreature();
  const publishState = (): void => {
    record = { ...record, cellId: state.cellId, localPose: state.localPose, collision: state.collision };
    publish(record);
  };
  const lastTrailPiece = (): TrailPiece => trail[trail.length - 1];
  // Walks the leader `lengthMeters` on along its geodesic and adds a trail piece for each cell it enters.
  const advanceLeader = (world: CompiledCellComplex, lengthMeters: number): void => {
    const pose = poseOnTrailPiece(lastTrailPiece(), leaderMeters);
    const direction = transformDirection3(pose, vec3(0, 1, 0));
    const walk = walkDevelopedSegment({
      world,
      cellId: lastTrailPiece().cellId,
      start: { x: pose.translation.x, y: pose.translation.y },
      direction: { x: direction.x, y: direction.y },
      lengthMeters,
    });

    if (walk.status !== "end" || walk.pieces.length === 0) {
      if (!warnedLeaderWalk) {
        warnedLeaderWalk = true;
        console.warn(`Creature "${objectSpec.id}": leader walk ended with status "${walk.status}"; the leader stays put.`);
      }
      return;
    }

    for (let index = 1; index < walk.pieces.length; index += 1) {
      const piece = walk.pieces[index];
      const entered: RigidTransform3 = {
        rotation: pose.rotation,
        translation: vec3(
          pose.translation.x + direction.x * piece.tEnter,
          pose.translation.y + direction.y * piece.tEnter,
          pose.translation.z,
        ),
      };
      trail.push({
        cellId: piece.cellId,
        startMeters: leaderMeters + piece.tEnter,
        start: orthonormalizeYawRigidTransform3(composeRigidTransform3(piece.cellFromStart, entered)),
        fromPrevious: orthonormalizeYawRigidTransform3(
          composeRigidTransform3(piece.cellFromStart, invertRigidTransform3(walk.pieces[index - 1].cellFromStart)),
        ),
      });
    }
    leaderMeters += lengthMeters;
  };
  // Moves the chase point to arc length `meters` (never past the leader) and drops the trail behind it.
  const moveChaseTo = (meters: number): void => {
    chaseMeters = Math.min(Math.max(meters, chaseMeters), leaderMeters);
    let passed = 0;

    while (passed + 1 < trail.length && chaseMeters >= trail[passed + 1].startMeters) {
      passed += 1;
      creatureFromChase = orthonormalizeYawRigidTransform3(
        composeRigidTransform3(creatureFromChase, invertRigidTransform3(trail[passed].fromPrevious)),
      );
    }
    trail = trail.slice(passed);
  };
  // The chase point's pose in the creature's cell frame.
  const chasePose = (): RigidTransform3 => composeRigidTransform3(creatureFromChase, poseOnTrailPiece(trail[0], chaseMeters));

  return {
    objectId: objectSpec.id,
    id: objectSpec.id,
    get cellId() {
      return state.cellId;
    },
    get state() {
      return state;
    },
    update(world, deltaSeconds, obstacles = []) {
      if (deltaSeconds <= 0) {
        return;
      }

      elapsedSeconds += deltaSeconds;
      const stepMeters = objectSpec.speedMetersPerSecond * deltaSeconds;
      const cell = world.cellsById.get(state.cellId);
      // Wobble offsets are values (not increments); scaled down near forbidden zones so the wobble cannot push the body into them.
      const lateralOffsetMeters = lateralOscillationOffset(objectSpec, elapsedSeconds) *
        (cell ? forbiddenZoneLateralOscillationScale(cell, state) : 1);
      const lateralStepMeters = Math.abs(lateralOffsetMeters - lastLateralOffsetMeters);
      lastLateralOffsetMeters = lateralOffsetMeters;
      verticalOscillationPhaseRadians += butterflyVerticalOscillationRateHz(objectSpec, elapsedSeconds) * tau * deltaSeconds;
      const verticalOffsetMeters =
        butterflyVerticalOscillationHeightOffset(objectSpec, verticalOscillationPhaseRadians) - verticalBaselineMeters;

      // The leader is authoritative: it walks on whatever happens to the creature.
      advanceLeader(world, stepMeters);

      // The chase point moves on until it is a leash ahead of where the creature can get this frame, along the trail (the trail is straight in the
      // creature's frame, so that distance grows one for one with arc length), or on by a catch-up step while the creature waits at a zone for it to come round.
      const chaseLeadMeters = (): number => {
        const pose = chasePose();
        const forward = transformDirection3(pose, vec3(0, 1, 0));
        const anchor = state.localPose.translation;

        return forward.x * (pose.translation.x - anchor.x) + forward.y * (pose.translation.y - anchor.y);
      };
      moveChaseTo(
        Math.max(
          chaseMeters + creatureLeashMeters + creatureCatchUpFactor * stepMeters - chaseLeadMeters(),
          waitingForChase ? chaseMeters + creatureCatchUpFactor * stepMeters : chaseMeters,
        ),
      );

      // The target is the chase point plus the wobble.
      const targetOf = (): { readonly x: number; readonly y: number; readonly z: number } => {
        const pose = chasePose();
        const right = transformDirection3(pose, vec3(1, 0, 0));

        return {
          x: pose.translation.x + right.x * lateralOffsetMeters,
          y: pose.translation.y + right.y * lateralOffsetMeters,
          z: pose.translation.z + verticalOffsetMeters,
        };
      };
      const lagMeters = (): number => {
        const target = targetOf();
        const anchor = state.localPose.translation;

        return Math.hypot(target.x - anchor.x, target.y - anchor.y);
      };

      const target = targetOf();
      const anchor = state.localPose.translation;
      let desiredX = target.x - anchor.x;
      let desiredY = target.y - anchor.y;
      const desiredLength = Math.hypot(desiredX, desiredY);
      const capMeters = creatureCatchUpFactor * stepMeters + lateralStepMeters;

      if (desiredLength > capMeters && desiredLength > 0) {
        desiredX *= capMeters / desiredLength;
        desiredY *= capMeters / desiredLength;
      }

      // Detour around a forbidden zone on the side the geodesic passes its vertex.
      let ruleApplied = false;
      waitingForChase = false;
      const bounds = getDynamicObjectCollisionBounds(state);

      if (cell && bounds && cell.singularityColumns.length > 0) {
        const geodesicPose = chasePose();
        const geodesicForward = transformDirection3(geodesicPose, vec3(0, 1, 0));
        const sideRule = applyForbiddenZoneSideRuleToColumns(
          { x: desiredX, y: desiredY },
          { x: bounds.center.x, y: bounds.center.y },
          bounds.radius,
          cell.singularityColumns,
          { x: geodesicPose.translation.x, y: geodesicPose.translation.y },
          { x: geodesicForward.x, y: geodesicForward.y },
          Math.max(desiredLength, stepMeters),
          { x: anchor.x, y: anchor.y },
          { x: target.x, y: target.y },
        );

        desiredX = sideRule.displacement.x;
        desiredY = sideRule.displacement.y;
        ruleApplied = sideRule.applied;
        waitingForChase = sideRule.waiting;
      }

      const result = moveDynamicObject({
        world,
        object: state,
        displacement: vec3(desiredX, desiredY, target.z - anchor.z),
        portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
        bodiesInCell: (cellId) => obstacles.filter((obstacle) => obstacle.cellId === cellId),
      });
      // Obstacle bodies (the player) are swept discs in the move, so the creature slides around them.
      creatureFromChase = orthonormalizeYawRigidTransform3(composeRigidTransform3(result.cellFromStart, creatureFromChase));
      state = result.object;

      // A body that stands inside a forbidden zone or wall rejects every step (even one that leads out), so it would stay there for good; push it out. A push through a portal is not taken: it would change the cell under the chase point's frame map.
      if (result.blocked && Math.hypot(result.appliedDisplacement.x, result.appliedDisplacement.y) < 1e-9) {
        const pushed = depenetrateDynamicObject(world, state).object;

        if (pushed.cellId === state.cellId) {
          state = pushed;
        }
      }

      // Heading: the geodesic's when the creature is on its way, else the direction of the last applied step. Turning swings the collision cylinder (its centre is offset from the origin), so the turn is limited to what the cell allows.
      if (lagMeters() < 1e-4 || (!result.blocked && !ruleApplied)) {
        state = {
          ...state,
          localPose: turnWithoutOverlap(world, state, {
            rotation: chasePose().rotation,
            translation: state.localPose.translation,
          }),
        };
      } else {
        const applied = transformDirection3(result.cellFromStart, result.appliedDisplacement);

        if (Math.hypot(applied.x, applied.y) > 1e-6) {
          state = {
            ...state,
            localPose: turnWithoutOverlap(world, state, yawRigidTransform3(Math.atan2(-applied.x, applied.y), state.localPose.translation)),
          };
        }
      }

      publishState();
    },
    place(cellId, localPose) {
      state = { ...state, cellId, localPose };
      seedLeaderOnCreature();
      lastLateralOffsetMeters = 0;
      publishState();
    },
    leaderForDebug() {
      let creatureFromLeader = creatureFromChase;

      for (const piece of trail.slice(1)) {
        creatureFromLeader = composeRigidTransform3(creatureFromLeader, invertRigidTransform3(piece.fromPrevious));
      }
      return { cellId: lastTrailPiece().cellId, localPose: poseOnTrailPiece(lastTrailPiece(), leaderMeters), creatureFromLeader };
    },
    transformGeometry(mapByCellId, nextWorld) {
      const transformedState = transformPoseWithCellMaps(state, mapByCellId);
      const transformedInitialState = transformPoseWithCellMaps(initialState, mapByCellId);
      if (!transformedState || !transformedInitialState) {
        return;
      }

      state = {
        ...state,
        cellId: transformedState.cellId,
        localPose: transformedState.localPose,
      };
      initialState = {
        ...initialState,
        cellId: transformedInitialState.cellId,
        localPose: transformedInitialState.localPose,
      };
      if (nextWorld) {
        state = depenetrateDynamicObject(nextWorld, state).object;
        initialState = depenetrateDynamicObject(nextWorld, initialState).object;
      }
      seedLeaderOnCreature();
      publishState();
    },
    reset() {
      elapsedSeconds = 0;
      lastLateralOffsetMeters = 0;
      verticalOscillationPhaseRadians = initialButterflyVerticalOscillationPhaseRadians(objectSpec);
      verticalBaselineMeters = butterflyVerticalOscillationHeightOffset(objectSpec, verticalOscillationPhaseRadians);
      state = initialState;
      seedLeaderOnCreature();
      publishState();
    },
  };
}

/**
 * Returns `target` (the creature's pose turned to a new heading at the same position) when the turned body is clear of the cell's zones and walls, else the largest of half, a quarter, an eighth and a sixteenth of the turn that is clear, else the current pose.
 * The collision cylinder's centre is offset from the pose origin and the offset turns with the pose, so a heading change moves the cylinder and has to be tested like a step.
 */
function turnWithoutOverlap(world: CompiledCellComplex, state: DynamicObjectState, target: RigidTransform3): RigidTransform3 {
  const cell = world.cellsById.get(state.cellId);

  if (!cell || !state.collision) {
    return target;
  }

  const overlaps = (pose: RigidTransform3): boolean => testCellCollision({ cell, object: { ...state, localPose: pose } }).blocked;

  if (!overlaps(target)) {
    return target;
  }

  const yawOf = (pose: RigidTransform3): number => {
    const forward = transformDirection3(pose, vec3(0, 1, 0));

    return Math.atan2(-forward.x, forward.y);
  };
  const from = yawOf(state.localPose);
  const turn = Math.atan2(Math.sin(yawOf(target) - from), Math.cos(yawOf(target) - from));

  for (let fraction = 0.5; fraction >= 1 / 16; fraction /= 2) {
    const pose = yawRigidTransform3(from + turn * fraction, state.localPose.translation);

    if (!overlaps(pose)) {
      return pose;
    }
  }

  return state.localPose;
}

function lateralOscillationOffset(objectSpec: SimpleGeoCreatureObjectSpec, elapsedSeconds: number): number {
  if (objectSpec.oscillationRateHz <= 0 || objectSpec.oscillationMagnitudeMeters <= 0) {
    return 0;
  }

  return Math.sin(elapsedSeconds * objectSpec.oscillationRateHz * tau) * objectSpec.oscillationMagnitudeMeters;
}

/**
 * Sign of the side on which the point `v` lies relative to the oriented line through `leaderPoint` with direction `leaderForward`: +1 when `v` is to the left, -1 when it is to the right.
 * A point on the line (|cross| <= 1e-9) counts as to the right, matching the segment-walk vertex tie rule that passes a vertex on the line with the vertex on the right.
 */
export function geodesicSideOfPoint(
  leaderPoint: { readonly x: number; readonly y: number },
  leaderForward: { readonly x: number; readonly y: number },
  v: { readonly x: number; readonly y: number },
): 1 | -1 {
  const cross = leaderForward.x * (v.y - leaderPoint.y) - leaderForward.y * (v.x - leaderPoint.x);

  return cross > 1e-9 ? 1 : -1;
}

/**
 * Replaces a desired horizontal displacement that would run into a zone disc by one that goes round the disc with the zone centre on the required side.
 * `desired` is the displacement of the body centre `center`; `zoneCenter` and `contactRadius` (body radius + zone radius + 1e-5 m) describe the disc; `side` is +1 when the zone centre must stay on the left of the motion and -1 for the right. The new displacement keeps the length of `desired`. At the contact point with outward normal n, the tangent is n turned +90 degrees for side +1 and -90 degrees for side -1.
 */
export function applyForbiddenZoneSideRule(
  desired: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  zoneCenter: { readonly x: number; readonly y: number },
  contactRadius: number,
  side: 1 | -1,
): { readonly x: number; readonly y: number } {
  const length = Math.hypot(desired.x, desired.y);
  const d0 = { x: center.x - zoneCenter.x, y: center.y - zoneCenter.y };
  const a = length * length;
  const hit = zoneHitFraction(desired, d0, contactRadius);

  if (hit === undefined || a === 0) {
    return desired;
  }

  const qx = d0.x + desired.x * hit;
  const qy = d0.y + desired.y * hit;
  const qLength = Math.hypot(qx, qy);

  if (qLength < 1e-9) {
    return desired;
  }

  const n = { x: qx / qLength, y: qy / qLength };
  const t = side > 0 ? { x: -n.y, y: n.x } : { x: n.y, y: -n.x };
  const remaining = (1 - hit) * length;

  // From the contact point q the tangent step stays outside the disc, so the straight move from the start to its end does too.
  return { x: desired.x * hit + t.x * remaining, y: desired.y * hit + t.y * remaining };
}

/**
 * Whether `target` lies a little behind `anchor` (less than a quarter turn) on the way round the zone centre `zoneCenter` that `side` requires: counterclockwise for side +1 (zone on the left of the motion), clockwise for -1.
 * A creature that would run into the zone toward such a target has gone round further than the point it chases (its body centre is ahead of its origin). Going round on would overtake that point for good (it stays a leash ahead along the trail), so the creature would circle the whole vertex to reach it; it stops at the zone instead and lets the point come round, which a point moving along a geodesic that passes the vertex on that side always does. A target farther round, or straight across the zone, is reached by going round.
 */
export function isTargetBehindAroundZone(
  zoneCenter: { readonly x: number; readonly y: number },
  anchor: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
  side: 1 | -1,
): boolean {
  const anchorAngle = Math.atan2(anchor.y - zoneCenter.y, anchor.x - zoneCenter.x);
  const targetAngle = Math.atan2(target.y - zoneCenter.y, target.x - zoneCenter.x);
  const ahead = side * Math.atan2(Math.sin(targetAngle - anchorAngle), Math.cos(targetAngle - anchorAngle));

  return ahead < 0 && ahead > -Math.PI / 2;
}

/** Fraction in [0, 1] of `desired` at which a body at `d0` (relative to the zone centre) first reaches the contact circle while moving inward; undefined when it does not. */
function zoneHitFraction(
  desired: { readonly x: number; readonly y: number },
  d0: { readonly x: number; readonly y: number },
  contactRadius: number,
): number | undefined {
  const a = desired.x * desired.x + desired.y * desired.y;
  const dist2 = d0.x * d0.x + d0.y * d0.y;
  const b = 2 * (d0.x * desired.x + d0.y * desired.y);

  if (a === 0) {
    return undefined;
  }

  if (dist2 <= contactRadius * contactRadius) {
    return b < 0 ? 0 : undefined;
  }

  const discriminant = b * b - 4 * a * (dist2 - contactRadius * contactRadius);

  if (discriminant < 0) {
    return undefined;
  }

  const s = (-b - Math.sqrt(discriminant)) / (2 * a);

  return s >= 0 && s <= 1 ? s : undefined;
}

/**
 * Applies {@link applyForbiddenZoneSideRule} to the nearest zone column the displacement `desired` would run into (or that the body touches while standing on the wrong side of it).
 * `leaderPoint` and `leaderForward` describe the geodesic in the body's frame; each zone fixes its side with {@link geodesicSideOfPoint}. A body touching a zone on the side opposite to the required one orbits it by `orbitLength` meters toward the required side. `anchor` is the creature's origin and `target` the point it steers to, in the same frame; when the target lies behind around the zone (see {@link isTargetBehindAroundZone}) the step ends at the zone and `waiting` is true, so the chase point moves on until it has come round.
 */
function applyForbiddenZoneSideRuleToColumns(
  desired: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  bodyRadius: number,
  columns: readonly { readonly center: { readonly x: number; readonly y: number }; readonly radius: number }[],
  leaderPoint: { readonly x: number; readonly y: number },
  leaderForward: { readonly x: number; readonly y: number },
  orbitLength: number,
  anchor: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
): { readonly displacement: { readonly x: number; readonly y: number }; readonly applied: boolean; readonly waiting: boolean } {
  let best: { readonly s: number; readonly column: (typeof columns)[number]; readonly wrongSide: boolean } | undefined;

  for (const column of columns) {
    const contactRadius = bodyRadius + column.radius + forbiddenZoneContactMarginMeters;
    const d0 = { x: center.x - column.center.x, y: center.y - column.center.y };
    const side = geodesicSideOfPoint(leaderPoint, leaderForward, column.center);
    const crossBody = leaderForward.x * (column.center.y - center.y) - leaderForward.y * (column.center.x - center.x);
    const touching = Math.hypot(d0.x, d0.y) <= contactRadius;
    // On the wrong side: the zone centre lies on the other side of the line than the geodesic requires.
    const wrongSide = touching && (side > 0 ? crossBody < -1e-9 : crossBody > 1e-9);
    const s = wrongSide ? 0 : zoneHitFraction(desired, d0, contactRadius);

    if (s !== undefined && (best === undefined || s < best.s)) {
      best = { s, column, wrongSide };
    }
  }

  if (!best) {
    return { displacement: desired, applied: false, waiting: false };
  }

  const side = geodesicSideOfPoint(leaderPoint, leaderForward, best.column.center);

  if (best.wrongSide) {
    // Orbit toward the required side: the tangent at the body's own position, of length orbitLength.
    const nx = center.x - best.column.center.x;
    const ny = center.y - best.column.center.y;
    const n = Math.hypot(nx, ny);

    if (n < 1e-9) {
      return { displacement: desired, applied: false, waiting: false };
    }

    const length = Math.max(Math.hypot(desired.x, desired.y), orbitLength);
    const t = side > 0 ? { x: -ny / n, y: nx / n } : { x: ny / n, y: -nx / n };

    return { displacement: { x: t.x * length, y: t.y * length }, applied: true, waiting: false };
  }

  if (isTargetBehindAroundZone(best.column.center, anchor, target, side)) {
    return { displacement: { x: desired.x * best.s, y: desired.y * best.s }, applied: true, waiting: true };
  }

  return {
    displacement: applyForbiddenZoneSideRule(
      desired,
      center,
      best.column.center,
      bodyRadius + best.column.radius + forbiddenZoneContactMarginMeters,
      side,
    ),
    applied: true,
    waiting: false,
  };
}

/**
 * Returns a factor in [0, 1] that fades the sideways wobble out near forbidden zones.
 * The nearest horizontal clearance between the creature's collision cylinder and the cell's singularity columns (cylinders around portal junction vertices) is mapped by smoothstep: 0 at or below 0.5 m, 1 at or above 1.0 m. Returns 1 when the cell has no columns or the state has no collision shape.
 */
export function forbiddenZoneLateralOscillationScale(
  cell: CompiledPrismCell,
  state: DynamicObjectState,
): number {
  const bounds = getDynamicObjectCollisionBounds(state);

  if (!bounds || cell.singularityColumns.length === 0) {
    return 1;
  }

  let nearestClearanceMeters = Infinity;

  for (const exclusionCylinder of cell.singularityColumns) {
    const dx = bounds.center.x - exclusionCylinder.center.x;
    const dy = bounds.center.y - exclusionCylinder.center.y;
    const clearanceMeters = Math.sqrt(dx * dx + dy * dy) - bounds.radius - exclusionCylinder.radius;
    nearestClearanceMeters = Math.min(nearestClearanceMeters, clearanceMeters);
  }

  const fadeStartMeters = forbiddenZoneLateralStopClearanceMeters;
  const fadeEndMeters = fadeStartMeters + forbiddenZoneLateralFadeMeters;
  const t = clamp((nearestClearanceMeters - fadeStartMeters) / (fadeEndMeters - fadeStartMeters), 0, 1);

  return t * t * (3 - 2 * t);
}

/**
 * Returns the butterfly's instantaneous vertical bob rate in Hz at `elapsedSeconds`, or 0 for non-butterflies.
 * The rate is drawn deterministically (a hash of the object id and the 0.1 s time bucket) between 1.31x and 1.73x the lateral rate (1 Hz if there is no lateral oscillation), clamped to [0.85, 2] Hz, so bobbing looks irregular but is reproducible.
 */
export function butterflyVerticalOscillationRateHz(
  objectSpec: SimpleGeoCreatureObjectSpec,
  elapsedSeconds: number,
): number {
  if (objectSpec.kind !== "geo-butterfly") {
    return 0;
  }

  // Vertical rate is tied to the lateral rate (or 1 Hz) with incommensurate multipliers so the two motions do not lock in phase.
  const lateralRateHz = objectSpec.oscillationRateHz > 0 ? objectSpec.oscillationRateHz : 1;
  const minRateHz = clamp(
    lateralRateHz * butterflyVerticalRateMinMultiplier,
    butterflyVerticalRateMinHz,
    butterflyVerticalRateMaxHz,
  );
  const maxRateHz = clamp(
    lateralRateHz * butterflyVerticalRateMaxMultiplier,
    minRateHz,
    butterflyVerticalRateMaxHz,
  );
  const bucket = Math.floor(Math.max(0, elapsedSeconds) / butterflyVerticalRateBucketSeconds);
  const random = seededUnitInterval(`${objectSpec.id}:vertical-rate:${bucket}`);

  return minRateHz + (maxRateHz - minRateHz) * random;
}

/**
 * Returns the butterfly's vertical bob amplitude in meters (10% of its collision height, capped at 0.08 m), or 0 for non-butterflies.
 */
export function butterflyVerticalOscillationHeightMagnitudeMeters(objectSpec: SimpleGeoCreatureObjectSpec): number {
  if (objectSpec.kind !== "geo-butterfly") {
    return 0;
  }

  return Math.min(
    objectSpec.collision.height * butterflyVerticalMagnitudeFractionOfHeight,
    butterflyVerticalMagnitudeMaxMeters,
  );
}

function initialButterflyVerticalOscillationPhaseRadians(objectSpec: SimpleGeoCreatureObjectSpec): number {
  if (objectSpec.kind !== "geo-butterfly") {
    return 0;
  }

  return seededUnitInterval(`${objectSpec.id}:vertical-phase`) * tau;
}

function butterflyVerticalOscillationHeightOffset(
  objectSpec: SimpleGeoCreatureObjectSpec,
  phaseRadians: number,
): number {
  return Math.sin(phaseRadians) * butterflyVerticalOscillationHeightMagnitudeMeters(objectSpec);
}

function seededUnitInterval(seed: string): number {
  // FNV-1a hash of the seed string, mapped to [0, 1): deterministic pseudo-randomness per object id.
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0x100000000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
