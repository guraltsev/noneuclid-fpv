/**
 * Read-only inspection of what the runtime-object render pipeline did with the last frame: which records exist and where they come from, what the portal-ghost
 * rule decided for a drawn part, which instances were written for an archetype and with which path and clip row, and why a record was not drawn on a path.
 *
 * It answers "this object is missing, or cut, on the far side of a portal; which step lost it?" without a debugger. Every answer is plain data (the public API
 * converts it to JSON) and is made by the code the frame uses, not by a second implementation: ghost decisions come from `explainPortalGhosts`, the writer
 * decisions from the `onDecision` hook of `updateRuntimeObjectRenderArchetypeInstances`. Nothing here runs per frame; the sync keeps a pointer to the last
 * frame's inputs and these functions read them when called. Positions are in world axes (x, y, z up), like the player pose; the frame the position is in is named in
 * each field (`cell`: the record's cell, `root`: the rendered root cell's frame).
 *
 * `installRenderInspectionApi` publishes the functions as the public API namespace `render` (`recordSources`, `records`, `explainGhosts`, `instances`,
 * `explainInstances`, `paths`); see `_docs/interactive-browser-debugging.md`.
 */
import { setApiNamespace } from "../../runtime/publicApi";
import type { FrameRenderSnapshot } from "./frameRenderSnapshot";
import {
  type PortalGhostExplanation,
  type PortalGhostRecordFlags,
  type PortalGhostRuntimeObjectRenderRecordRequest,
  explainPortalGhosts,
} from "./runtimeObjectGhostRecords";
import {
  type RuntimeObjectInstanceDecision,
  resolvePortalInstanceClipIndex,
  updateRuntimeObjectRenderArchetypeInstances,
} from "./renderPortalInstances";
import type { RuntimeObjectRenderArchetype } from "./runtimeObjectRenderArchetypes";
import type { RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";
import { threePointToWorld } from "./worldAxes";
import * as THREE from "three";

/** One source's records of the last collection: the records of one drawn part group, with the source that made them. */
export interface InspectedRecordGroup {
  /** Id of the record source (an element of `runtimeObjectRecordSources`). */
  readonly source: string;
  readonly records: readonly RuntimeObjectRenderRecord[];
}

/** How one drawn part gets its ghosts, as the sync would build it now. */
export interface InspectedGhostPart {
  /** The part's id: the object id, or for a body part of a geodesic object the placement id. */
  readonly partId: string;
  /** The source that owns the part. */
  readonly source: string;
  readonly archetypeKeys: readonly string[];
  /** The ghost request the sync makes for the part; absent when the part is exempt from ghosts. */
  readonly request?: PortalGhostRuntimeObjectRenderRecordRequest;
  /** Why the part is exempt from ghosts, when it is. */
  readonly exemption?: string;
  /** Set when the request could not be made (for example a footprint that cannot be measured); the message is the error's. */
  readonly error?: string;
}

/** What the sync hands to the inspection functions. Every member reads state of the last sync; none computes per frame. */
export interface RenderInspectionContext {
  /** The record groups of the last collection, in collection order. */
  groups(): readonly InspectedRecordGroup[];
  /** The ghost parts of the object `objectId` (a registry object or the player's rover), or undefined if no such object draws anything. */
  ghostParts(objectId: string): readonly InspectedGhostPart[] | undefined;
  /** The live archetypes. */
  archetypes(): readonly RuntimeObjectRenderArchetype[];
  /** The records of the last collection grouped by archetype key (what the writer read). */
  recordsByArchetypeKey(): ReadonlyMap<string, readonly RuntimeObjectRenderRecord[]>;
  /** The snapshot of the last sync, or undefined before the first one. */
  snapshot(): FrameRenderSnapshot | undefined;
}

/** Plain position in world axes (x, y, z up), meters. */
export interface InspectedPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One record source with how much it produced in the last collection. */
export interface InspectedRecordSource {
  readonly source: string;
  readonly groups: number;
  readonly records: number;
}

/** One render record as plain data. */
export interface InspectedRecord {
  readonly source: string;
  readonly objectId: string;
  readonly cellId: string;
  readonly archetypeKey: string;
  /** Where the record puts the object origin, in the frame of `cellId`. */
  readonly positionInCell: InspectedPosition;
  readonly flags: PortalGhostRecordFlags;
}

/** Filter of {@link inspectRecords}; every member narrows the result. */
export interface InspectRecordsFilter {
  readonly objectId?: string;
  readonly source?: string;
  /** Keep records whose archetype key starts with this text. */
  readonly archetypePrefix?: string;
  /** At most this many records are returned (default 100); `total` counts all matches. */
  readonly limit?: number;
}

/** Result of {@link inspectRecords}. */
export interface InspectedRecords {
  readonly total: number;
  readonly records: readonly InspectedRecord[];
}

/** The ghost decisions of one object: one entry per drawn part. */
export interface InspectedObjectGhosts {
  readonly objectId: string;
  readonly parts: readonly {
    readonly partId: string;
    readonly source: string;
    readonly archetypeKeys: readonly string[];
    /** The record flags copied onto every record of the part, ghosts included. */
    readonly recordFlags: PortalGhostRecordFlags;
    /** The ghost rule's decision; absent for an exempt part or an error. */
    readonly decision?: PortalGhostExplanation;
    readonly exemption?: string;
    readonly error?: string;
  }[];
}

/** Filter of {@link inspectInstances}. */
export interface InspectInstancesFilter {
  /** Keep archetypes whose key starts with this text. */
  readonly archetypePrefix?: string;
  /** Keep archetypes that have records of this object. */
  readonly objectId?: string;
  /** Also list every instance (placement, path, clip row), at most `limit` per archetype. */
  readonly detail?: boolean;
  /** Instances listed per archetype with `detail` (default 50). */
  readonly limit?: number;
}

/** One written instance as plain data. */
export interface InspectedInstance {
  readonly index: number;
  readonly pathId: number;
  /** The destination cell of the path the instance was written for, and the path's depth from the root. */
  readonly cellId?: string;
  readonly depth?: number;
  /** The clip row the instance was written with: -2 unclipped, -1 no slot, otherwise a row of the clip texture. */
  readonly clipIndex: number;
  /** Where the instance origin is, in the rendered root cell's frame. */
  readonly positionInRoot: InspectedPosition;
  /** The screen region the path is visible in (the clip polygon in normalised device coordinates, x and y in -1..1), as the visibility pass computed it. */
  readonly pathClipPolygonNdc?: readonly { readonly x: number; readonly y: number }[];
}

/** One archetype's instances. */
export interface InspectedArchetypeInstances {
  readonly archetypeKey: string;
  readonly sourceObjectId: string;
  readonly capacity: number;
  /** Instances drawn this frame. */
  readonly count: number;
  /** Instances per destination cell of their path. */
  readonly countByCell: Readonly<Record<string, number>>;
  readonly instances?: readonly InspectedInstance[];
}

/** Why one record was or was not drawn on one visible path. */
export interface InspectedInstanceDecision {
  readonly archetypeKey: string;
  /** The cell of the record; the path is a visible path to that cell. */
  readonly recordCellId: string;
  readonly pathId: number;
  readonly pathDepth: number;
  readonly outcome: RuntimeObjectInstanceDecision["outcome"];
  readonly instanceIndex?: number;
  /** The clip row an instance would be written with (see {@link InspectedInstance}). */
  readonly clipIndex: number;
  /** Distance to the nearest camera, when the record has a suppression distance. */
  readonly cameraDistanceMeters?: number;
  readonly suppressWithinCameraDistanceMeters?: number;
  /** Absent when the record never got a placement (it skips the root path). */
  readonly positionInRoot?: InspectedPosition;
  /** The screen region the path is visible in (see {@link InspectedInstance.pathClipPolygonNdc}). */
  readonly pathClipPolygonNdc?: readonly { readonly x: number; readonly y: number }[];
}

/** The writer decisions for one object, over every archetype it has records in. */
export interface InspectedObjectInstances {
  readonly objectId: string;
  readonly rootCellId: string;
  readonly decisions: readonly InspectedInstanceDecision[];
}

/** Filter of {@link inspectPaths}. */
export interface InspectPathsFilter {
  /** Keep paths whose destination cell is this one. */
  readonly cellId?: string;
  /** Keep paths whose screen region contains this point (normalised device coordinates, x and y in -1..1). */
  readonly containsNdc?: { readonly x: number; readonly y: number };
  /** At most this many paths are returned (default 100); `total` counts all matches. */
  readonly limit?: number;
}

/** One visible portal path as plain data. */
export interface InspectedPath {
  readonly pathId: number;
  readonly destinationCellId: string;
  /** Portals crossed from the root cell. */
  readonly depth: number;
  /** The clip row of the path this frame (-2 unclipped, -1 no slot), as instances of it are written. */
  readonly clipIndex: number;
  /** The screen region the path is visible in, in normalised device coordinates. */
  readonly clipPolygonNdc: readonly { readonly x: number; readonly y: number }[];
  readonly screenAreaPixels: number;
  /** True when the traversal did not look beyond this path. */
  readonly terminal: boolean;
}

/** Result of {@link inspectPaths}. */
export interface InspectedPaths {
  readonly rootCellId: string;
  readonly total: number;
  readonly paths: readonly InspectedPath[];
}

const defaultRecordLimit = 100;
const defaultInstanceLimit = 50;

function cellPosition(record: RuntimeObjectRenderRecord): InspectedPosition {
  const e = record.localMatrix.elements;
  return roundedPosition(threePointToWorld(new THREE.Vector3(e[12], e[13], e[14])));
}

function roundedPosition(point: InspectedPosition): InspectedPosition {
  const r = (value: number): number => Math.round(value * 1e5) / 1e5 + 0;
  return { x: r(point.x), y: r(point.y), z: r(point.z) };
}

function flagsOf(record: RuntimeObjectRenderRecord): PortalGhostRecordFlags {
  return {
    ...(record.omitRootVisiblePath === undefined ? {} : { omitRootVisiblePath: record.omitRootVisiblePath }),
    ...(record.suppressWithinCameraDistanceMeters === undefined
      ? {}
      : { suppressWithinCameraDistanceMeters: record.suppressWithinCameraDistanceMeters }),
  };
}

/** Lists the record sources of the last collection with the number of groups and records each produced. */
export function inspectRecordSources(context: RenderInspectionContext): readonly InspectedRecordSource[] {
  const bySource = new Map<string, { groups: number; records: number }>();

  for (const group of context.groups()) {
    const entry = bySource.get(group.source) ?? { groups: 0, records: 0 };
    entry.groups += 1;
    entry.records += group.records.length;
    bySource.set(group.source, entry);
  }

  return [...bySource.entries()].map(([source, counts]) => ({ source, ...counts }));
}

/** Lists the render records of the last collection that match `filter`, with where each puts its object in its own cell and its flags. */
export function inspectRecords(context: RenderInspectionContext, filter: InspectRecordsFilter = {}): InspectedRecords {
  const limit = filter.limit ?? defaultRecordLimit;
  const records: InspectedRecord[] = [];
  let total = 0;

  for (const group of context.groups()) {
    if (filter.source !== undefined && group.source !== filter.source) {
      continue;
    }

    for (const record of group.records) {
      if (filter.objectId !== undefined && record.objectId !== filter.objectId) {
        continue;
      }

      if (filter.archetypePrefix !== undefined && !record.archetypeKey.startsWith(filter.archetypePrefix)) {
        continue;
      }

      total += 1;
      if (records.length < limit) {
        records.push({
          source: group.source,
          objectId: record.objectId,
          cellId: record.cellId,
          archetypeKey: record.archetypeKey,
          positionInCell: cellPosition(record),
          flags: flagsOf(record),
        });
      }
    }
  }

  return { total, records };
}

/**
 * Explains the ghost rule for each drawn part of the object `objectId` (or of the player's rover, by its object id): the footprint used, the disk developed from it
 * and, for each cell copy the disk reaches, whether it is the own cell, gets a ghost, or is dropped as a duplicate. Throws if no object by that id draws anything.
 */
export function explainObjectGhosts(context: RenderInspectionContext, objectId: string): InspectedObjectGhosts {
  const parts = context.ghostParts(objectId);

  if (!parts || parts.length === 0) {
    throw new Error(`no drawn object with id "${objectId}"`);
  }

  return {
    objectId,
    parts: parts.map((part) => ({
      partId: part.partId,
      source: part.source,
      archetypeKeys: part.archetypeKeys,
      recordFlags: part.request?.recordFlags ?? {},
      ...(part.request && !part.error ? { decision: explainPortalGhosts(part.request) } : {}),
      ...(part.exemption === undefined ? {} : { exemption: part.exemption }),
      ...(part.error === undefined ? {} : { error: part.error }),
    })),
  };
}

interface InspectedPathInfo {
  readonly cellId: string;
  readonly depth: number;
  readonly clipPolygonNdc: readonly { readonly x: number; readonly y: number }[];
}

function roundedPolygon(polygon: readonly { readonly x: number; readonly y: number }[]): readonly { readonly x: number; readonly y: number }[] {
  return polygon.map((point) => ({ x: Math.round(point.x * 1e4) / 1e4 + 0, y: Math.round(point.y * 1e4) / 1e4 + 0 }));
}

function pathLookup(snapshot: FrameRenderSnapshot | undefined): ReadonlyMap<number, InspectedPathInfo> {
  const result = new Map<number, InspectedPathInfo>();

  for (const path of snapshot?.objectPaths ?? []) {
    result.set(path.pathId, { cellId: path.destinationCellId, depth: path.depth, clipPolygonNdc: roundedPolygon(path.clipPolygonNdc) });
  }

  return result;
}

/** Lists the live archetypes that match `filter` with their instance counts per cell and, with `detail`, every written instance (placement, path, clip row). */
export function inspectInstances(
  context: RenderInspectionContext,
  filter: InspectInstancesFilter = {},
): readonly InspectedArchetypeInstances[] {
  const snapshot = context.snapshot();
  const paths = pathLookup(snapshot);
  const recordsByKey = context.recordsByArchetypeKey();
  const limit = filter.limit ?? defaultInstanceLimit;
  const result: InspectedArchetypeInstances[] = [];

  for (const archetype of context.archetypes()) {
    if (filter.archetypePrefix !== undefined && !archetype.archetypeKey.startsWith(filter.archetypePrefix)) {
      continue;
    }

    if (filter.objectId !== undefined && !(recordsByKey.get(archetype.archetypeKey) ?? []).some((record) => record.objectId === filter.objectId)) {
      continue;
    }

    const count = archetype.mesh.count;
    const matrixArray = archetype.mesh.instanceMatrix.array;
    const countByCell: Record<string, number> = {};
    const instances: InspectedInstance[] = [];

    for (let index = 0; index < count; index += 1) {
      const pathId = archetype.portalPathIdAttribute.getX(index);
      const path = paths.get(pathId);
      const cellKey = path?.cellId ?? "unknown";
      countByCell[cellKey] = (countByCell[cellKey] ?? 0) + 1;

      if (filter.detail && instances.length < limit) {
        const base = 16 * index;
        instances.push({
          index,
          pathId,
          cellId: path?.cellId,
          depth: path?.depth,
          clipIndex: archetype.portalClipIndexAttribute.getX(index),
          positionInRoot: roundedPosition(
            threePointToWorld(new THREE.Vector3(matrixArray[base + 12], matrixArray[base + 13], matrixArray[base + 14])),
          ),
          pathClipPolygonNdc: path?.clipPolygonNdc,
        });
      }
    }

    result.push({
      archetypeKey: archetype.archetypeKey,
      sourceObjectId: archetype.sourceObjectId,
      capacity: archetype.capacity,
      count,
      countByCell,
      ...(filter.detail ? { instances } : {}),
    });
  }

  return result;
}

function polygonContains(polygon: readonly { readonly x: number; readonly y: number }[], point: { readonly x: number; readonly y: number }): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];

    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Lists the visible portal paths of the last frame with their screen regions: which cell copy each shows, how many portals deep it is, and the clip polygon it is drawn
 * inside. With `containsNdc` it answers "which paths cover this pixel?", the question behind a cut-off or doubled object. Throws before the first frame.
 */
