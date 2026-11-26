/**
 * Seeded layout of the large generated landmarks of a cell (design 018 sections 8.1 and 8.4): arcades, towers, floating boulders, stilt forms and the like.
 *
 * Pure: it decides what stands where, how big and turned how; `render/three/buildCellLandmarks.ts` turns the list into a mesh, the ground tint takes the
 * shadow casters, scenery takes the keep-out discs and the shell takes the colliders. The same cell always gets the same landmarks. A cell gets one major
 * landmark (6 to 11 m) and two to four minor ones (1.5 to 4 m) from the set of its biome, placed clear of sides, corners, authored objects, the start and
 * each other: cell geometry has no portal ghosts, so a landmark must never cross a side. Layer rule: imports only `cell-complex` and sibling modules.
 */
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import type { GroundShadowCaster } from "./groundTint";
import {
  colonnadeVariantFor,
  floatingBoulders,
  landmarkShape,
  landmarkTriangleCount,
  type LandmarkKind,
} from "./landmarkShapes";
import { createSeededRandom, hashStringToSeed } from "./seededNoise";
import { sceneryBiomeForFloor, type SceneryBiome } from "./sceneryLayout";

export type { LandmarkKind } from "./landmarkShapes";
export { landmarkTriangleCount } from "./landmarkShapes";

/** One generated landmark, in cell-local meters (x right, y forward). */
export interface LandmarkPlacement {
  readonly kind: LandmarkKind;
  /** The kind's own parameter: arches, boulders, stones, branches, breaks of a colonnade, what a plinth carries (see `landmarkShapes.ts`). */
  readonly variant: number;
  readonly x: number;
  readonly y: number;
  /** Turn about the vertical, radians from +x toward +y. */
  readonly yawRadians: number;
  /** Overall size factor; 1 is the kind's nominal size. */
  readonly scale: number;
  /** Seed of this landmark's own random details. */
  readonly seed: number;
  /** Radius of the disc on the ground that contains the whole landmark, meters (already scaled). */
  readonly footprintRadiusMeters: number;
  /** Height of the landmark, meters (already scaled). */
  readonly heightMeters: number;
  /** Discs the player cannot walk into (pillar feet and the like), cell-local meters. */
  readonly colliders: readonly LandmarkCollider[];
}

/** A vertical cylinder the player cannot walk into. */
export interface LandmarkCollider {
  readonly x: number;
  readonly y: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/** What the layout needs to know besides the cell. */
export interface LandmarkLayoutContext {
  /** Cell-local point to keep clear because the player starts there, when the world starts in this cell. */
  readonly startPosition?: { readonly x: number; readonly y: number };
}

/** The most triangles of landmarks one cell may carry; minor landmarks are dropped first. */
export const maxLandmarkTrianglesPerCell = 900;

/** Clearance rules in meters: the disc of a landmark must stay this far (beyond its radius) from sides, and its centre this far from vertices. */
export const landmarkClearances = {
  major: { side: 0.6, vertex: 3, object: 1.5, start: 4 },
  minor: { side: 0.4, vertex: 2, object: 1, start: 3 },
  /** Gap between the footprints of two landmarks. */
  between: 1.5,
} as const;

/** Collision radius assumed for an authored object without one, meters. */
export const landmarkDefaultObjectRadiusMeters = 0.5;

const majorKinds: Record<SceneryBiome, readonly LandmarkKind[]> = {
  sand: ["arcade", "tower"],
  mud: ["stilt-form"],
  grass: ["floating-boulders", "great-sphere"],
  river: ["pebble-stack", "needle"],
  forest: ["wire-mobile"],
  snow: ["colonnade", "ruin-arch"],
};

const minorKinds: Record<SceneryBiome, readonly LandmarkKind[]> = {
  sand: ["plinth", "lone-arch"],
  mud: ["crutch-slab", "obelisk", "soft-disc"],
  grass: ["door-frame", "small-floater"],
  river: ["bone-form", "pebble-pair"],
  forest: ["disc-stalk", "blob"],
  snow: ["broken-column", "ice-spire"],
};

/** The biome a landmark kind belongs to; the mesh builder picks its palette from it. */
export const landmarkBiomeByKind: Readonly<Record<LandmarkKind, SceneryBiome>> = Object.fromEntries(
  (Object.keys(majorKinds) as SceneryBiome[]).flatMap((biome) => [...majorKinds[biome], ...minorKinds[biome]].map((kind) => [kind, biome])),
) as Record<LandmarkKind, SceneryBiome>;

interface Candidate {
  readonly kind: LandmarkKind;
  readonly variant: number;
  readonly scale: number;
  readonly seed: number;
}

// Size factor range of a kind: majors vary a little, minors are kept between 1.5 and 4 m tall.
function scaleRange(kind: LandmarkKind, variant: number, role: "major" | "minor", height: number): readonly [number, number] {
  if (kind === "arcade") {
    return variant === 3 ? [1.0, 1.08] : variant === 4 ? [0.95, 1.04] : [0.82, 0.86];
  }

  if (role === "major") {
    return [0.92, Math.min(1.08, 11 / height)];
  }

  const low = Math.max(0.9, 1.52 / height);
  return [low, Math.max(low, Math.min(1.15, 4 / height))];
}

function buildPlacement(candidate: Candidate, x: number, y: number, yawRadians: number): LandmarkPlacement {
  const { kind, variant, scale, seed } = candidate;
  const shape = landmarkShape(kind, variant, seed);
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);

