/**
 * Creature bodies generated in code, in the low-poly surrealist style of design 018 section 8.1: a stilt-walker (Dali), a drifting mobile (Miro) and a rolling eye (Magritte, Tanguy).
 * Each body is ONE merged non-indexed mesh with flat normals and baked vertex colours (light from a fixed direction), drawn with a stock `MeshLambertMaterial` so the portal-clip shader patch applies to it like to any glTF material.
 * Orientation matches the glTF creature roots: the model's up is +y and its front is +z (the creature view turns the model half a turn about y, which brings +z to the creature's forward direction), the origin is on the floor under the body for the walker and the eye, and in the middle of the wire for the mobile.
 * Units are meters. The shapes depend only on `kind` and `seed` (a seeded random generator, never `Math.random`), so a world looks the same on every visit.
 */
import * as THREE from "three";
import type { GeneratedCreatureKind } from "../../../cell-complex/specs";
import { createSeededRandom } from "../../../world-assets/seededNoise";

/** The most triangles each generated body may use (design 018 section 8.5). */
export const generatedCreatureTriangleBudget: Readonly<Record<GeneratedCreatureKind, number>> = {
  "stilt-walker": 220,
  "drifting-mobile": 80,
  "rolling-eye": 120,
};

type Vec = readonly [number, number, number];

// Light direction baked into the colours: from above and a little to the side, the same for every creature.
const bakedLight = new THREE.Vector3(0.4, 0.8, 0.45).normalize();

