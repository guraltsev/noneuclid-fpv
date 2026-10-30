/**
 * Geodesic emitters ("cannons"), geodesic intervals and curve shortening on a glued cell complex.
 *
 * ## Setting
 * The world is a cell complex: convex prism cells, each with its own local frame (x right, y forward, z up, meters), glued along
 * portals. A portal carries a rigid map `transformToTarget` from its cell's frame to the neighbouring cell's frame. A geodesic is a
 * locally straight horizontal line: it is a straight ray inside each cell and continues across a portal as the image of that ray under
 * `transformToTarget`. Radians are counter-clockwise from +x (`yaw`); lengths are meters; all beams lie at a constant height
 * (`geodesicRayBeamHeightMeters` above the emitter floor point).
 *
 * ## Objects (all live in a `RuntimeObjectRegistry`)
 * - `GeodesicCannonObject` (emitter): a placed object that geodesic endpoints can attach to.
 * - `FreeGeodesicEndObject`: an invisible anchor for an endpoint that is not on an emitter.
 * - `GeodesicCornerObject`: an invisible pinned anchor at a corner of a taut geodesic polygon, next to the forbidden disk it wraps.
 * - `GeodesicIntervalObject`: THE authoritative geodesic. It has two endpoint attachments (`start`, `end`; each names an anchor object, an
 *   emitter or a free end) and a PORTAL WORD: the ordered list of portal traversals from `start` to `end`. Nothing else is stored.
 * - `GeodesicSegmentObject`: derived, per-cell straight pieces of an interval, regenerated from the interval whenever it changes.
 *   Never edit them directly. Their `terminal` says why a piece stops: `open` (the length was used up), `portal-hit` (continues in the
 *   next segment), `wall-hit`, `forbidden-zone-hit` (cylinder of a junction) or `emitter-hit`. Each interval's segments are also
 *   labelled with a `halfRole` (the first half of the total length belongs to the `start` role, the second to `end`), so that a click
 *   on a segment resolves to an endpoint (`resolveGeodesicEndpointSelectionFromSegmentHit`).
 * - `GeodesicIntersectionObject`: computed markers where segments of two different geodesics cross in a cell.
 * - `CurveShorteningPairObject`: bookkeeping of one shortening process (see below).
 *
 * ## Development: how a portal word fixes the geometry
 * Let the word read from `a` be `t_1 ... t_n`, with `T_i` the `transformToTarget` of the portal of `t_i`. The destination anchor `b`
 * lives in the frame of the last cell. Its pull-back `T_1^{-1}(... T_n^{-1}(b))` expresses it in the frame of `a`'s cell
 * (`liftGeodesicEndpoint`). The geodesic of that class is the straight segment from `a` to the pull-back; its direction is the launch
 * yaw and its length is the geodesic length (`rebuildDerivedGeodesicSegments`). To obtain the per-cell segments, that chord is traced
 * through the world (`traceGeodesicSegment` per cell, restarted in the target cell at each `portal-hit`), and the trace is accepted only
 * if the portals it actually crosses reproduce the stored word, otherwise it would be a different homotopy class. Reading the word
 * from `end` uses `reverseGeodesicPortalWord`. A chord shorter than `GEODESIC_MIN_LENGTH_METERS` is degenerate. Free ends (not on emitters) are
 * "free" because shooting (`shootGeodesic`) fixes the word by tracing the ray first and then recording what it crossed.
 *
 * ## Locked and moving intervals
 * An interval whose both endpoints are pinned anchors (emitters or polygon corners) is LOCKED (`isGeodesicLocked`): carrying an emitter keeps the interval and updates its
 * word by the portal the emitter crossed (both ends of a loop on that emitter move, so its word is conjugated: `w -> p^-1 w p`)
 * (`rebuildLockedGeodesicFromEndpointsAndPortalWord`). An interval with an emitter and a free end
 * is an aimable free geodesic (`aimFreeGeodesicFromEndpoint`, `extendGeodesic`, split by `splitGeodesicIntervalAtSegmentHit`).
 * `motionState: "moving"` marks intervals owned by a curve-shortening pair; `"stable"` is everything else.
 *
 * ## Curve shortening (issue 31/32)
 * `tieAndDetachGeodesicEndpoints` detaches two endpoint roles (possibly the two roles of one loop) from an emitter and ties them to one
 * shared free end F, creating a `CurveShorteningPairObject`. The next `advanceCurveShorteningPairs` call resolves the pair in one tick
 * (`resolveCurveShorteningPair`): the role-aware concatenation of the two arcs' words, freely reduced (`getPortalWordBetweenEndpointRoles`,
 * `reduceAdjacentInversePortalTraversals`), is developed into a sleeve of apertures (`sleeve.ts`), and the shortest path of that homotopy
 * class is the straight chord, or a taut string that wraps the forbidden-zone disks at portal junctions. Wraps are drawn as corners,
 * pinned `GeodesicCornerObject` anchors, so the result is a chain of stable locked intervals. A single interval whose two roles share F is a
 * free loop: with a translation as holonomy it stays as a stable loop, with a rotation (it encircles a cone point) it is deleted with a
 * notice. A pair that cannot be resolved is left as it was and marked `"unresolved"`. There is no gradient descent.
 *
 * ## Intersections and bookkeeping
 * `updateGeodesicIntersectionObjects` recomputes the crossing markers of all segments (same cell, different geodesics) and keeps marker ids
 * stable. Emitter objects also carry caches (`geodesicIds`, `activeGeodesicId`, per-geodesic yaw) that `syncLegacyEmitterGeodesicFields`
 * keeps in line with the intervals.
 *
 * ## Legacy
 * The pre-interval emitter-connection model was deleted (job 26). Its readers remain (`geodesicConnectionsById`, `GeodesicEmitterConnection`,
 * `getGeodesicConnection`) and are marked `Legacy:`; the `"straightening"` connection state survives only as the display state of moving intervals.
 *
 * ## Constants
 * Meters unless stated. `GEODESIC_MIN_LENGTH_METERS` (0.15) minimum chord of a geodesic; `minGeodesicSegmentLengthMeters` (0.05) minimum
 * piece when splitting; `intersectionTolerance` (1e-7) numerical zero; `forbiddenZoneCircleToleranceMeters` (1e-9) band of the open-disk rule;
 * `emitterConnectionToleranceMeters` (0.3) capture radius around an emitter; `geodesicCornerClearanceMeters` (1e-6, in `sleeve.ts`) extra
 * radius of the forbidden disk wrapped by the taut string.
 *
 * The geodesic code is split over the modules of `src/world-objects/geodesic/`; this module holds the object types,
 * constants, constructors and small geometry helpers they share.
 */
