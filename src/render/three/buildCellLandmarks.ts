/**
 * Mesh of the generated landmarks of one cell (design 018 sections 8.1 to 8.4), in the cell mesh's Three.js axes (cell-local (x, y, height) is Three (x, height, -y)).
 *
 * One merged non-indexed mesh with vertex colours and a stock `MeshLambertMaterial`, so the portal clip patch applies and the cell archetype pipeline can
 * instance it over portal copies. The scene has no directional light, so the light of the cell (`shadowAzimuthRadians`) is baked into the colours: every
 * triangle is darkened by how far its normal turns from the light. Every kind is built from a small set of primitive emitters (box, frustum, cone, lat-long
 * and icosphere ellipsoids, ring arch, disc, crescent, star, strut) and emits exactly `landmarkTriangleCount(kind, variant)` triangles; the sizes it
 * relies on come from `world-assets/landmarkShapes.ts`, which the layout shares. Everything is deterministic from the placement seed.
 */
import * as THREE from "three";
import type { LandmarkPlacement } from "../../world-assets/landmarkLayout";
import {
  arcadePierHeightMeters,
  arcadePierMeters,
  arcadePierU,
  arcadeLengthMeters,
  colonnadeColumnBroken,
  colonnadeColumnCount,
  colonnadeColumnU,
  colonnadePitchMeters,
  colonnadeShaftHeightMeters,
  colonnadeStumpHeightMeters,
  flatDiscSegments,
  floatingBoulders,
  landmarkTriangleCount,
  mobileItemTriangles,
  pebbleStackStones,
  ruinArchSegments,
  stoneLatitudes,
  stoneLongitudes,
  arcadeArchSegments,
} from "../../world-assets/landmarkShapes";
import { createSeededRandom } from "../../world-assets/seededNoise";

/** Elevation of the baked light above the horizon, radians (40 degrees). */
export const landmarkLightElevationRadians = (40 * Math.PI) / 180;
/** Brightness of a face turned away from the light. */
export const landmarkShadeFloor = 0.62;
/** Brightness added to the floor by a face turned straight to the light. */
export const landmarkShadeRange = 0.38;
/** Red multiplier of a face turned away from the light (shade reads cool). */
export const landmarkShadeRed = 0.94;
/** Blue multiplier of a face turned away from the light. */
export const landmarkShadeBlue = 1.06;
/** Brightness multiplier of an underside (normal pointing down). */
export const landmarkUndersideFactor = 0.85;
/** A face whose normal height component is below this counts as an underside. */
export const landmarkUndersideNormalZ = -0.5;
/** Per-triangle brightness jitter, as a total fraction (plus or minus half of it), so flat facets do not look uniform. */
export const landmarkFacetJitter = 0.1;

/** Palettes (sRGB hex) per biome; edit here to tune the look. */
export const landmarkPalette = {
  sand: { ochre: "#d9a85b", terracotta: "#b8553a", cream: "#ead9b0", archDark: "#6a3a2c", pennant: "#c0392b", window: "#2a1d1a" },
  mud: { bone: "#e6dcc3", sienna: "#a5482c", dark: "#2b2320" },
  grass: { slate: "#6f7c85", pale: "#c9d2d4", door: "#7a4a2a", frame: "#ead9b0", sphere: "#dfe6e2" },
  river: { bone: "#ded6c2", greyBlue: "#8e9fad", dark: "#3d4852" },
  forest: { black: "#1b1b1b", red: "#d2362b", yellow: "#f2c230", blue: "#2456a6" },
  snow: { marble: "#eef0ee", vein: "#c5ccd1", ice: "#b9dcec" },
} as const;

type Vec3 = readonly [number, number, number];

const colorCache = new Map<string, THREE.Color>();

// THREE.Color converts the sRGB hex into the linear working space the vertex colours hold.
function col(hex: string): THREE.Color {
  let color = colorCache.get(hex);

  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }

  return color;
}

/** Unit vector from a surface toward the light, in cell-local axes: horizontally opposite to the shadow direction, raised by the light elevation. */
export function landmarkToLight(shadowAzimuthRadians: number): THREE.Vector3 {
  const horizontal = Math.cos(landmarkLightElevationRadians);
  return new THREE.Vector3(-Math.cos(shadowAzimuthRadians) * horizontal, -Math.sin(shadowAzimuthRadians) * horizontal, Math.sin(landmarkLightElevationRadians));
}

/**
 * Multiplies `color` by the baked light of a face with the unit normal `normal` (cell-local axes): `0.62 + 0.38 * max(0, n . toLight)`, a cool tint
 * on faces turned away, and 0.85 on undersides. Returns the colour.
 */
export function bakeLandmarkLight(color: THREE.Color, normal: THREE.Vector3, toLight: THREE.Vector3): THREE.Color {
  const along = normal.dot(toLight);
  color.multiplyScalar(landmarkShadeFloor + landmarkShadeRange * Math.max(0, along));

  if (along <= 0) {
    color.r *= landmarkShadeRed;
    color.b *= landmarkShadeBlue;
  }

  if (normal.z < landmarkUndersideNormalZ) {
    color.multiplyScalar(landmarkUndersideFactor);
  }

  return color;
}

