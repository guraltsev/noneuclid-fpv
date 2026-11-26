/**
 * What each generated landmark kind is, in numbers (design 018 sections 8.1 and 8.4): nominal footprint, height, ground colliders and the triangle count of its mesh.
 *
 * Pure and shared: `landmarkLayout.ts` uses it to decide what fits where and to fill colliders and shadow casters, and `render/three/buildCellLandmarks.ts`
 * emits exactly the geometry described here, so the numbers cannot drift apart. Everything is in a landmark's own frame at scale 1: `u` right, `v` forward,
 * `w` up, in meters, with the landmark's origin on the ground. The few shapes whose parts are random (floating boulders, pebble stacks, colonnade breaks)
 * draw them here from the placement seed, so the layout and the mesh see the same parts.
 */
import { createSeededRandom } from "./seededNoise";

/** What a landmark is; the mesh builder has one shape generator per kind. */
export type LandmarkKind =
  | "arcade"
  | "tower"
  | "plinth"
  | "lone-arch"
  | "stilt-form"
  | "crutch-slab"
  | "obelisk"
  | "soft-disc"
  | "floating-boulders"
  | "great-sphere"
  | "door-frame"
  | "small-floater"
  | "pebble-stack"
  | "needle"
  | "bone-form"
  | "pebble-pair"
  | "wire-mobile"
  | "disc-stalk"
  | "blob"
  | "colonnade"
  | "ruin-arch"
  | "broken-column"
  | "ice-spire";