import type { SimpleCollisionCylinder } from "../../movement/dynamicObject";
import { identityRigidTransform3, yawRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, normalizeVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeWorldObject, RuntimeWorldObjectBase } from "../runtimeObjectRegistry";
import { reduceAdjacentInversePortalTraversals } from "./portalWord";

// ---- Runtime object shapes ----

/**
 * A geodesic emitter ("cannon"): a placeable runtime object that geodesic intervals attach their endpoints to.
 *
 * The cannon sits on the cell floor (`localPose.translation.z` is the floor height); the beam it emits starts
 * `geodesicRayBeamHeightMeters` above that. Frames are cell-local (x right, y forward, z up). The cannon does NOT own
 * geometry: the authoritative geodesic data are the `GeodesicIntervalObject`s whose `start`/`end` attachments reference
 * this cannon's id; `geodesicIds`, `activeGeodesicId`, `geodesicEmitterYawRadiansById` and `geodesicConnectionsById` are
 * menu/UI caches kept in sync by `syncLegacyEmitterGeodesicFields` and may lag behind the registry.
 */
export interface GeodesicCannonObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-cannon";
  /** Marker consumed by `canObjectAttachGeodesics`: this object may be the anchor of an interval endpoint. */
  readonly canAttachGeodesics?: true;
  /** Geodesic currently selected in the emitter menu (cache; may name a geodesic that no longer exists). */
  readonly activeGeodesicId?: string;
  /** Ids of geodesics listed under this cannon (cache of the interval attachments). */
  readonly geodesicIds: readonly string[];
  /** Per-geodesic launch yaw in radians (cell-local, 0 = +x, counter-clockwise); overrides `aimYawRadians` for that geodesic. */
  readonly geodesicEmitterYawRadiansById?: Readonly<Record<string, number>>;
  /** Legacy: per-geodesic connection state from the pre-interval model; superseded by interval endpoint attachments (see `getGeodesicConnection`). */
  readonly geodesicConnectionsById?: Readonly<Record<string, GeodesicEmitterConnection>>;
  /** Default launch yaw in radians, normalized by `sanitizeYaw`; equals the yaw of `localPose.rotation`. */
  readonly aimYawRadians: number;
}

