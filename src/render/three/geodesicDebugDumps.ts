/**
 * Console debug dumps for geodesics and geodesic creatures, plus the periodic creature consistency check.
 *
 * Read-only: every dump snapshots the runtime object registry (and, for creatures, the scene graph) and prints it with
 * `console.info`/`console.table`, also returning the structured dump. Lengths are in meters and coordinates are cell-local
 * (x right, y forward, z up), formatted to fixed precision for readability. The functions are installed as
 * browser-console helpers by createThreeApp; the verbose per-frame check does nothing unless the debug level is "verbose".
 */
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { addVec3, scaleVec3 } from "../../math/vec3";
import type { ClientSession } from "../../runtime/clientSession";
import { getEmitterGeodesicIds, isTied } from "../../world-objects/geodesic/endpoints";
import { collectGeodesicPortalWord, getGeodesicSegments } from "../../world-objects/geodesic/segments";
import { getGeodesicConnection, arcConnectsEmitters } from "../../world-objects/geodesic/lifecycle";
import { type GeodesicMarmotRuntime } from "./creatures/geodesicMarmotView";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { type SimpleGeoCreatureRuntime } from "./creatures/simpleGeoCreatureView";
import { AimTarget } from "../../interaction/aimTarget";
import {
  AllGeodesicsDebugDump,
  EndpointDebugDump,
  GeodesicPathDebugDump,
  GeodesicWordDebugDump,
  formatEndpointRef,
  formatGeodesicPortalWord,
  formatVec3,
  getGeodesicDebugAnchorPoint,
  reverseGeodesicPortalTraversal,
  roundedMeters,
  totalGeodesicLengthFromDebugSegments,
} from "./appDebugHelpers";
import { formatGeodesicTerminal } from "./carriedGeodesicCannon";
import { GeodesicCreatureDebugDump, collectGeodesicCreatureDebugDump } from "./geodesicCreatureDebug";

const geodesicCreatureDebugCheckIntervalSeconds = 0.1;
const geodesicCreatureHealthyLogIntervalSeconds = 5;

/** Dependencies of the geodesic debug dumps, supplied by createThreeApp's shell. */
export interface GeodesicDebugDumpsDeps {
  /** Selected world id; value (fixed for the app's lifetime), reported in the all-geodesics dump. */
  readonly worldId: string;
  /** Registry read for geodesic segments, intervals, cannons, and anchors. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Live creature runtimes checked by the creature dump and consistency check; the array is read each call, not copied. */
  readonly dynamicObjectRuntimes: readonly (GeodesicMarmotRuntime | SimpleGeoCreatureRuntime)[];
  /** Per-cell root objects by cell id, used to verify creature parenting and visibility. */
  readonly cellMeshes: ReadonlyMap<string, THREE.Object3D>;
  /** Getter for the active compiled world (it can be replaced at runtime). */
  getWorld(): CompiledCellComplex;
  /** The shell session; only the menu state's selected tool is reported. */
  readonly session: ClientSession;
  /** Getter for the id of the cell currently rendered as visible, if any. */
  getVisibleCellId(): string | undefined;
  /** Getter for the most recent portal crossing by the player or carried emitter, if any. */
  /** Geodesic or emitter the camera ray currently targets, if any. */
  resolveCameraAimTarget(): AimTarget | undefined;
}

/**
 * Creates the geodesic debug-dump functions.
 *
 * Returns `dumpGeodesicCreatures` (creature parenting and visibility table), `dumpGeodesicPath` (segments and portal word of
 * one geodesic; defaults to the active, selected, or aimed geodesic and returns `undefined` when none is found),
 * `dumpLockedGeodesicWords` (portal words of all locked geodesics), `dumpAllGeodesics` (full registry snapshot, also
 * printed as copyable JSON), and `updateGeodesicCreatureDebug(deltaSeconds)` for per-frame use. The last accumulates time and,
 * in verbose mode, checks creatures every 0.1 s, warning on any issue and logging a healthy status at most every 5 s.
 * Holds only timer state; nothing to dispose.
 */
