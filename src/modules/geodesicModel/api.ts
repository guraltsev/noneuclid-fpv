/**
 * The geodesic model's public face (design 013 sections 12.1 and 13.1): its token, the read-only queries clients and dependents share, the operations only dependents
 * hold, and the plain-data shapes of its commands and events. Other modules import this file and nothing else of the module's directory.
 *
 * The geodesic model is the piecewise-geodesic curve on the glued complex: arcs with a portal word as homotopy class, the vertices they meet at, their
 * realization as per-cell segments, and the operations on them (realize an arc, move a vertex, remove a vertex, tie, delete a curve). A curve's end nodes are
 * the arc ends on an emitter; its interior vertices are `geodesicModel/vertex` objects shared by two or more arc ends. The emitter drags an end node; a
 * dynamics module acts on interior vertices only, and without one a tied curve stays as tied.
 */
import { defineModuleToken } from "../../engine/moduleTypes";
import type { EngineCommandBase, EngineEventBase } from "../../engine/moduleTypes";
import type { GeodesicEmitterObject, GeodesicPortalTraversal } from "../../world-objects/geodesic/objects";

declare module "../../glue/toolIds" {
  interface ModuleToolIds {
    /** The tie tool, defined by the geodesic model unless the experience leaves it out (`tieTool: false`). */
    geodesicModelTie: "geodesicModel/tie";
  }
}

/** The id of the tie tool. */
export const geodesicTieToolId = "geodesicModel/tie" as const;

/** Options of the geodesic model, for the world part and the client part alike (plain data). */
export interface GeodesicModelOptions {
  /** Defines the tie tool and its menu action, and makes the tie command require it (default true). Without it the command stays, for scripts. */
  readonly tieTool: boolean;
}

/** The options when none are given. */
export const defaultGeodesicModelOptions: GeodesicModelOptions = { tieTool: true };

/** Turning angle (radians) below which a vertex counts as taut: its two arcs are one geodesic and the vertex may be removed. */
export { vertexTautTurnRadians } from "../../world-objects/geodesic/vertices";

/** An arc end at a vertex: one endpoint role of an arc. */
export interface ArcEnd {
  readonly arcId: string;
  readonly role: "start" | "end";
}

/** Unit tangent of an arc at a vertex, pointing away from it, in the vertex's cell frame, with the arc's chord length. */
export interface ArcTangent {
  readonly x: number;
  readonly y: number;
  readonly lengthMeters: number;
}

/** An endpoint role of an arc, named by the arc, the role and the anchor it is attached to (plain data, so that a command can carry it). */
export interface GeodesicEndpointRef {
  readonly geodesicId: string;
  readonly role: "start" | "end";
  readonly anchorObjectId: string;
}

/** What clients and dependents receive: reads only, which never change the registry. */
export interface GeodesicModelQueries {
  /** Both endpoint roles attached to the vertex (a loop on it contributes two). Order: registry insertion order. */
  arcsAtVertex(vertexId: string): readonly ArcEnd[];
  /** Tangents of the arcs at the vertex; with `displacedTo`, as if the vertex stood at that point of its own cell (no portal walk). `undefined` if an arc cannot be lifted. */
  arcTangentsAtVertex(vertexId: string, arcs: readonly ArcEnd[], displacedTo?: { readonly x: number; readonly y: number }): readonly ArcTangent[] | undefined;
  /** Total length (meters) of the distinct arcs among `arcs`. */
  lengthOfArcs(arcs: readonly ArcEnd[]): number;
  /** Both ends on emitters: a geodesic with no interior vertex. */
  connectsEmitters(arcId: string): boolean;
  /** The arc has an end on a tied vertex (a tied arc is drawn open). A closed loop on one vertex is not tied. */
  isTied(arcId: string): boolean;
  /** Vertices with two or more arc ends, closed loops included. Read from the arc index. */
  tiedVertexCount(): number;
  /** Visits them in registry insertion order. Read from the arc index. */
  forEachTiedVertex(fn: (vertexId: string) => void): void;
  /** The endpoint roles attached to the emitter whose arcs connect emitters: the ends a tie can use. Reads the arc index; not a scan. */
  tieableEnds(emitterId: string): readonly GeodesicEndpointRef[];
  /** Every arc of the curve through this vertex, walked over shared vertices. */
  arcsOfCurve(vertexId: string): readonly string[];
  /** Every arc of the curve this arc belongs to, the arc itself included. */
  curveOfArc(arcId: string): readonly string[];
  /** The arcs with an end on the emitter, in registry order. Read from the arc index. */
  arcsOnEmitter(emitterId: string): readonly string[];
  /** The emitter the arc leaves from: the one at its start, else the one at its end; undefined with neither, or for an id that is no arc. */
  emitterOfArc(arcId: string): string | undefined;
  /** The arc's last rebuild failed during a carry, so it still shows its old path. */
  isStale(arcId: string): boolean;
}

