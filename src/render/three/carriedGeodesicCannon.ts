/**
 * Pure placement, glow, and naming helpers for carrying and aiming geodesic emitters.
 *
 * Anchors are returned in cell-local coordinates (meters; x right, y forward, z up), converted
 * from the Three.js frame of the active aim ray via `threePointToWorld`. Only the glow factory
 * allocates GPU resources; everything else is side-effect free.
 */
import * as THREE from "three";
import { type Vec3 } from "../../math/vec3";
import { geodesicRayBeamHeightMeters } from "../../world-objects/geodesic/objects";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { RootAimRay } from "./rootAimRay";
import { threePointToWorld } from "./worldAxes";

/** Distance in meters ahead of the desktop aim-ray origin at which a carried emitter is held. */
export const carriedGeodesicEmitterDesktopDistanceMeters = 0.75;
/** Positional tolerance in meters under which a carried emitter's pose is treated as unchanged. */
export const carriedGeodesicEmitterPoseToleranceMeters = 1e-4;

/** Head pose in Three.js world space: position in meters and orientation quaternion. */
export interface XrHeadWorldPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/**
 * Computes where a carried cannon sits on desktop: the point 0.75 m along the aim ray, in cell-local coordinates.
 *
 * Only x and y follow the ray; z keeps the cannon's current `localPose.translation.z` so it stays on its floor.
 * Returns `undefined` when there is no active aim ray.
 */
export function resolveDesktopCarriedGeodesicCannonAnchor(
  cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  activeAimRay: RootAimRay | undefined,
): Vec3 | undefined {
  if (!activeAimRay) {
    return undefined;
  }

  const screenPoint = threePointToWorld(
    activeAimRay.origin.clone().add(
      activeAimRay.direction.clone().multiplyScalar(carriedGeodesicEmitterDesktopDistanceMeters),
    ),
  );
  return {
    x: screenPoint.x,
    y: screenPoint.y,
    z: cannon.localPose.translation.z,
  };
}

/**
 * Computes where a carried cannon sits in VR: directly under the aim-ray origin (the hand), in cell-local coordinates.
 *
 * Only x and y follow the hand; z keeps the cannon's current `localPose.translation.z`.
 * Returns `undefined` when there is no active aim ray.
 */
export function resolveVrCarriedGeodesicCannonAnchor(
  cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  activeAimRay: RootAimRay | undefined,
): Vec3 | undefined {
  if (!activeAimRay) {
    return undefined;
  }

  const handPoint = threePointToWorld(activeAimRay.origin);
  return {
    x: handPoint.x,
    y: handPoint.y,
    z: cannon.localPose.translation.z,
  };
}

/**
 * Creates the hidden translucent pink open cylinder that highlights a carried emitter.
 *
 * The mesh starts invisible and unparented; the caller positions, shows, and adds it to the scene. The caller
 * owns its geometry and material and must dispose them (e.g. via `disposeObject3D`).
 */
export function createCarriedGeodesicCannonGlow(): THREE.Mesh {
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 1.72, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff7ac8,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glow.name = "carried-geodesic-emitter-glow";
  glow.renderOrder = 925;
  glow.visible = false;
  return glow;
}

/**
 * Picks which of a cannon's geodesics an action applies to.
 *
 * Returns the requested id if the cannon owns it, otherwise the cannon's active geodesic, otherwise its first
 * geodesic; `undefined` only when the cannon has none and no active id.
 */
export function resolveCannonGeodesicId(
  cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  requestedGeodesicId: string | undefined,
): string | undefined {
  if (requestedGeodesicId && cannon.geodesicIds.includes(requestedGeodesicId)) {
    return requestedGeodesicId;
  }

  return cannon.activeGeodesicId ?? cannon.geodesicIds[0];
}

/**
 * Returns the cell-local emitter (beam origin) point of a cannon in meters.
 *
 * This is the cannon's translation raised by `geodesicRayBeamHeightMeters` along z; yaw is not applied because
 * the offset is purely vertical.
 */
export function resolveGeodesicCannonAbsoluteEmitterPoint(
  cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
): Vec3 {
  return {
    x: cannon.localPose.translation.x,
    y: cannon.localPose.translation.y,
    z: cannon.localPose.translation.z + geodesicRayBeamHeightMeters,
  };
}

/**
 * Returns the signed distance in meters from a segment's start to a cell-local point, projected onto the segment direction.
 *
 * Assumes `segment.direction` is a unit vector in the same cell-local frame; the result is negative behind the
 * start and is not clamped to the segment length.
 */
export function getDistanceAlongGeodesicSegment(
  segment: Extract<RuntimeWorldObject, { readonly kind: "geodesic-segment" }>,
  localPoint: Vec3,
): number {
  const dx = localPoint.x - segment.start.x;
  const dy = localPoint.y - segment.start.y;
  const dz = localPoint.z - segment.start.z;
  return dx * segment.direction.x + dy * segment.direction.y + dz * segment.direction.z;
}

/**
 * Formats a geodesic segment's terminal as a compact debug string such as `wall-hit:2` or `portal-hit:p->cell:q`.
 *
 * The switch is exhaustive over terminal kinds, so adding a kind without updating it fails type checking.
 */
export function formatGeodesicTerminal(terminal: Extract<RuntimeWorldObject, { readonly kind: "geodesic-segment" }>["terminal"]): string {
  switch (terminal.kind) {
    case "open":
      return "open";
    case "emitter-hit":
      return `emitter-hit:${terminal.emitterId}`;
    case "portal-hit":
      return `portal-hit:${terminal.portalId}->${terminal.targetCellId}:${terminal.targetPortalId}`;
    case "wall-hit":
      return `wall-hit:${terminal.sideIndex}`;
    case "forbidden-zone-hit":
      return `forbidden-zone-hit:${terminal.junctionId}`;
  }
}