  const colliders = shape.colliders.map((collider) => ({
    x: x + scale * (collider.u * cos - collider.v * sin),
    y: y + scale * (collider.u * sin + collider.v * cos),
    radiusMeters: collider.radiusMeters <= 0.12 ? collider.radiusMeters : collider.radiusMeters * scale,
    heightMeters: collider.heightMeters * scale,
  }));
  // Thin colliders keep their 0.12 m radius when the landmark shrinks, so the footprint grows to hold them.
  const footprint = Math.max(shape.footprintRadiusMeters * scale, ...colliders.map((collider) => Math.hypot(collider.x - x, collider.y - y) + collider.radiusMeters));

  return { kind, variant, x, y, yawRadians, scale, seed, footprintRadiusMeters: footprint, heightMeters: shape.heightMeters * scale, colliders };
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

// Variants a kind can take, most demanding first, so a cramped cell falls back to a smaller one.
function variantsOf(kind: LandmarkKind, random: () => number, seed: number): readonly number[] {
  switch (kind) {
    case "arcade":
      return [5, 4, 3].filter((arches) => arches <= 3 + Math.floor(random() * 3));
    case "floating-boulders":
      return [5, 4, 3].filter((count) => count <= 3 + Math.floor(random() * 3));
    case "pebble-stack":
      return [8, 7, 6, 5].filter((count) => count <= 5 + Math.floor(random() * 4));
    case "wire-mobile":
      return [5, 4, 3].filter((count) => count <= 3 + Math.floor(random() * 3));
    case "colonnade":
      return [6, 5, 4].filter((count) => count <= 4 + Math.floor(random() * 3)).map((count) => colonnadeVariantFor(count, seed));
    case "plinth":
      return [Math.floor(random() * 3)];
    case "disc-stalk":
      return [Math.floor(random() * 2)];
    case "bone-form":
      return [2 + Math.floor(random() * 2)];
    default:
      return [0];
  }
}

/** Lays out the landmarks of a cell; an empty list for a cell that gets none. */
export function computeLandmarkLayout(cell: CompiledPrismCell, context: LandmarkLayoutContext = {}): readonly LandmarkPlacement[] {
  if (cell.floorMaterial.kind !== "floor-texture") {
    return [];
  }

  const biome = sceneryBiomeForFloor(cell.floorMaterial.name);

  if (!biome) {
    return [];
  }

  const cellSeed = hashStringToSeed(cell.id);
  const random = createSeededRandom((cellSeed ^ 0x1a4d3a2c) >>> 0);
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const major = placeMajor(cell, context, biome, random, [minX, maxX, minY, maxY]);
  const placed: LandmarkPlacement[] = major ? [major] : [];
  let triangles = major ? landmarkTriangleCount(major.kind, major.variant) : 0;

  const wanted = 2 + Math.floor(random() * 3);
  const kinds = minorKinds[biome];
  const pickOffset = Math.floor(random() * kinds.length);

  for (let minor = 0; minor < wanted; minor += 1) {
    const kind = kinds[(pickOffset + minor) % kinds.length];

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const x = minX + random() * (maxX - minX);
      const y = minY + random() * (maxY - minY);
      const yawRadians = random() * Math.PI * 2;
      const seed = Math.floor(random() * 0xffffffff) >>> 0;
      const sizeRoll = random();
      const [variant] = variantsOf(kind, random, seed);
      const nominal = landmarkShape(kind, variant, seed);
      const [low, high] = scaleRange(kind, variant, "minor", nominal.heightMeters);
      const scale = low + (high - low) * sizeRoll;
      const candidate = buildPlacement({ kind, variant, scale, seed }, x, y, yawRadians);

      if (triangles + landmarkTriangleCount(kind, variant) > maxLandmarkTrianglesPerCell) {
        break;
      }

      if (clearanceSlack(cell, context, placed, x, y, candidate.footprintRadiusMeters, landmarkClearances.minor) >= 0) {
        placed.push(candidate);
        triangles += landmarkTriangleCount(kind, variant);
        break;
      }
    }
  }

