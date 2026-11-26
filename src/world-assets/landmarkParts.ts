/**
 * The primitive kit of generated landmarks (design 018 section 9): a landmark is a list of parts, each a simple solid in the landmark's own frame
 * (`u` right, `v` forward, `w` up, meters, origin on the ground), with a colour and an optional glow.
 *
 * Pure and shared: the theme generators (`faceThemes.ts`) build part lists, the layout (`landmarkLayout.ts`) measures them here (footprint, height,
 * colliders, hovering parts, triangle count), and the mesh builder (`render/three/buildCellLandmarks.ts`) draws exactly the triangles
 * `tessellateParts` returns, so what collides, what throws a shadow and what is drawn cannot drift apart.
 *
 * Shapes (all placed by `at` and turned by `pose`: yaw about `w`, then pitch about the turned `v`, then roll about the turned `u`):
 * - `box`: sizes `sx`, `sy`, `sz`, centred on its origin in `u` and `v`, from 0 to `sz` in `w`; 12 triangles.
 * - `prism`: `sides`-gon frustum from radius `r0` at 0 to `r1` at `h` (a cone when `r1` is 0); sides plus a cap for every non-zero radius.
 * - `ball`: lat-long ellipsoid with radii `rx`, `ry`, `rz` centred on its origin; `wobble` shrinks vertices at random (seeded by `wobbleSeed`).
 * - `ring`: torus arc of radius `radius` and tube `tube` in the `u`-`w` plane (standing, facing `v`), from angle `start` over `arc` radians.
 * - `star`: a flat star (or gear, with inner radius near the outer) of `points` points in the `u`-`w` plane, `thickness` deep along `v`.
 * - `strut`: a square rod of radius `radius` from `from` to `to` (both in the part frame).
 *
 * Every triangle carries a reference point inside its solid; the mesh builder turns the normal away from it before it bakes the light.
 *
 * A part may move ({@link PartMotion}): it turns about an axis through a pivot, in steps that each take a moment and then rest, or
 * continuously. The motion is data that rides on the triangles to the mesh, and the vertex shader turns the part (design 018
 * section 9.9); nothing here moves, and colliders, shadows and the footprint are those of the part at rest.
 * Layer rule: imports only sibling modules.
 */
import { createSeededRandom } from "./seededNoise";

/** A point or vector in a landmark's frame (u, v, w), meters. */
export type Vec3 = readonly [number, number, number];

/** How a part is turned: radians. */
export interface PartPose {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
}

/**
 * How a part moves, in the landmark frame: it turns about `axis` through `pivot` by `step` radians every `period` seconds; each turn
 * takes `move` seconds, eased in and out, and the part rests in between. With `move` at least `period` it turns at a steady
 * `step / period` radians per second. `phase` (seconds) shifts the schedule, so neighbours do not move together.
 */
export interface PartMotion {
  readonly pivot: Vec3;
  /** Unit vector. */
  readonly axis: Vec3;
  readonly step: number;
  readonly period: number;
  readonly move: number;
  readonly phase: number;
}

/** What every part has besides its shape. */
interface PartBase {
  /** Where the part's origin is, in the landmark frame. */
  readonly at: Vec3;
  readonly pose?: PartPose;
  /** sRGB hex colour. */
  readonly color: string;
  /** Glowing parts (lamp bulbs, eyes) are drawn at full brightness, without the baked light. */
  readonly glow?: boolean;
  /** False keeps a part that touches the ground from blocking the player (a hatch lid, a rug). */
  readonly collide?: boolean;
  /** How the part moves; absent for a part that stands still. */
  readonly motion?: PartMotion;
}

/** One part of a landmark. */
export type LandmarkPart =
  | (PartBase & { readonly shape: "box"; readonly sx: number; readonly sy: number; readonly sz: number })
  | (PartBase & { readonly shape: "prism"; readonly sides: number; readonly r0: number; readonly r1: number; readonly h: number; readonly phase?: number })
  | (PartBase & {
      readonly shape: "ball";
      readonly rx: number;
      readonly ry: number;
      readonly rz: number;
      readonly longitudes?: number;
      readonly latitudes?: number;
      readonly wobble?: number;
      readonly wobbleSeed?: number;
    })
  | (PartBase & {
      readonly shape: "ring";
      readonly radius: number;
      readonly tube: number;
      readonly start?: number;
      readonly arc?: number;
      readonly segments?: number;
      readonly tubeSides?: number;
    })
  | (PartBase & { readonly shape: "star"; readonly points: number; readonly outer: number; readonly inner: number; readonly thickness: number })
  | (PartBase & { readonly shape: "strut"; readonly from: Vec3; readonly to: Vec3; readonly radius: number; readonly sides?: number });