/**
 * Legacy: connection record of the pre-interval model describing how a geodesic leaves and (maybe) re-enters emitters.
 *
 * In the current model this is derived from interval attachments by `getGeodesicConnection`; a stored `"straightening"`
 * state belongs to the retired same-cell straightening path, which no longer exists.
 */
export interface GeodesicEmitterConnection {
  readonly outgoingEmitterId: string;
  readonly incomingEmitterId?: string;
  readonly state: "open" | "connected" | "straightening";
}

/**
 * One crossing of a portal, recorded by the ids on both sides; a sequence of these is a portal word.
 *
 * Invariant for a valid word: consecutive traversals chain, i.e. `word[i].targetCellId === word[i+1].sourceCellId`.
 * The rigid transform is not stored; it is recovered from the compiled world as
 * `world.cellsById.get(sourceCellId).portalsById.get(sourcePortalId).transformToTarget`, which maps
 * source-cell-local coordinates to target-cell-local coordinates.
 */
export interface GeodesicPortalTraversal {
  readonly sourceCellId: string;
  readonly sourcePortalId: string;
  readonly targetCellId: string;
  readonly targetPortalId: string;
}

/** A `GeodesicPortalTraversal` that also carries the portal's rigid transform, reported when a carried emitter crosses a portal. */
export interface GeodesicCarryPortalTransition extends GeodesicPortalTraversal {
  readonly transformToTarget: RigidTransform3;
}

/** Which end of a geodesic interval: `"start"` is the end the portal word is read from, `"end"` the one it arrives at. */
export type GeodesicEndRole = "start" | "end";

/**
 * Which half of an interval a derived segment belongs to (split at the midpoint of the total length).
 *
 * A `"start"` half is attached to `interval.start`, an `"end"` half to `interval.end`; used so a clicked segment can be
 * resolved to an endpoint (see `resolveGeodesicEndpointSelectionFromSegmentHit`).
 */
export type GeodesicHalfRole = "start" | "end";

/** Attachment of one endpoint role of one geodesic interval to an anchor object (emitter or free end). */
export interface GeodesicEndpointAttachment {
  readonly geodesicId: string;
  readonly role: GeodesicEndRole;
  readonly anchorObjectId: string;
}

/** An endpoint attachment picked by the user (typically from a segment hit) as input to tie-and-detach. */
export interface GeodesicEndpointSelection extends GeodesicEndpointAttachment {}

/**
 * An invisible, non-colliding anchor object marking a geodesic endpoint that is not on an emitter.
 *
 * Its `localPose.translation` is the endpoint position in cell `cellId` (cell-local meters, including beam height in z).
 * It is deleted automatically once no interval refers to it (`removeUnusedFreeGeodesicEnds`). A shared free end (two
 * attached roles) is the moving vertex of a curve-shortening pair.
 */
export interface FreeGeodesicEndObject extends RuntimeWorldObjectBase {
  readonly kind: "free-geodesic-end";
  readonly canAttachGeodesics: true;
  /** Optional face the end was authored on; informational, not used by the tracing math. */
  readonly faceId?: string;
}

/**
 * A pinned, invisible anchor at a corner of a taut geodesic polygon, next to the forbidden disk it wraps.
 *
 * Created by the exact curve-shortening resolution (`resolveCurveShorteningPair`); its `localPose.translation` is the corner in cell
 * `cellId` (cell-local meters, z = beam height). Unlike a free end it is never aimed or moved by the user and counts as a lock for
 * `isGeodesicLocked`. It is deleted automatically once no interval refers to it (`removeUnusedFreeGeodesicEnds`).
 */
export interface GeodesicCornerObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-corner";
  readonly canAttachGeodesics: true;
  /** Junction id (`"<cellId>:vertex-<i>"`) of the disk this corner wraps, in the corner's own cell. */
  readonly junctionId: string;
  /** Side of the wrapped disk relative to the travel direction from the chain's start anchor to its end anchor. */
  readonly side: "left" | "right";
}