// Writes the triangles of the landmarks of one cell. Parts are authored in their own frame; `part` stacks a matrix on the placement's.
class LandmarkWriter {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  cursor = 0;
  random: () => number = Math.random;
  private readonly base = new THREE.Matrix4();
  private current = new THREE.Matrix4();
  private readonly toLight: THREE.Vector3;
  private readonly va = new THREE.Vector3();
  private readonly vb = new THREE.Vector3();
  private readonly vc = new THREE.Vector3();
  private readonly vr = new THREE.Vector3();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(triangles: number, shadowAzimuthRadians: number) {
    this.positions = new Float32Array(triangles * 9);
    this.normals = new Float32Array(triangles * 9);
    this.colors = new Float32Array(triangles * 9);
    this.toLight = landmarkToLight(shadowAzimuthRadians);
  }

  begin(placement: LandmarkPlacement): void {
    this.base.makeTranslation(placement.x, placement.y, 0);
    this.base.multiply(new THREE.Matrix4().makeRotationZ(placement.yawRadians));
    this.base.multiply(new THREE.Matrix4().makeScale(placement.scale, placement.scale, placement.scale));
    this.current.copy(this.base);
    this.random = createSeededRandom((placement.seed ^ 0x1a2b3c4d) >>> 0);
  }

  part(matrix: THREE.Matrix4, emit: () => void): void {
    const saved = this.current;
    this.current = saved.clone().multiply(matrix);
    emit();
    this.current = saved;
  }

  // Emits one triangle. With `ref` (a point inside the solid) the normal points away from it; without, the face turns toward the light.
  tri(a: Vec3, b: Vec3, c: Vec3, color: THREE.Color, ref?: Vec3): void {
    const { va, vb, vc, e1, e2, normal } = this;
    va.set(a[0], a[1], a[2]).applyMatrix4(this.current);
    vb.set(b[0], b[1], b[2]).applyMatrix4(this.current);
    vc.set(c[0], c[1], c[2]).applyMatrix4(this.current);
    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    normal.crossVectors(e1, e2);
    const length = normal.length();

    if (length < 1e-12) {
      normal.set(0, 0, 1);
    } else {
      normal.divideScalar(length);
    }

    let flip: boolean;

    if (ref) {
      this.vr.set(ref[0], ref[1], ref[2]).applyMatrix4(this.current);
      const cx = (va.x + vb.x + vc.x) / 3 - this.vr.x;
      const cy = (va.y + vb.y + vc.y) / 3 - this.vr.y;
      const cz = (va.z + vb.z + vc.z) / 3 - this.vr.z;
      flip = normal.x * cx + normal.y * cy + normal.z * cz < 0;
    } else {
      flip = normal.dot(this.toLight) < 0;
    }

    if (flip) {
      normal.negate();
      e1.copy(vb);
      vb.copy(vc);
      vc.copy(e1);
    }

    const shaded = bakeLandmarkLight(color.clone(), normal, this.toLight);
    shaded.multiplyScalar(1 + (this.random() - 0.5) * landmarkFacetJitter);
    const start = this.cursor;
    const corners = [va, vb, vc];

    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = start + vertex * 3;
      // Cell-local (x, y, height) to Three (x, height, -y).
      this.positions[offset] = corners[vertex].x;
      this.positions[offset + 1] = corners[vertex].z;
      this.positions[offset + 2] = -corners[vertex].y;
      this.normals[offset] = normal.x;
      this.normals[offset + 1] = normal.z;
      this.normals[offset + 2] = -normal.y;
      this.colors[offset] = shaded.r;
      this.colors[offset + 1] = shaded.g;
      this.colors[offset + 2] = shaded.b;
    }

    this.cursor += 9;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: THREE.Color, ref?: Vec3): void {
    this.tri(a, b, c, color, ref);
    this.tri(a, c, d, color, ref);
  }
}

interface PartPose {
  readonly yaw?: number;
  readonly ry?: number;
  readonly rx?: number;
}

// Translation, then yaw about the vertical, then a tilt about the local y axis, then about the local x axis.
function at(x: number, y: number, z: number, pose: PartPose = {}): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);

  if (pose.yaw) {
    matrix.multiply(new THREE.Matrix4().makeRotationZ(pose.yaw));
  }

  if (pose.ry) {
    matrix.multiply(new THREE.Matrix4().makeRotationY(pose.ry));
  }

  if (pose.rx) {
    matrix.multiply(new THREE.Matrix4().makeRotationX(pose.rx));
  }

  return matrix;
}

function chain(...matrices: readonly THREE.Matrix4[]): THREE.Matrix4 {
  const result = new THREE.Matrix4();

  for (const matrix of matrices) {
    result.multiply(matrix);
  }

  return result;
}

