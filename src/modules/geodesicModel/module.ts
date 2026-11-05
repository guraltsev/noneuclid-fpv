/**
 * The geodesic model module (design 013 section 13.1): piecewise geodesics on the glued complex as a world module. It is a facade over the geometry in
 * `src/world-objects/geodesic/` (the implementation stays there in this wave, because legacy callers import it and `world-objects` cannot import this layer).
 *
 * The module declares the four geodesic kinds (arc, vertex, segment, crossing), provides the token `geodesicModel` with the queries clients and dependents
 * read and the hot operations only dependents hold (`previewVertexMove`, `commitVertexMove`, `previewVertexRemoval`, and on the fast channel `retraceArc`, `followAnchorRoute`, `rebuildArcsOfEmitter`), and handles the commands `tieAndDetach`,
 * `highlightEndpoint`, and the module-only `removeVertex`, `removeCurve`, `shootArc`, `extendArc`, `cutAtSegment`, `cutAtVertex` and `removePlainArcs`. Its one tick, `crossings`, is a derive tick that recomputes the crossing markers when segments change. The
 * tie command requires the tie tool (defined here, with its client part in `client.ts`) unless the experience leaves the tool out. Each command is atomic: on refusal nothing changes.
 * Everything that writes an arc, a vertex or a segment runs here, in this module's frame, so the write guard holds for every caller; the emitter's own record is the emitters' to write.
 */
import type { CommandContext, CommandHandlers, CommandResult, ModuleDefinition, ModuleTick, ObjectKindDeclaration } from "../../engine/moduleTypes";
import { cutGeodesicsAtVertex, extendGeodesic, followAnchorRoute, rebuildGeodesicToLength, shootGeodesic } from "../../world-objects/geodesic/cannon";
import { rebuildEmitterGeodesics } from "../../world-objects/geodesic/carryEnd";
import {
  arcsAtVertex,
  arcsOfCurve,
  arcsOfCurveContaining,
  forEachTiedVertex,
  getEmitterGeodesicIds,
  getGeodesicEndpointAttachmentsForAnchor,
  isAimableFreeGeodesic,
  isStale,
  isTied,
  tiedVertexCount,
} from "../../world-objects/geodesic/endpoints";
import { splitGeodesicIntervalAtSegmentHit } from "../../world-objects/geodesic/intervals";
import { arcConnectsEmitters, getGeodesicConnection, removeGeodesic, removePlainGeodesicsFromCannon } from "../../world-objects/geodesic/lifecycle";
import { pruneMissingGeodesicIntersectionObjects, updateGeodesicIntersectionObjects } from "../../world-objects/geodesic/intersections";
import { getGeodesicSegments } from "../../world-objects/geodesic/segments";
import {
  arcTangentsAtVertex,
  commitVertexMove,
  lengthOfArcs,
  previewVertexMove,
  previewVertexRemoval,
  removeVertex,
  tieAtNewVertex,
  type TieAtNewVertexRefusal,
} from "../../world-objects/geodesic/vertices";
import {
  defaultGeodesicModelOptions,
  geodesicModelRefusals,
  geodesicModelToken,
  geodesicTieToolId,
  type GeodesicCutAtSegmentCommand,
  type GeodesicCutAtVertexCommand,
  type GeodesicExtendArcCommand,
  type GeodesicHighlightEndpointCommand,
  type GeodesicModelApi,
  type GeodesicModelOptions,
  type GeodesicModelCommand,
  type GeodesicModelEvent,
  type GeodesicModelQueries,
  type GeodesicRemoveCurveCommand,
  type GeodesicRemovePlainArcsCommand,
  type GeodesicRemoveVertexCommand,
  type GeodesicShootArcCommand,
  type GeodesicTieAndDetachCommand,
  type GeodesicVertexTiedEvent,
} from "./api";

/** The module as the engine's list takes it. */
export type GeodesicModelModuleDefinition = ModuleDefinition<GeodesicModelApi, GeodesicModelCommand, GeodesicModelEvent, GeodesicModelQueries>;

const objectKinds: readonly ObjectKindDeclaration[] = [
  { kind: "geodesicModel/arc", label: "real", persistence: "saved" },
  { kind: "geodesicModel/vertex", label: "real", persistence: "saved" },
  { kind: "geodesicModel/segment", label: "cheap-derived", persistence: "rebuilt" },
  { kind: "geodesicModel/crossing", label: "cheap-derived", persistence: "rebuilt" },
];

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

const tieRefusals: Record<TieAtNewVertexRefusal, { readonly code: string; readonly message: string }> = {
  sameEndpoint: { code: geodesicModelRefusals.sameEndpoint, message: "Pick two different geodesic ends." },
  notAnEmitter: { code: geodesicModelRefusals.notAnEmitter, message: "That is not an emitter." },
  notAttached: { code: geodesicModelRefusals.notAttached, message: "Both ends must be attached to the emitter." },
  notConnected: { code: geodesicModelRefusals.notConnected, message: "Both geodesics must connect emitters." },
  rebuildFailed: { code: geodesicModelRefusals.rebuildFailed, message: "The tied geodesics could not be rebuilt." },
};