/** The result of `previewVertexMove`. */
export interface VertexMovePreview {
  readonly vertexId: string;
  readonly lengthAfterMeters: number;
  /** Opaque to callers: the new vertex record and the realized arcs. */
  readonly internal: unknown;
}

/** What removing a vertex would give: a merged arc, a taut loop, a collapsed curve, or blocked. */
export type VertexRemovalPreview =
  | { readonly kind: "merge"; readonly mergedArcId: string; readonly removedArcId: string; readonly internal: unknown }
  | { readonly kind: "loopTaut"; readonly arcId: string }
  | { readonly kind: "collapsed"; readonly arcIds: readonly string[]; readonly loop: boolean }
  | { readonly kind: "blocked"; readonly reason: "loopBlocked" | "mergeBlocked" | "anchor" | "missingArc" };

/** What a rebuild of an emitter's arcs means for the emitter and its carrier. */
export interface EmitterArcsRebuild {
  /** Set when the emitter's plain active arc was regrown from it. */
  readonly regrownActiveGeodesicId?: string;
  /** The yaw the regrown arc left along, which the emitter then faces. */
  readonly launchYawRadians?: number;
}

/** For dependents only: the hot route of design 013 section 5.7, what runs many times a step (M1, M2) or once per frame on the fast channel. Everything else is a command. */
export interface GeodesicModelApi extends GeodesicModelQueries {
  /** Walks the vertex `lengthMeters` along `direction` (vertex cell frame) through portals, updates the arcs' words and realizes them. `undefined` if the id is not a vertex or the walk or a chord fails; changes nothing either way. */
  previewVertexMove(input: { readonly vertexId: string; readonly arcs: readonly ArcEnd[]; readonly direction: { readonly x: number; readonly y: number }; readonly lengthMeters: number }): VertexMovePreview | undefined;
  /** Applies a preview of a vertex move: the vertex, the arcs with their new words and their segments. */
  commitVertexMove(preview: VertexMovePreview): void;
  /** What removing the vertex would give; `blocked` for an id that is not a vertex. Changes nothing. */
  previewVertexRemoval(input: { readonly vertexId: string; readonly arcs: readonly ArcEnd[] }): VertexRemovalPreview;
  /** Fast channel. Re-traces a free arc from `emitter`, which says where it leaves from and along which yaw, to its intended length; `connectEmitters` lets it end on an emitter it reaches. Does nothing for an arc that is gone or no longer free. */
  retraceArc(input: { readonly emitter: GeodesicEmitterObject; readonly arcId: string; readonly connectEmitters: boolean }): void;
  /** Fast channel. Folds a route the emitter travelled into the portal word of each arc that follows it; the emitter is already stored at its new place. Returns the arcs that could not follow, and then changes nothing. */
  followAnchorRoute(emitterId: string, route: readonly GeodesicPortalTraversal[]): readonly string[];
  /** Fast channel. Rebuilds the arcs of an emitter that moved (`world-objects/geodesic/carryEnd.ts`). With `keepOnFailure`, the safety net of a carry in progress, a failed rebuild keeps the arc, marked stale. */
  rebuildArcsOfEmitter(input: { readonly emitterId: string; readonly activeArcId?: string; readonly keepOnFailure: boolean }): EmitterArcsRebuild;
}

/** The geodesic model's token: `provides` of the module, `requires` of the modules that act on its curves. */
export const geodesicModelToken = defineModuleToken<GeodesicModelApi, GeodesicModelQueries>("geodesicModel");

/** Detaches two endpoint roles from an emitter and ties them at a new shared vertex, born at the emitter's beam point (the geometry does not change). Refusals: `geodesicModel/sameEndpoint`, `notAnEmitter`, `notAttached`, `notConnected`, `rebuildFailed` (rolled back). */
export interface GeodesicTieAndDetachCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/tieAndDetach";
  readonly emitterId: string;
  readonly first: GeodesicEndpointRef;
  readonly second: GeodesicEndpointRef;
}