/** One triangle of a landmark in its own frame. */
export interface LandmarkTriangle {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  /** A point inside the solid the triangle bounds; the normal points away from it. */
  readonly inside: Vec3;
  readonly color: string;
  readonly glow: boolean;
  /** The part's motion, if it moves. */
  readonly motion?: PartMotion;
}

/** A vertical cylinder of a landmark the player cannot walk into, in the landmark frame. */
export interface LocalLandmarkCollider {
  readonly u: number;
  readonly v: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/** A part that hovers clear of the ground: the point below its centre, its horizontal radius and its top. */
export interface LocalFloatingPart {
  readonly u: number;
  readonly v: number;
  readonly radiusMeters: number;
  readonly topMeters: number;
}

/** What the layout needs to know about a part list. */
export interface LandmarkMeasure {
  /** Radius of the disc around the origin that holds every vertex, meters. */
  readonly footprintRadiusMeters: number;
  /** Height of the highest vertex, meters. */
  readonly heightMeters: number;
  readonly triangles: number;
  readonly colliders: readonly LocalLandmarkCollider[];
  readonly floating: readonly LocalFloatingPart[];
}

/** Collider radius of a thin stalk, strut or leg, meters. */
export const thinColliderRadiusMeters = 0.12;
/** A part whose lowest point is at most this high touches the ground (it may block the player). */
export const groundContactMeters = 0.3;
/** A part touching the ground blocks the player only when its top is at least this high. */
export const colliderMinTopMeters = 0.6;
/** A part whose lowest point is at least this high hovers and throws its own shadow. */
export const floatingMinBottomMeters = 0.8;
/** A hovering part throws a shadow only when its horizontal radius is at least this, meters. */
export const floatingMinRadiusMeters = 0.25;

/** Triangles `tessellatePart` emits for a part. */
export function partTriangleCount(part: LandmarkPart): number {
  switch (part.shape) {
    case "box":
      return 12;
    case "prism":
      return (part.r0 > 0 && part.r1 > 0 ? 2 * part.sides : part.sides) + (part.r0 > 0 ? part.sides : 0) + (part.r1 > 0 ? part.sides : 0);
    case "ball":
      return 2 * (part.longitudes ?? 8) * ((part.latitudes ?? 4) - 1);
    case "ring":
      return 2 * (part.segments ?? 12) * (part.tubeSides ?? 4);
    case "star":
      return 8 * part.points;
    case "strut":
      return 2 * (part.sides ?? 4);
  }
}

/** Triangles of a whole part list. */
export function partsTriangleCount(parts: readonly LandmarkPart[]): number {
  return parts.reduce((sum, part) => sum + partTriangleCount(part), 0);
}

// Rotation matrix (row-major 3x3) of a pose: yaw about w, then pitch about the turned v, then roll about the turned u.
function rotationOf(pose: PartPose | undefined): readonly number[] | undefined {
  if (!pose || (!pose.yaw && !pose.pitch && !pose.roll)) {
    return undefined;
  }

  const [cy, sy] = [Math.cos(pose.yaw ?? 0), Math.sin(pose.yaw ?? 0)];
  const [cp, sp] = [Math.cos(pose.pitch ?? 0), Math.sin(pose.pitch ?? 0)];
  const [cr, sr] = [Math.cos(pose.roll ?? 0), Math.sin(pose.roll ?? 0)];
  // Rz(yaw) * Ry(pitch) * Rx(roll)
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

function placer(part: LandmarkPart): (point: Vec3) => Vec3 {
  const rotation = rotationOf(part.pose);
  const [ox, oy, oz] = part.at;

  if (!rotation) {
    return ([x, y, z]) => [x + ox, y + oy, z + oz];
  }

  const m = rotation;
  return ([x, y, z]) => [ox + m[0] * x + m[1] * y + m[2] * z, oy + m[3] * x + m[4] * y + m[5] * z, oz + m[6] * x + m[7] * y + m[8] * z];
}

/** The triangles of one part, in the landmark frame. */
export function tessellatePart(part: LandmarkPart): readonly LandmarkTriangle[] {
  const place = placer(part);
  const glow = part.glow === true;
  const out: LandmarkTriangle[] = [];
  const motion = part.motion;
  const tri = (a: Vec3, b: Vec3, c: Vec3, inside: Vec3) =>
    out.push({ a: place(a), b: place(b), c: place(c), inside: place(inside), color: part.color, glow, ...(motion ? { motion } : {}) });
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, inside: Vec3) => {
    tri(a, b, c, inside);
    tri(a, c, d, inside);
  };

  switch (part.shape) {
    case "box": {
      const x = part.sx / 2;
      const y = part.sy / 2;
      const z = part.sz;
      const lower: Vec3[] = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]];
      const upper: Vec3[] = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
      const inside: Vec3 = [0, 0, z / 2];

      for (let index = 0; index < 4; index += 1) {
        const next = (index + 1) % 4;
        quad(lower[index], lower[next], upper[next], upper[index], inside);
      }

      quad(upper[0], upper[1], upper[2], upper[3], inside);
      quad(lower[0], lower[3], lower[2], lower[1], inside);
      break;
    }
    case "prism": {
      const { sides, r0, r1, h } = part;
      const phase = part.phase ?? 0;
      const ring = (radius: number, z: number): Vec3[] =>
        Array.from({ length: sides }, (_, index) => {
          const angle = phase + (index / sides) * Math.PI * 2;
          return [radius * Math.cos(angle), radius * Math.sin(angle), z];
        });
      const lower = ring(r0, 0);
      const upper = ring(r1, h);
      const inside: Vec3 = [0, 0, h / 2];

      for (let index = 0; index < sides; index += 1) {
        const next = (index + 1) % sides;

        if (r0 > 0 && r1 > 0) {
          quad(lower[index], lower[next], upper[next], upper[index], inside);
        } else if (r1 > 0) {
          tri([0, 0, 0], upper[next], upper[index], inside);
        } else {
          tri(lower[index], lower[next], [0, 0, h], [0, 0, h * 0.3]);
        }

        if (r0 > 0) {
          tri(lower[index], [0, 0, 0], lower[next], inside);
        }

        if (r1 > 0) {
          tri(upper[index], upper[next], [0, 0, h], inside);
        }
      }
      break;
    }
    case "ball": {
      const longitudes = part.longitudes ?? 8;
      const latitudes = part.latitudes ?? 4;
      const random = part.wobble ? createSeededRandom(part.wobbleSeed ?? 1) : undefined;
      const rings: Vec3[][] = [];

      for (let ring = 0; ring <= latitudes; ring += 1) {
        const phi = (ring / latitudes) * Math.PI;
        const z = -Math.cos(phi);
        const radius = Math.sin(phi);
        const row: Vec3[] = [];
        const count = ring === 0 || ring === latitudes ? 1 : longitudes;

        for (let index = 0; index < count; index += 1) {
          const theta = (index / longitudes) * Math.PI * 2;
          const shrink = random ? 1 - (part.wobble ?? 0) * random() : 1;
          row.push([part.rx * radius * Math.cos(theta) * shrink, part.ry * radius * Math.sin(theta) * shrink, part.rz * z * shrink]);
        }

        rings.push(row);
      }

      const inside: Vec3 = [0, 0, 0];

      for (let index = 0; index < longitudes; index += 1) {
        const next = (index + 1) % longitudes;
        tri(rings[0][0], rings[1][next], rings[1][index], inside);
        tri(rings[latitudes][0], rings[latitudes - 1][index], rings[latitudes - 1][next], inside);

        for (let ring = 1; ring < latitudes - 1; ring += 1) {
          quad(rings[ring][index], rings[ring][next], rings[ring + 1][next], rings[ring + 1][index], inside);
        }
      }
      break;
    }
    case "ring": {
      const segments = part.segments ?? 12;
      const tubeSides = part.tubeSides ?? 4;
      const start = part.start ?? 0;
      const arc = part.arc ?? Math.PI * 2;

      const point = (step: number, side: number): Vec3 => {
        const theta = start + (step / segments) * arc;
        const phi = (side / tubeSides) * Math.PI * 2 + Math.PI / tubeSides;
        const radius = part.radius + part.tube * Math.cos(phi);
        return [radius * Math.cos(theta), part.tube * Math.sin(phi), radius * Math.sin(theta)];
      };

      for (let step = 0; step < segments; step += 1) {
        const middle = start + ((step + 0.5) / segments) * arc;
        const inside: Vec3 = [part.radius * Math.cos(middle), 0, part.radius * Math.sin(middle)];

        for (let side = 0; side < tubeSides; side += 1) {
          quad(point(step, side), point(step + 1, side), point(step + 1, side + 1), point(step, side + 1), inside);
        }
      }
      break;
    }
    case "star": {
      const count = part.points * 2;
      const y = part.thickness / 2;
      const outline = Array.from({ length: count }, (_, index) => {
        const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
        const radius = index % 2 === 0 ? part.outer : part.inner;
        return [radius * Math.cos(angle), radius * Math.sin(angle)] as const;
      });
      const inside: Vec3 = [0, 0, 0];

      for (let index = 0; index < count; index += 1) {
        const [ax, az] = outline[index];
        const [bx, bz] = outline[(index + 1) % count];
        tri([ax, -y, az], [bx, -y, bz], [0, -y, 0], inside);
        tri([ax, y, az], [0, y, 0], [bx, y, bz], inside);
        quad([ax, -y, az], [ax, y, az], [bx, y, bz], [bx, -y, bz], inside);
      }
      break;
    }
    case "strut": {
      const sides = part.sides ?? 4;
      const [ax, ay, az] = part.from;
      const [bx, by, bz] = part.to;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const length = Math.hypot(dx, dy, dz) || 1;
      const axis: Vec3 = [dx / length, dy / length, dz / length];
      // Any vector not parallel to the axis gives the two directions across it.
      const helper: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const across1 = normalize(cross(axis, helper));
      const across2 = cross(axis, across1);
      const offsets = Array.from({ length: sides }, (_, index) => {
        const angle = (index / sides) * Math.PI * 2 + Math.PI / sides;
        const c = Math.cos(angle) * part.radius;
        const s = Math.sin(angle) * part.radius;
        return [across1[0] * c + across2[0] * s, across1[1] * c + across2[1] * s, across1[2] * c + across2[2] * s] as const;
      });
      const inside: Vec3 = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];