function tieAndDetach(command: GeodesicTieAndDetachCommand, ctx: CommandContext): CommandResult {
  const tied = tieAtNewVertex(ctx.world, ctx.objects, {
    detachedEmitterId: command.emitterId,
    first: command.first,
    second: command.second,
    createVertexId: () => ctx.ids.next("vertex"),
  });
  if (!tied.ok) {
    return { ok: false, refusal: tieRefusals[tied.reason] };
  }
  const event: GeodesicVertexTiedEvent = { kind: "geodesicModel/vertexTied", vertexId: tied.vertexId, arcIds: tied.arcIds };
  ctx.emit(event);
  return { ok: true, value: { vertexId: tied.vertexId } };
}

function highlightEndpoint(command: GeodesicHighlightEndpointCommand, ctx: CommandContext): CommandResult {
  const { selection } = command;
  for (const segment of getGeodesicSegments(ctx.objects, selection.geodesicId)) {
    if (segment.halfRole !== selection.role) continue;
    const highlightState = command.on ? "tie-detach-selected" : undefined;
    if (segment.highlightState !== highlightState) ctx.objects.update({ ...segment, highlightState });
  }
  return { ok: true };
}

function removeVertexCommand(command: GeodesicRemoveVertexCommand, ctx: CommandContext): CommandResult {
  const preview = previewVertexRemoval(ctx.world, ctx.objects, { vertexId: command.vertexId, arcs: command.arcs });
  if (preview.kind === "blocked") {
    return refuse(geodesicModelRefusals.vertexBlocked, `The vertex cannot be removed (${preview.reason}).`);
  }
  return { ok: true, value: { arcIds: removeVertex(ctx.objects, command.vertexId, preview) } };
}

function removeCurve(command: GeodesicRemoveCurveCommand, ctx: CommandContext): CommandResult {
  if (!command.arcIds.every((arcId) => ctx.objects.get(arcId)?.kind === "geodesicModel/arc")) {
    return refuse(geodesicModelRefusals.unknownArc, "One of the arcs does not exist.");
  }
  for (const arcId of command.arcIds) removeGeodesic(ctx.objects, arcId);
  return { ok: true, value: { arcIds: command.arcIds } };
}

function shootArc(command: GeodesicShootArcCommand, ctx: CommandContext): CommandResult {
  const emitter = ctx.objects.get(command.emitterId);
  if (emitter?.kind !== "geodesicEmitters/emitter") return refuse(geodesicModelRefusals.notAnEmitter, "That is not an emitter.");
  const arcId = ctx.ids.next("arc");
  shootGeodesic({ world: ctx.world, registry: ctx.objects, cannon: emitter, geodesicId: arcId, maxLengthMeters: command.lengthMeters });
  return { ok: true, value: { arcId } };
}

function extendArc(command: GeodesicExtendArcCommand, ctx: CommandContext): CommandResult {
  // `extendGeodesic` writes only once it knows the geodesic can go on.
  const extended = extendGeodesic({ world: ctx.world, registry: ctx.objects, geodesicId: command.arcId, maxLengthMeters: command.lengthMeters });
  return extended === undefined ? refuse(geodesicModelRefusals.arcBlocked, "That geodesic cannot go any further.") : { ok: true };
}

function cutAtSegment(command: GeodesicCutAtSegmentCommand, ctx: CommandContext): CommandResult {
  const interval = ctx.objects.get(command.arcId);
  const segment = ctx.objects.get(command.segmentId);
  const placed = ctx.objects.get(command.emitterId);
  if (interval?.kind !== "geodesicModel/arc" || segment?.kind !== "geodesicModel/segment" || placed?.kind !== "geodesicEmitters/emitter") {
    return refuse(geodesicModelRefusals.unknownArc, "That geodesic cannot be cut there.");
  }
  splitGeodesicIntervalAtSegmentHit({
    world: ctx.world,
    registry: ctx.objects,
    interval,
    segment,
    distanceAlongSegmentMeters: command.distanceAlongSegmentMeters,
    placed,
    createContinuationGeodesicId: () => ctx.ids.next("arc"),
  });
  return { ok: true };
}

function cutAtVertex(command: GeodesicCutAtVertexCommand, ctx: CommandContext): CommandResult {
  const emitter = ctx.objects.get(command.emitterId);
  if (emitter?.kind !== "geodesicEmitters/emitter") return refuse(geodesicModelRefusals.notAnEmitter, "That is not an emitter.");
  const yawRadians = cutGeodesicsAtVertex({
    world: ctx.world,
    registry: ctx.objects,
    emitter,
    cellId: command.cellId,
    vertexPoint: command.vertexPoint,
    createContinuationGeodesicId: () => ctx.ids.next("arc"),
  });
  return yawRadians === undefined ? { ok: true } : { ok: true, value: { yawRadians } };
}

