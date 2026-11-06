/**
 * Registry record types of the results of the player's tools: placed flags (signs), geodesic length labels and protractor angles.
 * Declarations only. They are split from the modules that create and refresh them (`placedFlags`, `measureLengthTool`, `protractorTool`) because those modules use the registry, and the registry unions these records.
 */
import type { Vec3 } from "../math/vec3";
import type { GeodesicEndRole } from "./geodesic/objects";
import type { RuntimeWorldObjectBase } from "./runtimeObjectBase";

/**
 * The available sign models, which also determine the default message prefix ("A" for WoodenSign1, "B" for WoodenSign2).
 */
export const placedFlagTypes = ["WoodenSign1", "WoodenSign2"] as const;
/**
 * Union of the sign model names in `placedFlagTypes`.
 */
export type PlacedFlagType = typeof placedFlagTypes[number];

/**
 * Registry record for a placed sign: its type, sanitized message and font color.
 */
export interface PlacedFlagObject extends RuntimeWorldObjectBase {
  readonly kind: "placedFlags/flag";
  readonly flagType: PlacedFlagType;
  readonly message: string;
}

/**
 * Registry record for a length label attached to a geodesic.
 * `lengthMeters` is the total length of all segments of `geodesicId` (across every cell), while `labelPoint` and `segmentId` identify where, in `cellId`'s frame, the label is anchored.
 */
export interface MeasuredGeodesicLengthObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesicMeasurements/length";
  /** Id of the measured geodesic interval. */
  readonly geodesicId: string;
  /** Optional display name used in place of `geodesicId` in the label text. */
  readonly label?: string;
  /** Total length of the geodesic in meters, summed over all of its segments in every cell. */
  readonly lengthMeters: number;
  /** Anchor point of the label in the cell-local frame of `cellId` (meters), lying on the anchoring segment. */
  readonly labelPoint: Vec3;
  /** Id of the segment (in `cellId`) the label is anchored to. */
  readonly segmentId?: string;
}

/**
 * Registry record for a persistent angle measurement.
 * `localPose` is the centre point with the first ray's yaw, `cellId` is the centre's cell, and all points are in that cell's local frame (meters). `angleRadians` is counterclockwise from `first` to `second` in [0, 2π).
 */
export interface ProtractorAngleObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesicMeasurements/angle";
  /** Id of the cannon or intersection object at the vertex; the angle is recomputed from it on refresh. */
  readonly centerObjectId: string;
  /** Vertex position in the cell-local frame (meters). */
  readonly centerPoint: Vec3;
  /** First side; the angle is measured counterclockwise from this ray. */
  readonly first: ProtractorDirectedGeodesic;
  /** Second side; the angle ends at this ray. */
  readonly second: ProtractorDirectedGeodesic;
  /** Counterclockwise angle from `first` to `second`, in [0, 2π). */
  readonly angleRadians: number;
  /** `angleRadians` converted to degrees, for display. */
  readonly angleDegrees: number;
  /** Arc radius in meters used for drawing and label placement. */
  readonly radiusMeters: number;
  /** Aiming box around the label, used to select the measurement for removal. */
  readonly labelHitbox?: ProtractorAngleLabelHitbox;
}

/**
 * Oriented box around an angle label used for aim picking, in the vertex cell's local frame.
 * `center` is in meters, `yawRadians` rotates the box about +z, and the three extents are full widths in meters.
 */
export interface ProtractorAngleLabelHitbox {
  readonly center: Vec3;
  readonly yawRadians: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly depthMeters: number;
}

/**
 * One side of an angle: a geodesic ray leaving the vertex.
 * Identifies the geodesic (and which end of it, for emitter endpoints), the segment or emitter used to read the direction, and the resolved horizontal yaw of the ray.
 */
export interface ProtractorDirectedGeodesic {
  readonly geodesicId: string;
  /** Which end of the geodesic interval this ray belongs to (start or end half), when relevant; two sides of the same geodesic are distinct only if their end roles differ. */
  readonly endRole?: GeodesicEndRole;
  readonly label?: string;
  /** Registry id of the segment this ray was read from, or a synthetic "<emitterId>:<geodesicId>:emitter" id for rays defined by an emitter's aim. */
  readonly segmentId: string;
  /** Direction of the ray as atan2(y, x) in the vertex cell's frame, normalised to (-π, π]. */
  readonly yawRadians: number;
  /** +1 if the ray points along the segment's stored direction, -1 if against it (pointing back towards the segment start). */
  readonly directionSign?: 1 | -1;
}