      for (let index = 0; index < sides; index += 1) {
        const o = offsets[index];
        const p = offsets[(index + 1) % sides];
        quad([ax + o[0], ay + o[1], az + o[2]], [ax + p[0], ay + p[1], az + p[2]], [bx + p[0], by + p[1], bz + p[2]], [bx + o[0], by + o[1], bz + o[2]], inside);
      }
      break;
    }
  }

  return out;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

/** The triangles of a part list, in the landmark frame, in part order. */
export function tessellateParts(parts: readonly LandmarkPart[]): readonly LandmarkTriangle[] {
  return parts.flatMap(tessellatePart);
}

/** Measures a part list: footprint, height, triangles, the colliders of the parts that stand on the ground and the parts that hover. */
export function measureParts(parts: readonly LandmarkPart[]): LandmarkMeasure {
  let footprint = 0;
  let height = 0;
  let triangles = 0;
  const colliders: LocalLandmarkCollider[] = [];
  const floating: LocalFloatingPart[] = [];

  for (const part of parts) {
    const tris = tessellatePart(part);
    triangles += tris.length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;

    for (const triangle of tris) {
      for (const [u, v, w] of [triangle.a, triangle.b, triangle.c]) {
        footprint = Math.max(footprint, Math.hypot(u, v));
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
        bottom = Math.min(bottom, w);
        top = Math.max(top, w);
      }
    }

    height = Math.max(height, top);
    const centreU = (minU + maxU) / 2;
    const centreV = (minV + maxV) / 2;
    const radius = Math.hypot(maxU - minU, maxV - minV) / 2;

    if (bottom <= groundContactMeters && top >= colliderMinTopMeters && part.collide !== false) {
      if (part.shape === "strut") {
        // A strut blocks at its foot only: a leg or a post, not the whole span of a slanted rod.
        const foot = part.from[2] <= part.to[2] ? part.from : part.to;
        const [u, v] = placer(part)(foot);
        colliders.push({ u, v, radiusMeters: Math.max(thinColliderRadiusMeters, part.radius), heightMeters: top });
      } else {
        colliders.push({ u: centreU, v: centreV, radiusMeters: Math.max(thinColliderRadiusMeters, radius), heightMeters: top });
      }
    } else if (bottom >= floatingMinBottomMeters && radius >= floatingMinRadiusMeters && part.shape !== "strut") {
      floating.push({ u: centreU, v: centreV, radiusMeters: radius, topMeters: top });
    }
  }

  return { footprintRadiusMeters: footprint, heightMeters: height, triangles, colliders, floating };
}
