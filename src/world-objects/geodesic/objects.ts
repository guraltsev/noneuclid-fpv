/**
 * Geodesic emitters ("cannons"), geodesic arcs and curve shortening on a glued cell complex.
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
 * - `GeodesicVertexObject` (`geodesicModel/vertex`, formerly "free geodesic end"): an invisible anchor for an endpoint that is not on an emitter.
 * - `GeodesicArcObject` (`geodesicModel/arc`, formerly "geodesic interval"): THE authoritative geodesic. It has two endpoint attachments (`start`, `end`; each names an anchor object, an
 *   emitter or a free end) and a PORTAL WORD: the ordered list of portal traversals from `start` to `end`. Nothing else is stored.
 * - `GeodesicSegmentObject` (`geodesicModel/segment`): derived, per-cell straight pieces of an interval, regenerated from the interval whenever it changes.
 *   Never edit them directly. Their `terminal` says why a piece stops: `open` (the length was used up), `portal-hit` (continues in the
 *   next segment), `wall-hit`, `forbidden-zone-hit` (cylinder of a junction) or `emitter-hit`. Each interval's segments are also
 *   labelled with a `halfRole` (the first half of the total length belongs to the `start` role, the second to `end`), so that a click
 *   on a segment resolves to an endpoint (`resolveGeodesicEndpointSelectionFromSegmentHit`).
 * - `GeodesicCrossingObject` (`geodesicModel/crossing`, formerly "geodesic intersection"): computed markers where segments of two different geodesics cross in a cell.
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
 * ## End nodes, interior vertices and tied arcs
 * An arc that CONNECTS EMITTERS (`arcConnectsEmitters`: both ends on emitters) is a geodesic of its own. A curve's END NODES are the arc ends on
 * an emitter; its INTERIOR VERTICES are `geodesicModel/vertex` objects shared by two or more arc ends. An arc is TIED (`isTied`) when it has an
 * end on such a vertex. An arc FOLLOWS an emitter (`arcFollowsEmitter`) when it has an end on it and connects emitters or is tied: carrying the
 * emitter keeps the arc and updates its word by the portal the emitter crossed (both ends of a loop on that emitter move, so its word is
 * conjugated: `w -> p^-1 w p`) (`rebuildLockedGeodesicFromEndpointsAndPortalWord`). An arc with an emitter and an unshared free end
 * is an aimable free geodesic (`aimFreeGeodesicFromEndpoint`, `extendGeodesic`, split by `splitGeodesicIntervalAtSegmentHit`).
 *
 * ## Curve shortening (issue 31/32)
 * `geodesicModel/tieAndDetach` detaches two endpoint roles (possibly the two roles of one loop) from an emitter and ties them to one
 * shared free end F; nothing else is recorded: a curve has no lifecycle. The curve then relaxes under the curve shortening flow of the `curveShortening` module:
 * every tied vertex moves each step along the descent direction of the total length by an exact line search, its two arcs are re-realized as
 * geodesic chords of their portal words (the words change by the portals the vertex crosses), and a vertex whose turning angle is below the tolerance is
 * removed, merging its two arcs. The vertex count never grows and the length never grows. A single interval whose two roles share F is a free loop:
 * with a translation as holonomy it is already taut and its vertex stays as a base point, with a rotation (it encircles a cone point) it shrinks until it is
 * deleted with a notice. A curve that would need a wrap vertex at a forbidden-zone disk goes quiet as unresolved.
 *
 */
import type { SimpleCollisionCylinder } from "../../movement/dynamicObject";
import type { CarryHighlightShape } from "../carryHighlightShape";
import { identityRigidTransform3, yawRigidTransform3, type RigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, normalizeVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeWorldObjectBase } from "../runtimeObjectBase";

// ---- Runtime object shapes ----

/**
 * A geodesic emitter ("cannon"): a placeable runtime object that geodesic intervals attach their endpoints to.
 *
 * The cannon sits on the cell floor (`localPose.translation.z` is the floor height); the beam it emits starts
 * `geodesicRayBeamHeightMeters` above that. Frames are cell-local (x right, y forward, z up). The cannon does NOT own
 * geometry: the authoritative geodesic data are the `GeodesicArcObject`s whose `start`/`end` attachments reference
 * this cannon's id (`getEmitterGeodesicIds` lists them); the cannon stores no copy of that list.
 */
export interface GeodesicCannonObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesic-cannon";
  /** Marker consumed by `canObjectAttachGeodesics`: this object may be the anchor of an interval endpoint. */
  readonly canAttachGeodesics?: true;
  /** Marker consumed by `canBeCarried` (src/world-objects/carry.ts): this object may be carried and reacts to displacement steps. */
  readonly canBeCarried?: true;
  /** The shape of the highlight drawn around the emitter while it is carried (`cannonCarryHighlight`). */
  readonly carryHighlight?: CarryHighlightShape;
  /** Default launch yaw in radians, normalized by `sanitizeYaw`; equals the yaw of `localPose.rotation`. */
  readonly aimYawRadians: number;
}

