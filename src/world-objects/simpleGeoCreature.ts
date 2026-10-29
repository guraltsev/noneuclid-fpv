/**
 * Simple geodesic creatures: the mouse and the butterfly, autonomous walkers that follow straight lines (geodesics) through the cell complex.
 * Contains the authoring helper that builds a SimpleGeoCreatureObjectSpec with library defaults (speeds, visual scale, collision cylinder derived from the measured model bounds), the per-creature runtime that owns the glTF instance and advances state each frame with moveDynamicObject, and the registry record.
 * Units are meters, seconds and radians; positions and displacements are in the current cell's local frame (x right, y forward, z up). Each frame the creature moves forward along its body +y axis at constant speed, plus an optional sinusoidal sideways wobble (faded out near forbidden zones around portal junction vertices) and, for butterflies, a bounded vertical bob; it ignores forbidden zones for movement and stands still for a frame if the move would overlap an obstacle.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import type { CellObjectSpec, SimpleCollisionCylinderSpec, SimpleGeoCreatureObjectSpec } from "../cell-complex/specs";
import { yawRigidTransform3, transformDirection3, type RigidTransform3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import { getDynamicObjectCollisionBounds } from "../movement/collision";
import { depenetrateDynamicObject } from "../movement/depenetrateDynamicObject";
import type { DynamicObjectState } from "../movement/dynamicObject";
import {
  AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
  moveDynamicObject,
} from "../movement/moveDynamicObject";
import { runtimeDiagnostics } from "../render/three/runtimeDiagnostics";
import {
  buildObjectCollisionWireframe,
  updateObjectCollisionWireframe,
} from "../render/three/debugCollisionWireframes";
import type { PreparedWorldAssets } from "../render/three/preloadWorldAssets";
import { applyWorldRigidTransform } from "../render/three/worldAxes";
import { transformPoseWithCellMaps, type CellDeformationMap } from "../runtime/worldGeometryDeformations";
import { degreesToRadians } from "./staticAssets";
import type { RuntimeObjectRegistry } from "./runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState, type RuntimeCreatureObject } from "./runtimeObjectRegistry";

/**
 * Author-facing parameters for the mouse and butterfly library entries.
 * Position is [x, height, y] in meters; angles are degrees; unspecified values take per-kind defaults (speed 1.2 m/s mouse, 0.7 m/s butterfly; no oscillation; class "creature").
 */
export interface SimpleGeoCreatureAuthoringParams {
  /** Position in authored [x, z, y] axes. The middle coordinate is height above the floor. */
  readonly position: readonly [x: number, y: number, z: number];
  /** Multiplies the library creature's base visual size, collision area, and lift. */
  readonly scale?: number;
  /** Tilt of the model about its lateral axis, in degrees. */
  readonly forwardTilt?: number;
  /** Tilt of the model about its forward axis, in degrees. */
  readonly sideTilt?: number;
  /** Yaw in degrees. */
  readonly turn?: number;
  /** Forward speed in meters per second. */
  readonly speed?: number;
  /** Lateral oscillation rate in Hz. */
  readonly oscillationRate?: number;
  /** Lateral oscillation magnitude in meters. */
  readonly oscillationMagnitude?: number;
  /** Advanced override for the library's default collision cylinder. */
  readonly collision?: SimpleCollisionCylinderSpec;
  /** Override the object's collision class, for example "creature". */
  readonly class?: string;
  /** Objects in these classes ignore this object's collision, for example ["user"]. */
  readonly do_not_collide_with?: readonly string[];
  /** Camel-case alias accepted for TypeScript callers. Serialized specs use do_not_collide_with. */
  readonly doNotCollideWith?: readonly string[];
  /** Help text for the help lens; a generic creature message is used when absent. */
  readonly displayHelpMessage?: string;
}

/**
 * Per-creature runtime handle owned by the renderer.
 * `root` is the three.js group (reparented into the current cell's root by `syncParent`); `cellId` reports the creature's current cell.
 */