/** A vertical cylinder of a landmark in its own frame at scale 1. */
export interface LocalLandmarkCollider {
  readonly u: number;
  readonly v: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/** The nominal numbers of one landmark (scale 1). */
export interface LandmarkShape {
  /** Radius of the disc around the origin that contains every part, meters. */
  readonly footprintRadiusMeters: number;
  /** Height of the highest point, meters. */
  readonly heightMeters: number;
  /** Triangles the mesh builder emits for it. */
  readonly triangles: number;
  /** Cylinders that touch the ground and are thicker than {@link thinColliderRadiusMeters}, plus thin ones at exactly that radius. */
  readonly colliders: readonly LocalLandmarkCollider[];
}

/** One hovering boulder, in the landmark frame: centre height `zCenter`, outer radius `radius` (the mesh never exceeds it). */
export interface FloatingBoulder {
  readonly u: number;
  readonly v: number;
  readonly zCenter: number;
  readonly radius: number;
}

/** One stone of a pebble stack: an ellipsoid with radii `rx`, `ry`, `rz` centred at (`u`, `v`, `zCenter`). */
export interface StackStone {
  readonly u: number;
  readonly v: number;
  readonly zCenter: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}

/** Collider radius of a thin stalk, strut or leg, meters. */
export const thinColliderRadiusMeters = 0.12;

/** Clear width between the piers of an arcade, meters. */
export const arcadeClearWidthMeters = 1.8;
/** Width (and depth) of an arcade pier, meters. */
export const arcadePierMeters = 0.8;
/** Height of the piers of an arcade (the arches spring 1.35 m below their top), meters. */
export const arcadePierHeightMeters = 5.75;
/** Height of an arcade including its entablature, meters. */
export const arcadeHeightMeters = 6.5;
/** Segments of one semicircular arch of an arcade. */
export const arcadeArchSegments = 6;
/** Column pitch of a colonnade, meters. */
export const colonnadePitchMeters = 2.1;
/** Height of a standing colonnade shaft, meters. */
export const colonnadeShaftHeightMeters = 5.9;
/** Number of arch pieces of a ruin arch. */
export const ruinArchSegments = 8;
/** Triangles of the five items a wire mobile carries, in turn: red disc, blue disc, black crescent, yellow star, yellow disc. */
export const mobileItemTriangles: readonly number[] = [8, 8, 12, 10, 8];
/** Segments of the disc fan of a flat disc. */
export const flatDiscSegments = 8;
/** Longitude and latitude bands of the smooth stones (pebble stacks and pairs). */
export const stoneLongitudes = 8;
/** Latitude bands of a smooth stone. */
export const stoneLatitudes = 3;

/** Triangles of a lat-long ellipsoid with `longitudes` and `latitudes` bands. */
export function latLongTriangles(longitudes: number, latitudes: number): number {
  return 2 * longitudes * (latitudes - 1);
}

/** Triangles of an icosphere at subdivision level 0 (20) or 1 (80). */
export function icoTriangles(level: number): number {
  return 20 * 4 ** level;
}

/** Triangles of the tower's shaft, cornice, roof, pole, pennant and eight windows and doors. */
const towerTriangles = 8 + 12 + 4 + 6 + 1 + 16;

/** Triangles of a wire mobile with `branches` branches: a kinked stalk, then per branch a strut and its item. */
export function wireMobileTriangles(branches: number): number {
  let total = 12;

  for (let index = 0; index < branches; index += 1) {
    total += 6 + mobileItemTriangles[index % mobileItemTriangles.length];
  }

  return total;
}

/** Number of columns of a colonnade variant. */
export function colonnadeColumnCount(variant: number): number {
  return variant & 7;
}

/** Whether column `index` of a colonnade variant is broken short. */
export function colonnadeColumnBroken(variant: number, index: number): boolean {
  return ((variant >> (3 + index)) & 1) === 1;
}

/** Height of a broken colonnade stump, meters; depends on its index only. */
export function colonnadeStumpHeightMeters(index: number): number {
  return 1.0 + 0.45 * ((index * 5 + 1) % 4);
}

/** Position of column `index` along a colonnade of `count` columns, meters from its centre. */
export function colonnadeColumnU(count: number, index: number): number {
  return (index - (count - 1) / 2) * colonnadePitchMeters;
}

/** Pier centres of an arcade of `arches` arches, meters from its centre. */
export function arcadePierU(arches: number, index: number): number {
  return (index - arches / 2) * (arcadeClearWidthMeters + arcadePierMeters);
}

/** Length of an arcade of `arches` arches, meters. */
export function arcadeLengthMeters(arches: number): number {
  return arches * arcadeClearWidthMeters + (arches + 1) * arcadePierMeters;
}

/** Length of a colonnade of `count` columns, meters. */
export function colonnadeLengthMeters(count: number): number {
  return (count - 1) * colonnadePitchMeters + 1;
}

/**
 * Draws a colonnade variant (column count and the set of broken columns) from a seed: one to half the columns are broken, and at least two
 * neighbouring columns stay standing so that a lintel joins them.
 */
export function colonnadeVariantFor(count: number, seed: number): number {
  const random = createSeededRandom((seed ^ 0xc01011ad) >>> 0);
  const wanted = 1 + Math.floor(random() * Math.floor(count / 2));
  const broken = new Set<number>();

  for (let guard = 0; broken.size < wanted && guard < 40; guard += 1) {
    broken.add(Math.floor(random() * count));
  }

  const adjacentStanding = (): boolean => {
    for (let index = 0; index + 1 < count; index += 1) {
      if (!broken.has(index) && !broken.has(index + 1)) {
        return true;
      }
    }

    return false;
  };

  for (const index of [...broken]) {
    if (adjacentStanding()) {
      break;
    }

    broken.delete(index);
  }

  let variant = count;

  for (const index of broken) {
    variant |= 1 << (3 + index);
  }

  return variant;
}

/** The boulders of a `floating-boulders` cluster (variant = count, 3 to 5) or of a `small-floater` (one boulder), drawn from the seed. */
export function floatingBoulders(kind: "floating-boulders" | "small-floater", variant: number, seed: number): readonly FloatingBoulder[] {
  const random = createSeededRandom((seed ^ 0xb001de5) >>> 0);

  if (kind === "small-floater") {
    const radius = 0.5 + 0.15 * random();
    return [{ u: 0, v: 0, zCenter: 1.8 + 0.6 * random() + radius, radius }];
  }

  const boulders: FloatingBoulder[] = [{ u: 0, v: 0, zCenter: 3.0 + 0.6 * random() + 1.5, radius: 1.5 }];
  const phase = random() * Math.PI * 2;

  for (let index = 1; index < variant; index += 1) {
    const radius = 0.6 + 0.6 * random();
    const bottom = 2.5 + 3.0 * random();
    const angle = phase + (index - 1) * 2.4 + (random() - 0.5) * 0.4;
    const distance = 2.3 + 0.7 * random();
    boulders.push({ u: Math.cos(angle) * distance, v: Math.sin(angle) * distance, zCenter: bottom + radius, radius });
  }

  return boulders;
}

/** The stones of a pebble stack of `count` stones (5 to 8): decreasing in size, slightly off the axis, stacked to 6 to 8 m. */
export function pebbleStackStones(count: number, seed: number): readonly StackStone[] {
  const random = createSeededRandom((seed ^ 0x57ac4) >>> 0);
  const targetHeight = 6 + ((count - 5) * 2) / 3;
  const raw: { u: number; v: number; zCenter: number; rx: number; ry: number; rz: number }[] = [];
  let base = 0;

  for (let index = 0; index < count; index += 1) {
    const radius = 1.5 * 0.86 ** index;
    const rz = radius * 0.5;
    raw.push({
      u: index === 0 ? 0 : (random() - 0.4) * 0.5,
      v: index === 0 ? 0 : (random() - 0.5) * 0.5,
      zCenter: base + rz,
      rx: radius * (0.95 + 0.1 * random()),
      ry: radius * (0.95 + 0.1 * random()),
      rz,
    });
    base += 2 * rz * 0.88;
  }

  const last = raw[raw.length - 1];
  const factor = targetHeight / (last.zCenter + last.rz);
  return raw.map((stone) => ({ ...stone, zCenter: stone.zCenter * factor, rz: stone.rz * factor }));
}

function thin(u: number, v: number, heightMeters: number): LocalLandmarkCollider {
  return { u, v, radiusMeters: thinColliderRadiusMeters, heightMeters };
}

function cylinder(u: number, v: number, radiusMeters: number, heightMeters: number): LocalLandmarkCollider {
  return { u, v, radiusMeters, heightMeters };
}

/** The triangle count of a landmark of the given kind and variant, which `buildCellLandmarks.ts` emits exactly. */
export function landmarkTriangleCount(kind: LandmarkKind, variant: number): number {
  switch (kind) {
    case "arcade":
      return (variant + 1) * 8 + 10 + variant * arcadeArchSegments * 6;
    case "tower":
      return towerTriangles;
    case "plinth":
      return 20 + (variant === 1 ? icoTriangles(0) : variant === 2 ? 6 : 0);
    case "lone-arch":
      return 16 + 6 * 8;
    case "stilt-form":
      return icoTriangles(0) + 4 * 12;
    case "crutch-slab":
      return 12 + 12 + 6 + 12;
    case "obelisk":
      return 12;
    case "soft-disc":
      return 10 + 12;
    case "floating-boulders":
      return icoTriangles(1) + (variant - 1) * icoTriangles(0);
    case "great-sphere":
      return icoTriangles(1);
    case "door-frame":
      return 10 + 10 + 12 + 12;
    case "small-floater":
      return icoTriangles(0);
    case "pebble-stack":
      return variant * latLongTriangles(stoneLongitudes, stoneLatitudes);
    case "needle":
      return latLongTriangles(6, 6) + icoTriangles(0) + 6;
    case "bone-form":
      return latLongTriangles(8, 5) + 6 * variant;
    case "pebble-pair":
      return 2 * latLongTriangles(stoneLongitudes, stoneLatitudes);
    case "wire-mobile":
      return wireMobileTriangles(variant);
    case "disc-stalk":
      return 6 + (variant === 1 ? 12 : 8);
    case "blob":
      return latLongTriangles(8, 4) + latLongTriangles(8, 3) + flatDiscSegments;
    case "colonnade": {
      const count = colonnadeColumnCount(variant);
      let total = 0;

      for (let index = 0; index < count; index += 1) {
        const broken = colonnadeColumnBroken(variant, index);
        total += broken ? 24 : 34;

        if (index + 1 < count && !broken && !colonnadeColumnBroken(variant, index + 1)) {
          total += 12;
        }
      }

      return total;
    }
    case "ruin-arch":
      return 16 + ruinArchSegments * 8 + 12 + 12;
    case "broken-column":
      return 24 + 32;
    case "ice-spire":
      return 3 * 15;
  }
}

/**
 * The nominal shape of a landmark: footprint, height, colliders and triangles, at scale 1. `variant` is the kind's own parameter (arches of an
 * arcade, boulders of a cluster, stones of a stack, branches of a mobile, breaks of a colonnade, what a plinth carries); `seed` is the placement seed,
 * which matters only to the kinds with random parts.
 */
export function landmarkShape(kind: LandmarkKind, variant: number, seed: number): LandmarkShape {
  const triangles = landmarkTriangleCount(kind, variant);
  const make = (footprintRadiusMeters: number, heightMeters: number, colliders: readonly LocalLandmarkCollider[]): LandmarkShape => ({
    footprintRadiusMeters,
    heightMeters,
    triangles,
    colliders,
  });

  switch (kind) {
    case "arcade": {
      const length = arcadeLengthMeters(variant);
      const piers = Array.from({ length: variant + 1 }, (_, index) => cylinder(arcadePierU(variant, index), 0, 0.55, arcadePierHeightMeters));
      return make(Math.hypot(length / 2 + 0.2, 0.5) + 0.05, arcadeHeightMeters, piers);
    }
    case "tower":
      return make(2.0, 10.5, [cylinder(0, 0, 1.6, 9.5)]);
    case "plinth": {
      const height = variant === 1 ? 2.85 : variant === 2 ? 3.1 : 1.6;
      return make(1.3, height, [cylinder(0, 0, 0.8, 1.6)]);
    }
    case "lone-arch":
      return make(1.3, 3.2, [cylinder(-0.85, 0, 0.3, 2.2), cylinder(0.85, 0, 0.3, 2.2)]);
    case "stilt-form": {
      const feet = [1, -1].flatMap((sx) => [1, -1].map((sy) => thin(2.7 * sx, 2.3 * sy, 4.2)));
      return make(3.7, 9.15, feet);
    }
    case "crutch-slab":
      return make(1.5, 2.22, [thin(-0.2, 0, 2.1)]);
    case "obelisk":
      return make(0.5, 3.7, [cylinder(0, 0, 0.25, 3.7)]);
    case "soft-disc":
      return make(1.45, 1.52, [cylinder(0, 0, 0.85, 1.5)]);
    case "floating-boulders": {
      const boulders = floatingBoulders(kind, variant, seed);
      return make(
        Math.max(...boulders.map((boulder) => Math.hypot(boulder.u, boulder.v) + boulder.radius)) + 0.1,
        Math.max(...boulders.map((boulder) => boulder.zCenter + boulder.radius)),
        [],
      );
    }
    case "great-sphere":
      return make(2.4, 4.4, [cylinder(0, 0, 2.05, 4.4)]);
    case "door-frame":
      return make(1.0, 2.4, [cylinder(-0.5, 0, 0.13, 2.4), cylinder(0.5, 0, 0.13, 2.4)]);
    case "small-floater": {
      const [boulder] = floatingBoulders(kind, variant, seed);
      return make(boulder.radius + 0.1, boulder.zCenter + boulder.radius, []);
    }
    case "pebble-stack": {
      const stones = pebbleStackStones(variant, seed);
      const top = stones[stones.length - 1];
      return make(1.5 * 1.05 + 0.4, top.zCenter + top.rz, [cylinder(0, 0, 1.35, top.zCenter + top.rz)]);
    }
    case "needle":
      return make(3.4, 9.4, [thin(0, 0, 3), thin(3.0, 0.8, 1.5)]);
    case "bone-form": {
      const feet = variant === 2 ? [[0.84, 0], [-0.84, 0]] : [[0.84, 0], [-0.6, 0.36], [-0.6, -0.36]];
      return make(1.6, 2.0, feet.map(([u, v]) => thin(u, v, 1.0)));
    }
    case "pebble-pair":
      return make(1.2, 1.6, [cylinder(0, 0, 0.9, 1.0)]);
    case "wire-mobile":
      return make(3.3, 9.0, [thin(0, 0, 8)]);
    case "disc-stalk":
      return make(1.0, 3.35, [thin(0, 0, 2.8)]);
    case "blob":
      return make(2.1, 1.9, [cylinder(0, 0, 0.85, 0.9)]);
    case "colonnade": {
      const count = colonnadeColumnCount(variant);
      const colliders = Array.from({ length: count }, (_, index) =>
        cylinder(colonnadeColumnU(count, index), 0, 0.5, colonnadeColumnBroken(variant, index) ? colonnadeStumpHeightMeters(index) : 6.5),
      );
      return make(Math.hypot(colonnadeLengthMeters(count) / 2, 0.6) + 0.1, 6.5, colliders);
    }
    case "ruin-arch":
      return make(3.5, 7.0, [cylinder(-2.15, 0, 0.5, 3.6), cylinder(2.15, 0, 0.5, 3.6), cylinder(2.9, 0.7, 0.5, 0.6)]);
    case "broken-column":
      return make(1.8, 1.5, [cylinder(0, 0, 0.5, 1.5), cylinder(1.1, 0.5, 0.5, 0.85)]);
    case "ice-spire":
      return make(1.5, 3.5, [cylinder(0, 0, 0.24, 3.5), cylinder(0.6, 0.25, 0.24, 2.5), cylinder(-0.4, 0.5, 0.24, 1.8)]);
  }
}