// Axis-aligned box centred on the origin in x and y, from height 0 to `sz`: 8 triangles for the sides, 2 for the top, 2 for the bottom.
function box(w: LandmarkWriter, sx: number, sy: number, sz: number, color: THREE.Color, top = true, bottom = false): void {
  const x = sx / 2;
  const y = sy / 2;
  const lower: Vec3[] = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]];
  const upper: Vec3[] = [[-x, -y, sz], [x, -y, sz], [x, y, sz], [-x, y, sz]];
  const ref: Vec3 = [0, 0, sz / 2];

  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    w.quad(lower[index], lower[next], upper[next], upper[index], color, ref);
  }

  if (top) {
    w.quad(upper[0], upper[1], upper[2], upper[3], color, ref);
  }

  if (bottom) {
    w.quad(lower[0], lower[3], lower[2], lower[1], color, ref);
  }
}

interface FrustumOptions {
  readonly top?: boolean;
  readonly bottom?: boolean;
  /** Angle of the first vertex, radians. */
  readonly phase?: number;
  /** How far the centre of the top cap rises above the rim (a jagged break). */
  readonly apexRise?: number;
  /** Colour of every second side, for a fluted look. */
  readonly altColor?: THREE.Color;
}

// n-sided frustum from radius r0 at height 0 to r1 at height h: 2n triangles for the sides, n for each cap.
function frustum(w: LandmarkWriter, n: number, r0: number, r1: number, h: number, color: THREE.Color, options: FrustumOptions = {}): void {
  const phase = options.phase ?? 0;
  const lower: Vec3[] = [];
  const upper: Vec3[] = [];

  for (let index = 0; index < n; index += 1) {
    const angle = phase + (index / n) * Math.PI * 2;
    lower.push([r0 * Math.cos(angle), r0 * Math.sin(angle), 0]);
    upper.push([r1 * Math.cos(angle), r1 * Math.sin(angle), h]);
  }

  const ref: Vec3 = [0, 0, h / 2];

  for (let index = 0; index < n; index += 1) {
    const next = (index + 1) % n;
    w.quad(lower[index], lower[next], upper[next], upper[index], options.altColor && index % 2 === 1 ? options.altColor : color, ref);
  }

  if (options.top) {
    const centre: Vec3 = [0, 0, h + (options.apexRise ?? 0)];

    for (let index = 0; index < n; index += 1) {
      w.tri(upper[index], upper[(index + 1) % n], centre, color, ref);
    }
  }

  if (options.bottom) {
    for (let index = 0; index < n; index += 1) {
      w.tri(lower[index], lower[(index + 1) % n], [0, 0, 0], color, ref);
    }
  }
}

// n-sided cone (a pyramid for n = 4) of base radius r and height h, open at the bottom: n triangles.
function cone(w: LandmarkWriter, n: number, r: number, h: number, color: THREE.Color, phase = 0): void {
  const apex: Vec3 = [0, 0, h];

  for (let index = 0; index < n; index += 1) {
    const a = phase + (index / n) * Math.PI * 2;
    const b = phase + ((index + 1) / n) * Math.PI * 2;
    w.tri([r * Math.cos(a), r * Math.sin(a), 0], [r * Math.cos(b), r * Math.sin(b), 0], apex, color, [0, 0, h * 0.3]);
  }
}

// Lat-long ellipsoid centred on the origin with its poles on the z axis: 2 * longitudes * (latitudes - 1) triangles. `wobble` shrinks vertices at random.
function latLong(w: LandmarkWriter, longitudes: number, latitudes: number, rx: number, ry: number, rz: number, color: THREE.Color, wobble = 0): void {
  const rings: Vec3[][] = [];

  for (let ring = 0; ring <= latitudes; ring += 1) {
    const phi = (ring / latitudes) * Math.PI;
    const row: Vec3[] = [];

    if (ring === 0 || ring === latitudes) {
      row.push([0, 0, -Math.cos(phi) * rz]);
    } else {
      for (let index = 0; index < longitudes; index += 1) {
        const theta = (index / longitudes) * Math.PI * 2;
        const factor = 1 - wobble * w.random();
        row.push([rx * Math.sin(phi) * Math.cos(theta) * factor, ry * Math.sin(phi) * Math.sin(theta) * factor, -rz * Math.cos(phi) * factor]);
      }
    }

    rings.push(row);
  }

  const ref: Vec3 = [0, 0, 0];

  for (let index = 0; index < longitudes; index += 1) {
    const next = (index + 1) % longitudes;
    w.tri(rings[0][0], rings[1][index], rings[1][next], color, ref);
    w.tri(rings[latitudes - 1][index], rings[latitudes][0], rings[latitudes - 1][next], color, ref);

    for (let ring = 1; ring < latitudes - 1; ring += 1) {
      w.quad(rings[ring][index], rings[ring][next], rings[ring + 1][next], rings[ring + 1][index], color, ref);
    }
  }
}

const icoUnitTriangles = new Map<number, readonly (readonly [Vec3, Vec3, Vec3])[]>();

