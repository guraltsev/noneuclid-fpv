/**
 * Creates "ghost" render records so a dynamic object that overlaps a portal is drawn on every side of it.
 *
 * Only the object's true cell contains its pose; an object near a portal side or a vertex would otherwise vanish when
 * the neighbouring cells are seen through the portals. The ghosts come from the developed disk (job 12) of radius
 * `render footprint radius + activation clearance` around the footprint's centre: every cell copy the disk reaches,
 * however many portals away, gets one record with pose `node.cellFromStart * object.localPose`, converted to a Three.js
 * matrix.
 *
 * The footprint is what is DRAWN (`RenderFootprint`: centre and radius in the object's own frame), never the collision shape: a ghost exists
 * to show the drawn part on the other side of a portal, and the drawn part need not be centred on, or as wide as, the body that collides.
 * It is a required input. An object has no fallback footprint; a drawn part without a measured one is an error, reported by the caller.
 *
 * Around a cone vertex the same cell can appear in two copies. Copies in the same cell whose centres are closer than
 * twice the footprint radius overlap, so only the first one (breadth-first order, the real object first) is kept.
 * This also merges the two wedges through which a flat copy is reached. See `_docs/MATHEMATICAL_MODEL.md` section 8.
 *
 * Every source of render records of the instance sync (ordinary objects, geodesic body parts, the carry highlight, the player's rover) hands over
 * `PortalGhostedRecords`: records that came out of {@link collectRuntimeObjectRenderRecordsWithPortalGhosts}, which needs a footprint, or
 * out of {@link exemptFromPortalGhosts}, which needs a stated reason. The sync accepts nothing else, so a new source cannot add raw records.
 */