/** Tool highlight of one endpoint's half of a geodesic (the segments' `highlightState`); transient. */
export interface GeodesicHighlightEndpointCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/highlightEndpoint";
  readonly selection: GeodesicEndpointRef;
  readonly on: boolean;
}

/** Module-only. Recomputes the removal preview and applies it; refused with `geodesicModel/vertexBlocked` if blocked. The result is `{ arcIds }`, the arcs changed or removed. */
export interface GeodesicRemoveVertexCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/removeVertex";
  readonly vertexId: string;
  readonly arcs: readonly ArcEnd[];
}

/** Module-only. Deletes the arcs, their segments and every vertex left with no arc; refused with `geodesicModel/unknownArc` if one is not an arc. The result is `{ arcIds }`. */
export interface GeodesicRemoveCurveCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/removeCurve";
  readonly arcIds: readonly string[];
}

/** Module-only. A new free arc from the emitter along its yaw, tracing to `lengthMeters`, which becomes its intended length. Refused with `geodesicModel/notAnEmitter`. The result is `{ arcId }`, of the family `geodesicModel/arc`. */
export interface GeodesicShootArcCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/shootArc";
  readonly emitterId: string;
  readonly lengthMeters: number;
}

/** Module-only. Lengthens a free arc: its intended length grows by `lengthMeters`. Refused with `geodesicModel/arcBlocked`, changing nothing, when it connects emitters, is tied, or ended at a wall, a zone or an emitter. */
export interface GeodesicExtendArcCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/extendArc";
  readonly arcId: string;
  readonly lengthMeters: number;
}

/** Module-only. Cuts a free arc at a point of its segment, at the emitter already standing there. Refused with `geodesicModel/unknownArc`. */
export interface GeodesicCutAtSegmentCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/cutAtSegment";
  readonly emitterId: string;
  readonly arcId: string;
  readonly segmentId: string;
  readonly distanceAlongSegmentMeters: number;
}

/** Module-only. Cuts every arc passing a point of a cell, at the emitter already standing there. Refused with `geodesicModel/notAnEmitter`. The result is `{ yawRadians }`, the yaw of the last continuation, if there is one. */
export interface GeodesicCutAtVertexCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/cutAtVertex";
  readonly emitterId: string;
  readonly cellId: string;
  readonly vertexPoint: { readonly x: number; readonly y: number; readonly z: number };
}

/** Module-only. Deletes the arcs of the emitter that do not follow it: its plain shot geodesics. Connected and tied arcs stay. The result is `{ arcIds }`, those deleted. */
export interface GeodesicRemovePlainArcsCommand extends EngineCommandBase {
  readonly kind: "geodesicModel/removePlainArcs";
  readonly emitterId: string;
}

/** Every command of the module. */
export type GeodesicModelCommand =
  | GeodesicTieAndDetachCommand
  | GeodesicHighlightEndpointCommand
  | GeodesicRemoveVertexCommand
  | GeodesicRemoveCurveCommand
  | GeodesicShootArcCommand
  | GeodesicExtendArcCommand
  | GeodesicCutAtSegmentCommand
  | GeodesicCutAtVertexCommand
  | GeodesicRemovePlainArcsCommand;

/** Two endpoint roles were tied at a new vertex. */
export interface GeodesicVertexTiedEvent extends EngineEventBase {
  readonly kind: "geodesicModel/vertexTied";
  readonly vertexId: string;
  readonly arcIds: readonly string[];
}

/** Every event of the module. */
export type GeodesicModelEvent = GeodesicVertexTiedEvent;

/** The refusal codes of the module's commands. */
export const geodesicModelRefusals = {
  sameEndpoint: "geodesicModel/sameEndpoint",
  notAnEmitter: "geodesicModel/notAnEmitter",
  notAttached: "geodesicModel/notAttached",
  notConnected: "geodesicModel/notConnected",
  rebuildFailed: "geodesicModel/rebuildFailed",
  vertexBlocked: "geodesicModel/vertexBlocked",
  unknownArc: "geodesicModel/unknownArc",
  arcBlocked: "geodesicModel/arcBlocked",
} as const;
