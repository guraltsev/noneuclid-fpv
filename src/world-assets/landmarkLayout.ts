/**
 * Seeded layout of the generated landmarks of a cell (design 018 sections 8.4 and 9): one major landmark (6 to 11 m), a few minor ones (1.5 to
 * 4 m) and some small props, all from the generators of the face's theme and in the face's palette (`faceThemeAssignment.ts`).
 *
 * Pure: it decides what stands where, how big and turned how, and keeps the generated parts on the placement; `render/three/buildCellLandmarks.ts`
 * draws them, the ground tint takes the shadow casters, scenery takes the keep-out discs and the shell takes the colliders, all measured from the
 * same parts (`landmarkParts.ts`). The same cell with the same look always gets the same landmarks. Everything stays clear of sides, corners,
 * authored objects, the start and each other: cell geometry has no portal ghosts, so a landmark must never cross a side. Layer rule: imports
 * only `cell-complex` and sibling modules.
 */
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import type { FaceLook } from "./faceThemeAssignment";
import type { LandmarkGenerator, LandmarkRole } from "./faceThemes";
import type { GroundShadowCaster } from "./groundTint";
import { measureParts, thinColliderRadiusMeters, type LandmarkMeasure, type LandmarkPart } from "./landmarkParts";
import { createSeededRandom, hashStringToSeed } from "./seededNoise";

/** One generated landmark, in cell-local meters (x right, y forward). */
export interface LandmarkPlacement {
  /** Theme the landmark comes from. */
  readonly themeId: string;
  /** Name of the generator that built it. */
  readonly kind: string;
  readonly role: LandmarkRole;
  readonly x: number;
  readonly y: number;
  /** Turn about the vertical, radians from +x toward +y. */
  readonly yawRadians: number;
  /** Overall size factor applied to the parts. */
  readonly scale: number;
  /** Seed the parts were generated from. */
  readonly seed: number;
  /** The parts, in the landmark's own frame at scale 1. */
  readonly parts: readonly LandmarkPart[];
  /** Triangles the parts make. */
  readonly triangles: number;
  /** Radius of the disc on the ground that contains the whole landmark, meters (already scaled). */
  readonly footprintRadiusMeters: number;
  /** Height of the landmark, meters (already scaled). */
  readonly heightMeters: number;
  /** Discs the player cannot walk into (feet, piers, walls), cell-local meters. */
  readonly colliders: readonly LandmarkCollider[];
  /** Parts that hover, as the point below them, cell-local meters. */
  readonly floating: readonly FloatingLandmarkPart[];
}