/** Collects flat-shaded, coloured triangles and turns them into one geometry. */
class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly color = new THREE.Color();

  /** Adds one triangle with its own flat normal (from the winding) and colour, shaded by the baked light. */
  triangle(a: Vec, b: Vec, c: Vec, hex: string): void {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const vc = new THREE.Vector3(...c);
    const normal = vb.clone().sub(va).cross(vc.clone().sub(va));
    if (normal.lengthSq() < 1e-14) {
      return;
    }
    normal.normalize();
    // Two-sided surfaces are lit from either face, so a flat disc looks the same from both sides.
    const shade = 0.62 + 0.38 * Math.abs(normal.dot(bakedLight));
    this.color.set(hex).multiplyScalar(shade);
    for (const vertex of [va, vb, vc]) {
      this.positions.push(vertex.x, vertex.y, vertex.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(this.color.r, this.color.g, this.color.b);
    }
  }

  /** Adds a quad as two triangles. */
  quad(a: Vec, b: Vec, c: Vec, d: Vec, hex: string): void {
    this.triangle(a, b, c, hex);
    this.triangle(a, c, d, hex);
  }

  /** Adds a closed triangular prism of the given thickness between two points (a thin stick: six triangles). */
  stick(from: Vec, to: Vec, thickness: number, hex: string): void {
    const axis = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const helper = Math.abs(axis.y) < 0.9 * axis.length() ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = axis.clone().cross(helper).normalize().multiplyScalar(thickness / 2);
    const v = axis.clone().normalize().cross(u).normalize().multiplyScalar(thickness / 2);
    const ring = [0, 1, 2].map((index) => {
      const angle = (index * 2 * Math.PI) / 3;
      return u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
    });
    const at = (point: Vec, offset: THREE.Vector3): Vec => [point[0] + offset.x, point[1] + offset.y, point[2] + offset.z];
    for (let index = 0; index < 3; index += 1) {
      const next = (index + 1) % 3;
      this.quad(at(from, ring[index]), at(from, ring[next]), at(to, ring[next]), at(to, ring[index]), hex);
    }
  }

  /** Adds a flat polygon fan (a disc) around `centre`, spanned by the unit vectors `u` and `v`, with `sides` triangles. */
  disc(centre: Vec, u: Vec, v: Vec, radius: number, sides: number, hex: string): void {
    const point = (index: number): Vec => {
      const angle = (index * 2 * Math.PI) / sides;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      return [centre[0] + u[0] * c + v[0] * s, centre[1] + u[1] * c + v[1] * s, centre[2] + u[2] * c + v[2] * s];
    };
    for (let index = 0; index < sides; index += 1) {
      this.triangle(centre, point(index), point(index + 1), hex);
    }
  }

  /** Adds a flat ring between two radii, `2 * sides` triangles. */
  ring(centre: Vec, u: Vec, v: Vec, inner: number, outer: number, sides: number, hex: string): void {
    const point = (index: number, radius: number): Vec => {
      const angle = (index * 2 * Math.PI) / sides;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      return [centre[0] + u[0] * c + v[0] * s, centre[1] + u[1] * c + v[1] * s, centre[2] + u[2] * c + v[2] * s];
    };
    for (let index = 0; index < sides; index += 1) {
      this.quad(point(index, inner), point(index, outer), point(index + 1, outer), point(index + 1, inner), hex);
    }
  }

  /**
   * Adds a faceted ellipsoid of `radii` around `centre` (`segments` meridians, `rings` latitude bands, poles on the y axis) whose vertices are
   * pushed in or out by up to `jitter` (a fraction) using `random`. A band below `belowY` (in unit-sphere height) gets `lowerHex`.
   */
  ellipsoid(centre: Vec, radii: Vec, segments: number, rings: number, jitter: number, random: () => number, upperHex: string, lowerHex: string): void {
    const grid: Vec[][] = [];
    for (let ring = 0; ring <= rings; ring += 1) {
      const polar = (ring * Math.PI) / rings;
      const row: Vec[] = [];
      const columns = ring === 0 || ring === rings ? 1 : segments;
      const scale = ring === 0 || ring === rings ? 1 : 1 + (random() - 0.5) * 2 * jitter;
      for (let column = 0; column < columns; column += 1) {
        const angle = (column * 2 * Math.PI) / segments;
        row.push([
          centre[0] + radii[0] * Math.sin(polar) * Math.cos(angle) * scale,
          centre[1] + radii[1] * Math.cos(polar) * scale,
          centre[2] + radii[2] * Math.sin(polar) * Math.sin(angle) * scale,
        ]);
      }
      grid.push(row);
    }
    const hexAt = (a: Vec, b: Vec, c: Vec): string => ((a[1] + b[1] + c[1]) / 3 < centre[1] - radii[1] * 0.25 ? lowerHex : upperHex);
    for (let ring = 0; ring < rings; ring += 1) {
      for (let column = 0; column < segments; column += 1) {
        const next = (column + 1) % segments;
        const top = grid[ring];
        const bottom = grid[ring + 1];
        if (ring === 0) {
          this.oriented(top[0], bottom[next], bottom[column], hexAt);
        } else if (ring === rings - 1) {
          this.oriented(top[column], top[next], bottom[0], hexAt);
        } else {
          this.oriented(top[column], bottom[next], bottom[column], hexAt);
          this.oriented(top[column], top[next], bottom[next], hexAt);
        }
      }
    }
  }

  private oriented(a: Vec, b: Vec, c: Vec, hexAt: (a: Vec, b: Vec, c: Vec) => string): void {
    this.triangle(a, b, c, hexAt(a, b, c));
  }

  /** Adds a faceted sphere from a subdivided icosahedron, vertices moved by up to `jitter` using `random`. */
  icoSphere(centre: Vec, radius: number, subdivisions: number, jitter: number, random: () => number, hex: string): void {
    const phi = (1 + Math.sqrt(5)) / 2;
    const base: Vec[] = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ];
    const faces: ReadonlyArray<readonly [number, number, number]> = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const unit = (p: Vec): Vec => {
      const length = Math.hypot(p[0], p[1], p[2]);
      return [p[0] / length, p[1] / length, p[2] / length];
    };
    const middle = (a: Vec, b: Vec): Vec => unit([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    let triangles: Array<readonly [Vec, Vec, Vec]> = faces.map(([a, b, c]) => [unit(base[a]), unit(base[b]), unit(base[c])]);
    for (let level = 0; level < subdivisions; level += 1) {
      triangles = triangles.flatMap(([a, b, c]) => {
        const ab = middle(a, b);
        const bc = middle(b, c);
        const ca = middle(c, a);
        return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as Array<readonly [Vec, Vec, Vec]>;
      });
    }
    // One radius per distinct vertex, so shared vertices stay shared.
    const radii = new Map<string, number>();
    const place = (p: Vec): Vec => {
      const key = p.map((value) => value.toFixed(5)).join(",");
      let scale = radii.get(key);
      if (scale === undefined) {
        scale = 1 + (random() - 0.5) * 2 * jitter;
        radii.set(key, scale);
      }
      return [centre[0] + p[0] * radius * scale, centre[1] + p[1] * radius * scale, centre[2] + p[2] * radius * scale];
    };
    for (const [a, b, c] of triangles) {
      this.triangle(place(a), place(b), place(c), hex);
    }
  }

  /** The merged geometry: non-indexed, with position, normal and colour attributes. */
  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const bone = "#e6dcc3";
const sienna = "#a5482c";
const nearBlack = "#2b2320";

// The stilt-walker: a small faceted body 2.6 to 3.2 m up on four very long thin legs with one knee each, and an obelisk or a pennant on its back.
function addStiltWalker(soup: TriangleSoup, random: () => number): void {
  const bodyHeight = 2.8 + random() * 0.3;
  // 8 meridians and 5 latitude bands: 64 triangles, about 0.9 m long.
  soup.ellipsoid([0, bodyHeight, 0], [0.3, 0.25, 0.45], 8, 5, 0.06, random, bone, sienna);
  const hipY = bodyHeight - 0.18;
  for (const [sideX, sideZ] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const hip: Vec = [sideX * 0.2, hipY, sideZ * 0.28];
    const splay = 0.12 + random() * 0.06;
    const knee: Vec = [sideX * (0.2 + splay), hipY * (0.52 + random() * 0.06), sideZ * (0.28 + splay)];
    const foot: Vec = [sideX * (0.2 + 2.4 * splay), 0.02, sideZ * (0.28 + 2.4 * splay)];
    soup.stick(hip, knee, 0.04, nearBlack);
    soup.stick(knee, foot, 0.04, nearBlack);
  }
  const topY = bodyHeight + 0.22;
  if (random() < 0.5) {
    // A tiny obelisk: a tapered four-sided shaft with a pyramid tip.
    const base = 0.07;
    const tip = 0.03;
    const shaft = 0.32;
    const lower: Vec[] = [[-base, topY, -base], [base, topY, -base], [base, topY, base], [-base, topY, base]];
    const upper: Vec[] = [[-tip, topY + shaft, -tip], [tip, topY + shaft, -tip], [tip, topY + shaft, tip], [-tip, topY + shaft, tip]];
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      soup.quad(lower[index], lower[next], upper[next], upper[index], bone);
      soup.triangle(upper[index], upper[next], [0, topY + shaft + 0.08, 0], sienna);
    }
  } else {
    // A pennant on a thin pole.
    soup.stick([0, topY - 0.02, 0], [0, topY + 0.55, 0], 0.025, nearBlack);
    soup.triangle([0, topY + 0.55, 0], [0, topY + 0.3, 0], [0.38, topY + 0.42, 0.04], sienna);
  }
}

// The drifting mobile: a thin black wire, three flat discs on short arms at different heights, a black crescent on top.
function addDriftingMobile(soup: TriangleSoup, random: () => number): void {
  const black = "#161616";
  const bottom = -0.8;
  const top = 0.8;
  soup.stick([0, bottom, 0], [0, top, 0], 0.02, black);
  const discs = [
    { colour: "#d2362b", radius: 0.28, height: bottom + 0.35 },
    { colour: "#f2c230", radius: 0.2, height: bottom + 0.85 },
    { colour: "#2456a6", radius: 0.16, height: bottom + 1.3 },
  ];
  const firstAngle = random() * Math.PI * 2;
  discs.forEach((disc, index) => {
    const angle = firstAngle + (index * 2 * Math.PI) / 3 + (random() - 0.5) * 0.4;
    const armLength = 0.3 + random() * 0.12;
    const out: Vec = [Math.cos(angle), 0, Math.sin(angle)];
    const end: Vec = [out[0] * armLength, disc.height, out[2] * armLength];
    soup.stick([0, disc.height, 0], end, 0.02, black);
    // The disc stands in the vertical plane that holds the arm, its centre a radius further out.
    const centre: Vec = [out[0] * (armLength + disc.radius), disc.height, out[2] * (armLength + disc.radius)];
    soup.disc(centre, out, [0, 1, 0], disc.radius, 8, disc.colour);
  });
  // The crescent: an arc whose width tapers to nothing at both tips, lying in a vertical plane on top of the wire.
  const outerRadius = 0.22;
  const steps = 10;
  const crescentCentre: Vec = [0, top + 0.1, 0];
  const point = (step: number, inset: number): Vec => {
    const angle = Math.PI * 0.15 + (step / steps) * Math.PI * 1.7;
    const radius = outerRadius - inset;
    return [crescentCentre[0] + Math.cos(angle) * radius, crescentCentre[1] + Math.sin(angle) * radius, 0];
  };
  for (let step = 0; step < steps; step += 1) {
    const width = (s: number): number => 0.01 + 0.1 * Math.sin((s / steps) * Math.PI);
    soup.quad(point(step, 0), point(step + 1, 0), point(step + 1, width(step + 1)), point(step, width(step)), black);
  }
}

// The rolling eye: a pale faceted sphere resting on the ground with a dark pupil on a slate ring on its front (+z).
function addRollingEye(soup: TriangleSoup, random: () => number): void {
  const radius = 0.3;
  soup.icoSphere([0, radius, 0], radius, 1, 0.03, random, "#e9e6dc");
  const plateZ = radius * 0.985;
  const across: Vec = [1, 0, 0];
  const up: Vec = [0, 1, 0];
  soup.ring([0, radius, plateZ], across, up, 0.09, 0.16, 10, "#4a5a6a");
  soup.disc([0, radius, plateZ + 0.01], across, up, 0.09, 10, "#15181c");
}

/**
 * Builds the body of a generated creature: a group holding one merged vertex-coloured mesh (`MeshLambertMaterial` with `vertexColors` and `DoubleSide`).
 * The same `kind` and `seed` always give the same shape. Up is +y and the front is +z, ready for the creature view's placement; see the module comment for the origin of each kind.
 */
export function buildGeneratedCreatureRoot(kind: GeneratedCreatureKind, seed: number): THREE.Object3D {
  const random = createSeededRandom(seed);
  const soup = new TriangleSoup();
  switch (kind) {
    case "stilt-walker":
      addStiltWalker(soup, random);
      break;
    case "drifting-mobile":
      addDriftingMobile(soup, random);
      break;
    case "rolling-eye":
      addRollingEye(soup, random);
      break;
  }

  const mesh = new THREE.Mesh(
    soup.toGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  mesh.name = `generated-creature:${kind}`;
  const group = new THREE.Group();
  group.name = `generated-creature-root:${kind}`;
  group.add(mesh);
  return group;
}
