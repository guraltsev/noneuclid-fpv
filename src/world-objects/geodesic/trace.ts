/**
 * Tracing a horizontal geodesic ray through a compiled cell complex: the single-cell tracer, the multi-cell walk on the segment-walk kernel, and forbidden-zone (open-disk) and emitter hits.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { walkDevelopedSegment, type SegmentWalkPiece } from "../../cell-complex/segmentWalk";
import { transformDirection3, transformPoint3 } from "../../math/rigidTransform3";
import { crossXY } from "../../math/vec2";
import { addVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { geodesicPerfCounters } from "./perfCounters";
import {
  emitterConnectionToleranceMeters,
  type GeodesicCannonObject,
  type GeodesicSegmentTerminal,
  type GeodesicTraceBuildResult,
  intersectionTolerance,
  normalizeHorizontalDirection,
  type TraceGeodesicSegmentResult,
} from "./objects";

/** Input for `traceGeodesicSegment`: trace one ray inside one cell, up to `maxLengthMeters`. */
export interface TraceGeodesicSegmentInput {
  readonly world: CompiledCellComplex;
  /** Cell whose frame `start` and `direction` use; must exist in `world`. */
  readonly cellId: string;
  /** Ray origin, cell-local meters; only x and y affect the tracing (the ray is horizontal). */
  readonly start: Vec3;
  /** Travel direction; its z is ignored and it is normalized horizontally. A zero horizontal direction is invalid input. */
  readonly direction: Vec3;
  /** Maximum ray length in meters; must be finite and > 0 or `traceGeodesicSegment` throws. */
  readonly maxLengthMeters: number;
  /** Side (index in the cell's side list) the ray just came through; it is skipped instead of relying on the `t <= intersectionTolerance` guard. */
  readonly entrySideIndex?: number;
}

/** Input for `traceGeodesicSegmentWithEmitters`: a plain trace that also stops at emitters near the ray. */
export interface TraceGeodesicSegmentWithEmittersInput extends TraceGeodesicSegmentInput {
  readonly registry: RuntimeObjectRegistry;
  /** Geodesic being traced; emitters already listing this geodesic (other than the source) are not treated as hits. */
  readonly geodesicId: string;
  /** Emitter the geodesic leaves from; unlike other emitters of the geodesic it may be hit again by the ray. */
  readonly sourceEmitterId: string;
}

/** Half-width (meters) of the band around a forbidden-zone circle in which a start counts as being on the circle (open-disk rule). */
const forbiddenZoneCircleToleranceMeters = 1e-9;

/** Crossing limit of a geodesic walk; a 3 000 m chord on the torus family needs about 200. */
const maxGeodesicWalkCrossings = 4096;

// ---- Tracing ----

/**
 * Traces one straight ray inside a single cell and reports where and why it stops.
 *
 * The ray is horizontal: `direction` is normalized in x/y (z dropped) and `start.z` is irrelevant. The nearest of the
 * cell's side segments and forbidden zones decides the terminal: a side with a portal gives `portal-hit` (with the
 * continuation start/direction already mapped into the target cell by `transformToTarget`), a plain side gives
 * `wall-hit`, a zone gives `forbidden-zone-hit`, and no hit within `maxLengthMeters` gives `open` with
 * `lengthMeters === maxLengthMeters`. A hit at distance beyond `maxLengthMeters` (within tolerance) is clamped to it.
 * Hits with `t <= intersectionTolerance` are ignored so a ray starting on a side does not re-hit it.
 *
 * Throws `Error` if `cellId` is not in `world`, or `maxLengthMeters` is not a finite positive number. Does not
 * look at runtime objects; see `traceGeodesicSegmentWithEmitters` for emitter hits. Units: meters, cell-local frame.
 */