function normalized(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

// The triangles of a unit icosphere of subdivision level 0 or 1.
function icoTrianglesOf(level: number): readonly (readonly [Vec3, Vec3, Vec3])[] {
  const known = icoUnitTriangles.get(level);

  if (known) {
    return known;
  }

  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => normalized(x, y, z));
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  let triangles: (readonly [Vec3, Vec3, Vec3])[] = faces.map(([a, b, c]) => [vertices[a], vertices[b], vertices[c]]);

  for (let step = 0; step < level; step += 1) {
    triangles = triangles.flatMap(([a, b, c]) => {
      const ab = normalized(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
      const bc = normalized(b[0] + c[0], b[1] + c[1], b[2] + c[2]);
      const ca = normalized(c[0] + a[0], c[1] + a[1], c[2] + a[2]);
      return [
        [a, ab, ca],
        [ab, b, bc],
        [ca, bc, c],
        [ab, bc, ca],
      ] as const;
    });
  }

  icoUnitTriangles.set(level, triangles);
  return triangles;
}

// Faceted ellipsoid centred on the origin: 20 (level 0) or 80 (level 1) triangles. Shared vertices shrink by a random factor in [minFactor, 1].
function ico(w: LandmarkWriter, level: number, rx: number, ry: number, rz: number, minFactor: number, color: THREE.Color): void {
  const factors = new Map<string, number>();
  const place = (unit: Vec3): Vec3 => {
    const key = `${Math.round(unit[0] * 100)},${Math.round(unit[1] * 100)},${Math.round(unit[2] * 100)}`;
    let factor = factors.get(key);

    if (factor === undefined) {
      factor = minFactor + (1 - minFactor) * w.random();
      factors.set(key, factor);
    }

    return [unit[0] * rx * factor, unit[1] * ry * factor, unit[2] * rz * factor];
  };

  for (const [a, b, c] of icoTrianglesOf(level)) {
    w.tri(place(a), place(b), place(c), color, [0, 0, 0]);
  }
}

interface ArchColors {
  readonly front: THREE.Color;
  readonly inner: THREE.Color;
  readonly outer?: THREE.Color;
}

// Round arch: a half ring in the x-z plane, centred on the origin, `depth` thick along y. Per segment 6 triangles (front, back, inner) or 8 with the outer face.
function ringArch(w: LandmarkWriter, inner: number, outer: number, depth: number, segments: number, colors: ArchColors): void {
  const point = (radius: number, step: number, y: number): Vec3 => {
    const angle = (step / segments) * Math.PI;
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  };
  const half = depth / 2;

  for (let step = 0; step < segments; step += 1) {
    const mid = ((step + 0.5) / segments) * Math.PI;
    const middleRadius = (inner + outer) / 2;
    const ref: Vec3 = [middleRadius * Math.cos(mid), 0, middleRadius * Math.sin(mid)];
    w.quad(point(inner, step, half), point(outer, step, half), point(outer, step + 1, half), point(inner, step + 1, half), colors.front, ref);
    w.quad(point(inner, step, -half), point(outer, step, -half), point(outer, step + 1, -half), point(inner, step + 1, -half), colors.front, ref);
    w.quad(point(inner, step, half), point(inner, step + 1, half), point(inner, step + 1, -half), point(inner, step, -half), colors.inner, ref);

    if (colors.outer) {
      w.quad(point(outer, step, half), point(outer, step + 1, half), point(outer, step + 1, -half), point(outer, step, -half), colors.outer, ref);
    }
  }
}

// Flat n-gon in the x-y plane (a fan from its centre): n triangles. `droop` lowers points to bend the disc.
function discFan(w: LandmarkWriter, n: number, radius: number, color: THREE.Color, droop?: (x: number, y: number) => number, cx = 0, cy = 0): void {
  const height = (x: number, y: number): number => (droop ? droop(x, y) : 0);
  const centre: Vec3 = [cx, cy, height(cx, cy)];
  const rim = (index: number): Vec3 => {
    const angle = (index / n) * Math.PI * 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return [x, y, height(x, y)];
  };

  for (let index = 0; index < n; index += 1) {
    w.tri(centre, rim(index), rim(index + 1), color);
  }
}

// Flat crescent in the x-y plane opening toward +x: 2 * segments triangles.
function crescent(w: LandmarkWriter, radius: number, segments: number, color: THREE.Color): void {
  const spread = 2.2;
  const outerAt = (step: number): Vec3 => {
    const angle = -spread + (2 * spread * step) / segments;
    return [-radius * 0.3 + radius * Math.cos(angle), radius * Math.sin(angle), 0];
  };
  const innerAt = (step: number): Vec3 => {
    const angle = -spread + (2 * spread * step) / segments;
    const depth = 0.6 * radius * Math.sin((Math.PI * step) / segments);
    return [-radius * 0.3 + (radius - depth) * Math.cos(angle), (radius - depth) * Math.sin(angle), 0];
  };

  for (let step = 0; step < segments; step += 1) {
    w.quad(outerAt(step), outerAt(step + 1), innerAt(step + 1), innerAt(step), color);
  }
}

// Flat five-pointed star in the x-y plane: 10 triangles.
function star(w: LandmarkWriter, radius: number, color: THREE.Color): void {
  const points: Vec3[] = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = Math.PI / 2 + (index / 10) * Math.PI * 2;
    const r = index % 2 === 0 ? radius : radius * 0.45;
    points.push([r * Math.cos(angle), r * Math.sin(angle), 0]);
  }

  for (let index = 0; index < 10; index += 1) {
    w.tri([0, 0, 0], points[index], points[(index + 1) % 10], color);
  }
}

