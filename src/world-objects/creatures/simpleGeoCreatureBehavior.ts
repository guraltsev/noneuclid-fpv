/**
 * Motion of the simple geodesic creatures (the mouse and the butterfly), with no renderer: the state a creature owns, how it advances each frame, and how it follows geometry changes.
 * Each creature owns an invisible leader that walks its geodesic exactly with the segment-walk kernel (while the creature is within `creatureLeashMeters` of it); the creature steers toward the leader plus a sinusoidal sideways wobble (faded out near forbidden zones around portal junction vertices) and, for butterflies, a bounded vertical bob, with swept collision against walls, forbidden zones and other bodies, so it detours around an obstacle and then rejoins the same geodesic; a detour around a forbidden zone keeps the zone's vertex on the side the geodesic passes it.
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
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
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

/** The leader advances only while the creature lags it by less than this many meters, so it waits for a blocked creature. */
export const creatureLeashMeters = 0.5;
/** The creature may move toward its leader at up to this multiple of its speed, so it catches up after a detour. */
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

/**
 * Creates the behavior for a creature starting in `startCellId`.
 * Registers the object in `registry` when given (throwing if the id already exists) and claims ownership of its registry record, so only the creature itself writes the record afterwards; `place` (the `WorldObjectOwner` placement command), `reset` and `transformGeometry` re-seed the leader on the creature. The leader advances at the spec speed along its forward axis exactly on the geodesic; the creature moves toward the leader plus the lateral wobble and butterfly bob, so with nothing in the way its path is the geodesic plus a bounded oscillation, and after a detour it returns to the same geodesic.
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
  // The leader walks the geodesic exactly; `creatureFromLeader` maps its cell frame to the creature's cell frame along the paths actually walked.
  let leader: { cellId: string; localPose: RigidTransform3 } = { cellId: state.cellId, localPose: state.localPose };
  let creatureFromLeader: RigidTransform3 = identityRigidTransform3;
  let warnedLeaderWalk = false;
  const seedLeaderOnCreature = (): void => {
    leader = { cellId: state.cellId, localPose: state.localPose };
    creatureFromLeader = identityRigidTransform3;
  };
  const publishState = (): void => {
    record = { ...record, cellId: state.cellId, localPose: state.localPose, collision: state.collision };
    publish(record);
  };
  const advanceLeader = (world: CompiledCellComplex, lengthMeters: number): void => {
    const pose = leader.localPose;
    const direction = transformDirection3(pose, vec3(0, 1, 0));
    const walk = walkDevelopedSegment({
      world,
      cellId: leader.cellId,
      start: { x: pose.translation.x, y: pose.translation.y },
      direction: { x: direction.x, y: direction.y },
      lengthMeters,
    });
    const last = walk.pieces[walk.pieces.length - 1];

    if (walk.status !== "end" || !last) {
      if (!warnedLeaderWalk) {
        warnedLeaderWalk = true;
        console.warn(`Creature "${objectSpec.id}": leader walk ended with status "${walk.status}"; the leader stays put.`);
      }
      return;
    }

    const moved: RigidTransform3 = {
      rotation: pose.rotation,
      translation: vec3(
        pose.translation.x + direction.x * lengthMeters,
        pose.translation.y + direction.y * lengthMeters,
        pose.translation.z,
      ),
    };
    leader = { cellId: last.cellId, localPose: orthonormalizeYawRigidTransform3(composeRigidTransform3(last.cellFromStart, moved)) };
    creatureFromLeader = orthonormalizeYawRigidTransform3(
      composeRigidTransform3(creatureFromLeader, invertRigidTransform3(last.cellFromStart)),
    );
  };

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

      // The leader in the creature's frame; the target is the leader plus the wobble.
      const targetOf = (): { readonly x: number; readonly y: number; readonly z: number } => {
        const pose = composeRigidTransform3(creatureFromLeader, leader.localPose);
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

      const lagBefore = lagMeters();
      if (lagBefore < creatureLeashMeters && stepMeters > 0) {
        advanceLeader(world, stepMeters);
      }

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
      const bounds = getDynamicObjectCollisionBounds(state);

      if (cell && bounds && cell.singularityColumns.length > 0) {
        const leaderPose = composeRigidTransform3(creatureFromLeader, leader.localPose);
        const leaderForward = transformDirection3(leaderPose, vec3(0, 1, 0));
        const sideRule = applyForbiddenZoneSideRuleToColumns(
          { x: desiredX, y: desiredY },
          { x: bounds.center.x, y: bounds.center.y },
          bounds.radius,
          cell.singularityColumns,
          { x: leaderPose.translation.x, y: leaderPose.translation.y },
          { x: leaderForward.x, y: leaderForward.y },
          Math.max(desiredLength, stepMeters),
        );

        desiredX = sideRule.displacement.x;
        desiredY = sideRule.displacement.y;
        ruleApplied = sideRule.applied;
      }

      const result = moveDynamicObject({
        world,
        object: state,
        displacement: vec3(desiredX, desiredY, target.z - anchor.z),
        portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
        bodiesInCell: (cellId) => obstacles.filter((obstacle) => obstacle.cellId === cellId),
      });
      // Obstacle bodies (the player) are swept discs in the move, so the creature slides around them.
      creatureFromLeader = orthonormalizeYawRigidTransform3(composeRigidTransform3(result.cellFromStart, creatureFromLeader));
      state = result.object;

      // Heading: the leader's when the creature is on its way, else the direction of the last applied step.
      if (lagMeters() < 1e-4 || (!result.blocked && !ruleApplied)) {
        state = {
          ...state,
          localPose: { rotation: composeRigidTransform3(creatureFromLeader, leader.localPose).rotation, translation: state.localPose.translation },
        };
      } else {
        const applied = transformDirection3(result.cellFromStart, result.appliedDisplacement);

        if (Math.hypot(applied.x, applied.y) > 1e-6) {
          state = { ...state, localPose: yawRigidTransform3(Math.atan2(-applied.x, applied.y), state.localPose.translation) };
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
      return { cellId: leader.cellId, localPose: leader.localPose, creatureFromLeader };
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
 * `leaderPoint` and `leaderForward` describe the geodesic in the body's frame; each zone fixes its side with {@link geodesicSideOfPoint}. A body touching a zone on the side opposite to the required one orbits it by `orbitLength` meters toward the required side.
 */
function applyForbiddenZoneSideRuleToColumns(
  desired: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  bodyRadius: number,
  columns: readonly { readonly center: { readonly x: number; readonly y: number }; readonly radius: number }[],
  leaderPoint: { readonly x: number; readonly y: number },
  leaderForward: { readonly x: number; readonly y: number },
  orbitLength: number,
): { readonly displacement: { readonly x: number; readonly y: number }; readonly applied: boolean } {
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
    return { displacement: desired, applied: false };
  }

  const side = geodesicSideOfPoint(leaderPoint, leaderForward, best.column.center);

  if (best.wrongSide) {
    // Orbit toward the required side: the tangent at the body's own position, of length orbitLength.
    const nx = center.x - best.column.center.x;
    const ny = center.y - best.column.center.y;
    const n = Math.hypot(nx, ny);

    if (n < 1e-9) {
      return { displacement: desired, applied: false };
    }

    const length = Math.max(Math.hypot(desired.x, desired.y), orbitLength);
    const t = side > 0 ? { x: -ny / n, y: nx / n } : { x: ny / n, y: -nx / n };

    return { displacement: { x: t.x * length, y: t.y * length }, applied: true };
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