export function inspectPaths(context: RenderInspectionContext, filter: InspectPathsFilter = {}): InspectedPaths {
  const snapshot = context.snapshot();

  if (!snapshot) {
    throw new Error("no frame has been synced yet");
  }

  const limit = filter.limit ?? defaultRecordLimit;
  const paths: InspectedPath[] = [];
  let total = 0;

  for (const path of snapshot.objectPaths) {
    if (filter.cellId !== undefined && path.destinationCellId !== filter.cellId) {
      continue;
    }

    if (filter.containsNdc !== undefined && !polygonContains(path.clipPolygonNdc, filter.containsNdc)) {
      continue;
    }

    total += 1;
    if (paths.length < limit) {
      paths.push({
        pathId: path.pathId,
        destinationCellId: path.destinationCellId,
        depth: path.depth,
        clipIndex: resolvePortalInstanceClipIndex(path, snapshot.clipIndexByPathId, snapshot.unclippedRoot),
        clipPolygonNdc: roundedPolygon(path.clipPolygonNdc),
        screenAreaPixels: Math.round(path.screenAreaPixels),
        terminal: path.terminal,
      });
    }
  }

  return { rootCellId: snapshot.rootCellId, total, paths };
}

const traceDiagnostics = {
  reset() {},
  recordCapacityOverflow() {},
  capacityOverflowArchetypes: [] as readonly string[],
  capacityOverflowCount: 0,
};

