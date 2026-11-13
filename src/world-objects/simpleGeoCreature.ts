/**
 * Simple geodesic creatures: the mouse and the butterfly, autonomous walkers that follow straight lines (geodesics) through the cell complex.
 * Contains the authoring helper that builds a SimpleGeoCreatureObjectSpec with library defaults (speeds, visual scale, collision cylinder derived from the measured model bounds), and the registry record. The motion is in `creatures/simpleGeoCreatureBehavior` and the glTF view in `render/three/creatures/simpleGeoCreatureView`.
 * Units are meters, seconds and radians; positions and displacements are in the current cell's local frame (x right, y forward, z up). Each frame the creature moves forward along its body +y axis at constant speed, plus an optional sinusoidal sideways wobble (faded out near forbidden zones around portal junction vertices) and, for butterflies, a bounded vertical bob; each creature owns an invisible leader that walks the geodesic exactly, and the creature steers toward the leader's position (plus the wobble and bob) with swept collision against walls, forbidden zones and other bodies, so it detours around an obstacle and then rejoins the same geodesic; a detour around a forbidden zone keeps the zone's vertex on the side the geodesic passes it.
 */
import type { CellObjectSpec, SimpleCollisionCylinderSpec, SimpleGeoCreatureObjectSpec } from "../cell-complex/specs";
import { yawRigidTransform3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import { degreesToRadians } from "./staticAssets";
import type { RuntimeCreatureObject } from "./runtimeObjectBase";

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
  /** True when the creature is the landmark of its face (one per face). */
  readonly landmark?: boolean;
}

const defaultScale = 1;
const collisionFloorClearanceMeters = 0.01;
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
    ...(params.landmark === true ? { landmark: true } : {}),
  };
}

/**
 * Type guard: true for geo-mouse and geo-butterfly specs.
 */
export function isSimpleGeoCreatureObjectSpec(objectSpec: CellObjectSpec): objectSpec is SimpleGeoCreatureObjectSpec {
  return objectSpec.kind === "geo-mouse" || objectSpec.kind === "geo-butterfly";
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
    mapIconPath: objectSpec.mapIconPath,
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