export interface SimpleGeoCreatureRuntime {
  readonly root: THREE.Object3D;
  readonly objectId: string;
  readonly cellId: string;
  /** Advances the creature by `deltaSeconds`; `obstacles` are collision states (same-cell ones are tested) that the creature will not move into. No-op for non-positive `deltaSeconds`. */
  update(world: CompiledCellComplex, deltaSeconds: number, obstacles?: readonly DynamicObjectState[]): void;
  /** Attaches `root` to the scene node of the creature's current cell if it is not already there. */
  syncParent(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
  /** Shows or hides the debug collision cylinder. */
  setCollisionWireframeVisible(visible: boolean): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped; when `nextWorld` is given, both poses are then pushed out of obstacles in it. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
  /** Restores the initial (possibly deformation-remapped) pose and oscillation phases and reattaches to that cell's root. */
  reset(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
}

const defaultScale = 1;
const collisionFloorClearanceMeters = 0.01;
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
const mouseAssetBounds = {
  widthMetersAtAuthorScale: 19.218719482421875 / 30,
  heightMetersAtAuthorScale: 31.855297088623047 / 30,
} as const;
const mouseBodyCollision = {
  lengthMetersAtAuthorScale: 1.45,
  centerYMetersAtAuthorScale: 0.35,
} as const;
const butterflyAssetBounds = {
  widthMetersAtAuthorScale: 1.5509990453720093 * 0.8,
  lengthMetersAtAuthorScale: 1.0916100144386292 * 0.8,
  heightMetersAtAuthorScale: 0.92323899269104 * 0.8,
  centerXMetersAtAuthorScale: 0.016376495361328125 * 0.8,
  centerYMetersAtAuthorScale: 0.045488983392715454 * 0.8,
} as const;

/**
 * Creates the authored spec for a mouse or butterfly.
 * Reorders `params.position` from [x, height, y] to cell-local (x, y, z); converts degrees to radians; multiplies the author scale by the kind's base visual scale (1/30 mouse, 0.8 butterfly); and, unless overridden, derives a collision cylinder from the measured model bounds scaled by the author scale, kept at least 1 cm above the floor.
 */
export function createSimpleGeoCreature(
  kind: SimpleGeoCreatureObjectSpec["kind"],
  id: string,
  assetPath: string,
  params: SimpleGeoCreatureAuthoringParams,
): SimpleGeoCreatureObjectSpec {
  const authorScale = params.scale ?? defaultScale;

  return {
    id,
    kind,
    assetPath,
    position: {
      x: params.position[0],
      y: params.position[2],
      z: params.position[1],
    },
    modelOffset: {
      x: 0,
      y: 0,
      z: creatureModelLiftMeters(kind, authorScale),
    },
    scale: authorScale * defaultVisualScale(kind),
    forwardTiltRadians: degreesToRadians(params.forwardTilt ?? 0),
    sideTiltRadians: degreesToRadians(params.sideTilt ?? 0),
    turnRadians: degreesToRadians(params.turn ?? 0),
    yawRadians: degreesToRadians(params.turn ?? 0),
    speedMetersPerSecond: params.speed ?? defaultSpeed(kind),
    oscillationRateHz: params.oscillationRate ?? 0,
    oscillationMagnitudeMeters: params.oscillationMagnitude ?? 0,
    collision: params.collision ?? defaultCreatureCollision(kind, authorScale),
    class: params.class ?? "creature",
    do_not_collide_with: params.do_not_collide_with ?? params.doNotCollideWith,
    displayHelpMessage: params.displayHelpMessage,
  };
}

/**
 * Type guard: true for geo-mouse and geo-butterfly specs.
 */
export function isSimpleGeoCreatureObjectSpec(objectSpec: CellObjectSpec): objectSpec is SimpleGeoCreatureObjectSpec {
  return objectSpec.kind === "geo-mouse" || objectSpec.kind === "geo-butterfly";
}

/**
 * Creates the runtime (three.js model instance, state, registry entry) for a creature starting in `startCellId`.
 * Throws if the model was not preloaded in `assets`. Registers the object in `registry` when given (throwing if the id already exists). Each update advances forward at the spec speed along the body +y axis; the lateral wobble and butterfly bob are added as per-frame displacement increments (differences of the oscillation offsets) so that the net path is the unperturbed geodesic plus a bounded oscillation.
 */
export function createSimpleGeoCreatureRuntime(
  objectSpec: SimpleGeoCreatureObjectSpec,
  startCellId: string,
  assets: PreparedWorldAssets,
  registry?: RuntimeObjectRegistry,
): SimpleGeoCreatureRuntime {
  const root = new THREE.Group();
  root.name = `${objectSpec.kind}:${objectSpec.id}`;

  const prepared = assets.instantiateGltf(objectSpec.assetPath);
  if (!prepared) {
    throw new Error(`Geo creature asset was not preloaded: ${objectSpec.assetPath}`);
  }

  prepared.scene.name = `asset:${objectSpec.id}`;
  prepared.scene.scale.setScalar(objectSpec.scale ?? defaultScale);
  prepared.scene.rotation.x = objectSpec.forwardTiltRadians ?? 0;
  prepared.scene.rotation.y = Math.PI;
  prepared.scene.rotation.z = objectSpec.sideTiltRadians ?? 0;
  if (objectSpec.modelOffset) {
    prepared.scene.position.copy(new THREE.Vector3(objectSpec.modelOffset.x, objectSpec.modelOffset.z, -objectSpec.modelOffset.y));
  }
  root.add(prepared.scene);
  const initialObject = createRuntimeCreatureObject(objectSpec, startCellId);
  registry?.add(initialObject);
  let initialState = runtimeObjectToDynamicObjectState(initialObject);
  let state = initialState;
  const collisionWireframe = buildObjectCollisionWireframe(objectSpec.id, state);
  collisionWireframe.visible = false;
  root.add(collisionWireframe);
  // The debug option decides visibility; updateObjectCollisionWireframe alone would show it whenever bounds exist.
  let collisionWireframeRequested = false;
  const refreshCollisionWireframe = (): void => {
    updateObjectCollisionWireframe(collisionWireframe, state);
    collisionWireframe.visible = collisionWireframeRequested && collisionWireframe.visible;
  };
  refreshCollisionWireframe();
  let elapsedSeconds = 0;
  let lateralOscillationOffsetMeters = 0;
  let verticalOscillationPhaseRadians = initialButterflyVerticalOscillationPhaseRadians(objectSpec);
  let verticalOscillationOffsetMeters = butterflyVerticalOscillationHeightOffset(objectSpec, verticalOscillationPhaseRadians);
  const diagnostics = runtimeDiagnostics();

  diagnostics.recordAssetInstanceStart(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  diagnostics.recordAssetInstanceComplete(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  applyObjectPose(root, state.localPose);

  return {
    root,
    objectId: objectSpec.id,
    get cellId() {
      return state.cellId;
    },
    update(world, deltaSeconds, obstacles = []) {
      if (deltaSeconds <= 0) {
        return;
      }

      elapsedSeconds += deltaSeconds;
      const forward = objectSpec.speedMetersPerSecond * deltaSeconds;
      const cell = world.cellsById.get(state.cellId);
      const nextLateralOscillationOffsetMeters = lateralOscillationOffset(objectSpec, elapsedSeconds);
      // Displacement is the increment of the oscillation offset, so oscillation never accumulates drift; scaled down near forbidden zones so the wobble cannot push the body into them.
      const lateralOffsetDeltaMeters = (nextLateralOscillationOffsetMeters - lateralOscillationOffsetMeters) *
        (cell ? forbiddenZoneLateralOscillationScale(cell, state) : 1);
      lateralOscillationOffsetMeters = nextLateralOscillationOffsetMeters;
      verticalOscillationPhaseRadians += butterflyVerticalOscillationRateHz(objectSpec, elapsedSeconds) * tau * deltaSeconds;
      const nextVerticalOscillationOffsetMeters = butterflyVerticalOscillationHeightOffset(
        objectSpec,
        verticalOscillationPhaseRadians,
      );
      const verticalOffsetDeltaMeters = nextVerticalOscillationOffsetMeters - verticalOscillationOffsetMeters;
      verticalOscillationOffsetMeters = nextVerticalOscillationOffsetMeters;
      const displacement = transformDirection3(state.localPose, vec3(lateralOffsetDeltaMeters, forward, verticalOffsetDeltaMeters));
      const result = moveDynamicObject({
        world,
        object: state,
        displacement,
        portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
        ignoreForbiddenZones: true,
        bodiesInCell: (cellId) => obstacles.filter((obstacle) => obstacle.cellId === cellId),
      });
      // Obstacle bodies (the player) are swept discs in the move, so the creature slides around them.
      state = result.object;
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
    },
    syncParent(cellRoots) {
      const targetRoot = cellRoots.get(state.cellId);

      if (targetRoot && root.parent !== targetRoot) {
        targetRoot.add(root);
      }
    },
    setCollisionWireframeVisible(visible) {
      collisionWireframeRequested = visible;
      refreshCollisionWireframe();
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
        state = depenetrateDynamicObject(nextWorld, state, { ignoreForbiddenZones: true }).object;
        initialState = depenetrateDynamicObject(nextWorld, initialState, { ignoreForbiddenZones: true }).object;
      }
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
    },
    reset(cellRoots) {
      elapsedSeconds = 0;
      lateralOscillationOffsetMeters = 0;
      verticalOscillationPhaseRadians = initialButterflyVerticalOscillationPhaseRadians(objectSpec);
      verticalOscillationOffsetMeters = butterflyVerticalOscillationHeightOffset(
        objectSpec,
        verticalOscillationPhaseRadians,
      );
      state = initialState;
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
      const targetRoot = cellRoots.get(state.cellId);

      if (targetRoot && root.parent !== targetRoot) {
        targetRoot.add(root);
      }
    },
  };
}

/**
 * Builds the registry record for a creature spec in the given cell without creating any three.js objects.
 */
export function createSimpleGeoCreatureRuntimeObject(
  objectSpec: SimpleGeoCreatureObjectSpec,
  cellId: string,
): RuntimeCreatureObject {
  return createRuntimeCreatureObject(objectSpec, cellId);
}

function createRuntimeCreatureObject(objectSpec: SimpleGeoCreatureObjectSpec, cellId: string): RuntimeCreatureObject {
  return {
    id: objectSpec.id,
    kind: objectSpec.kind,
    cellId,
    localPose: yawRigidTransform3(
      objectSpec.turnRadians ?? 0,
      vec3(objectSpec.position.x, objectSpec.position.y, objectSpec.position.z),
    ),
    collision: objectSpec.collision,
    class: objectSpec.class,
    do_not_collide_with: objectSpec.do_not_collide_with,
    portalRenderable: true,
    displayHelpMessage: objectSpec.displayHelpMessage ?? "A moving creature that follows the geometry of this world.",
    tooltip: {
      label: objectSpec.kind === "geo-mouse" ? "geodesic mouse" : "geodesic butterfly",
      rangeMeters: 2.25,
    },
  };
}

function syncRegistryObject(
  registry: RuntimeObjectRegistry | undefined,
  id: string,
  state: DynamicObjectState,
): void {
  if (!registry) {
    return;
  }

  const object = registry.get(id);
  if (!object || (object.kind !== "geo-mouse" && object.kind !== "geo-butterfly")) {
    return;
  }

  registry.update({
    ...object,
    cellId: state.cellId,
    localPose: state.localPose,
    collision: state.collision,
  });
}

function lateralOscillationOffset(objectSpec: SimpleGeoCreatureObjectSpec, elapsedSeconds: number): number {
  if (objectSpec.oscillationRateHz <= 0 || objectSpec.oscillationMagnitudeMeters <= 0) {
    return 0;
  }

  return Math.sin(elapsedSeconds * objectSpec.oscillationRateHz * tau) * objectSpec.oscillationMagnitudeMeters;
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

function defaultSpeed(kind: SimpleGeoCreatureObjectSpec["kind"]): number {
  return kind === "geo-butterfly" ? 0.7 : 1.2;
}

function defaultVisualScale(kind: SimpleGeoCreatureObjectSpec["kind"]): number {
  return kind === "geo-mouse" ? 1 / 30 : 0.8;
}

function creatureModelLiftMeters(kind: SimpleGeoCreatureObjectSpec["kind"], authorScale: number): number {
  return kind === "geo-butterfly" ? authorScale * 0.25 : authorScale * 0.35;
}

function defaultCreatureCollision(
  kind: SimpleGeoCreatureObjectSpec["kind"],
  authorScale: number,
): SimpleGeoCreatureObjectSpec["collision"] {
  if (kind === "geo-butterfly") {
    const height = butterflyAssetBounds.heightMetersAtAuthorScale * authorScale;

    return {
      radius: Math.max(
        butterflyAssetBounds.widthMetersAtAuthorScale,
        butterflyAssetBounds.lengthMetersAtAuthorScale,
      ) * authorScale / 2,
      height,
      offset: {
        x: butterflyAssetBounds.centerXMetersAtAuthorScale * authorScale,
        y: butterflyAssetBounds.centerYMetersAtAuthorScale * authorScale,
        z: Math.max(creatureModelLiftMeters(kind, authorScale), height / 2 + collisionFloorClearanceMeters),
      },
    };
  }

  const height = mouseAssetBounds.heightMetersAtAuthorScale * authorScale;

  return {
    radius: Math.max(
      mouseAssetBounds.widthMetersAtAuthorScale,
      mouseBodyCollision.lengthMetersAtAuthorScale,
    ) * authorScale / 2,
    height,
    offset: {
      x: 0,
      y: mouseBodyCollision.centerYMetersAtAuthorScale * authorScale,
      z: Math.max(creatureModelLiftMeters(kind, authorScale), height / 2 + collisionFloorClearanceMeters),
    },
  };
}

function applyObjectPose(root: THREE.Object3D, pose: RigidTransform3): void {
  applyWorldRigidTransform(root, pose);
}