/**
 * Explains, for every record of the object `objectId` and every visible path to the record's cell, whether an instance was written and, if not, why (the record skips the
 * root path, it is hidden near a camera, it is merged into the unclipped root copy, or the archetype is full). It re-runs the instance writer on the last frame's inputs with
 * a trace; the writer writes the values it wrote before, so the call changes nothing on screen. Throws if the object has no records or there was no frame yet.
 */
export function explainObjectInstances(context: RenderInspectionContext, objectId: string): InspectedObjectInstances {
  const snapshot = context.snapshot();

  if (!snapshot) {
    throw new Error("no frame has been synced yet");
  }

  const recordsByKey = context.recordsByArchetypeKey();
  const paths = pathLookup(snapshot);
  const decisions: InspectedInstanceDecision[] = [];
  let found = false;

  for (const archetype of context.archetypes()) {
    const records = recordsByKey.get(archetype.archetypeKey) ?? [];

    if (!records.some((record) => record.objectId === objectId)) {
      continue;
    }

    found = true;
    updateRuntimeObjectRenderArchetypeInstances(
      [archetype],
      new Map([[archetype.archetypeKey, records]]),
      snapshot.objectPathsByDestinationCell,
      traceDiagnostics,
      snapshot.clipIndexByPathId,
      {
        cameraPositions: snapshot.cameraPositions,
        unclippedRoot: snapshot.unclippedRoot,
        rootGroupByPathId: snapshot.rootGroupByPathId,
        onDecision(decision) {
          if (decision.record.objectId !== objectId) {
            return;
          }

          decisions.push({
            archetypeKey: decision.record.archetypeKey,
            recordCellId: decision.record.cellId,
            pathId: decision.path.pathId,
            pathDepth: decision.path.depth,
            outcome: decision.outcome,
            instanceIndex: decision.instanceIndex,
            clipIndex: resolvePortalInstanceClipIndex(decision.path, snapshot.clipIndexByPathId, snapshot.unclippedRoot),
            cameraDistanceMeters: decision.cameraDistanceMeters,
            suppressWithinCameraDistanceMeters: decision.record.suppressWithinCameraDistanceMeters,
            positionInRoot: Number.isNaN(decision.position.x)
              ? undefined
              : roundedPosition(threePointToWorld(new THREE.Vector3(decision.position.x, decision.position.y, decision.position.z))),
            pathClipPolygonNdc: paths.get(decision.path.pathId)?.clipPolygonNdc,
          });
        },
      },
    );
  }

  if (!found) {
    throw new Error(`no records of object "${objectId}" in the last frame`);
  }

  return { objectId, rootCellId: snapshot.rootCellId, decisions };
}

/** Publishes the inspection functions as the public API namespace `render`; pair with {@link uninstallRenderInspectionApi} on teardown. */
export function installRenderInspectionApi(context: RenderInspectionContext): void {
  setApiNamespace("render", {
    recordSources: () => inspectRecordSources(context),
    records: (filter?: InspectRecordsFilter) => inspectRecords(context, filter),
    explainGhosts: (objectId: string) => explainObjectGhosts(context, objectId),
    instances: (filter?: InspectInstancesFilter) => inspectInstances(context, filter),
    explainInstances: (objectId: string) => explainObjectInstances(context, objectId),
    paths: (filter?: InspectPathsFilter) => inspectPaths(context, filter),
  });
}

/** Removes the public API namespace `render`. */
export function uninstallRenderInspectionApi(): void {
  setApiNamespace("render", undefined);
}