/**
 * The authoritative description of one geodesic: two endpoint attachments plus the portal word joining them.
 *
 * Invariants: `start.geodesicId === end.geodesicId === id`; `startCellId` (= `cellId`) is the cell of the `start`
 * anchor; `portalWord` is ordered from `start` toward `end`, chains cell to cell, begins in `startCellId` and ends
 * in the `end` anchor's cell (see `portalWordMatchesCurrentEndpointCells`). The geometry (a straight line in the
 * development along `portalWord`) is fully determined by these data and is materialized as
 * `GeodesicSegmentObject`s by `rebuildDerivedGeodesicSegments`. The interval itself is invisible and not collidable.
 */
export interface GeodesicIntervalObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-interval";
  readonly start: GeodesicEndpointAttachment;
  readonly end: GeodesicEndpointAttachment;
  /** Cell containing the `start` anchor; the tracing of the interval begins here. Mirrors `cellId`. */
  readonly startCellId: string;
  /** Ordered `start` -> `end` list of portals crossed; it fixes the homotopy class of the geodesic (empty when both ends are in one cell and the path stays inside it). */
  readonly portalWord: readonly GeodesicPortalTraversal[];
  /** `"moving"` while the interval belongs to a curve-shortening pair and is being retraced each tick; `"stable"` otherwise. */
  readonly motionState: "stable" | "moving";
}

/**
 * Bookkeeping object owning one curve-shortening process: two endpoint roles glued at a shared free end, resolved in one tick.
 *
 * Invariants (see issue 32): `first` and `second` are different endpoint roles attached to `freeEndAnchorId`
 * (they may belong to the same interval, which is then a free loop); every referenced interval is `"moving"`.
 * The object is invisible; `cellId`/`localPose` merely mirror `lastGoodFreeEndCellId`/`lastGoodFreeEndPoint`. A pair whose resolution failed has `state: "unresolved"`.
 */
export interface CurveShorteningPairObject extends RuntimeWorldObjectBase {
  readonly kind: "curve-shortening-pair";
  readonly first: GeodesicEndpointAttachment;
  readonly second: GeodesicEndpointAttachment;
  /** Id of the shared `FreeGeodesicEndObject` that both roles attach to. */
  readonly freeEndAnchorId: string;
  /** Cell of the shared free end when the pair was created (informational; the pose mirrors it). */
  readonly lastGoodFreeEndCellId: string;
  /** Cell-local position (meters) of the shared free end when the pair was created (informational). */
  readonly lastGoodFreeEndPoint: Vec3;
  /** `"moving"` until the next `advanceCurveShorteningPairs` call resolves the pair; `"unresolved"` after a failed resolution (later calls skip it). */
  readonly state: "moving" | "unresolved";
}

/**
 * An interval's far endpoint pulled back into the cell of a chosen source endpoint (the "development" of the interval).
 *
 * Within the source cell's local frame, the geodesic is the straight segment from `sourcePoint` to
 * `targetPointInSourceCell`; its length is the interval's length and its direction is the launch direction.
 */
export interface LiftedGeodesicEndpoint {
  readonly sourceRole: GeodesicEndRole;
  readonly targetRole: GeodesicEndRole;
  readonly sourceAnchorObjectId: string;
  readonly targetAnchorObjectId: string;
  /** Cell containing the source anchor (frame of `sourcePoint` and `targetPointInSourceCell`). */
  readonly sourceCellId: string;
  readonly sourcePoint: Vec3;
  /** Target anchor position expressed in the source cell's frame after undoing the portal word (meters). */
  readonly targetPointInSourceCell: Vec3;
  /** The interval's word read from `sourceRole` to `targetRole` (reversed if the source is `"end"`). */
  readonly portalWordFromSourceToTarget: readonly GeodesicPortalTraversal[];
}

/**
 * Outcome of rebuilding an interval's derived geometry: the interval, its new segments, and how the trace ended.
 *
 * `terminal` classifies the last trace: `free-end` (reached a free end), `emitter-hit` (reached an emitter), or a failure
 * kind (`wall-hit`, `forbidden-zone-hit`) when the path was cut short.
 */
export interface GeodesicTraceBuildResult {
  readonly interval: GeodesicIntervalObject;
  readonly segments: readonly GeodesicSegmentObject[];
  readonly terminal:
    | { readonly kind: "free-end"; readonly freeEndObjectId: string }
    | { readonly kind: "emitter-hit"; readonly emitterId: string }
    | { readonly kind: "forbidden-zone-hit"; readonly junctionId: string }
    | { readonly kind: "wall-hit"; readonly sideIndex: number };
}