export function traceGeodesicSegment(input: TraceGeodesicSegmentInput): TraceGeodesicSegmentResult {
  const cell = input.world.cellsById.get(input.cellId);
  if (!cell) {
    throw new Error(`Cannot trace geodesic segment in missing cell "${input.cellId}".`);
  }
  if (!(input.maxLengthMeters > 0) || !Number.isFinite(input.maxLengthMeters)) {
    throw new Error(`Geodesic trace length must be positive; received ${input.maxLengthMeters}.`);
  }

  const direction = normalizeHorizontalDirection(input.direction);
  // `nearest` = earliest hit found so far along the ray (smallest parameter t, in meters since `direction` has unit length).
  let nearest:
    | { readonly kind: "side"; readonly sideIndex: number; readonly t: number; readonly portal?: NonNullable<typeof cell.sides[number]["portal"]> }
    | { readonly kind: "forbidden-zone"; readonly junctionId: string; readonly t: number }
    | undefined;

  // Ray vs. cell sides. The ray is P(t) = S + t d (d unit, horizontal) and a side is Q(u) = A + u e with e = B - A, |e| = side length.
  // Solving S + t d = A + u e with 2D cross products (w = A - S):  t = (w x e) / (d x e),  u = (w x d) / (d x e).
  // The cell is a convex prism, so the first side with t > 0 is where the ray leaves the cell.
  for (const side of cell.sides) {
    if (side.sideIndex === input.entrySideIndex) {
      continue;
    }
    const edgeX = side.end.x - side.start.x;
    const edgeY = side.end.y - side.start.y;
    // d x e: zero when the ray is parallel to the side; those sides are skipped (a collinear graze is not a hit).
    const denominator = crossXY(direction.x, direction.y, edgeX, edgeY);
    if (Math.abs(denominator) <= intersectionTolerance) {
      continue;
    }

    const startToSideX = side.start.x - input.start.x;
    const startToSideY = side.start.y - input.start.y;
    // t: distance along the ray to the side's supporting line. sideU: position along the side, in [0, 1] when the ray crosses the side itself.
    const t = crossXY(startToSideX, startToSideY, edgeX, edgeY) / denominator;
    const sideU = crossXY(startToSideX, startToSideY, direction.x, direction.y) / denominator;
    const sideMeters = sideU * side.lengthMeters;

    // Reject: behind or on the start point (so a ray that starts on a side does not re-hit it), beyond the requested length, or
    // crossing the supporting line outside the side segment. Tolerances are in meters.
    if (
      t <= intersectionTolerance ||
      t > input.maxLengthMeters + intersectionTolerance ||
      sideMeters < -intersectionTolerance ||
      sideMeters > side.lengthMeters + intersectionTolerance
    ) {
      continue;
    }

    if (!nearest || t < nearest.t) {
      // A hit slightly beyond `maxLengthMeters` (within tolerance) is clamped to it. Ties keep the first side.
      nearest = { kind: "side", sideIndex: side.sideIndex, t: Math.min(t, input.maxLengthMeters), portal: side.portal };
    }
  }

  // Forbidden zones are vertical cylinders; they compete with the sides for the nearest hit (strictly closer wins).
  for (const zone of cell.forbiddenZones) {
    const t = intersectRayWithForbiddenZone(input.start, direction, zone.collision);
    if (t === undefined || t > input.maxLengthMeters + intersectionTolerance) {
      continue;
    }

    if (!nearest || t < nearest.t) {
      nearest = { kind: "forbidden-zone", junctionId: zone.junctionId, t: Math.min(t, input.maxLengthMeters) };
    }
  }

  // Nothing reached within the requested length: the whole length is used inside this cell.
  if (!nearest) {
    return {
      cellId: input.cellId,
      start: input.start,
      direction,
      lengthMeters: input.maxLengthMeters,
      terminal: { kind: "open" },
    };
  }

  if (nearest.kind === "forbidden-zone") {
    return {
      cellId: input.cellId,
      start: input.start,
      direction,
      lengthMeters: nearest.t,
      terminal: { kind: "forbidden-zone-hit", junctionId: nearest.junctionId },
    };
  }

  if (!nearest.portal) {
    return {
      cellId: input.cellId,
      start: input.start,
      direction,
      lengthMeters: nearest.t,
      terminal: { kind: "wall-hit", sideIndex: nearest.sideIndex },
    };
  }

  // Portal crossing. The portal's rigid transform maps this cell's frame to the target cell's frame, taking the hit point to the
  // matching point on the target portal and the direction to the (rotated) continuation direction. The direction is renormalized
  // horizontally to remove numerical drift.
  const hitPoint = addVec3(input.start, scaleVec3(direction, nearest.t));
  const targetDirection = normalizeHorizontalDirection(transformDirection3(nearest.portal.transformToTarget, direction));
  const transformedStart = transformPoint3(nearest.portal.transformToTarget, hitPoint);
  // No nudge: the continuation starts exactly on the target portal's side; a restart must pass that side as `entrySideIndex`.
  const targetStart = transformedStart;

  return {
    cellId: input.cellId,
    start: input.start,
    direction,
    lengthMeters: nearest.t,
    terminal: {
      kind: "portal-hit",
      portalId: nearest.portal.id,
      targetCellId: nearest.portal.targetCellId,
      targetPortalId: nearest.portal.targetPortalId,
      targetStart,
      targetDirection,
    },
  };
}