/** How an interval geodesic attaches to emitters, derived from its endpoint attachments by `getGeodesicConnection`. */
export interface GeodesicEmitterAttachment {
  readonly outgoingEmitterId: string;
  readonly incomingEmitterId?: string;
  readonly state: "open" | "connected";
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
 * attached roles) is a vertex of a curve under the curve shortening flow.
 */
export interface GeodesicVertexObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesicModel/vertex";
  readonly canAttachGeodesics: true;
  /** Optional face the end was authored on; informational, not used by the tracing math. */
  readonly faceId?: string;
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
export interface GeodesicArcObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesicModel/arc";
  readonly start: GeodesicEndpointAttachment;
  readonly end: GeodesicEndpointAttachment;
  /** Cell containing the `start` anchor; the tracing of the interval begins here. Mirrors `cellId`. */
  readonly startCellId: string;
  /** Ordered `start` -> `end` list of portals crossed; it fixes the homotopy class of the geodesic (empty when both ends are in one cell and the path stays inside it). */
  readonly portalWord: readonly GeodesicPortalTraversal[];
  /** Display number ("G1", "G2", ...), assigned once when the arc is created (`nextGeodesicNumber`); real state, never recomputed. Absent only in test fixtures. */
  readonly geodesicNumber?: number;
  /** Transient: set while the last rebuild of this arc failed during a carry, so it still shows its old path; the next successful rebuild clears it (`isStale`). */
  readonly stale?: true;
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
  readonly interval: GeodesicArcObject;
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
  readonly kind: "geodesicModel/segment";
  /** Id of the owning `GeodesicArcObject`. */
  readonly geodesicId: string;
  /** Copy of the owning arc's `geodesicNumber` (display number "G1", "G2", ...), kept so tooltips and labels read it directly. */
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
  /** Display state of the owning geodesic: `"connected"` (both ends of the arc on emitters) or `"open"` (see `resolveDerivedSegmentConnectionState`). */
  readonly connectionState?: "open" | "connected";
  /** UI-only highlight for a half chosen in the tie-and-detach flow. */
  readonly highlightState?: "tie-detach-selected";
}

/**
 * A computed marker where two distinct geodesics' segments cross in the same cell.
 *
 * Derived data maintained by `updateGeodesicIntersectionObjects`; ids are remembered per geodesic/segment pair so markers stay stable between frames.
 */
export interface GeodesicCrossingObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesicModel/crossing";
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

/**
 * Half-extents in meters of the visible emitter model in the emitter's frame (z up, the box centred at `(0, 0, half.z)`), measured from the
 * assets the renderer draws (`geodesicCannonRenderer.ts`), not guessed:
 * - `flashlight/Post.glb` is 3.013 units tall (y from -1.9996 to 1.0131) and 0.37 wide; drawn at scale 0.42 and lifted by 0.74 it spans
 *   -0.10 to 1.166 m above the floor (only the part from the floor up is visible) and reaches 0.085 m from its axis.
 * - `flashlight/Lightsaber.glb` is 0.5215 long (x from -0.198 to 0.3235) and 0.1 thick; at scale 0.42 on the beam height (1.08 m) it reaches
 *   0.138 m from the post axis, turning with the aim, and is 0.042 m thick.
 * So the model is a thin post, 1.166 m tall from the floor, with a head that reaches 0.138 m sideways: half-extents `(0.138, 0.138, 0.583)`.
 * `tests/render/cannonModelBounds.test.ts` re-measures the two files and fails when they stop matching these numbers.
 */
export const cannonModelHalfExtentsMeters: Vec3 = { x: 0.138, y: 0.138, z: 0.583 };

/** Factor by which the emitter's highlight ellipsoid exceeds the model's half-extents, so it is a loose fit and not skin-tight. */
export const cannonCarryHighlightLooseness = 1.15;

/**
 * Carry highlight of an emitter: an ellipsoid hugging the visible model (`cannonModelHalfExtentsMeters`) a little loosely, so it is thin and
 * a bit taller than wide, centred at half the model's height: semi-axes `(0.159, 0.159, 0.670)` m around `(0, 0, 0.583)`. It does not follow
 * the collision cylinder (radius 0.3 m, 0.75 m tall), which is a physics shape and much wider than anything drawn.
 */