// Thin three-sided strut between two points: 6 triangles.
function strut(w: LandmarkWriter, a: Vec3, b: Vec3, radius: number, color: THREE.Color): void {
  const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const helper = Math.abs(direction.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const p1 = new THREE.Vector3().crossVectors(direction, helper).normalize();
  const p2 = new THREE.Vector3().crossVectors(direction, p1).normalize();
  const corner = (end: Vec3, index: number): Vec3 => {
    const angle = (index / 3) * Math.PI * 2;
    const cos = Math.cos(angle) * radius;
    const sin = Math.sin(angle) * radius;
    // A strut that ends on the ground must not dig into it.
    return [end[0] + p1.x * cos + p2.x * sin, end[1] + p1.y * cos + p2.y * sin, Math.max(0, end[2] + p1.z * cos + p2.z * sin)];
  };
  const ref: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

  for (let index = 0; index < 3; index += 1) {
    const next = (index + 1) % 3;
    w.quad(corner(a, index), corner(a, next), corner(b, next), corner(b, index), color, ref);
  }
}

const quarterTurn = Math.PI / 2;
const eighthTurn = Math.PI / 4;

function emitArcade(w: LandmarkWriter, arches: number): void {
  const p = landmarkPalette.sand;
  const length = arcadeLengthMeters(arches);

  for (let index = 0; index <= arches; index += 1) {
    w.part(at(arcadePierU(arches, index), 0, 0), () => box(w, arcadePierMeters, arcadePierMeters, arcadePierHeightMeters, col(p.ochre), false));
  }

  w.part(at(0, 0, arcadePierHeightMeters), () => box(w, length + 0.4, 1.0, 0.75, col(p.cream)));

  for (let index = 0; index < arches; index += 1) {
    const centre = (arcadePierU(arches, index) + arcadePierU(arches, index + 1)) / 2;
    w.part(at(centre, 0, 4.4), () => ringArch(w, 0.9, 1.35, 0.8, arcadeArchSegments, { front: col(p.terracotta), inner: col(p.archDark) }));
  }
}

function emitTower(w: LandmarkWriter): void {
  const p = landmarkPalette.sand;
  const faceX = (z: number): number => 1.35 - 0.4 * (z / 8.2);

  frustum(w, 4, 1.35 * Math.SQRT2, 0.95 * Math.SQRT2, 8.2, col(p.ochre), { phase: eighthTurn });
  w.part(at(0, 0, 8.2), () => frustum(w, 4, 0.95 * Math.SQRT2, 1.25 * Math.SQRT2, 0.5, col(p.cream), { phase: eighthTurn, top: true }));
  w.part(at(0, 0, 8.7), () => cone(w, 4, 1.5, 0.8, col(p.terracotta), eighthTurn));
  strut(w, [0, 0, 9.5], [0, 0, 10.5], 0.04, col(p.window));
  w.tri([0.02, 0, 10.45], [0.02, 0, 9.95], [1.0, 0, 10.2], col(p.pennant));

  for (let side = 0; side < 4; side += 1) {
    w.part(at(0, 0, 0, { yaw: side * quarterTurn }), () => {
      for (const [low, high, half] of [[0, 1.9, 0.4], [5.2, 6.6, 0.22]] as const) {
        const ref: Vec3 = [0, 0, (low + high) / 2];
        w.quad([faceX(low) + 0.03, -half, low], [faceX(low) + 0.03, half, low], [faceX(high) + 0.03, half, high], [faceX(high) + 0.03, -half, high], col(p.window), ref);
      }
    });
  }
}

function emitPlinth(w: LandmarkWriter, variant: number): void {
  const p = landmarkPalette.sand;
  box(w, 1.8, 1.8, 0.6, col(p.cream));
  w.part(at(0, 0, 0.6), () => box(w, 1.2, 1.2, 1.0, col(p.ochre)));

  if (variant === 1) {
    w.part(at(0, 0, 2.2), () => ico(w, 0, 0.65, 0.65, 0.65, 0.92, col(p.terracotta)));
  } else if (variant === 2) {
    w.part(at(0, 0, 1.6), () => cone(w, 6, 0.55, 1.5, col(p.terracotta)));
  }
}

function emitLoneArch(w: LandmarkWriter): void {
  const p = landmarkPalette.sand;

  for (const side of [-1, 1]) {
    w.part(at(0.85 * side, 0, 0), () => box(w, 0.4, 0.5, 2.2, col(p.ochre), false));
  }

  w.part(at(0, 0, 2.2), () => ringArch(w, 0.7, 1.0, 0.5, 6, { front: col(p.terracotta), inner: col(p.archDark), outer: col(p.terracotta) }));
}

function emitStiltForm(w: LandmarkWriter): void {
  const p = landmarkPalette.mud;
  w.part(at(0, 0, 8.4), () => ico(w, 0, 1.2, 0.9, 0.75, 0.9, col(p.sienna)));

  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const hip: Vec3 = [0.6 * sx, 0.5 * sy, 7.8];
      const knee: Vec3 = [1.7 * sx, 1.5 * sy, 4.2];
      const foot: Vec3 = [2.7 * sx, 2.3 * sy, 0];
      strut(w, hip, knee, 0.08, col(p.dark));
      strut(w, knee, foot, 0.08, col(p.dark));
    }
  }
}