/**
 * A derived, per-cell straight piece of a geodesic: a ray inside one cell from `start` along `direction` for `lengthMeters`.
 *
 * A geodesic crossing portals is represented by consecutive segments (ids `<geodesicId>:segment:<n>`), each ending at a
 * portal (terminal `portal-hit`) except the last. Segments are computed data (regenerated by `rebuildDerivedGeodesicSegments`
 * and friends); never edit them to change a geodesic. `cellId` is the cell whose frame `start`/`direction` use.
 */
export interface GeodesicSegmentObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-segment";
  /** Id of the owning `GeodesicIntervalObject` (or, for legacy data, of the emitter-side geodesic). */
  readonly geodesicId: string;
  /** Display number ("G1", "G2", ...) assigned by `getGlobalGeodesicNumbers`; optional cache. */
  readonly geodesicNumber?: number;
  /** 0-based position along the geodesic from its `start`; segments sort by this. */
  readonly segmentIndex: number;
  /** Set when the segment belongs to the start or end half of the interval (halves split at half the total length). */
  readonly halfRole?: GeodesicHalfRole;
  /** Segment origin in `cellId`'s frame (meters; z is the constant beam height). */
  readonly start: Vec3;
  /** Unit horizontal travel direction (z = 0) in `cellId`'s frame. */
  readonly direction: Vec3;
  /** Length in meters, measured along `direction` from `start`. */
  readonly lengthMeters: number;
  /** What stops this segment; `portal-hit` means the geodesic continues in the next segment. */
  readonly terminal: GeodesicSegmentTerminal;
  /** Display state of the owning geodesic: `"connected"` (emitter at both ends), `"open"`, or `"straightening"`, which is now also used for `"moving"` curve-shortening intervals (see `resolveDerivedSegmentConnectionState`). */
  readonly connectionState?: "open" | "connected" | "straightening";
  /** UI-only highlight for a half chosen in the tie-and-detach flow. */
  readonly highlightState?: "tie-detach-selected";
}

/**
 * A computed marker where two distinct geodesics' segments cross in the same cell.
 *
 * Derived data maintained by `updateGeodesicIntersectionObjects`; ids are remembered per geodesic/segment pair so markers stay stable between frames.
 */
export interface GeodesicIntersectionObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-intersection";
  /** The two crossing geodesics (distinct ids). */
  readonly geodesicIds: readonly [string, string];
  /** The two crossing segments, in the same order as `geodesicIds`. */
  readonly segmentIds: readonly [string, string];
}

/**
 * How a single per-cell segment ends.
 *
 * - `open`: the traced length was used up inside the cell (the requested length, or the lifted chord, ends here).
 * - `emitter-hit`: the segment ends at an emitter (when emitter connection is enabled or the anchored target is an emitter).
 * - `portal-hit`: the ray reached a portal side; `targetStart`/`targetDirection` are the continuation in the target cell,
 *   exact images of the hit point and direction (no nudge); a restart there must skip the target side (`entrySideIndex`) or use
 *   the multi-cell path tracer, which walks the developed segment with `walkDevelopedSegment`.
 * - `wall-hit`: the ray reached a side without a portal (`sideIndex` of the cell's side list).
 * - `forbidden-zone-hit`: the ray entered a forbidden collision zone of a junction (`junctionId`).
 */
export type GeodesicSegmentTerminal =
  | { readonly kind: "open" }
  | { readonly kind: "emitter-hit"; readonly emitterId: string }
  | {
      readonly kind: "portal-hit";
      readonly portalId: string;
      readonly targetCellId: string;
      readonly targetPortalId: string;
      readonly targetStart: Vec3;
      readonly targetDirection: Vec3;
    }
  | { readonly kind: "wall-hit"; readonly sideIndex: number }
  | { readonly kind: "forbidden-zone-hit"; readonly junctionId: string };

/** Construction options for `createGeodesicCannonObject`; omitted optional fields get the defaults documented there. */
export interface CreateGeodesicCannonOptions {
  readonly id: string;
  readonly cellId: string;
  readonly localPose: RigidTransform3;
  readonly activeGeodesicId?: string;
  readonly geodesicIds?: readonly string[];
  readonly geodesicEmitterYawRadiansById?: Readonly<Record<string, number>>;
  readonly geodesicConnectionsById?: Readonly<Record<string, GeodesicEmitterConnection>>;
  readonly aimYawRadians?: number;
  readonly collision?: SimpleCollisionCylinder;
}

