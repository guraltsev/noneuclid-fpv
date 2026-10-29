/**
 * Aim-ray value type and pure aim helpers shared by desktop and XR interaction code.
 * A ray is expressed in the Three.js frame; helpers convert to the cell-local game world (x right, y forward, z up, meters) via worldAxes.
 * The "root" is the cell the ray is expressed in before any portal traversal.
 */
import * as THREE from "three";
import { type Vec3 } from "../../math/vec3";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { AimTarget } from "./aimTarget";
import { threeDirectionToWorld, threePointToWorld } from "./worldAxes";

/**
 * A ray in the render root's Three.js frame.
 */
export interface RootAimRay {
  /** Ray start, meters. */
  readonly origin: THREE.Vector3;
  /** Unit direction (callers are expected to normalize; not enforced here). */
  readonly direction: THREE.Vector3;
  /** Orientation of the pointing device, for placing visuals aligned with the ray. */
  readonly quaternion: THREE.Quaternion;
}

/**
 * Intersects a Three.js-frame ray with the floor plane z = 0 of the world frame.
 * Returns the hit in world coordinates (z = 0), or `undefined` if the ray is nearly parallel to the floor or points away from it (including starting below it).
 * No range limit is applied.
 */
export function intersectRootRayWithFloor(originThree: THREE.Vector3, directionThree: THREE.Vector3): Vec3 | undefined {
  const origin = threePointToWorld(originThree);
  const direction = threeDirectionToWorld(directionThree);
  if (Math.abs(direction.z) <= 1e-6) {
    return undefined;
  }

  const t = -origin.z / direction.z;
  if (!Number.isFinite(t) || t <= 0) {
    return undefined;
  }

  return {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: 0,
  };
}

/**
 * Returns the ray's direction in world axes, or `undefined` if no ray is given.
 */
export function getAimForwardVector(ray?: RootAimRay): { readonly x: number; readonly y: number; readonly z: number } | undefined {
  return ray ? threeDirectionToWorld(ray.direction) : undefined;
}

/**
 * Builds a string identifying an ordered list of aim targets (object id, geodesic emitter id, portal hop count) so callers can detect when the set under the ray changed
 * and reset target cycling.
 */
export function createAimTargetCycleSignature(targets: readonly AimTarget[]): string {
  return targets.map((target) => [
    target.object?.id ?? "",
    target.geodesicEmitterGeodesicId ?? "",
    target.hopCount,
  ].join(":")).join("|");
}

/**
 * Returns the maximum interaction distance in meters for an object: tooltip range, else interactable range, else 2.5.
 */
export function getRuntimeObjectInteractionRangeMeters(object: RuntimeWorldObject): number {
  return object.tooltip?.rangeMeters ?? object.interactable?.rangeMeters ?? 2.5;
}
