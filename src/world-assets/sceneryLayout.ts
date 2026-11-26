/**
 * Seeded layout of the small decorative props (grass, flowers, stones, mushrooms...) that grow on the floor of a cell.
 *
 * Pure and deterministic: the layout of a cell depends only on the cell id, its polygon, its floor texture and its authored objects,
 * so every copy of the cell seen through portals shows the same details (design 018 section 4.2). Positions are cell-local meters.
 * Props are decoration only: they are not objects, so they have no collision and no aim target. The mesh is built from this list by
 * `render/three/buildCellScenery.ts`. Layer rule: this module imports only from `cell-complex`.
 */

import type { CompiledPrismCell } from "../cell-complex/prismCells";
import { createSeededRandom, fractalNoise2, hashStringToSeed } from "./seededNoise";

/** The kinds of prop the layout can place. */
export type SceneryPropKind =
  | "grass-tuft"
  | "dark-tuft"
  | "dry-tuft"
  | "daisy"
  | "fern"
  | "mushroom"
  | "twig"
  | "stone"
  | "pale-stone"
  | "red-rock"
  | "reed"
  | "succulent"
  | "shrub"
  | "snow-mound"
  | "ice-crystal";

/** A ground type that decides which props grow; derived from the floor texture name. */
export type SceneryBiome = "grass" | "forest" | "river" | "sand" | "mud" | "snow";

/** One prop of a cell: where it stands, how it is turned and sized, and which colour variant it has. */
export interface SceneryProp {
  readonly kind: SceneryPropKind;
  /** Cell-local meters. */
  readonly x: number;
  /** Cell-local meters. */
  readonly y: number;
  /** Turn about the vertical, radians. */
  readonly yawRadians: number;
  /** Size factor, about 0.7 to 1.3. */
  readonly scale: number;
  /** Colour variant in [0, 1]. */
  readonly tone: number;
}

/** Options of {@link computeSceneryLayout}; the defaults are the shipped look, tests and tuning override them. */
export interface SceneryLayoutOptions {
  /** Spacing of the jittered grid, meters. */
  readonly spacingMeters?: number;
  /** Multiplies every biome density. */
  readonly densityScale?: number;
  /**
   * Per side index, the biome of the cell glued to that side (undefined for a wall or a neighbour that grows nothing). A prop
   * near such a side takes its kind from the neighbour's list with probability `1 - smoothstep(-h, h, d)`, `d` being its distance
   * into this cell from the side and `h` {@link neighbourBlendHalfWidthMeters}, so both faces carry both biomes in the same proportion at the border.
   */
  readonly neighbourBiomeBySideIndex?: ReadonlyMap<number, SceneryBiome | undefined>;
  /** Half-width `h` of the biome transition at a side, meters (default {@link defaultNeighbourBlendHalfWidthMeters}). */
  readonly neighbourBlendHalfWidthMeters?: number;
  /** Discs (cell-local meters) no prop may touch, such as the feet of generated landmarks. */
  readonly keepOutDiscs?: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
}

/** Half-width of the biome transition at a side when the caller gives none, meters. */
export const defaultNeighbourBlendHalfWidthMeters = 1.5;

/** Triangles each prop kind adds to the cell mesh; `buildCellScenery.ts` emits exactly this many for the kind. */
export const sceneryTrianglesByKind: Record<SceneryPropKind, number> = {
  "grass-tuft": 5,
  "dark-tuft": 4,
  "dry-tuft": 5,
  daisy: 5,
  fern: 8,
  mushroom: 11,
  twig: 2,
  stone: 6,
  "pale-stone": 6,
  "red-rock": 4,
  reed: 3,
  succulent: 5,
  shrub: 6,
  "snow-mound": 6,
  "ice-crystal": 4,
};

/** The most triangles of scenery one cell may carry. */
export const maxSceneryTrianglesPerCell = 1500;

