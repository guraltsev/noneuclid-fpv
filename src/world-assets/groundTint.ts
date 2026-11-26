/**
 * Per-cell ground tint image (design 018 section 4.1).
 *
 * A pure function turns a cell into a small RGBA image over the cell's bounding box: two octaves of seeded value noise
 * around 1.0, a slight warm/cool shift, and a soft dark disc under every authored static object (its shadow from a sun at
 * the zenith). The floor material multiplies its colour by this image. A texel value of 128 means "multiply by 1.0".
 */
import type { CellObjectSpec, FloorMaterialSpec } from "../cell-complex/specs";
import { fractalNoise2, hashStringToSeed } from "./seededNoise";

/** Strength of the large (about 8 m) brightness patches: the tint varies by plus or minus this fraction. */
export const groundTintLargeStrength = 0.3;
/** Strength of the small (about 2 m) brightness patches. */
export const groundTintSmallStrength = 0.1;
/** Largest warm/cool shift of the red and blue channels, as a fraction. */
export const groundTintWarmCoolStrength = 0.04;
/** Darkest the contact shadow gets, as a fraction removed at the object (0.38 means 62 percent of the colour is left). */
export const groundContactShadowStrength = 0.5;
/** Radius in meters used for a static object with no collision cylinder. */
export const groundContactShadowDefaultRadiusMeters = 0.35;
/** Texel value that means "multiply by 1.0". */
export const groundTintNeutralTexel = 128;

/** The structural part of a compiled prism cell that the tint needs. */
export interface GroundTintCell {
  readonly id: string;
  readonly baseVertices: readonly { readonly x: number; readonly y: number }[];
  readonly objects: readonly CellObjectSpec[];
  readonly floorMaterial: FloorMaterialSpec;
}

/** Something tall that stands in a cell and throws a long shadow on its ground (a generated landmark, an authored object). */
export interface GroundShadowCaster {
  /** Cell-local position of the foot, meters. */
  readonly x: number;
  readonly y: number;
  /** Radius of the footprint, meters. */
  readonly radiusMeters: number;
  /** Height, meters; the shadow is this long times {@link groundShadowLengthPerHeight}. */
  readonly heightMeters: number;
}

/** Options of {@link computeGroundTint}. */
export interface GroundTintOptions {
  /** Image width in texels (default 128). */
  readonly width?: number;
  /** Image height in texels (default 128). */
  readonly height?: number;
  /** Direction in which shadows fall in this cell: radians from +x toward +y (see `cell-complex/cellSun.ts`). Without it shadows fall straight down. */
  readonly shadowAzimuthRadians?: number;
  /** Extra shadow casters besides the cell's authored static objects (generated landmarks). */
  readonly casters?: readonly GroundShadowCaster[];
}

/** Length of a caster's shadow on the ground as a multiple of its height (a low sun). */
export const groundShadowLengthPerHeight = 1.1;

/** A tint image and the cell-local rectangle it covers (x right, y forward, meters). */
export interface GroundTint {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, row 0 at `originY`. */
  readonly data: Uint8Array<ArrayBuffer>;
  readonly originX: number;
  readonly originY: number;
  readonly sizeX: number;
  readonly sizeY: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Computes the tint image of a cell over its bounding box, seeded by the cell id so it is the same on every machine.
 * Texel centres are sampled; creatures (anything whose kind is not `asset`) cast no contact shadow.
 */
export function computeGroundTint(cell: GroundTintCell, options: GroundTintOptions = {}): GroundTint {
  const width = options.width ?? 128;
  const height = options.height ?? 128;
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const originX = Math.min(...xs);
  const originY = Math.min(...ys);
  const sizeX = Math.max(Math.max(...xs) - originX, 1e-6);
  const sizeY = Math.max(Math.max(...ys) - originY, 1e-6);
  const seed = hashStringToSeed(cell.id);
  const shadows = cell.objects
    .filter((object) => object.kind === "asset")
    .map((object) => ({
      x: object.position.x,
      y: object.position.y,
      radius: "collision" in object && object.collision ? object.collision.radius : groundContactShadowDefaultRadiusMeters,
    }));
  const data = new Uint8Array(new ArrayBuffer(width * height * 4));

  for (let row = 0; row < height; row += 1) {
    const y = originY + ((row + 0.5) / height) * sizeY;
    for (let column = 0; column < width; column += 1) {
      const x = originX + ((column + 0.5) / width) * sizeX;
      const large = (fractalNoise2(seed, x / 8, y / 8, 2) - 0.5) * 2;
      const small = (fractalNoise2(seed + 1, x / 2, y / 2, 2) - 0.5) * 2;
      const warm = (fractalNoise2(seed + 2, x / 6, y / 6, 2) - 0.5) * 2;
      let shadow = 1;
      for (const object of shadows) {
        const distance = Math.hypot(x - object.x, y - object.y);
        shadow *= 1 - groundContactShadowStrength * (1 - smoothstep(0.6 * object.radius, 1.7 * object.radius + 0.25, distance));
      }
      const brightness = (1 + groundTintLargeStrength * large + groundTintSmallStrength * small) * shadow;
      const offset = (row * width + column) * 4;
      data[offset] = clampTexel(brightness * (1 + groundTintWarmCoolStrength * warm) * groundTintNeutralTexel);
      data[offset + 1] = clampTexel(brightness * groundTintNeutralTexel);
      data[offset + 2] = clampTexel(brightness * (1 - groundTintWarmCoolStrength * warm) * groundTintNeutralTexel);
      data[offset + 3] = 255;
    }
  }

  return { width, height, data, originX, originY, sizeX, sizeY };
}

function clampTexel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