/**
 * Like `traceGeodesicSegment`, but shortens the result to an `emitter-hit` when an eligible emitter lies on the ray.
 *
 * Eligibility and tolerance are those of `findNearestEmitterHitOnTrace`. The emitter hit only applies if it is closer
 * than the wall/portal/zone/open end already found (the search is bounded by the traced length). Throws like `traceGeodesicSegment`.
 */
export function traceGeodesicSegmentWithEmitters(
  input: TraceGeodesicSegmentWithEmittersInput,
): TraceGeodesicSegmentResult {
  const traced = traceGeodesicSegment(input);
  const hit = findNearestEmitterHitOnTrace({
    registry: input.registry,
    sourceEmitterId: input.sourceEmitterId,
    geodesicId: input.geodesicId,
    cellId: traced.cellId,
    start: traced.start,
    direction: traced.direction,
    maxLengthMeters: traced.lengthMeters,
  });

  if (!hit) {
    return traced;
  }

  return {
    ...traced,
    lengthMeters: hit.distanceMeters,
    terminal: { kind: "emitter-hit", emitterId: hit.emitter.id },
  };
}

/**
 * Finds the closest emitter in the cell lying within `emitterConnectionToleranceMeters` of the ray and ahead of its start.
 *
 * Math: for each cannon, project the horizontal offset from `start` onto the unit direction (`projected`, must be in
 * `(intersectionTolerance, maxLengthMeters]`) and require the perpendicular remainder to be at most the tolerance. The
 * returned distance is `projected` (clamped), i.e. the emitter is hit at its closest-approach point. Emitters that
 * already list `geodesicId` are skipped unless they are the source emitter. Returns `undefined` if there is none.
 */
export function findNearestEmitterHitOnTrace(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly sourceEmitterId: string;
  readonly geodesicId?: string;
  readonly cellId: string;
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly maxLengthMeters: number;
}): { readonly emitter: GeodesicCannonObject; readonly distanceMeters: number } | undefined {
  const direction = normalizeHorizontalDirection(input.direction);
  let nearest: { readonly emitter: GeodesicCannonObject; readonly distanceMeters: number } | undefined;

  for (const object of input.registry.getObjectsInCell(input.cellId)) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }
    const isSourceEmitter = object.id === input.sourceEmitterId;
    if (!isSourceEmitter && input.geodesicId && object.geodesicIds.includes(input.geodesicId)) {
      continue;
    }

    const offsetX = object.localPose.translation.x - input.start.x;
    const offsetY = object.localPose.translation.y - input.start.y;
    const projected = offsetX * direction.x + offsetY * direction.y;
    if (
      projected <= intersectionTolerance ||
      projected > input.maxLengthMeters + intersectionTolerance
    ) {
      continue;
    }

    const perpendicularX = offsetX - direction.x * projected;
    const perpendicularY = offsetY - direction.y * projected;
    if (Math.hypot(perpendicularX, perpendicularY) > emitterConnectionToleranceMeters) {
      continue;
    }

    if (!nearest || projected < nearest.distanceMeters) {
      nearest = { emitter: object, distanceMeters: Math.min(projected, input.maxLengthMeters) };
    }
  }

  return nearest;
}

function traceGeodesicSegmentForConnectionMode(
  input: TraceGeodesicSegmentWithEmittersInput & { readonly connectEmitters: boolean },
): TraceGeodesicSegmentResult {
  return input.connectEmitters
    ? traceGeodesicSegmentWithEmitters(input)
    : traceGeodesicSegment(input);
}

/**
 * Converts one piece of a developed-segment walk into a segment terminal.
 *
 * `end` gives `open`; a `wall` or `portal` exit gives `wall-hit` or `portal-hit` (with `continuation`, the next piece's exact start and
 * unit direction in the target cell, required for portal exits). When the exit was decided by the vertex tie rule
 * (`throughVertexIndex` defined) the line passes through a portal-junction vertex and the terminal is a `forbidden-zone-hit` whose
 * `junctionId` is `"<cellId>:vertex-<index>"`; shipped worlds hit the vertex's forbidden zone earlier, so this fires only where a
 * vertex has no zone. Pure; exported for tests.
 */