function emitCrutchSlab(w: LandmarkWriter): void {
  const p = landmarkPalette.mud;
  w.part(at(-0.2, 0, 2.1), () => box(w, 1.6, 1.1, 0.12, col(p.bone), true, true));
  w.part(chain(at(0.6, 0, 2.16, { ry: (50 * Math.PI) / 180 }), at(0.5, 0, -0.06)), () => box(w, 1.0, 1.1, 0.12, col(p.bone), true, true));
  strut(w, [-0.2, 0, 0], [-0.2, 0, 2.1], 0.07, col(p.dark));
  strut(w, [-0.2, 0, 1.4], [-0.7, 0, 2.1], 0.06, col(p.dark));
  strut(w, [-0.2, 0, 1.4], [0.3, 0, 2.1], 0.06, col(p.dark));
}

function emitObelisk(w: LandmarkWriter): void {
  const p = landmarkPalette.mud;
  frustum(w, 4, 0.283, 0.141, 3.4, col(p.dark), { phase: eighthTurn });
  w.part(at(0, 0, 3.4), () => cone(w, 4, 0.141, 0.3, col(p.sienna), eighthTurn));
}

function emitSoftDisc(w: LandmarkWriter): void {
  const p = landmarkPalette.mud;
  box(w, 1.2, 1.2, 1.5, col(p.bone));
  w.part(at(0, 0, 1.52), () => discFan(w, 12, 1.1, col(p.sienna), (x, y) => -1.6 * Math.max(0, Math.max(Math.abs(x), Math.abs(y)) - 0.6) ** 1.4, 0.1, 0));
}

function emitFloatingBoulders(w: LandmarkWriter, placement: LandmarkPlacement): void {
  const p = landmarkPalette.grass;
  const boulders = floatingBoulders("floating-boulders", placement.variant, placement.seed);

  boulders.forEach((boulder, index) => {
    const color = col(index % 2 === 0 ? p.slate : p.pale);
    w.part(at(boulder.u, boulder.v, boulder.zCenter, { yaw: index * 1.3 }), () => ico(w, index === 0 ? 1 : 0, boulder.radius, boulder.radius, boulder.radius * 0.9, 0.82, color));
  });
}

function emitGreatSphere(w: LandmarkWriter): void {
  w.part(at(0, 0, 2.2), () => ico(w, 1, 2.2, 2.2, 2.2, 0.96, col(landmarkPalette.grass.sphere)));
}

function emitDoorFrame(w: LandmarkWriter): void {
  const p = landmarkPalette.grass;

  for (const side of [-1, 1]) {
    w.part(at(0.5 * side, 0, 0), () => box(w, 0.18, 0.18, 2.22, col(p.frame)));
  }

  w.part(at(0, 0, 2.22), () => box(w, 1.18, 0.18, 0.18, col(p.frame), true, true));
  w.part(chain(at(-0.41, 0, 0, { yaw: (-65 * Math.PI) / 180 }), at(0.425, 0, 0)), () => box(w, 0.85, 0.05, 2.1, col(p.door), true, true));
}

function emitSmallFloater(w: LandmarkWriter, placement: LandmarkPlacement): void {
  const [boulder] = floatingBoulders("small-floater", placement.variant, placement.seed);
  w.part(at(boulder.u, boulder.v, boulder.zCenter), () => ico(w, 0, boulder.radius, boulder.radius, boulder.radius * 0.9, 0.85, col(landmarkPalette.grass.slate)));
}

function emitPebbleStack(w: LandmarkWriter, placement: LandmarkPlacement): void {
  const p = landmarkPalette.river;
  const colors = [p.greyBlue, p.bone, p.dark];

  pebbleStackStones(placement.variant, placement.seed).forEach((stone, index) => {
    w.part(at(stone.u, stone.v, stone.zCenter, { yaw: index * 0.9 }), () =>
      latLong(w, stoneLongitudes, stoneLatitudes, stone.rx, stone.ry, stone.rz, col(colors[index % 3]), 0.04),
    );
  });
}

function emitNeedle(w: LandmarkWriter): void {
  const p = landmarkPalette.river;
  const lean = (8 * Math.PI) / 180;

  w.part(at(0, 0, 0, { ry: lean }), () => {
    w.part(at(0, 0, 4.5), () => latLong(w, 6, 6, 0.35, 0.35, 4.5, col(p.bone)));
    w.part(at(0, 0, 9.0), () => ico(w, 0, 0.45, 0.45, 0.45, 0.9, col(p.bone)));
  });
  strut(w, [3.0, 0.8, 0], [5.4 * Math.sin(lean), 0, 5.4 * Math.cos(lean)], 0.05, col(p.dark));
}