export const cannonCarryHighlight: CarryHighlightShape = {
  kind: "ellipsoid",
  centre: { x: 0, y: 0, z: cannonModelHalfExtentsMeters.z },
  radii: {
    x: cannonModelHalfExtentsMeters.x * cannonCarryHighlightLooseness,
    y: cannonModelHalfExtentsMeters.y * cannonCarryHighlightLooseness,
    z: cannonModelHalfExtentsMeters.z * cannonCarryHighlightLooseness,
  },
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
 * yaw rotation of that angle (so pitch/roll are discarded).
 * Pure; does not touch any registry.
 */
export function createGeodesicCannonObject(options: CreateGeodesicCannonOptions): GeodesicCannonObject {
  const aimYawRadians = sanitizeYaw(options.aimYawRadians ?? yawFromPose(options.localPose));

  return {
    id: options.id,
    kind: "geodesic-cannon",
    canAttachGeodesics: true,
    canBeCarried: true,
    carryHighlight: cannonCarryHighlight,
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
    aimYawRadians,
  };
}

/** Type guard: true when the object is a `GeodesicSegmentObject` (`kind === "geodesicModel/segment"`). */
export function isGeodesicSegmentObject(object: { readonly kind: string }): object is GeodesicSegmentObject {
  return object.kind === "geodesicModel/segment";
}

/** Type guard: true when the object is a `GeodesicVertexObject`. */
export function isGeodesicVertexObject(object: { readonly kind: string }): object is GeodesicVertexObject {
  return object.kind === "geodesicModel/vertex";
}

/**
 * Builds a free-end anchor at `point` (cell-local meters, including its beam height in z) in cell `cellId`.
 *
 * Pure; the caller adds it to the registry. The object is non-renderable through portals and can attach geodesics.
 */
export function createGeodesicVertexObject(input: {
  readonly id: string;
  readonly cellId: string;
  readonly point: Vec3;
}): GeodesicVertexObject {
  return {
    id: input.id,
    kind: "geodesicModel/vertex",
    canAttachGeodesics: true,
    cellId: input.cellId,
    localPose: yawRigidTransform3(0, input.point),
    portalRenderable: false,
  };
}

/** The arc without its transient `stale` mark (the arc itself when it has none). */
export function withoutStale(arc: GeodesicArcObject): GeodesicArcObject {
  if (arc.stale === undefined) {
    return arc;
  }
  const { stale, ...rest } = arc;
  void stale;
  return rest;
}

/**
 * Builds a geodesic interval from two anchor ids, a start cell and an optional portal word.
 *
 * Defaults: empty `portalWord`. The word is freely reduced (adjacent inverse traversals cancel). Does not validate that the word matches the anchors' cells and
 * does not generate segments; call `rebuildDerivedGeodesicSegments` afterwards. Pure; the caller adds it to the registry.
 */
export function createGeodesicArcObject(input: {
  readonly id: string;
  readonly startAnchorObjectId: string;
  readonly endAnchorObjectId: string;
  readonly startCellId: string;
  readonly portalWord?: readonly GeodesicPortalTraversal[];
  /** Display number, assigned once at creation (see `nextGeodesicNumber`). */
  readonly geodesicNumber?: number;
}): GeodesicArcObject {
  return {
    id: input.id,
    kind: "geodesicModel/arc",
    cellId: input.startCellId,
    localPose: identityRigidTransform3,
    portalRenderable: false,
    startCellId: input.startCellId,
    portalWord: reduceAdjacentInversePortalTraversals(input.portalWord ?? []),
    ...(input.geodesicNumber === undefined ? {} : { geodesicNumber: input.geodesicNumber }),
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

/** Point where the cannon's beam starts, in the cannon's cell frame. */
export function getGeodesicCannonEmitterPoint(cannon: GeodesicCannonObject): Vec3 {
  return {
    x: cannon.localPose.translation.x,
    y: cannon.localPose.translation.y,
    z: cannon.localPose.translation.z + geodesicRayBeamHeightMeters,
  };
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

/** Freely reduces a portal word by cancelling adjacent inverse traversals. */
export function reduceAdjacentInversePortalTraversals(
  word: readonly GeodesicPortalTraversal[],
): readonly GeodesicPortalTraversal[] {
  const reduced: GeodesicPortalTraversal[] = [];
  for (const traversal of word) {
    const previous = reduced.at(-1);
    if (previous && portalTraversalsAreInverse(previous, traversal)) {
      reduced.pop();
      continue;
    }
    reduced.push(traversal);
  }
  return reduced;
}

function portalTraversalsAreInverse(
  left: GeodesicPortalTraversal,
  right: GeodesicPortalTraversal,
): boolean {
  return left.sourceCellId === right.targetCellId &&
    left.sourcePortalId === right.targetPortalId &&
    left.targetCellId === right.sourceCellId &&
    left.targetPortalId === right.sourcePortalId;
}