/** One traced piece: the cell, the (normalized) ray used, the length actually travelled, and why it stopped. */
export interface TraceGeodesicSegmentResult {
  readonly cellId: string;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly lengthMeters: number;
  readonly terminal: GeodesicSegmentTerminal;
}

/**
 * Result of the cannon placement functions: the placed (registry) cannon, or `placed: false` with a coarse `reason`.
 *
 * `reason` is overloaded: besides real collisions, `"missing-cell"` is also returned when the segment/vertex to split does not exist and
 * `"cell-collision"` when the split point is too close to a segment start or the split failed.
 */
export interface PlaceGeodesicCannonResult {
  /** Whether a cannon was added to the registry. */
  readonly placed: boolean;
  /** The cannon as stored in the registry (set when `placed`). */
  readonly object?: GeodesicCannonObject;
  /** Why placement was refused (set when `!placed`). */
  readonly reason?: "missing-cell" | "cell-collision" | "runtime-object-collision";
}

// ---- Constants ----

/** Collision cylinder of a new cannon: radius 0.3 m, height 0.75 m, standing on the floor. */
const defaultCannonCollision: SimpleCollisionCylinder = {
  radius: 0.3,
  height: 0.75,
  offset: { x: 0, y: 0, z: 0.375 },
};

/** Height of the geodesic beam above an emitter's floor point, in meters. */
export const geodesicRayBeamHeightMeters = 1.08;

/** Horizontal distance (meters) by which a beam starts away from its emitter center along the launch direction; currently 0. */
export const geodesicRayBeamStartOffsetMeters = 0;

/** Smallest lifted chord length (meters) of a valid interval; shorter intervals are degenerate and are deleted or rejected. */
export const GEODESIC_MIN_LENGTH_METERS = 0.15;

/** Default total trace length (meters) when a caller passes no `maxLengthMeters`. */
export const defaultTraceLengthMeters = 2;

/** Numerical tolerance for ray/side parallelism, hit parameters and length comparisons (meters / unitless). */
export const intersectionTolerance = 1e-7;

/** Smallest segment/continuation length (meters) worth creating when splitting or building free geodesics. */
export const minGeodesicSegmentLengthMeters = 0.05;

/** Perpendicular distance (meters) within which a ray counts as hitting an emitter; equal to the cannon collision radius. */
export const emitterConnectionToleranceMeters = 0.3;

// ---- Construction and type guards ----

/**
 * Builds a geodesic emitter object from options, filling defaults.
 *
 * `aimYawRadians` defaults to the yaw of `localPose` and is sanitized; the stored pose rotation is replaced by a pure
 * yaw rotation of that angle (so pitch/roll are discarded). `geodesicIds` defaults to `[activeGeodesicId]` or empty.
 * Pure; does not touch any registry.
 */
export function createGeodesicCannonObject(options: CreateGeodesicCannonOptions): GeodesicCannonObject {
  const aimYawRadians = sanitizeYaw(options.aimYawRadians ?? yawFromPose(options.localPose));

  return {
    id: options.id,
    kind: "geodesic-cannon",
    canAttachGeodesics: true,
    cellId: options.cellId,
    localPose: {
      ...options.localPose,
      rotation: yawRigidTransform3(aimYawRadians).rotation,
    },
    collision: options.collision ?? defaultCannonCollision,
    portalRenderable: true,
    displayHelpMessage: "Creates and edits geodesic rays. Open its menu to add, carry, rotate, aim, tie, detach, or delete rays.",
    tooltip: {
      label: "Geodesic emitter",
      rangeMeters: 2.5,
    },
    activeGeodesicId: options.activeGeodesicId,
    geodesicIds: options.geodesicIds ?? (options.activeGeodesicId ? [options.activeGeodesicId] : []),
    geodesicEmitterYawRadiansById: options.geodesicEmitterYawRadiansById,
    geodesicConnectionsById: options.geodesicConnectionsById,
    aimYawRadians,
  };
}

/** Type guard: true when the object is a `GeodesicSegmentObject` (`kind === "geodesic-segment"`). */
export function isGeodesicSegmentObject(object: { readonly kind: string }): object is GeodesicSegmentObject {
  return object.kind === "geodesic-segment";
}

/** Type guard: true when the object is a `GeodesicIntersectionObject`. */
export function isGeodesicIntersectionObject(object: { readonly kind: string }): object is GeodesicIntersectionObject {
  return object.kind === "geodesic-intersection";
}