function emitBoneForm(w: LandmarkWriter, props: number): void {
  const p = landmarkPalette.river;
  const feet = props === 2 ? [[0.84, 0], [-0.84, 0]] : [[0.84, 0], [-0.6, 0.36], [-0.6, -0.36]];

  w.part(at(0, 0, 1.5), () => latLong(w, 8, 5, 1.0, 0.55, 0.5, col(p.bone), 0.06));

  for (const [u, v] of feet) {
    strut(w, [u, v, 0], [u * 0.6, v * 0.6, 1.12], 0.05, col(p.dark));
  }
}

function emitPebblePair(w: LandmarkWriter): void {
  const p = landmarkPalette.river;
  w.part(at(0, 0, 0.5), () => latLong(w, stoneLongitudes, stoneLatitudes, 0.95, 0.85, 0.5, col(p.greyBlue), 0.04));
  w.part(at(0.1, 0.05, 1.25), () => latLong(w, stoneLongitudes, stoneLatitudes, 0.6, 0.55, 0.3, col(p.bone), 0.04));
}

function mobileItem(w: LandmarkWriter, index: number): void {
  const p = landmarkPalette.forest;

  switch (index % mobileItemTriangles.length) {
    case 0:
      discFan(w, flatDiscSegments, 0.6, col(p.red));
      break;
    case 1:
      discFan(w, flatDiscSegments, 0.5, col(p.blue));
      break;
    case 2:
      crescent(w, 0.7, 6, col(p.black));
      break;
    case 3:
      star(w, 0.65, col(p.yellow));
      break;
    default:
      discFan(w, flatDiscSegments, 0.45, col(p.yellow));
  }
}

function emitWireMobile(w: LandmarkWriter, branches: number): void {
  const black = col(landmarkPalette.forest.black);
  const stalkU = (z: number): number => (z < 4 ? (0.35 * z) / 4 : 0.35 * (1 - (z - 4) / 4));

  strut(w, [0, 0, 0], [0.35, 0, 4.0], 0.09, black);
  strut(w, [0.35, 0, 4.0], [0, 0, 8.0], 0.09, black);

  for (let index = 0; index < branches; index += 1) {
    const z = 3.5 + ((index + 0.5) * 4.2) / branches;
    const azimuth = index * 2.4;
    const length = 1.2 + 0.5 * (index % 3);
    const from: Vec3 = [stalkU(z), 0, z];
    const to: Vec3 = [from[0] + length * Math.cos(azimuth), length * Math.sin(azimuth), z + 0.35 * length];
    strut(w, from, to, 0.05, black);
    w.part(at(to[0], to[1], to[2], { yaw: azimuth, rx: quarterTurn }), () => mobileItem(w, index));
  }
}

function emitDiscStalk(w: LandmarkWriter, variant: number, seed: number): void {
  const p = landmarkPalette.forest;
  const random = createSeededRandom((seed ^ 0xd15c) >>> 0);
  const color = col([p.red, p.yellow, p.blue, p.black][Math.floor(random() * 4)]);
  strut(w, [0, 0, 0], [0.2, 0, 2.8], 0.06, col(p.black));

  if (variant === 1) {
    w.part(at(0.2, 0, 2.8, { yaw: random() * Math.PI, rx: quarterTurn }), () => crescent(w, 0.55, 6, color));
  } else {
    w.part(at(0.2, 0, 2.9, { yaw: random() * Math.PI, rx: quarterTurn }), () => discFan(w, flatDiscSegments, 0.45, color));
  }
}

function emitBlob(w: LandmarkWriter, seed: number): void {
  const p = landmarkPalette.forest;
  const red = createSeededRandom((seed ^ 0xb10b) >>> 0)() < 0.5;
  const body = col(red ? p.red : p.black);

  w.part(at(0, 0, 0.45), () => latLong(w, 8, 4, 1.2, 0.7, 0.45, body, 0.08));
  w.part(at(0.4, 0.1, 0.9), () => latLong(w, 8, 3, 0.35, 0.35, 0.9, body, 0.06));
  w.part(at(1.7, 0.5, 0.03), () => discFan(w, flatDiscSegments, 0.25, col(red ? p.black : p.red)));
}

function emitColonnade(w: LandmarkWriter, variant: number): void {
  const p = landmarkPalette.snow;
  const count = colonnadeColumnCount(variant);

  for (let index = 0; index < count; index += 1) {
    const u = colonnadeColumnU(count, index);
    const broken = colonnadeColumnBroken(variant, index);
    const height = broken ? colonnadeStumpHeightMeters(index) : colonnadeShaftHeightMeters;
    w.part(at(u, 0, 0, { yaw: index * 0.4 }), () =>
      frustum(w, 8, 0.45, 0.4, height, col(p.marble), { top: true, apexRise: broken ? 0.3 : 0, altColor: col(p.vein) }),
    );

    if (!broken) {
      w.part(at(u, 0, colonnadeShaftHeightMeters), () => box(w, 1.0, 1.0, 0.25, col(p.marble)));

      if (index + 1 < count && !colonnadeColumnBroken(variant, index + 1)) {
        w.part(at(u + colonnadePitchMeters / 2, 0, colonnadeShaftHeightMeters + 0.25), () =>
          box(w, colonnadePitchMeters, 0.8, 0.35, col(p.vein), true, true),
        );
      }
    }
  }
}