/** A vertical cylinder the player cannot walk into. */
export interface LandmarkCollider {
  readonly x: number;
  readonly y: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/** A landmark part that hovers: its centre column on the ground is at (`x`, `y`), its radius and its top height are given. */
export interface FloatingLandmarkPart {
  readonly x: number;
  readonly y: number;
  readonly radiusMeters: number;
  readonly topMeters: number;
}

/** What the layout needs to know besides the cell. */
export interface LandmarkLayoutContext {
  /** Cell-local point to keep clear because the player starts there, when the world starts in this cell. */
  readonly startPosition?: { readonly x: number; readonly y: number };
  /** Theme and palette of the face; without one the cell gets no landmarks. */
  readonly look?: FaceLook;
}

/** The most triangles of landmarks one cell may carry; props are dropped first, then minors. */
export const maxLandmarkTrianglesPerCell = 2400;

/** How many of each role a face gets (inclusive ranges). */
export const landmarkCounts: Record<Exclude<LandmarkRole, "major">, readonly [number, number]> = { minor: [2, 3], prop: [3, 6] };

/** Clearance rules in meters: the disc of a landmark must stay this far (beyond its radius) from sides, and its centre this far from vertices. */
export const landmarkClearances = {
  major: { side: 0.6, vertex: 3, object: 1.5, start: 4 },
  minor: { side: 0.5, vertex: 2, object: 1, start: 3 },
  prop: { side: 0.5, vertex: 1.2, object: 0.6, start: 1.5 },
  /** Gap between the footprints of two landmarks. */
  between: 1.0,
} as const;

/** Collision radius assumed for an authored object without one, meters. */
export const landmarkDefaultObjectRadiusMeters = 0.5;

/** Shrink factors tried in turn when a generated landmark does not fit its cell. */
const shrinkSteps = [1, 0.9, 0.8, 0.7, 0.6] as const;

interface Candidate {
  readonly generator: LandmarkGenerator;
  readonly parts: readonly LandmarkPart[];
  readonly measure: LandmarkMeasure;
  readonly seed: number;
}

function generate(look: FaceLook, generator: LandmarkGenerator, seed: number): Candidate {
  const parts = generator.build({ random: createSeededRandom(seed), palette: look.palette });
  return { generator, parts, measure: measureParts(parts), seed };
}

function buildPlacement(look: FaceLook, role: LandmarkRole, candidate: Candidate, scale: number, x: number, y: number, yawRadians: number): LandmarkPlacement {
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const toCell = (u: number, v: number) => ({ x: x + scale * (u * cos - v * sin), y: y + scale * (u * sin + v * cos) });
  const colliders = candidate.measure.colliders.map((collider) => ({
    ...toCell(collider.u, collider.v),
    radiusMeters: collider.radiusMeters <= thinColliderRadiusMeters ? collider.radiusMeters : collider.radiusMeters * scale,
    heightMeters: collider.heightMeters * scale,
  }));
  const floating = candidate.measure.floating.map((part) => ({ ...toCell(part.u, part.v), radiusMeters: part.radiusMeters * scale, topMeters: part.topMeters * scale }));
  // Thin colliders keep their 0.12 m radius when the landmark shrinks, so the footprint grows to hold them.
  const footprint = Math.max(candidate.measure.footprintRadiusMeters * scale, ...colliders.map((collider) => Math.hypot(collider.x - x, collider.y - y) + collider.radiusMeters));

  return {
    themeId: look.theme.id,
    kind: candidate.generator.name,
    role,
    x,
    y,
    yawRadians,
    scale,
    seed: candidate.seed,
    parts: candidate.parts,
    triangles: candidate.measure.triangles,
    footprintRadiusMeters: footprint,
    heightMeters: candidate.measure.heightMeters * scale,
    colliders,
    floating,
  };
}

function objectRadius(object: CompiledPrismCell["objects"][number]): number {
  return (object.kind === "asset" ? object.collision?.radius : object.collision.radius) ?? landmarkDefaultObjectRadiusMeters;
}

// The smallest margin by which a landmark disc of radius `radius` at (x, y) clears every rule; negative means a rule is broken.
function clearanceSlack(
  cell: CompiledPrismCell,
  context: LandmarkLayoutContext,
  placed: readonly LandmarkPlacement[],
  x: number,
  y: number,
  radius: number,
  rules: { readonly side: number; readonly vertex: number; readonly object: number; readonly start: number },
): number {
  let slack = Infinity;

  for (const side of cell.sides) {
    slack = Math.min(slack, (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y - (radius + rules.side));
  }

  for (const vertex of cell.baseVertices) {
    slack = Math.min(slack, Math.hypot(x - vertex.x, y - vertex.y) - rules.vertex);
  }

  for (const object of cell.objects) {
    slack = Math.min(slack, Math.hypot(x - object.position.x, y - object.position.y) - (objectRadius(object) + radius + rules.object));
  }

  if (context.startPosition) {
    slack = Math.min(slack, Math.hypot(x - context.startPosition.x, y - context.startPosition.y) - (radius + rules.start));
  }

  for (const other of placed) {
    slack = Math.min(slack, Math.hypot(x - other.x, y - other.y) - (radius + other.footprintRadiusMeters + landmarkClearances.between));
  }

  return slack;
}

/** Lays out the landmarks of a cell; an empty list for a cell without a look. */
export function computeLandmarkLayout(cell: CompiledPrismCell, context: LandmarkLayoutContext = {}): readonly LandmarkPlacement[] {
  const look = context.look;

  if (!look) {
    return [];
  }

  const random = createSeededRandom((hashStringToSeed(cell.id) ^ hashStringToSeed(look.theme.id) ^ 0x1a4d3a2c) >>> 0);
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const bounds = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const;
  const placed: LandmarkPlacement[] = [];
  const major = placeMajor(cell, context, look, random, bounds);
  let triangles = 0;

  if (major) {
    placed.push(major);
    triangles += major.triangles;
  }

  for (const role of ["minor", "prop"] as const) {
    const [low, high] = landmarkCounts[role];
    const wanted = low + Math.floor(random() * (high - low + 1));
    const generators = look.theme[role];
    const offset = Math.floor(random() * generators.length);

    for (let index = 0; index < wanted; index += 1) {
      const generator = generators[(offset + index) % generators.length];
      const placement = placeRandomly(cell, context, look, role, generator, random, bounds, placed);

      if (placement && triangles + placement.triangles <= maxLandmarkTrianglesPerCell) {
        placed.push(placement);
        triangles += placement.triangles;
      }
    }
  }

  return placed;
}

// A minor or a prop goes to the first random point where it fits; shrinking a little is allowed.
function placeRandomly(
  cell: CompiledPrismCell,
  context: LandmarkLayoutContext,
  look: FaceLook,
  role: "minor" | "prop",
  generator: LandmarkGenerator,
  random: () => number,
  [minX, maxX, minY, maxY]: readonly [number, number, number, number],
  placed: readonly LandmarkPlacement[],
): LandmarkPlacement | undefined {
  const candidate = generate(look, generator, Math.floor(random() * 0xffffffff) >>> 0);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    const yawRadians = random() * Math.PI * 2;
    const scale = shrinkSteps[Math.min(shrinkSteps.length - 1, Math.floor(attempt / 20))];
    const placement = buildPlacement(look, role, candidate, scale, x, y, yawRadians);

    if (clearanceSlack(cell, context, placed, x, y, placement.footprintRadiusMeters, landmarkClearances[role]) >= 0) {
      return placement;
    }
  }

  return undefined;
}

// The major goes to the feasible grid point with the largest smallest clearance; generators, seeds and sizes are tried until one fits.
function placeMajor(
  cell: CompiledPrismCell,
  context: LandmarkLayoutContext,
  look: FaceLook,
  random: () => number,
  [minX, maxX, minY, maxY]: readonly [number, number, number, number],
): LandmarkPlacement | undefined {
  const generators = look.theme.major;
  const first = Math.floor(random() * generators.length);
  const yawRadians = random() * Math.PI * 2;
  const step = 1;
  const points: { x: number; y: number }[] = [];

  for (let row = 0; row < Math.ceil((maxY - minY) / step); row += 1) {
    for (let column = 0; column < Math.ceil((maxX - minX) / step); column += 1) {
      points.push({ x: minX + (column + 0.1 + 0.8 * random()) * step, y: minY + (row + 0.1 + 0.8 * random()) * step });
    }
  }

  const candidates = generators.map((_, index) => generate(look, generators[(first + index) % generators.length], Math.floor(random() * 0xffffffff) >>> 0));

  for (const shrink of shrinkSteps) {
    for (const candidate of candidates) {
      const radius = candidate.measure.footprintRadiusMeters * shrink;
      let best: { x: number; y: number; slack: number } | undefined;

      for (const point of points) {
        const slack = clearanceSlack(cell, context, [], point.x, point.y, radius, landmarkClearances.major);

        if (slack >= 0 && (!best || slack > best.slack)) {
          best = { ...point, slack };
        }
      }

      if (best) {
        return buildPlacement(look, "major", candidate, shrink, best.x, best.y, yawRadians);
      }
    }
  }

  return undefined;
}

/** The hovering parts of a placement in cell-local meters. */
export function landmarkFloatingParts(placement: LandmarkPlacement): readonly FloatingLandmarkPart[] {
  return placement.floating;
}

/**
 * The long shadows the landmarks throw on the ground of their cell: one per ground-touching part, and for every hovering part one at the point below
 * it with its radius and its top height (a floating thing still throws a shadow, which is what makes it read as floating).
 */
export function landmarkShadowCasters(placements: readonly LandmarkPlacement[]): readonly GroundShadowCaster[] {
  const casters: GroundShadowCaster[] = [];

  for (const placement of placements) {
    for (const collider of placement.colliders) {
      casters.push({ x: collider.x, y: collider.y, radiusMeters: collider.radiusMeters, heightMeters: collider.heightMeters });
    }

    for (const part of placement.floating) {
      casters.push({ x: part.x, y: part.y, radiusMeters: part.radiusMeters, heightMeters: part.topMeters });
    }
  }

  return casters;
}

/** A disc on the ground that small props must keep out of. */
export interface LandmarkKeepOutDisc {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Discs around the ground-touching parts of the landmarks (collider radius plus 0.4 m) so scenery does not grow inside piers. */
export function landmarkKeepOutDiscs(placements: readonly LandmarkPlacement[]): readonly LandmarkKeepOutDisc[] {
  return placements.flatMap((placement) => placement.colliders.map((collider) => ({ x: collider.x, y: collider.y, radius: collider.radiusMeters + 0.4 })));
}