function removePlainArcs(command: GeodesicRemovePlainArcsCommand, ctx: CommandContext): CommandResult {
  return { ok: true, value: { arcIds: removePlainGeodesicsFromCannon(ctx.objects, command.emitterId) } };
}

/**
 * Crossing markers follow the segments: every pass that sees a segment written recomputes them all (the call removes and adds every marker, so it writes whenever it wakes).
 * The identity memory then forgets the markers that did not come back, so a marker keeps its id only across the pass that moves it.
 */
const crossingsTick: ModuleTick = {
  id: "geodesicModel/crossings",
  phase: "derive",
  writes: ["geodesicModel/crossing"],
  subscribes: ["geodesicModel/segment"],
  run(ctx) {
    updateGeodesicIntersectionObjects(ctx.objects);
    pruneMissingGeodesicIntersectionObjects(ctx.objects);
  },
};

/**
 * Creates the geodesic model module.
 * It requires nothing; the modules that act on its curves require `geodesicModelToken`.
 * With `tieTool: false` (default true) the module defines no tool id and the tie command does not require one.
 */
export function geodesicModelModule(options: Partial<GeodesicModelOptions> = {}): GeodesicModelModuleDefinition {
  const { tieTool } = { ...defaultGeodesicModelOptions, ...options };
  return {
    id: "geodesicModel",
    provides: geodesicModelToken,
    requires: [],
    objectKinds,
    toolIds: tieTool ? [geodesicTieToolId] : [],
    create: (context) => {
      const { objects } = context;
      const queries: GeodesicModelQueries = {
        arcsAtVertex: (vertexId) => arcsAtVertex(objects, vertexId),
        arcTangentsAtVertex: (vertexId, arcs, displacedTo) => arcTangentsAtVertex(context.getWorld(), objects, vertexId, arcs, displacedTo),
        lengthOfArcs: (arcs) => lengthOfArcs(objects, arcs),
        connectsEmitters: (arcId) => arcConnectsEmitters(objects, arcId),
        isTied: (arcId) => isTied(objects, arcId),
        tiedVertexCount: () => tiedVertexCount(objects),
        forEachTiedVertex: (fn) => forEachTiedVertex(objects, fn),
        arcsOfCurve: (vertexId) => arcsOfCurve(objects, vertexId),
        curveOfArc: (arcId) => arcsOfCurveContaining(objects, arcId),
        arcsOnEmitter: (emitterId) => getEmitterGeodesicIds(objects, emitterId),
        emitterOfArc: (arcId) => getGeodesicConnection(objects, arcId)?.outgoingEmitterId,
        isStale: (arcId) => isStale(objects, arcId),
        tieableEnds: (emitterId) => getGeodesicEndpointAttachmentsForAnchor(objects, emitterId).filter((end) => arcConnectsEmitters(objects, end.geodesicId)),
      };
      const api: GeodesicModelApi = {
        ...queries,
        previewVertexMove: (input) => previewVertexMove(context.getWorld(), objects, input),
        commitVertexMove: (preview) => commitVertexMove(objects, preview),
        previewVertexRemoval: (input) => previewVertexRemoval(context.getWorld(), objects, input),
        retraceArc({ emitter, arcId, connectEmitters }) {
          const arc = objects.get(arcId);
          if (arc?.kind !== "geodesicModel/arc" || arc.intendedLengthMeters === undefined || !isAimableFreeGeodesic(objects, arc)) return;
          rebuildGeodesicToLength({ world: context.getWorld(), registry: objects, cannon: emitter, geodesicId: arcId, totalLengthMeters: arc.intendedLengthMeters, connectEmitters });
        },
        followAnchorRoute: (emitterId, route) => followAnchorRoute(objects, emitterId, route),
        rebuildArcsOfEmitter: ({ emitterId, activeArcId, keepOnFailure }) =>
          rebuildEmitterGeodesics({ world: context.getWorld(), registry: objects, emitterId, activeGeodesicId: activeArcId, preserveGeodesicOnRebuildFailure: keepOnFailure }),
      };
      const commands: CommandHandlers<GeodesicModelCommand> = {
        "geodesicModel/tieAndDetach": tieTool ? { run: tieAndDetach, requiresTool: geodesicTieToolId } : { run: tieAndDetach },
        "geodesicModel/highlightEndpoint": { run: highlightEndpoint },
        "geodesicModel/removeVertex": { run: removeVertexCommand, moduleOnly: true },
        "geodesicModel/removeCurve": { run: removeCurve, moduleOnly: true },
        "geodesicModel/shootArc": { run: shootArc, moduleOnly: true },
        "geodesicModel/extendArc": { run: extendArc, moduleOnly: true },
        "geodesicModel/cutAtSegment": { run: cutAtSegment, moduleOnly: true },
        "geodesicModel/cutAtVertex": { run: cutAtVertex, moduleOnly: true },
        "geodesicModel/removePlainArcs": { run: removePlainArcs, moduleOnly: true },
      };
      return { api, queries, commands, ticks: [crossingsTick] };
    },
  };
}