/** Spacing of the jittered placement grid, meters. */
export const scenerySpacingMeters = 0.75;
/** Radius of a prop of scale 1 for keep-out purposes, meters: every shape fits in a disc of this radius. */
export const sceneryPropRadiusMeters = 0.25;
/** Clearance from every side of the cell, meters (a prop's own radius counts). */
export const scenerySideClearanceMeters = 0.35;
/** Clearance from every vertex of the cell, meters. */
export const sceneryVertexClearanceMeters = 1.0;
/** Collision radius assumed for an authored object without one, meters. */
export const sceneryDefaultObjectRadiusMeters = 0.35;
/** Extra clearance around an authored object's collision radius, meters. */
export const sceneryObjectClearanceMeters = 0.5;
/** Radius of the cleared disc around the centre of a feature, in which no ordinary prop grows, meters. */
export const sceneryFeatureClearRadiusMeters = 1.1;

/** Per biome: probability scale of keeping a grid candidate on the lushest ground, and the weighted prop kinds. */
export const sceneryBiomeTable: Record<
  SceneryBiome,
  { readonly density: number; readonly kinds: readonly (readonly [SceneryPropKind, number])[] }
> = {
  grass: { density: 1.9, kinds: [["grass-tuft", 0.62], ["dark-tuft", 0.23], ["daisy", 0.15]] },
  forest: { density: 1.0, kinds: [["fern", 0.35], ["mushroom", 0.12], ["twig", 0.53]] },
  river: { density: 0.9, kinds: [["stone", 0.6], ["reed", 0.4]] },
  sand: { density: 1.0, kinds: [["dry-tuft", 0.5], ["pale-stone", 0.3], ["succulent", 0.2]] },
  mud: { density: 0.8, kinds: [["red-rock", 0.55], ["shrub", 0.45]] },
  snow: { density: 0.75, kinds: [["snow-mound", 0.4], ["ice-crystal", 0.2], ["twig", 0.4]] },
};

type FeatureShape = "ring" | "patch";
interface FeatureRecipe {
  readonly shape: FeatureShape;
  readonly kind: SceneryPropKind;
  readonly min: number;
  readonly max: number;
}

// Features a biome can get; one is drawn per feature of the cell.
const featureRecipes: Record<SceneryBiome, readonly FeatureRecipe[]> = {
  grass: [
    { shape: "patch", kind: "daisy", min: 12, max: 16 },
    { shape: "ring", kind: "mushroom", min: 6, max: 8 },
  ],
  forest: [
    { shape: "ring", kind: "mushroom", min: 6, max: 8 },
    { shape: "ring", kind: "stone", min: 6, max: 8 },
  ],
  river: [{ shape: "ring", kind: "stone", min: 6, max: 8 }],
  sand: [
    { shape: "ring", kind: "pale-stone", min: 6, max: 8 },
    { shape: "ring", kind: "succulent", min: 6, max: 8 },
  ],
  mud: [{ shape: "ring", kind: "red-rock", min: 6, max: 8 }],
  snow: [
    { shape: "ring", kind: "ice-crystal", min: 6, max: 8 },
    { shape: "ring", kind: "snow-mound", min: 6, max: 8 },
  ],
};

const biomeByFloorTexture: Readonly<Record<string, SceneryBiome>> = {
  grass1: "grass",
  forest_leaves: "forest",
  river_pebbles: "river",
  gravelly_sand: "sand",
  red_mud_stones: "mud",
  snow: "snow",
};