/** Type guard: true when the object is a `GeodesicCannonObject`. */
export function isGeodesicCannonObject(object: { readonly kind: string }): object is GeodesicCannonObject {
  return object.kind === "geodesic-cannon";
}

/** Type guard: true when the object is a `GeodesicIntervalObject`. */
export function isGeodesicIntervalObject(object: { readonly kind: string }): object is GeodesicIntervalObject {
  return object.kind === "geodesic-interval";
}

/** Type guard: true when the object is a `FreeGeodesicEndObject`. */
export function isFreeGeodesicEndObject(object: { readonly kind: string }): object is FreeGeodesicEndObject {
  return object.kind === "free-geodesic-end";
}

/** Type guard: true when the object is a `GeodesicCornerObject`. */
export function isGeodesicCornerObject(object: RuntimeWorldObject | undefined): object is GeodesicCornerObject {
  return object?.kind === "geodesic-corner";
}

/**
 * Builds a corner anchor at `point` (cell-local meters, z = beam height) in cell `cellId`, wrapping the disk `junctionId` on `side`.
 *
 * Pure; the caller adds it to the registry. The object is invisible, non-colliding and without a tooltip.
 */
export function createGeodesicCornerObject(input: {
  readonly id: string;
  readonly cellId: string;
  readonly point: Vec3;
  readonly junctionId: string;
  readonly side: "left" | "right";
}): GeodesicCornerObject {
  return {
    id: input.id,
    kind: "geodesic-corner",
    canAttachGeodesics: true,
    cellId: input.cellId,
    localPose: yawRigidTransform3(0, input.point),
    portalRenderable: false,
    junctionId: input.junctionId,
    side: input.side,
  };
}

/** Type guard: true when the object is a `CurveShorteningPairObject`. */
export function isCurveShorteningPairObject(object: { readonly kind: string }): object is CurveShorteningPairObject {
  return object.kind === "curve-shortening-pair";
}

/**
 * Builds a free-end anchor at `point` (cell-local meters, including its beam height in z) in cell `cellId`.
 *
 * Pure; the caller adds it to the registry. The object is non-renderable through portals and can attach geodesics.
 */
export function createFreeGeodesicEndObject(input: {
  readonly id: string;
  readonly cellId: string;
  readonly point: Vec3;
}): FreeGeodesicEndObject {
  return {
    id: input.id,
    kind: "free-geodesic-end",
    canAttachGeodesics: true,
    cellId: input.cellId,
    localPose: yawRigidTransform3(0, input.point),
    portalRenderable: false,
  };
}

/**
 * Builds a geodesic interval from two anchor ids, a start cell and an optional portal word.
 *
 * Defaults: empty `portalWord`, `motionState: "stable"`. The word is freely reduced (adjacent inverse traversals cancel). Does not validate that the word matches the anchors' cells and
 * does not generate segments; call `rebuildDerivedGeodesicSegments` afterwards. Pure; the caller adds it to the registry.
 */
export function createGeodesicIntervalObject(input: {
  readonly id: string;
  readonly startAnchorObjectId: string;
  readonly endAnchorObjectId: string;
  readonly startCellId: string;
  readonly portalWord?: readonly GeodesicPortalTraversal[];
  readonly motionState?: "stable" | "moving";
}): GeodesicIntervalObject {
  return {
    id: input.id,
    kind: "geodesic-interval",
    cellId: input.startCellId,
    localPose: identityRigidTransform3,
    portalRenderable: false,
    startCellId: input.startCellId,
    portalWord: reduceAdjacentInversePortalTraversals(input.portalWord ?? []),
    motionState: input.motionState ?? "stable",
    start: {
      geodesicId: input.id,
      role: "start",
      anchorObjectId: input.startAnchorObjectId,
    },
    end: {
      geodesicId: input.id,
      role: "end",
      anchorObjectId: input.endAnchorObjectId,
    },
  };
}

/**
 * Builds a curve-shortening pair object (see `CurveShorteningPairObject`); `state` defaults to `"moving"`.
 *
 * Pure; the caller adds it to the registry. The pose mirrors the last-good free-end location.
 */
