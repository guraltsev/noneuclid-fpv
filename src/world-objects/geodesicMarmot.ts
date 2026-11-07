/**
 * Geodesic marmot: an autonomous creature that walks in a straight line (a locally straight geodesic) through the cell complex, crossing portals.
 * Provides the authoring helper that produces a GeodesicMarmotObjectSpec, and the registry record kept in the RuntimeObjectRegistry. The motion is in `creatures/geodesicMarmotBehavior` and the proxy mesh in `render/three/creatures/geodesicMarmotView`.
 * Units are meters and seconds; poses live in the current cell's local frame (x right, y forward, z up) and the heading is a yaw in radians derived from the authored velocity as yaw = atan2(-vx, vy), so the marmot walks along its authored velocity (body +y axis R·e_y = (-sin yaw, cos yaw)). Forward speed is the magnitude of the 2D velocity and is constant; the marmot turns only when a forbidden zone blocks it, by reflecting off the nearest zone.
 */
import type { CellObjectSpec, GeodesicMarmotObjectSpec } from "../cell-complex/specs";
import { yawRigidTransform3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import type { RuntimeCreatureObject } from "./runtimeObjectBase";

const defaultCollisionOffset = { x: 0, y: 0, z: 0.22 } as const;
const defaultScale = 0.42;

/**
 * Inputs for createGeodesicMarmot.
 * `position` is already in cell-local coordinates (meters; z is height) and `velocity` is the planar cell-local velocity in m/s whose direction fixes the initial heading and whose magnitude is the walking speed.
 */
export interface CreateGeodesicMarmotOptions {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly scale?: number;
  readonly class?: string;
  readonly do_not_collide_with?: readonly string[];
  readonly displayHelpMessage?: string;
}

/**
 * Creates the authored spec for a geodesic marmot.
 * Fixes the library-owned asset, a 0.36 m radius by 0.42 m collision cylinder, a default scale of 0.42 and the class "creature" unless overridden; the initial yaw is derived from `options.velocity`.
 */
export function createGeodesicMarmot(options: CreateGeodesicMarmotOptions): GeodesicMarmotObjectSpec {
  return {
    id: options.id,
    kind: "geodesci-marmot",
    assetPath: "_legacy/racoon-animation/scene.gltf",
    mapIconPath: "_legacy/racoon-animation/map-icon.svg",
    position: options.position,
    scale: options.scale ?? defaultScale,
    yawRadians: yawFromVelocity(options.velocity),
    velocity: options.velocity,
    collision: {
      radius: 0.36,
      height: 0.42,
      offset: defaultCollisionOffset,
    },
    class: options.class ?? "creature",
    do_not_collide_with: options.do_not_collide_with,
    displayHelpMessage: options.displayHelpMessage,
  };
}

/**
 * Type guard: true when a cell object spec is a geodesic marmot.
 */
export function isGeodesicMarmotObjectSpec(objectSpec: CellObjectSpec): objectSpec is GeodesicMarmotObjectSpec {
  return objectSpec.kind === "geodesci-marmot";
}

/**
 * Builds the registry record for a marmot spec in the given cell without creating any three.js objects.
 */
export function createGeodesicMarmotRuntimeObject(
  objectSpec: GeodesicMarmotObjectSpec,
  cellId: string,
): RuntimeCreatureObject {
  return createRuntimeCreatureObject(objectSpec, cellId);
}

function createRuntimeCreatureObject(objectSpec: GeodesicMarmotObjectSpec, cellId: string): RuntimeCreatureObject {
  return {
    id: objectSpec.id,
    kind: "geodesci-marmot",
    mapIconPath: objectSpec.mapIconPath,
    cellId,
    localPose: yawRigidTransform3(
      objectSpec.yawRadians ?? yawFromVelocity(objectSpec.velocity),
      vec3(objectSpec.position.x, objectSpec.position.y, objectSpec.position.z),
    ),
    collision: objectSpec.collision,
    class: objectSpec.class,
    do_not_collide_with: objectSpec.do_not_collide_with,
    portalRenderable: true,
    displayHelpMessage: objectSpec.displayHelpMessage ?? "A moving marmot that follows geodesic paths through the world.",
    tooltip: {
      label: "geodesic marmot",
      rangeMeters: 2.25,
    },
  };
}

// Forward is the body +y axis R·e_y = (-sin yaw, cos yaw); yaw = atan2(-vx, vy) makes it point along the velocity.
function yawFromVelocity(velocity: GeodesicMarmotObjectSpec["velocity"]): number {
  return Math.atan2(-velocity.x, velocity.y);
}