import type * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { collectDevelopedDisk, type DevelopedDiskNode } from "../../cell-complex/developedDisk";
import { composeRigidTransform3, transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { rigidTransformToThreeMatrix } from "./worldAxes";
import type { RenderFootprint, RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";

/** Default distance in meters (0.02) beyond which an object is considered too far from a portal wall to need a ghost. */
export const defaultPortalGhostActivationClearanceMeters = 0.02;

/** The record fields a drawn part may set besides its place, copied onto its own record and onto every ghost of it (the viewer's own body hides near the camera, for example). */
export type PortalGhostRecordFlags = Pick<RuntimeObjectRenderRecord, "omitRootVisiblePath" | "suppressWithinCameraDistanceMeters">;

declare const portalGhostedBrand: unique symbol;

/**
 * Render records that went through the portal-ghost rule: made by {@link collectRuntimeObjectRenderRecordsWithPortalGhosts} (a measured render
 * footprint was required) or by {@link exemptFromPortalGhosts} (a reason was required). The instance sync takes only this type.
 */
export type PortalGhostedRecords = readonly RuntimeObjectRenderRecord[] & { readonly [portalGhostedBrand]: true };

/** The records that deliberately get no portal ghosts, each with the reason. */
export const portalGhostExemptions = {
  "nothing-drawn": "the source draws nothing at the moment (no archetypes collected yet, or no shape to draw), so there is nothing to ghost",
  "geodesic-segment":
    "a segment is computed per cell and continues as the next segment of the geodesic in the next cell; ghosting it would draw it twice",
} as const;

/** Why a source of records is exempt from portal ghosts; the key of {@link portalGhostExemptions}. */
export type PortalGhostExemption = keyof typeof portalGhostExemptions;

/** Marks `records` as deliberately without portal ghosts, for a reason that {@link portalGhostExemptions} states. */
export function exemptFromPortalGhosts(reason: PortalGhostExemption, records: readonly RuntimeObjectRenderRecord[]): PortalGhostedRecords {
  if (!portalGhostExemptions[reason]) {
    throw new Error(`Unknown portal-ghost exemption "${reason}".`);
  }

  return records as unknown as PortalGhostedRecords;
}

/** The concatenation of already-ghosted record groups (the parts of one object, say); still ghosted. */
export function concatPortalGhostedRecords(groups: readonly PortalGhostedRecords[]): PortalGhostedRecords {
  return groups.flat() as unknown as PortalGhostedRecords;
}

/** A dynamic object with an id, i.e. anything that can have ghost records. */
export type PortalGhostRenderableObject = DynamicObjectState & {
  readonly id: string;
};

/** Input for ghost-record collection. */
export interface PortalGhostRuntimeObjectRenderRecordRequest {
  /** Compiled world used to find the object's cell and its portal sides. */
  readonly world: CompiledCellComplex;
  /** The object, with a cell id and a cell-local pose. */
  readonly object: PortalGhostRenderableObject;
  /** Archetype keys to emit one record each for, per ghost. */
  readonly archetypeKeys: Iterable<string>;
  /** Overrides `defaultPortalGhostActivationClearanceMeters`. */
  readonly activationClearanceMeters?: number;
  /**
   * What is drawn of the object (or of this part of it): a disk in the object's own frame. Required: there is no collision or default fallback.
   * Not read when `archetypeKeys` is empty (nothing is drawn, so nothing is ghosted).
   */
  readonly renderFootprint: RenderFootprint;
  /** Copied onto every record, the object's own and each ghost. */
  readonly recordFlags?: PortalGhostRecordFlags;
  /** The part's own matrix in the object's frame (Three axes), applied after the object's pose to every record; identity when absent. */
  readonly partMatrix?: THREE.Matrix4;
}

/**
 * The one way a part of an object gets its render records: one record per archetype key in the object's own cell, then its portal ghosts
 * (see {@link collectPortalGhostRuntimeObjectRenderRecords}). The instance sync uses it for every ordinary object, for every body part of a geodesic
 * object (cannon post, cannon heads, intersection balloon) and for the carry highlight, so no kind of object has portal-ghost logic of its own.
 */
export function collectRuntimeObjectRenderRecordsWithPortalGhosts(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): PortalGhostedRecords {
  const archetypeKeys = [...request.archetypeKeys];
  const localMatrix = withPartMatrix(rigidTransformToThreeMatrix(request.object.localPose), request.partMatrix);

  return [
    ...archetypeKeys.map((archetypeKey) => ({
      objectId: request.object.id,
      cellId: request.object.cellId,
      archetypeKey,
      localMatrix,
      ...request.recordFlags,
    })),
    ...collectPortalGhostRuntimeObjectRenderRecords({ ...request, archetypeKeys }),
  ] as unknown as PortalGhostedRecords;
}

// The record matrix of a pose, followed by the part's own matrix when it has one (a new matrix; the arguments are not modified).
function withPartMatrix(poseMatrix: THREE.Matrix4, partMatrix: THREE.Matrix4 | undefined): THREE.Matrix4 {
  return partMatrix ? poseMatrix.clone().multiply(partMatrix) : poseMatrix;
}

/** What the ghost rule decided for one cell copy the developed disk reached. */
export interface PortalGhostCopyDecision {
  /** Position in the disk's breadth-first order; 0 is the object's own cell. */
  readonly index: number;
  readonly cellId: string;
  /** Portal hops from the object's own cell. */
  readonly depth: number;
  /** Side of this copy through which the disk reached it; undefined for the own cell. */
  readonly entrySideIndex?: number;
  /** The footprint centre in this copy's cell frame (x, y meters). */
  readonly center: { readonly x: number; readonly y: number };
  /** "own": the object's own cell; "ghost": a record is made; "duplicate": dropped because it overlaps the kept copy `duplicateOfIndex` in the same cell. */
  readonly outcome: "own" | "ghost" | "duplicate";
  readonly duplicateOfIndex?: number;
}

/** The decision of the ghost rule for one drawn part, as plain data (see {@link explainPortalGhosts}). */
export interface PortalGhostExplanation {
  readonly objectId: string;
  readonly cellId: string;
  /** The footprint used, in the object's own frame. */
  readonly footprint: RenderFootprint;
  /** The footprint centre in the object's cell frame (x, y meters), the disk's centre before the disk's own inward nudge. */
  readonly diskCenter: { readonly x: number; readonly y: number };
  /** Footprint radius plus the activation clearance: the radius asked of the developed disk. */
  readonly diskRadiusMeters: number;
  readonly activationClearanceMeters: number;
  /** True when the disk stopped at its node limit, so some reachable copies may be missing. */
  readonly truncated: boolean;
  readonly copies: readonly PortalGhostCopyDecision[];
}

interface PortalGhostDevelopment {
  readonly explanation: PortalGhostExplanation;
  /** The disk nodes that get a ghost record, with their index in the explanation's `copies`. */
  readonly ghostNodes: readonly { readonly node: DevelopedDiskNode; readonly index: number }[];
}

// The one place the ghost rule is decided: the records and the explanation both come from it.
function developPortalGhosts(request: PortalGhostRuntimeObjectRenderRecordRequest): PortalGhostDevelopment | undefined {
  const { object, world } = request;

  if (!world.cellsById.has(object.cellId)) {
    return undefined;
  }

  const radius = request.renderFootprint.radiusMeters;

  if (!(radius > 0)) {
    throw new Error(`Object "${object.id}" has no render footprint (radius ${radius}); its portal ghosts cannot be decided.`);
  }

  // The footprint centre is in the object's own frame; the disk is taken in the cell's frame.
  const center = transformPoint3(object.localPose, vec3(request.renderFootprint.center.x, request.renderFootprint.center.y, 0));
  const clearance = request.activationClearanceMeters ?? defaultPortalGhostActivationClearanceMeters;
  const disk = collectDevelopedDisk({ world, cellId: object.cellId, center, radiusMeters: radius + clearance });
  const kept: { readonly index: number; readonly cellId: string; readonly x: number; readonly y: number }[] = [];
  const copies: PortalGhostCopyDecision[] = [];
  const ghostNodes: { readonly node: DevelopedDiskNode; readonly index: number }[] = [];

  for (const [index, node] of disk.nodes.entries()) {
    const ghostCenter = transformPoint3(node.cellFromStart, vec3(center.x, center.y, 0));
    const conflict = kept.find(
      (other) => other.cellId === node.cellId && Math.hypot(other.x - ghostCenter.x, other.y - ghostCenter.y) < 2 * radius,
    );
    const base = { index, cellId: node.cellId, depth: node.depth, entrySideIndex: node.entrySideIndex, center: { x: ghostCenter.x, y: ghostCenter.y } };

    if (conflict) {
      copies.push({ ...base, outcome: "duplicate", duplicateOfIndex: conflict.index });
      continue;
    }

    kept.push({ index, cellId: node.cellId, x: ghostCenter.x, y: ghostCenter.y });

    if (index === 0) {
      copies.push({ ...base, outcome: "own" });
      continue;
    }

    copies.push({ ...base, outcome: "ghost" });
    ghostNodes.push({ node, index });
  }

  return {
    explanation: {
      objectId: object.id,
      cellId: object.cellId,
      footprint: request.renderFootprint,
      diskCenter: { x: center.x, y: center.y },
      diskRadiusMeters: radius + clearance,
      activationClearanceMeters: clearance,
      truncated: disk.truncated,
      copies,
    },
    ghostNodes,
  };
}

/**
 * Returns what the ghost rule decides for a drawn part, as plain data: the disk it develops and, for every cell copy the disk reaches, whether the
 * copy is the object's own cell, gets a ghost record, or is dropped as a duplicate of a kept copy. It is the same code as the records come from.
 * Undefined if the object's cell is not in the world. Throws if the footprint radius is not positive, like the record collection.
 */
export function explainPortalGhosts(request: PortalGhostRuntimeObjectRenderRecordRequest): PortalGhostExplanation | undefined {
  return developPortalGhosts(request)?.explanation;
}

/**
 * Returns ghost render records, in every cell copy the object's render footprint reaches (empty if none, or if the cell or key list is missing).
 * Throws if the footprint radius is not positive: an unmeasured drawn part must fail loudly, not be left without ghosts.
 */
export function collectPortalGhostRuntimeObjectRenderRecords(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): readonly RuntimeObjectRenderRecord[] {
  const archetypeKeys = [...request.archetypeKeys];

  if (archetypeKeys.length === 0) {
    return [];
  }

  const development = developPortalGhosts(request);

  if (!development) {
    return [];
  }

  const records: RuntimeObjectRenderRecord[] = [];

  for (const { node } of development.ghostNodes) {
    const ghostMatrix = withPartMatrix(
      rigidTransformToThreeMatrix(composeRigidTransform3(node.cellFromStart, request.object.localPose)),
      request.partMatrix,
    );

    for (const archetypeKey of archetypeKeys) {
      records.push({
        objectId: request.object.id,
        cellId: node.cellId,
        archetypeKey,
        localMatrix: ghostMatrix,
        ...request.recordFlags,
      });
    }
  }

  return records;
}