function emitRuinArch(w: LandmarkWriter): void {
  const p = landmarkPalette.snow;

  for (const side of [-1, 1]) {
    w.part(at(2.15 * side, 0, 0), () => box(w, 0.7, 0.9, 3.6, col(p.marble), false));
  }

  w.part(at(0, 0, 3.6), () => ringArch(w, 1.8, 2.5, 0.9, ruinArchSegments, { front: col(p.marble), inner: col(p.vein), outer: col(p.marble) }));
  w.part(at(0.4, 0, 6.1, { ry: (12 * Math.PI) / 180 }), () => box(w, 1.0, 0.9, 0.8, col(p.vein), true, true));
  w.part(at(2.9, 0.7, 0, { yaw: 0.4 }), () => box(w, 0.9, 0.7, 0.6, col(p.marble), true, true));
}

function emitBrokenColumn(w: LandmarkWriter): void {
  const p = landmarkPalette.snow;
  frustum(w, 8, 0.5, 0.45, 1.25, col(p.marble), { top: true, apexRise: 0.25, altColor: col(p.vein) });
  w.part(chain(at(1.1, 0.5, 0.42, { yaw: 0.6, ry: quarterTurn }), at(0, 0, -0.45)), () =>
    frustum(w, 8, 0.42, 0.42, 0.9, col(p.marble), { top: true, bottom: true, altColor: col(p.vein) }),
  );
}

function emitIceSpire(w: LandmarkWriter): void {
  const p = landmarkPalette.snow;
  const spikes = [[0, 0, 3.5, 6], [0.6, 0.25, 2.5, -7], [-0.4, 0.5, 1.8, 5]] as const;

  spikes.forEach(([u, v, height, tilt], index) => {
    w.part(at(u, v, 0.03, { ry: (tilt * Math.PI) / 180 }), () => {
      frustum(w, 5, 0.24, 0.11, height * 0.72, col(p.ice));
      w.part(at(0, 0, height * 0.72), () => cone(w, 5, 0.11, height * 0.28, col(index === 0 ? p.marble : p.ice)));
    });
  });
}

function emitLandmark(w: LandmarkWriter, placement: LandmarkPlacement): void {
  switch (placement.kind) {
    case "arcade":
      return emitArcade(w, placement.variant);
    case "tower":
      return emitTower(w);
    case "plinth":
      return emitPlinth(w, placement.variant);
    case "lone-arch":
      return emitLoneArch(w);
    case "stilt-form":
      return emitStiltForm(w);
    case "crutch-slab":
      return emitCrutchSlab(w);
    case "obelisk":
      return emitObelisk(w);
    case "soft-disc":
      return emitSoftDisc(w);
    case "floating-boulders":
      return emitFloatingBoulders(w, placement);
    case "great-sphere":
      return emitGreatSphere(w);
    case "door-frame":
      return emitDoorFrame(w);
    case "small-floater":
      return emitSmallFloater(w, placement);
    case "pebble-stack":
      return emitPebbleStack(w, placement);
    case "needle":
      return emitNeedle(w);
    case "bone-form":
      return emitBoneForm(w, placement.variant);
    case "pebble-pair":
      return emitPebblePair(w);
    case "wire-mobile":
      return emitWireMobile(w, placement.variant);
    case "disc-stalk":
      return emitDiscStalk(w, placement.variant, placement.seed);
    case "blob":
      return emitBlob(w, placement.seed);
    case "colonnade":
      return emitColonnade(w, placement.variant);
    case "ruin-arch":
      return emitRuinArch(w);
    case "broken-column":
      return emitBrokenColumn(w);
    case "ice-spire":
      return emitIceSpire(w);
  }
}

/** Builds the landmark mesh of a cell (`name = "landmarks:<cellId>"`, `userData.kind = "landmark"`), or undefined when the cell has no landmarks. */
export function buildCellLandmarksMesh(
  cellId: string,
  placements: readonly LandmarkPlacement[],
  shadowAzimuthRadians: number,
): THREE.Mesh | undefined {
  if (placements.length === 0) {
    return undefined;
  }

  const writer = new LandmarkWriter(
    placements.reduce((sum, placement) => sum + landmarkTriangleCount(placement.kind, placement.variant), 0),
    shadowAzimuthRadians,
  );

  for (const placement of placements) {
    const before = writer.cursor;
    writer.begin(placement);
    emitLandmark(writer, placement);
    const emitted = (writer.cursor - before) / 9;

    if (emitted !== landmarkTriangleCount(placement.kind, placement.variant)) {
      throw new Error(`landmark ${placement.kind} (variant ${placement.variant}) emitted ${emitted} triangles, expected ${landmarkTriangleCount(placement.kind, placement.variant)}`);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(writer.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(writer.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(writer.colors, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = `landmarks:${cellId}`;
  mesh.userData = { kind: "landmark", cellId };
  return mesh;
}
