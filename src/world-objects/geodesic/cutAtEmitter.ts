/**
 * Cutting the arcs that pass through an emitter: an emitter set down on a geodesic's path becomes a point of it.
 * An arc whose path passes within `emitterConnectionToleranceMeters` of the emitter's beam point is split there into two arcs, one ending at the
 * emitter and one leaving it towards the old far end (an emitter, a free end or a tied vertex), so free, connected and tied arcs alike. The split keeps the
 * homotopy class: the stored portal word is cut where the path meets the emitter, and each half is realized as a straight chord with its half of the word.
 * A tied curve cut this way is pinned: the emitter becomes an end node of the two parts, and the curve shortening flow straightens each part on its own.
 * Both halves are realized before anything is written, so an arc that cannot be split stays as it was. Arcs on the emitter itself are left alone.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { realizeIntervalChord, rebuildDerivedGeodesicSegments } from "./intervals";
import {
  createGeodesicArcObject,
  emitterConnectionToleranceMeters,
  getGeodesicCannonEmitterPoint,
  GEODESIC_MIN_LENGTH_METERS,
  intersectionTolerance,
  type GeodesicArcObject,
  type GeodesicEmitterObject,
  type GeodesicSegmentObject,
} from "./objects";
import { collectPortalWordFromTraces, samePortalWord } from "./portalWord";
import { distanceAlongSegment, getGeodesicSegments, nextGeodesicNumber, segmentToTrace } from "./segments";

/** Where an arc's path passes the emitter: the segment, the distance along it, and the arc length from the arc's start to that point. */
interface PathHit {
  readonly segment: GeodesicSegmentObject;
  readonly distanceAlongSegmentMeters: number;
  readonly lengthFromStartMeters: number;
}

/**
 * Splits every arc whose path passes `emitter` (see the module header) and returns the ids of the arcs that leave the emitter after the split.
 * `createArcId` is called once per split arc. Mutates the registry; an arc whose halves cannot both be realized is not changed.
 */
export function cutArcsPassingEmitter(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly emitter: GeodesicEmitterObject;
  readonly createArcId: () => string;
}): readonly string[] {
  const { world, registry, emitter } = input;
  const point = getGeodesicCannonEmitterPoint(emitter);
  const arcIds = new Set(
    registry.getObjectsInCell(emitter.cellId)
      .filter((object): object is GeodesicSegmentObject => object.kind === "geodesicModel/segment")
      .map((segment) => segment.geodesicId),
  );
  const created: string[] = [];
  for (const arcId of [...arcIds].sort()) {
    const arc = registry.get(arcId);
    if (arc?.kind !== "geodesicModel/arc" || arc.start.anchorObjectId === emitter.id || arc.end.anchorObjectId === emitter.id) {
      continue;
    }
    const segments = getGeodesicSegments(registry, arc.id);
    if (!segmentsRunFromStart(world, registry, arc, segments)) {
      continue;
    }
    const hit = firstPathHit(segments, emitter.cellId, point);
    if (hit === undefined) {
      continue;
    }
    const leaving = splitArcAtHit(world, registry, arc, segments, hit, emitter, input.createArcId);
    if (leaving !== undefined) {
      created.push(leaving);
    }
  }
  return created;
}