export function createGeodesicDebugDumps(deps: GeodesicDebugDumpsDeps) {
  const { runtimeObjectRegistry, dynamicObjectRuntimes, cellMeshes } = deps;
  let geodesicCreatureDebugElapsedSeconds = 0;
  let geodesicCreatureHealthyLogElapsedSeconds = geodesicCreatureHealthyLogIntervalSeconds;

  function dumpGeodesicCreatures(): GeodesicCreatureDebugDump {
    const dump = collectGeodesicCreatureDebugDump({
      world: deps.getWorld(),
      runtimes: dynamicObjectRuntimes,
      registry: runtimeObjectRegistry,
      cellRoots: cellMeshes,
    });
    console.info("[noneuclid] geodesic creature dump", dump);
    console.table(dump.records.map((record) => ({
      id: record.id,
      kind: record.kind,
      runtimeCellId: record.runtimeCellId,
      registryCellId: record.registryCellId,
      parentCellId: record.parentCellId,
      localPosition: record.localPosition
        ? `${record.localPosition.x}, ${record.localPosition.y}, ${record.localPosition.z}`
        : "(missing)",
      renderVisible: record.renderVisible,
      ancestorsVisible: record.ancestorsVisible,
      issues: record.issues.join(", "),
    })));
    return dump;
  }

  function dumpGeodesicPath(requestedGeodesicId?: string): GeodesicPathDebugDump | undefined {
    const geodesicId = requestedGeodesicId ?? resolveDebugGeodesicId();
    if (!geodesicId) {
      console.info("[noneuclid] geodesic path dump: no active or aimed geodesic.");
      return undefined;
    }

    const segments = getGeodesicSegments(runtimeObjectRegistry, geodesicId);
    const word = collectGeodesicPortalWord(runtimeObjectRegistry, geodesicId);
    const start = segments[0]?.start;
    const dump: GeodesicPathDebugDump = {
      geodesicId,
      locked: arcConnectsEmitters(runtimeObjectRegistry, geodesicId),
      connection: getGeodesicConnection(runtimeObjectRegistry, geodesicId),
      startCellId: segments[0]?.cellId,
      start: start ? formatVec3(start) : undefined,
      word,
      wordText: formatGeodesicPortalWord(word),
      reverseWordText: formatGeodesicPortalWord([...word].reverse().map(reverseGeodesicPortalTraversal)),
      segments: segments.map((segment) => ({
        id: segment.id,
        cellId: segment.cellId,
        index: segment.segmentIndex,
        lengthMeters: Number(segment.lengthMeters.toFixed(4)),
        start: formatVec3(segment.start),
        direction: formatVec3(segment.direction),
        terminal: formatGeodesicTerminal(segment.terminal),
        connectionState: segment.connectionState ?? "open",
      })),
    };

    console.info("[noneuclid] geodesic path dump", dump);
    console.table(dump.segments);
    return dump;
  }

  function dumpLockedGeodesicWords(): readonly GeodesicWordDebugDump[] {
    const geodesicIds = collectKnownGeodesicIds()
      .filter((geodesicId) => arcConnectsEmitters(runtimeObjectRegistry, geodesicId))
      .sort();
    const dumps = geodesicIds.map(createGeodesicWordDebugDump);
    console.info("[noneuclid] locked geodesic words", dumps);
    console.table(dumps.map((dump) => ({
      geodesicId: dump.geodesicId,
      startCellId: dump.startCellId,
      start: dump.start,
      word: dump.wordText,
      connection: dump.connection
        ? `${dump.connection.outgoingEmitterId}->${dump.connection.incomingEmitterId ?? "(open)"}:${dump.connection.state}`
        : "(none)",
    })));
    return dumps;
  }

  function dumpAllGeodesics(): AllGeodesicsDebugDump {
    const objects = runtimeObjectRegistry.getAll();
    const geodesicIds = [...collectKnownGeodesicIds()].sort();
    const segments = objects
      .filter((object): object is Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/segment" }> =>
        object.kind === "geodesicModel/segment"
      )
      .sort((left, right) =>
        left.geodesicId.localeCompare(right.geodesicId) || left.segmentIndex - right.segmentIndex
      );
    const intervals = objects
      .filter((object): object is Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/arc" }> =>
        object.kind === "geodesicModel/arc"
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const anchors = objects
      .filter((object) => object.kind === "geodesic-cannon" || object.kind === "geodesicModel/vertex")
      .sort((left, right) => left.id.localeCompare(right.id));

    const dump: AllGeodesicsDebugDump = {
      worldId: deps.worldId,
      visibleCellId: deps.getVisibleCellId(),
      selectedTool: deps.session.get().menuState.selectedTool,
      activeGeodesicCannonToolState: deps.session.get().cannonToolState,
      geodesicIds,
      intervals: intervals.map((interval) => {
        const intervalSegments = getGeodesicSegments(runtimeObjectRegistry, interval.id);
        return {
          id: interval.id,
          cellId: interval.cellId,
          startCellId: interval.startCellId,
          tied: isTied(runtimeObjectRegistry, interval.id),
          start: describeEndpointAttachment(interval.start),
          end: describeEndpointAttachment(interval.end),
          portalWordText: formatGeodesicPortalWord(interval.portalWord),
          portalWord: interval.portalWord,
          connection: getGeodesicConnection(runtimeObjectRegistry, interval.id),
          locked: arcConnectsEmitters(runtimeObjectRegistry, interval.id),
          segmentCount: intervalSegments.length,
          totalSegmentLengthMeters: roundedMeters(totalGeodesicLengthFromDebugSegments(intervalSegments)),
          segmentCells: [...new Set(intervalSegments.map((segment) => segment.cellId))],
        };
      }),
      segments: segments.map((segment) => ({
        id: segment.id,
        geodesicId: segment.geodesicId,
        cellId: segment.cellId,
        index: segment.segmentIndex,
        halfRole: segment.halfRole,
        lengthMeters: roundedMeters(segment.lengthMeters),
        start: formatVec3(segment.start),
        end: formatVec3(addVec3(segment.start, scaleVec3(segment.direction, segment.lengthMeters))),
        direction: formatVec3(segment.direction),
        terminal: formatGeodesicTerminal(segment.terminal),
        connectionState: segment.connectionState ?? "open",
        highlightState: segment.highlightState,
      })),
      anchors: anchors.map((anchor) => ({
        id: anchor.id,
        kind: anchor.kind,
        cellId: anchor.cellId,
        point: formatVec3(anchor.kind === "geodesic-cannon" ? getGeodesicDebugAnchorPoint(anchor) : anchor.localPose.translation),
        attachedEndpoints: objects
          .filter((object): object is Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/arc" }> =>
            object.kind === "geodesicModel/arc"
          )
          .flatMap((interval) => [interval.start, interval.end])
          .filter((endpoint) => endpoint.anchorObjectId === anchor.id)
          .map(formatEndpointRef),
      })),
    };

    console.info("[noneuclid] all geodesics dump", dump);
    console.info("[noneuclid] copyable all geodesics dump\n" + JSON.stringify(dump, null, 2));
    console.table(dump.intervals.map((interval) => ({
      id: interval.id,
      tied: interval.tied,
      start: `${interval.start.anchorObjectId}@${interval.start.anchorCellId}`,
      end: `${interval.end.anchorObjectId}@${interval.end.anchorCellId}`,
      word: interval.portalWordText,
      segments: interval.segmentCount,
      totalLength: interval.totalSegmentLengthMeters,
    })));
    return dump;
  }

  function describeEndpointAttachment(endpoint: {
    readonly geodesicId: string;
    readonly role: string;
    readonly anchorObjectId: string;
  }): EndpointDebugDump {
    const anchor = runtimeObjectRegistry.get(endpoint.anchorObjectId);
    return {
      geodesicId: endpoint.geodesicId,
      role: endpoint.role,
      anchorObjectId: endpoint.anchorObjectId,
      anchorKind: anchor?.kind,
      anchorCellId: anchor?.cellId,
      anchorPoint: anchor
        ? formatVec3(anchor.kind === "geodesic-cannon" ? getGeodesicDebugAnchorPoint(anchor) : anchor.localPose.translation)
        : undefined,
    };
  }

  function createGeodesicWordDebugDump(geodesicId: string): GeodesicWordDebugDump {
    const segments = getGeodesicSegments(runtimeObjectRegistry, geodesicId);
    const word = collectGeodesicPortalWord(runtimeObjectRegistry, geodesicId);
    const start = segments[0]?.start;
    return {
      geodesicId,
      locked: arcConnectsEmitters(runtimeObjectRegistry, geodesicId),
      connection: getGeodesicConnection(runtimeObjectRegistry, geodesicId),
      startCellId: segments[0]?.cellId,
      start: start ? formatVec3(start) : undefined,
      word,
      wordText: formatGeodesicPortalWord(word),
      transitions: word.map((step, index) => ({
        index,
        sourceCellId: step.sourceCellId,
        sourcePortalId: step.sourcePortalId,
        targetCellId: step.targetCellId,
        targetPortalId: step.targetPortalId,
      })),
    };
  }

  function collectKnownGeodesicIds(): readonly string[] {
    const ids = new Set<string>();
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "geodesicModel/segment") {
        ids.add(object.geodesicId);
      } else if (object.kind === "geodesicModel/arc") {
        ids.add(object.id);
      }
    }
    return [...ids];
  }

  function resolveDebugGeodesicId(): string | undefined {
    if (deps.session.get().cannonToolState.activeGeodesicId) {
      return deps.session.get().cannonToolState.activeGeodesicId;
    }

    const cannonId = deps.session.get().cannonToolState.selectedCannonId;
    const selectedCannon = cannonId ? runtimeObjectRegistry.get(cannonId) : undefined;
    if (selectedCannon?.kind === "geodesic-cannon") {
      return getEmitterGeodesicIds(runtimeObjectRegistry, selectedCannon.id)[0];
    }

    const target = deps.resolveCameraAimTarget();
    const object = target?.object;
    if (object?.kind === "geodesicModel/segment") {
      return object.geodesicId;
    }
    if (object?.kind === "geodesic-cannon") {
      return getEmitterGeodesicIds(runtimeObjectRegistry, object.id)[0];
    }

    return undefined;
  }

  function updateGeodesicCreatureDebug(deltaSeconds: number): void {
    if (deps.session.get().debugSettings.debugLevel !== "verbose" || deltaSeconds <= 0) {
      return;
    }

    geodesicCreatureDebugElapsedSeconds += deltaSeconds;
    geodesicCreatureHealthyLogElapsedSeconds += deltaSeconds;
    if (geodesicCreatureDebugElapsedSeconds < geodesicCreatureDebugCheckIntervalSeconds) {
      return;
    }

    geodesicCreatureDebugElapsedSeconds = 0;
    const dump = collectGeodesicCreatureDebugDump({
      world: deps.getWorld(),
      runtimes: dynamicObjectRuntimes,
      registry: runtimeObjectRegistry,
      cellRoots: cellMeshes,
    });
    const message = `[noneuclid] geodesic creature consistency: ${dump.issueCount} issue(s) across ${dump.creatureCount} creature(s)`;

    if (dump.issueCount > 0) {
      console.warn(message, dump);
      return;
    }

    if (geodesicCreatureHealthyLogElapsedSeconds < geodesicCreatureHealthyLogIntervalSeconds) {
      return;
    }

    geodesicCreatureHealthyLogElapsedSeconds = 0;
    console.info(message, dump.records);
  }

  return {
    dumpGeodesicCreatures,
    dumpGeodesicPath,
    dumpLockedGeodesicWords,
    dumpAllGeodesics,
    updateGeodesicCreatureDebug,
  };
}