  return placed;
}

// The major goes to the feasible grid point with the largest smallest clearance; kinds, variants and sizes are tried until one fits.
function placeMajor(
  cell: CompiledPrismCell,
  context: LandmarkLayoutContext,
  biome: SceneryBiome,
  random: () => number,
  [minX, maxX, minY, maxY]: readonly [number, number, number, number],
): LandmarkPlacement | undefined {
  const kinds = majorKinds[biome];
  const first = Math.floor(random() * kinds.length);
  const seed = Math.floor(random() * 0xffffffff) >>> 0;
  const yawRadians = random() * Math.PI * 2;
  const sizeRoll = random();
  const step = 1;
  const columns = Math.ceil((maxX - minX) / step);
  const rows = Math.ceil((maxY - minY) / step);
  const points: { x: number; y: number }[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({ x: minX + (column + 0.1 + 0.8 * random()) * step, y: minY + (row + 0.1 + 0.8 * random()) * step });
    }
  }

  const orderedKinds = kinds.map((_, index) => kinds[(first + index) % kinds.length]);
  const preferred = orderedKinds.flatMap((kind) => variantsOf(kind, random, seed).map((variant) => ({ kind, variant })));
  // Compact fallbacks come last: the smallest variant of every kind at shrinking sizes.
  const attempts = [1, 0.92, 0.84, 0.76, 0.68].flatMap((shrink) => preferred.map((entry) => ({ ...entry, shrink })));

  for (const attempt of attempts) {
    const nominal = landmarkShape(attempt.kind, attempt.variant, seed);
    const [low, high] = scaleRange(attempt.kind, attempt.variant, "major", nominal.heightMeters);
    const scale = (low + (high - low) * sizeRoll) * attempt.shrink;
    const candidate: Candidate = { kind: attempt.kind, variant: attempt.variant, scale, seed };
    const radius = nominal.footprintRadiusMeters * scale;
    let best: { x: number; y: number; slack: number } | undefined;

    for (const point of points) {
      const slack = clearanceSlack(cell, context, [], point.x, point.y, radius, landmarkClearances.major);

      if (slack >= 0 && (!best || slack > best.slack)) {
        best = { ...point, slack };
      }
    }

    if (best) {
      return buildPlacement(candidate, best.x, best.y, yawRadians);
    }
  }

  return undefined;
}

/** A landmark part that hovers: its centre column on the ground is at (`x`, `y`), its radius and its top height are given. */
export interface FloatingLandmarkPart {
  readonly x: number;
  readonly y: number;
  readonly radiusMeters: number;
  readonly topMeters: number;
}

/** The hovering boulders of a placement in cell-local meters (empty for every kind but floating boulders and small floaters). */
export function landmarkFloatingParts(placement: LandmarkPlacement): readonly FloatingLandmarkPart[] {
  if (placement.kind !== "floating-boulders" && placement.kind !== "small-floater") {
    return [];
  }

  const cos = Math.cos(placement.yawRadians);
  const sin = Math.sin(placement.yawRadians);
  const scale = placement.scale;

  return floatingBoulders(placement.kind, placement.variant, placement.seed).map((boulder) => ({
    x: placement.x + scale * (boulder.u * cos - boulder.v * sin),
    y: placement.y + scale * (boulder.u * sin + boulder.v * cos),
    radiusMeters: boulder.radius * scale,
    topMeters: (boulder.zCenter + boulder.radius) * scale,
  }));
}

/**
 * The long shadows the landmarks throw on the ground of their cell: one per ground-touching part, and for every hovering boulder one at the point below it
 * with its radius and its top height (a floating thing still throws a shadow, which is what makes it read as floating).
 */
export function landmarkShadowCasters(placements: readonly LandmarkPlacement[]): readonly GroundShadowCaster[] {
  const casters: GroundShadowCaster[] = [];

  for (const placement of placements) {
    for (const collider of placement.colliders) {
      casters.push({ x: collider.x, y: collider.y, radiusMeters: collider.radiusMeters, heightMeters: collider.heightMeters });
    }

    for (const part of landmarkFloatingParts(placement)) {
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