export function geodesicTerminalFromWalkPiece(
  piece: SegmentWalkPiece,
  continuation?: { readonly start: Vec3; readonly direction: Vec3 },
): GeodesicSegmentTerminal {
  const exit = piece.exit;
  if (exit.kind === "end") {
    return { kind: "open" };
  }
  if (exit.throughVertexIndex !== undefined) {
    return { kind: "forbidden-zone-hit", junctionId: `${piece.cellId}:vertex-${exit.throughVertexIndex}` };
  }
  if (exit.kind === "wall") {
    return { kind: "wall-hit", sideIndex: exit.sideIndex };
  }
  if (!continuation) {
    throw new Error("A portal exit needs a continuation.");
  }

  return {
    kind: "portal-hit",
    portalId: exit.portal.id,
    targetCellId: exit.portal.targetCellId,
    targetPortalId: exit.portal.targetPortalId,
    targetStart: continuation.start,
    targetDirection: continuation.direction,
  };
}

// Traces a geodesic across portals by walking the developed segment A + t d, t in [0, L], with `walkDevelopedSegment`: piece k
// is the walk's piece in cell k, mapped into cell k's frame, with length tExit - tEnter, so the lengths add up to L exactly and
// nothing is nudged. Each piece is then cut at its first forbidden-zone hit (open-disk rule) or, when connecting emitters, emitter
// hit; the first cut ends the geodesic. Returned traces are consecutive pieces; the concatenation of their portal hits is the
// realized portal word. A `portal-hit` piece's `targetStart`/`targetDirection` are the next piece's exact start and direction.
/** Traces a geodesic through the cell complex, restarting in the target cell at each portal hit. */
export function traceGeodesicPathForConnectionMode(
  input: TraceGeodesicSegmentWithEmittersInput & { readonly connectEmitters: boolean },
): readonly TraceGeodesicSegmentResult[] {
  if (!(input.maxLengthMeters > intersectionTolerance)) {
    return [];
  }
  geodesicPerfCounters.chordTraces += 1;

  const direction = normalizeHorizontalDirection(input.direction);
  const walk = walkDevelopedSegment({
    world: input.world,
    cellId: input.cellId,
    start: { x: input.start.x, y: input.start.y },
    direction: { x: direction.x, y: direction.y },
    // A side reached within `intersectionTolerance` beyond the requested length still counts as hit (clamped to the length), as in `traceGeodesicSegment`.
    lengthMeters: input.maxLengthMeters + intersectionTolerance,
    maxCrossings: maxGeodesicWalkCrossings,
  });

  if (walk.status === "start-outside" || (walk.status === "missing-cell" && walk.pieces.length === 0)) {
    return [traceGeodesicSegmentForConnectionMode(input)];
  }

  const pieceFrame = (piece: SegmentWalkPiece, tMeters: number): { readonly start: Vec3; readonly direction: Vec3 } => ({
    start: transformPoint3(
      piece.cellFromStart,
      { x: input.start.x + direction.x * tMeters, y: input.start.y + direction.y * tMeters, z: input.start.z },
    ),
    direction: normalizeHorizontalDirection(transformDirection3(piece.cellFromStart, direction)),
  });
  const traces: TraceGeodesicSegmentResult[] = [];

  for (let index = 0; index < walk.pieces.length; index += 1) {
    const piece = walk.pieces[index];
    const next = walk.pieces[index + 1];
    const frame = index === 0 ? { start: input.start, direction } : pieceFrame(piece, piece.tEnter);
    if (index > 0 && piece.tEnter >= input.maxLengthMeters) {
      break;
    }

    const lengthMeters = Math.max(0, Math.min(piece.tExit, input.maxLengthMeters) - piece.tEnter);

    if (index > 0 && piece.exit.kind === "end" && lengthMeters <= intersectionTolerance) {
      break;
    }

    const cell = input.world.cellsById.get(piece.cellId);
    let cutMeters: number | undefined;
    let cutTerminal: GeodesicSegmentTerminal | undefined;

    for (const zone of cell?.forbiddenZones ?? []) {
      const t = intersectRayWithForbiddenZone(frame.start, frame.direction, zone.collision);
      if (t !== undefined && t <= lengthMeters + intersectionTolerance && (cutMeters === undefined || t < cutMeters)) {
        cutMeters = Math.min(t, lengthMeters);
        cutTerminal = { kind: "forbidden-zone-hit", junctionId: zone.junctionId };
      }
    }

    if (input.connectEmitters) {
      const hit = findNearestEmitterHitOnTrace({
        registry: input.registry,
        sourceEmitterId: input.sourceEmitterId,
        geodesicId: input.geodesicId,
        cellId: piece.cellId,
        start: frame.start,
        direction: frame.direction,
        maxLengthMeters: cutMeters ?? lengthMeters,
      });
      if (hit) {
        cutMeters = hit.distanceMeters;
        cutTerminal = { kind: "emitter-hit", emitterId: hit.emitter.id };
      }
    }

    if (cutMeters !== undefined && cutTerminal) {
      traces.push({ cellId: piece.cellId, start: frame.start, direction: frame.direction, lengthMeters: cutMeters, terminal: cutTerminal });
      break;
    }

    let continuation: { readonly start: Vec3; readonly direction: Vec3 } | undefined;
    if (piece.exit.kind === "portal") {
      continuation = next
        ? pieceFrame(next, next.tEnter)
        : {
          start: transformPoint3(piece.exit.portal.transformToTarget, addVec3(frame.start, scaleVec3(frame.direction, lengthMeters))),
          direction: normalizeHorizontalDirection(transformDirection3(piece.exit.portal.transformToTarget, frame.direction)),
        };
    }
    const terminal = geodesicTerminalFromWalkPiece(piece, continuation);
    traces.push({ cellId: piece.cellId, start: frame.start, direction: frame.direction, lengthMeters, terminal });

    if (terminal.kind !== "portal-hit") {
      break;
    }
  }

  return traces;
}

