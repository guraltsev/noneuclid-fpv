/**
 * Per-cell ground tint image (design 018 section 4.1).
 *
 * A pure function turns a cell into a small RGBA image over the cell's bounding box: two octaves of seeded value noise
 * around 1.0, a slight warm/cool shift, and a soft dark disc under every authored static object (its shadow from a sun at
 * the zenith). When a shadow azimuth is given, every caster (generated landmarks and the authored objects) also darkens a long tapered capsule of
 * ground pointing along that azimuth, and the face's palette (when given) shifts the hue of the whole image. The floor material multiplies its colour by this image. A texel value of 128 means "multiply by 1.0"; alpha is how far the texture's own colour is
 * removed first (0 keeps it).
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
/** Darkest a long shadow gets, at its foot, as a fraction removed (0.42 leaves 58 percent of the colour). */
export const groundLongShadowStrength = 0.6;
/** Fraction of the foot darkness left at the tip of a long shadow. */
export const groundLongShadowTipStrengthFraction = 0.6;
/** Width of a long shadow at its tip as a fraction of its width at the foot. */
export const groundLongShadowTipWidthFraction = 0.6;
/** Width of the soft edge of a long shadow, meters. */
export const groundLongShadowEdgeMeters = 0.18;
/** Height assumed for an authored object with no collision height, as a multiple of its radius. */
export const groundShadowDefaultHeightPerRadius = 2.5;
/** Default width and height of the tint image, texels. */
export const groundTintImageSize = 192;
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
  /** Image width in texels (default {@link groundTintImageSize}). */
  readonly width?: number;
  /** Image height in texels (default {@link groundTintImageSize}). */
  readonly height?: number;
  /** Direction in which shadows fall in this cell: radians from +x toward +y (see `cell-complex/cellSun.ts`). Without it shadows fall straight down. */
  readonly shadowAzimuthRadians?: number;
  /** Extra shadow casters besides the cell's authored static objects (generated landmarks); used only with `shadowAzimuthRadians`. */
  readonly casters?: readonly GroundShadowCaster[];
  /** Red, green and blue multipliers for the whole image (the face's palette, see `facePalettes.ts`); default no change. */
  readonly colorMultiplier?: readonly [number, number, number];
  /**
   * How far the floor's texture loses its own colour before the multipliers apply, 0 to 1, stored in the alpha channel (default 0): with a
   * palette, the floor keeps its texture's detail and brightness but takes the palette's hue.
   */
  readonly recolorStrength?: number;
}

/** Length of a caster's shadow on the ground as a multiple of its height (a low sun). */
export const groundShadowLengthPerHeight = 1.4;

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
  const width = options.width ?? groundTintImageSize;
  const height = options.height ?? groundTintImageSize;
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const originX = Math.min(...xs);
  const originY = Math.min(...ys);
  const sizeX = Math.max(Math.max(...xs) - originX, 1e-6);
  const sizeY = Math.max(Math.max(...ys) - originY, 1e-6);
  const seed = hashStringToSeed(cell.id);
  const staticObjects = cell.objects.filter((object) => object.kind === "asset");
  const shadows = staticObjects.map((object) => ({
    x: object.position.x,
    y: object.position.y,
    radius: "collision" in object && object.collision ? object.collision.radius : groundContactShadowDefaultRadiusMeters,
  }));
  const azimuth = options.shadowAzimuthRadians;
  const longShadows: LongShadow[] =
    azimuth === undefined
      ? []
      : [
          ...staticObjects.map((object, index) => {
            const collision = "collision" in object ? object.collision : undefined;
            return makeLongShadow(
              { x: shadows[index].x, y: shadows[index].y, radiusMeters: shadows[index].radius, heightMeters: collision?.height ?? groundShadowDefaultHeightPerRadius * shadows[index].radius },
              azimuth,
            );
          }),
          ...(options.casters ?? []).map((caster) => makeLongShadow(caster, azimuth)),
        ];
  const data = new Uint8Array(new ArrayBuffer(width * height * 4));
  const [redGain, greenGain, blueGain] = options.colorMultiplier ?? [1, 1, 1];
  const alpha = clampTexel((options.recolorStrength ?? 0) * 255);

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
      for (const longShadow of longShadows) {
        shadow *= 1 - longShadowDarkness(longShadow, x, y);
      }
      const brightness = (1 + groundTintLargeStrength * large + groundTintSmallStrength * small) * shadow;
      const offset = (row * width + column) * 4;
      data[offset] = clampTexel(redGain * brightness * (1 + groundTintWarmCoolStrength * warm) * groundTintNeutralTexel);
      data[offset + 1] = clampTexel(greenGain * brightness * groundTintNeutralTexel);
      data[offset + 2] = clampTexel(blueGain * brightness * (1 - groundTintWarmCoolStrength * warm) * groundTintNeutralTexel);
      data[offset + 3] = alpha;
    }
  }

  return { width, height, data, originX, originY, sizeX, sizeY };
}

interface LongShadow {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly length: number;
}

function makeLongShadow(caster: GroundShadowCaster, azimuthRadians: number): LongShadow {
  return {
    x: caster.x,
    y: caster.y,
    radius: caster.radiusMeters,
    directionX: Math.cos(azimuthRadians),
    directionY: Math.sin(azimuthRadians),
    length: caster.heightMeters * groundShadowLengthPerHeight,
  };
}

// Fraction of the colour a tapered capsule from the foot to the tip removes at (x, y): strongest at the foot, 60 percent of that at the tip, soft edged.
function longShadowDarkness(shadow: LongShadow, x: number, y: number): number {
  const dx = x - shadow.x;
  const dy = y - shadow.y;
  const along = dx * shadow.directionX + dy * shadow.directionY;
  const across = Math.abs(-dx * shadow.directionY + dy * shadow.directionX);
  const tipRadius = groundLongShadowTipWidthFraction * shadow.radius;
  const fraction = Math.min(1, Math.max(0, along / shadow.length));
  let distance: number;

  if (along < 0) {
    distance = Math.hypot(along, across) - shadow.radius;
  } else if (along > shadow.length) {
    distance = Math.hypot(along - shadow.length, across) - tipRadius;
  } else {
    distance = across - (shadow.radius + (tipRadius - shadow.radius) * fraction);
  }

  const half = groundLongShadowEdgeMeters / 2;
  const strength = groundLongShadowStrength * (1 - (1 - groundLongShadowTipStrengthFraction) * fraction);
  return strength * (1 - smoothstep(-half, half, distance));
}

function clampTexel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