export function createCurveShorteningPairObject(input: {
  readonly id: string;
  readonly first: GeodesicEndpointAttachment;
  readonly second: GeodesicEndpointAttachment;
  readonly freeEndAnchorId: string;
  readonly lastGoodFreeEndCellId: string;
  readonly lastGoodFreeEndPoint: Vec3;
  readonly state?: "moving" | "unresolved";
}): CurveShorteningPairObject {
  return {
    id: input.id,
    kind: "curve-shortening-pair",
    cellId: input.lastGoodFreeEndCellId,
    localPose: yawRigidTransform3(0, input.lastGoodFreeEndPoint),
    portalRenderable: false,
    first: input.first,
    second: input.second,
    freeEndAnchorId: input.freeEndAnchorId,
    lastGoodFreeEndCellId: input.lastGoodFreeEndCellId,
    lastGoodFreeEndPoint: input.lastGoodFreeEndPoint,
    state: input.state ?? "moving",
  };
}

/** Returns the segment's end point, `start + direction * lengthMeters`, in the segment's cell frame (meters). */
export function getGeodesicSegmentEnd(segment: GeodesicSegmentObject): Vec3 {
  return addVec3(segment.start, scaleVec3(segment.direction, segment.lengthMeters));
}

/** True unless the segment ended at a wall, forbidden zone or emitter (those terminals cannot be continued). */
export function canExtendGeodesicSegment(segment: GeodesicSegmentObject): boolean {
  return segment.terminal.kind !== "wall-hit" &&
    segment.terminal.kind !== "forbidden-zone-hit" &&
    segment.terminal.kind !== "emitter-hit";
}

/**
 * Yaw (radians, normalized by `sanitizeYaw`) from the cannon toward a cell-local target point.
 *
 * Returns `undefined` if the target is non-finite or horizontally within `intersectionTolerance` of the cannon.
 */
export function resolveGeodesicCannonAimYawRadians(
  cannon: GeodesicCannonObject,
  targetLocalPoint: Vec3,
): number | undefined {
  const dx = targetLocalPoint.x - cannon.localPose.translation.x;
  const dy = targetLocalPoint.y - cannon.localPose.translation.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= intersectionTolerance) {
    return undefined;
  }

  return sanitizeYaw(Math.atan2(dy, dx));
}

/** Point where the cannon's beam starts, in the cannon's cell frame. */
export function getGeodesicCannonEmitterPoint(cannon: GeodesicCannonObject): Vec3 {
  return {
    x: cannon.localPose.translation.x,
    y: cannon.localPose.translation.y,
    z: cannon.localPose.translation.z + geodesicRayBeamHeightMeters,
  };
}

/** True when the object may be the anchor of a geodesic interval endpoint. */
export function canObjectAttachGeodesics(object: RuntimeWorldObject | undefined): object is RuntimeWorldObject {
  return object !== undefined &&
    (object.kind === "geodesic-cannon" || ("canAttachGeodesics" in object && object.canAttachGeodesics === true));
}

/** Beam-height point of an anchor object in its cell frame. */
export function getAnchorBeamPoint(anchor: RuntimeWorldObject): Vec3 {
  return anchor.kind === "geodesic-cannon"
    ? getGeodesicCannonEmitterPoint(anchor)
    : anchor.localPose.translation;
}

/** The other endpoint role: `start` for `end` and `end` for `start`. */
export function getOppositeEndRole(role: GeodesicEndRole): GeodesicEndRole {
  return role === "start" ? "end" : "start";
}

/** Unit horizontal direction of a yaw (radians counter-clockwise from +x). */
export function directionFromYaw(yawRadians: number): Vec3 {
  return normalizeHorizontalDirection({ x: Math.cos(yawRadians), y: Math.sin(yawRadians), z: 0 });
}

/** Normalizes the horizontal part of a direction; the result has `z = 0`. */
export function normalizeHorizontalDirection(direction: Vec3): Vec3 {
  const normalized = normalizeVec3({ x: direction.x, y: direction.y, z: 0 });
  return { x: normalized.x, y: normalized.y, z: 0 };
}

// Extracts the yaw (rotation about +z, radians) from a pose's rotation matrix as atan2(m10, m00).
function yawFromPose(pose: RigidTransform3): number {
  return Math.atan2(pose.rotation.m10, pose.rotation.m00);
}

// Wraps an angle to (-pi, pi] via atan2(sin, cos); non-finite input becomes 0.
/** Wraps an angle to (-pi, pi] via atan2(sin, cos); non-finite input becomes 0. */
export function sanitizeYaw(yawRadians: number): number {
  if (!Number.isFinite(yawRadians)) {
    return 0;
  }

  return Math.atan2(Math.sin(yawRadians), Math.cos(yawRadians));
}