/** Maps the terminal of a trace tail to the terminal of a build result. */
export function traceTerminalToBuildTerminal(
  tail: TraceGeodesicSegmentResult | undefined,
): GeodesicTraceBuildResult["terminal"] {
  if (!tail) {
    return { kind: "wall-hit", sideIndex: -1 };
  }
  if (tail.terminal.kind === "emitter-hit") {
    return { kind: "emitter-hit", emitterId: tail.terminal.emitterId };
  }
  if (tail.terminal.kind === "forbidden-zone-hit") {
    return { kind: "forbidden-zone-hit", junctionId: tail.terminal.junctionId };
  }
  if (tail.terminal.kind === "wall-hit") {
    return { kind: "wall-hit", sideIndex: tail.terminal.sideIndex };
  }
  return { kind: "free-end", freeEndObjectId: "" };
}

// Ray vs. vertical cylinder (center, radius, height): returns the ray parameter t > 0 of the first crossing of the cylinder wall, or undefined.
// A start height outside the cylinder's slab (|z - center.z| > height/2; infinite height means no slab) misses. In the plane,
// with o = start - center and unit d, |o + t d|^2 = r^2 becomes t^2 + b t + c = 0 (b = 2 o.d, c = |o|^2 - r^2);
// Open-disk rule: a start strictly inside the disk (|o| < r - 1e-9) is a hit at t = 0; a start on the circle (| |o| - r | <= 1e-9) is a hit at
// t = 0 only when it moves inward (o.d < 0) and is not a hit when it moves outward or tangentially; a start outside hits at the first root
// of the quadratic, if the ray moves towards the disk (b < 0) and the discriminant is non-negative.
function intersectRayWithForbiddenZone(
  start: Vec3,
  direction: Vec3,
  zone: { readonly center: Vec3; readonly radius: number; readonly height: number },
): number | undefined {
  const dz = Math.abs(start.z - zone.center.z);
  if (Number.isFinite(zone.height) && dz > zone.height / 2) {
    return undefined;
  }

  const offsetX = start.x - zone.center.x;
  const offsetY = start.y - zone.center.y;
  const b = 2 * (offsetX * direction.x + offsetY * direction.y);
  const c = offsetX * offsetX + offsetY * offsetY - zone.radius * zone.radius;

  const offsetLength = Math.hypot(offsetX, offsetY);

  if (offsetLength < zone.radius - forbiddenZoneCircleToleranceMeters) {
    return 0;
  }

  if (Math.abs(offsetLength - zone.radius) <= forbiddenZoneCircleToleranceMeters) {
    return b < 0 ? 0 : undefined;
  }

  if (b >= 0) {
    return undefined;
  }

  const discriminant = b * b - 4 * c;
  if (discriminant < 0) {
    return undefined;
  }

  return Math.max(0, (-b - Math.sqrt(discriminant)) / 2);
}