// The split itself: the arc keeps its start and now ends at the emitter; a new arc leaves the emitter for the old end. Nothing is written unless both chords realize.
function splitArcAtHit(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  arc: GeodesicArcObject,
  segments: readonly GeodesicSegmentObject[],
  hit: PathHit,
  emitter: GeodesicEmitterObject,
  createArcId: () => string,
): string | undefined {
  const before = segments.filter((segment) => segment.segmentIndex < hit.segment.segmentIndex).map(segmentToTrace);
  const after = segments.filter((segment) => segment.segmentIndex >= hit.segment.segmentIndex).map(segmentToTrace);
  const totalMeters = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
  const toEmitter: GeodesicArcObject = {
    ...arc,
    end: { geodesicId: arc.id, role: "end", anchorObjectId: emitter.id },
    portalWord: collectPortalWordFromTraces(world, before),
  };
  const fromEmitter = createGeodesicArcObject({
    id: "",
    startAnchorObjectId: emitter.id,
    endAnchorObjectId: arc.end.anchorObjectId,
    startCellId: emitter.cellId,
    portalWord: collectPortalWordFromTraces(world, after),
    intendedLengthMeters: 0,
  });
  const toEmitterMeters = realizedLengthMeters(world, registry, toEmitter);
  const fromEmitterMeters = realizedLengthMeters(world, registry, fromEmitter);
  if (toEmitterMeters === undefined || fromEmitterMeters === undefined) {
    return undefined;
  }
  const leavingId = createArcId();
  registry.update({ ...toEmitter, intendedLengthMeters: toEmitterMeters });
  registry.add(createGeodesicArcObject({
    id: leavingId,
    startAnchorObjectId: emitter.id,
    endAnchorObjectId: arc.end.anchorObjectId,
    startCellId: emitter.cellId,
    portalWord: fromEmitter.portalWord,
    geodesicNumber: nextGeodesicNumber(registry),
    // What a free arc had stopped short of its intention goes on with the half that keeps its free end.
    intendedLengthMeters: fromEmitterMeters + Math.max(0, arc.intendedLengthMeters - totalMeters),
  }));
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: toEmitter.id });
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: leavingId });
  return leavingId;
}

// The length of the chord that would realize `arc` with its word, or undefined when it cannot be realized. Reads the registry only.
function realizedLengthMeters(world: CompiledCellComplex, registry: RuntimeObjectRegistry, arc: GeodesicArcObject): number | undefined {
  const realization = realizeIntervalChord({ world, registry, interval: arc });
  return realization.kind === "ok" ? realization.traces.reduce((sum, trace) => sum + trace.lengthMeters, 0) : undefined;
}

// The first point of the path, in the emitter's cell, within the connection tolerance of `point`, that leaves both halves long enough to be arcs.
function firstPathHit(segments: readonly GeodesicSegmentObject[], cellId: string, point: { readonly x: number; readonly y: number; readonly z: number }): PathHit | undefined {
  const totalMeters = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
  let lengthBeforeMeters = 0;
  for (const segment of segments) {
    if (segment.cellId === cellId) {
      const along = Math.min(segment.lengthMeters, Math.max(0, distanceAlongSegment(segment, point)));
      const nearestX = segment.start.x + segment.direction.x * along;
      const nearestY = segment.start.y + segment.direction.y * along;
      const lengthFromStartMeters = lengthBeforeMeters + along;
      if (
        Math.hypot(point.x - nearestX, point.y - nearestY) <= emitterConnectionToleranceMeters &&
        lengthFromStartMeters >= GEODESIC_MIN_LENGTH_METERS &&
        totalMeters - lengthFromStartMeters >= GEODESIC_MIN_LENGTH_METERS
      ) {
        return { segment, distanceAlongSegmentMeters: along, lengthFromStartMeters };
      }
    }
    lengthBeforeMeters += segment.lengthMeters;
  }
  return undefined;
}

// The derived segments of an arc normally run from its start anchor; an arc traced from its end (a free arc whose emitter holds `end`) is left alone,
// since cutting its word by the segments' order would swap the halves. Checked on the word and on where the first segment starts.
function segmentsRunFromStart(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  arc: GeodesicArcObject,
  segments: readonly GeodesicSegmentObject[],
): boolean {
  const first = segments[0];
  const start = registry.get(arc.start.anchorObjectId);
  if (first === undefined || start === undefined || first.cellId !== arc.startCellId) {
    return false;
  }
  const startPoint = start.kind === "geodesicEmitters/emitter" ? getGeodesicCannonEmitterPoint(start) : start.localPose.translation;
  return (
    Math.hypot(first.start.x - startPoint.x, first.start.y - startPoint.y) <= intersectionTolerance * 10 &&
    samePortalWord(collectPortalWordFromTraces(world, segments.map(segmentToTrace)), arc.portalWord)
  );
}