/** What grows on a floor texture (design 018 section 4.2); undefined for any other texture or none. */
export function sceneryBiomeForFloor(floorTextureName: string | undefined): SceneryBiome | undefined {
  return floorTextureName === undefined ? undefined : biomeByFloorTexture[floorTextureName];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Lays out the props of a cell: a jittered grid thinned by the same noise field as the ground tint (clumps on lush patches, clearings
 * elsewhere), then one or two features (a ring of stones or mushrooms, a flower patch), within the triangle budget.
 * Returns an empty list for a cell with no biome or a floor that is not a floor texture. Ordinary props come first, features last.
 */
export function computeSceneryLayout(cell: CompiledPrismCell, options: SceneryLayoutOptions = {}): readonly SceneryProp[] {
  if (cell.floorMaterial.kind !== "floor-texture") {
    return [];
  }

  const biome = sceneryBiomeForFloor(cell.floorMaterial.name);

  if (!biome) {
    return [];
  }

  const spacing = options.spacingMeters ?? scenerySpacingMeters;
  const densityScale = options.densityScale ?? 1;
  const seed = hashStringToSeed(cell.id);
  const random = createSeededRandom((seed ^ 0x5ce4e5) >>> 0);
  const table = sceneryBiomeTable[biome];
  const keepOut = options.keepOutDiscs ?? [];
  const allowed = (x: number, y: number, scale: number): boolean =>
    isClear(cell, x, y, sceneryPropRadiusMeters * scale) && keepOut.every((disc) => Math.hypot(x - disc.x, y - disc.y) >= disc.radius + sceneryPropRadiusMeters * scale);
  const kindsAt = neighbourKindsPicker(cell, table.kinds, options);

  const features = placeFeatures(biome, allowed, cell, random);
  const ordinary: SceneryProp[] = [];

  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const columns = Math.ceil((Math.max(...xs) - minX) / spacing);
  const rows = Math.ceil((Math.max(...ys) - minY) / spacing);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Every random number is drawn whether or not the candidate survives, so one rejection does not reshuffle the rest.
      const x = minX + (column + 0.1 + 0.8 * random()) * spacing;
      const y = minY + (row + 0.1 + 0.8 * random()) * spacing;
      const keepRoll = random();
      const kindRoll = random();
      const yawRadians = random() * Math.PI * 2;
      const scale = 0.7 + 0.6 * random();
      const tone = random();
      const lushness = smoothstep(0.35, 0.75, fractalNoise2(seed, x / 8, y / 8, 2));

      if (keepRoll >= table.density * densityScale * lushness) {
        continue;
      }

      if (features.some((feature) => Math.hypot(x - feature.x, y - feature.y) < sceneryFeatureClearRadiusMeters)) {
        continue;
      }

      if (!allowed(x, y, scale)) {
        continue;
      }

      ordinary.push({ kind: pickKind(kindsAt(x, y, kindRoll), kindRoll), x, y, yawRadians, scale, tone });
    }
  }

  const featureProps = features.flatMap((feature) => feature.props);
  return trimToBudget(ordinary, featureProps);
}

