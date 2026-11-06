/**
 * Anchors of geodesic intervals: which registry objects can hold an endpoint, and where the beam of one starts in its cell frame.
 */
import type { Vec3 } from "../../math/vec3";
import type { RuntimeWorldObject } from "../runtimeObjectRegistry";
import { getGeodesicCannonEmitterPoint } from "./objects";

/** True when the object may be the anchor of a geodesic interval endpoint. */
export function canObjectAttachGeodesics(object: RuntimeWorldObject | undefined): object is RuntimeWorldObject {
  return object !== undefined &&
    (object.kind === "geodesicEmitters/emitter" || ("canAttachGeodesics" in object && object.canAttachGeodesics === true));
}

/** Beam-height point of an anchor object in its cell frame. */
export function getAnchorBeamPoint(anchor: RuntimeWorldObject): Vec3 {
  return anchor.kind === "geodesicEmitters/emitter"
    ? getGeodesicCannonEmitterPoint(anchor)
    : anchor.localPose.translation;
}