// The kind list for a candidate: the nearest side with a neighbour biome lends its list with probability 1 - smoothstep(-h, h, d).
// The decision reuses the fine digits of the kind roll, so no extra random number is drawn and layouts without neighbours do not change.
function neighbourKindsPicker(
  cell: CompiledPrismCell,
  ownKinds: readonly (readonly [SceneryPropKind, number])[],
  options: SceneryLayoutOptions,
): (x: number, y: number, kindRoll: number) => readonly (readonly [SceneryPropKind, number])[] {
  const neighbours = options.neighbourBiomeBySideIndex;
  const halfWidth = options.neighbourBlendHalfWidthMeters ?? defaultNeighbourBlendHalfWidthMeters;

  if (!neighbours || neighbours.size === 0) {
    return () => ownKinds;
  }

  return (x, y, kindRoll) => {
    let nearest: SceneryBiome | undefined;
    let nearestDistance = Infinity;

    for (const side of cell.sides) {
      const biome = neighbours.get(side.sideIndex);
      const distance = (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y;

      if (biome && distance < nearestDistance) {
        nearest = biome;
        nearestDistance = distance;
      }
    }

    if (!nearest) {
      return ownKinds;
    }

    const biomeRoll = (kindRoll * 997) % 1;
    return biomeRoll < 1 - smoothstep(-halfWidth, halfWidth, nearestDistance) ? sceneryBiomeTable[nearest].kinds : ownKinds;
  };
}

interface PlacedFeature {
  readonly x: number;
  readonly y: number;
  readonly props: readonly SceneryProp[];
}

function pickKind(kinds: readonly (readonly [SceneryPropKind, number])[], roll: number): SceneryPropKind {
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = roll * total;

  for (const [kind, weight] of kinds) {
    remaining -= weight;

    if (remaining < 0) {
      return kind;
    }
  }

  return kinds[kinds.length - 1][0];
}

// Distance rules: a prop of the given radius must clear every side, every vertex and every authored object.
function isClear(cell: CompiledPrismCell, x: number, y: number, radius: number): boolean {
  for (const side of cell.sides) {
    const distance = (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y;

    if (distance < scenerySideClearanceMeters + radius) {
      return false;
    }
  }

  for (const vertex of cell.baseVertices) {
    if (Math.hypot(x - vertex.x, y - vertex.y) < sceneryVertexClearanceMeters + radius) {
      return false;
    }
  }

  for (const object of cell.objects) {
    const objectRadius = (object.kind === "asset" ? object.collision?.radius : object.collision.radius) ?? sceneryDefaultObjectRadiusMeters;

    if (Math.hypot(x - object.position.x, y - object.position.y) < objectRadius + sceneryObjectClearanceMeters + radius) {
      return false;
    }
  }

  return true;
}

// One or two features at seeded points where every member of the group fits; a feature that finds no such point in a few tries is left out.
function placeFeatures(
  biome: SceneryBiome,
  allowed: (x: number, y: number, scale: number) => boolean,
  cell: CompiledPrismCell,
  random: () => number,
): readonly PlacedFeature[] {
  const wanted = 1 + (random() < 0.5 ? 1 : 0);
  const recipes = featureRecipes[biome];
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const placed: PlacedFeature[] = [];

  for (let index = 0; index < wanted; index += 1) {
    const recipe = recipes[Math.floor(random() * recipes.length)];
    const count = recipe.min + Math.floor(random() * (recipe.max - recipe.min + 1));

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const x = Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs));
      const y = Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys));
      const props = buildFeatureProps(recipe, count, x, y, random);

      if (placed.every((other) => Math.hypot(other.x - x, other.y - y) > 3) && props.every((prop) => allowed(prop.x, prop.y, prop.scale))) {
        placed.push({ x, y, props });
        break;
      }
    }
  }

  return placed;
}

function buildFeatureProps(recipe: FeatureRecipe, count: number, x: number, y: number, random: () => number): readonly SceneryProp[] {
  const props: SceneryProp[] = [];
  const phase = random() * Math.PI * 2;

  for (let index = 0; index < count; index += 1) {
    let propX: number;
    let propY: number;

    if (recipe.shape === "ring") {
      const angle = phase + (index / count) * Math.PI * 2 + (random() - 0.5) * 0.25;
      const radius = 0.6 * (0.92 + 0.16 * random());
      propX = x + Math.cos(angle) * radius;
      propY = y + Math.sin(angle) * radius;
    } else {
      const angle = random() * Math.PI * 2;
      const radius = 0.7 * Math.sqrt(random());
      propX = x + Math.cos(angle) * radius;
      propY = y + Math.sin(angle) * radius;
    }

    props.push({
      kind: recipe.kind,
      x: propX,
      y: propY,
      yawRadians: random() * Math.PI * 2,
      scale: 0.8 + 0.4 * random(),
      tone: random(),
    });
  }

  return props;
}

// Drops ordinary props last-generated-first, then feature props last-first, until the triangle total fits the budget.
function trimToBudget(ordinary: SceneryProp[], features: readonly SceneryProp[]): readonly SceneryProp[] {
  const keptFeatures = [...features];
  let total = 0;

  for (const prop of ordinary) {
    total += sceneryTrianglesByKind[prop.kind];
  }

  for (const prop of keptFeatures) {
    total += sceneryTrianglesByKind[prop.kind];
  }

  while (total > maxSceneryTrianglesPerCell && ordinary.length > 0) {
    total -= sceneryTrianglesByKind[ordinary.pop()!.kind];
  }

  while (total > maxSceneryTrianglesPerCell && keptFeatures.length > 0) {
    total -= sceneryTrianglesByKind[keptFeatures.pop()!.kind];
  }

  return [...ordinary, ...keptFeatures];
}
