/**
 * Builds the merged scenery mesh of one cell: every prop of `computeSceneryLayout` as a few flat-shaded, vertex-coloured triangles.
 *
 * The mesh has one non-indexed geometry with `position`, `normal` and `color` only, authored directly in the cell mesh's three.js axes
 * (cell-local (x, y, height) becomes (x, height, -y), the floor is at height 0), and a stock `MeshLambertMaterial` so the portal clip patch
 * (which rewrites chunks of the stock shaders) applies to it. Shapes are tiny and low-poly on purpose; each kind emits exactly
 * `sceneryTrianglesByKind[kind]` triangles. Per-prop jitter comes from `createSeededRandom` seeded by the cell id and the prop index, so the
 * mesh is the same on every machine. The mesh is tagged `userData.kind = "scenery"`, which the archetype pipeline instances over portal copies.
 */

import * as THREE from "three";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import { computeSceneryLayout, sceneryTrianglesByKind, type SceneryProp, type SceneryPropKind } from "../../world-assets/sceneryLayout";
import { createSeededRandom, hashStringToSeed } from "../../world-assets/seededNoise";

/**
 * Colours of one prop kind as sRGB hex pairs; `tone` 0 gives the first of each pair and `tone` 1 the second.
 * `base` is the foot of blades and the main body, `tip` the top of blades and the apex of domes, `accent` a second part
 * (daisy petals, mushroom cap, shrub blades, succulent tips, snow-mound foot). Muted on purpose: tools stay the brightest things.
 */
export interface SceneryColors {
  readonly base: readonly [string, string];
  readonly tip: readonly [string, string];
  readonly accent: readonly [string, string];
}

/** The scenery palette: one entry per prop kind. Edit here to tune the look. */
export const sceneryPalette: Record<SceneryPropKind, SceneryColors> = {
  "grass-tuft": { base: ["#3d5a2a", "#4a6230"], tip: ["#8aa653", "#a2b45f"], accent: ["#8aa653", "#a2b45f"] },
  "dark-tuft": { base: ["#2a4025", "#30462a"], tip: ["#4f7242", "#5a7a46"], accent: ["#4f7242", "#5a7a46"] },
  "dry-tuft": { base: ["#8a7a48", "#9a8654"], tip: ["#cdbb82", "#d8c690"], accent: ["#cdbb82", "#d8c690"] },
  daisy: { base: ["#43602e", "#4a6a34"], tip: ["#6f8f48", "#7a9650"], accent: ["#e8e4d6", "#d9b84a"] },
  fern: { base: ["#2f5a34", "#386438"], tip: ["#6c9a58", "#7ba660"], accent: ["#6c9a58", "#7ba660"] },
  mushroom: { base: ["#d8cfb8", "#cfc2a6"], tip: ["#a45a42", "#c09050"], accent: ["#8a4a38", "#b87a4a"] },
  twig: { base: ["#4a3a2a", "#5a4632"], tip: ["#5a4632", "#6a5440"], accent: ["#4a3a2a", "#5a4632"] },
  stone: { base: ["#6f6f68", "#7d7a70"], tip: ["#8e8c82", "#9a968a"], accent: ["#6f6f68", "#7d7a70"] },
  "pale-stone": { base: ["#b4a98c", "#c2b799"], tip: ["#d4caae", "#ddd4ba"], accent: ["#b4a98c", "#c2b799"] },
  "red-rock": { base: ["#7a3f30", "#8a4a36"], tip: ["#a5624a", "#b0704f"], accent: ["#7a3f30", "#8a4a36"] },
  reed: { base: ["#6a7a3c", "#778446"], tip: ["#6a5230", "#7a6038"], accent: ["#6a5230", "#7a6038"] },
  succulent: { base: ["#6f8a6a", "#7a9674"], tip: ["#9ab08a", "#a4b894"], accent: ["#b88a8a", "#c09a8a"] },
  shrub: { base: ["#2c3f27", "#34492c"], tip: ["#3f5a35", "#48653a"], accent: ["#7a8f48", "#86984e"] },
  "snow-mound": { base: ["#f2f4f8", "#f6f8fb"], tip: ["#fbfcfe", "#ffffff"], accent: ["#b9c8dc", "#c4d2e4"] },
  "ice-crystal": { base: ["#a9c6d8", "#b7d2e0"], tip: ["#dcecf4", "#e6f2f8"], accent: ["#a9c6d8", "#b7d2e0"] },
};

type Vec3 = readonly [number, number, number];

const colorCache = new Map<string, THREE.Color>();

// Parses a hex colour once; THREE.Color converts sRGB to the linear working space, which is what vertex colours hold.
function cachedColor(hex: string): THREE.Color {
  let color = colorCache.get(hex);

  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }

  return color;
}

function paletteColor(kind: SceneryPropKind, part: keyof SceneryColors, tone: number, brightness = 1): THREE.Color {
  const pair = sceneryPalette[kind][part];
  const color = cachedColor(pair[0]).clone().lerp(cachedColor(pair[1]), tone);
  return color.multiplyScalar(brightness);
}

// Writes triangles of one prop in prop-local coordinates (u, v, w) = (right, forward, up) in meters at scale 1.
class SceneryWriter {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  private cursor = 0;
  private cx = 0;
  private cy = 0;
  private cos = 1;
  private sin = 0;
  scale = 1;

  constructor(triangles: number) {
    this.positions = new Float32Array(triangles * 9);
    this.normals = new Float32Array(triangles * 9);
    this.colors = new Float32Array(triangles * 9);
  }

  setProp(prop: SceneryProp): void {
    this.cx = prop.x;
    this.cy = prop.y;
    this.cos = Math.cos(prop.yawRadians);
    this.sin = Math.sin(prop.yawRadians);
    this.scale = prop.scale;
  }

  // Emits one triangle; the normal follows from the winding and the shader flips it on back faces (the material is double-sided).
  tri(a: Vec3, b: Vec3, c: Vec3, colorA: THREE.Color, colorB: THREE.Color, colorC: THREE.Color): void {
    const start = this.cursor;
    this.place(a, start);
    this.place(b, start + 3);
    this.place(c, start + 6);
    const p = this.positions;
    const e1x = p[start + 3] - p[start];
    const e1y = p[start + 4] - p[start + 1];
    const e1z = p[start + 5] - p[start + 2];
    const e2x = p[start + 6] - p[start];
    const e2y = p[start + 7] - p[start + 1];
    const e2z = p[start + 8] - p[start + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);

    if (length < 1e-12) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    const colors = [colorA, colorB, colorC];

    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = start + vertex * 3;
      this.normals[offset] = nx;
      this.normals[offset + 1] = ny;
      this.normals[offset + 2] = nz;
      this.colors[offset] = colors[vertex].r;
      this.colors[offset + 1] = colors[vertex].g;
      this.colors[offset + 2] = colors[vertex].b;
    }

    this.cursor += 9;
  }

  // Prop-local (u, v, w) to cell-local (x, y, height) to three (x, height, -y).
  private place(point: Vec3, offset: number): void {
    const u = point[0] * this.scale;
    const v = point[1] * this.scale;
    this.positions[offset] = this.cx + u * this.cos - v * this.sin;
    this.positions[offset + 1] = point[2] * this.scale;
    this.positions[offset + 2] = -(this.cy + u * this.sin + v * this.cos);
  }
}

/**
 * Builds the scenery mesh of `cell`, or undefined when the cell grows nothing (no biome, a flat-colour floor).
 * The geometry belongs to the caller (disposed with the cell mesh); the material is new per mesh.
 */
export function buildCellSceneryMesh(cell: CompiledPrismCell): THREE.Mesh | undefined {
  const props = computeSceneryLayout(cell);

  if (props.length === 0) {
    return undefined;
  }

  const seed = hashStringToSeed(cell.id);
  const writer = new SceneryWriter(props.reduce((sum, prop) => sum + sceneryTrianglesByKind[prop.kind], 0));

  props.forEach((prop, index) => {
    writer.setProp(prop);
    emitProp(writer, prop, createSeededRandom((seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0));
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(writer.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(writer.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(writer.colors, 3));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = `scenery:${cell.id}`;
  mesh.userData = { kind: "scenery", cellId: cell.id };
  return mesh;
}

function emitProp(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  switch (prop.kind) {
    case "grass-tuft":
      emitBlades(writer, prop, random, { count: 5, minHeight: 0.18, maxHeight: 0.35, minLean: 0.25, maxLean: 0.55, width: 0.035 });
      break;
    case "dark-tuft":
      emitBlades(writer, prop, random, { count: 4, minHeight: 0.15, maxHeight: 0.28, minLean: 0.2, maxLean: 0.45, width: 0.04 });
      break;
    case "dry-tuft":
      emitBlades(writer, prop, random, { count: 5, minHeight: 0.15, maxHeight: 0.3, minLean: 0.3, maxLean: 0.6, width: 0.03 });
      break;
    case "reed":
      emitBlades(writer, prop, random, { count: 3, minHeight: 0.4, maxHeight: 0.6, minLean: 0.1, maxLean: 0.25, width: 0.025 });
      break;
    case "daisy":
      emitDaisy(writer, prop, random);
      break;
    case "fern":
      emitFern(writer, prop, random);
      break;
    case "mushroom":
      emitMushroom(writer, prop, random);
      break;
    case "twig":
      emitTwig(writer, prop, random);
      break;
    case "stone":
    case "pale-stone":
      emitRock(writer, prop, random, { sides: 6, minRadius: 0.09, maxRadius: 0.19, heightRatio: 0.55, jitter: 0.15, sink: 0.01 });
      break;
    case "red-rock":
      emitRock(writer, prop, random, { sides: 4, minRadius: 0.08, maxRadius: 0.17, heightRatio: 1.3, jitter: 0.3, sink: 0.02 });
      break;
    case "succulent":
      emitSucculent(writer, prop, random);
      break;
    case "shrub":
      emitShrub(writer, prop, random);
      break;
    case "snow-mound":
      emitSnowMound(writer, prop, random);
      break;
    case "ice-crystal":
      emitIceCrystal(writer, prop, random);
      break;
  }
}

function range(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

interface BladeSpec {
  readonly count: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Horizontal reach of the tip as a fraction of the blade height. */
  readonly minLean: number;
  readonly maxLean: number;
  readonly width: number;
}

// Thin tapered blades (one triangle each) fanning out from the centre; dark at the base, light at the tip (reeds are the other way round by palette).
function emitBlades(writer: SceneryWriter, prop: SceneryProp, random: () => number, spec: BladeSpec): void {
  for (let index = 0; index < spec.count; index += 1) {
    const angle = ((index + random() * 0.6) / spec.count) * Math.PI * 2;
    const height = range(random, spec.minHeight, spec.maxHeight);
    const reach = height * range(random, spec.minLean, spec.maxLean);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const half = (spec.width * range(random, 0.8, 1.2)) / 2;
    const base = paletteColor(prop.kind, "base", prop.tone, range(random, 0.9, 1.1));
    const tip = paletteColor(prop.kind, "tip", prop.tone, range(random, 0.9, 1.1));
    writer.tri(
      [0.02 * dx - half * dy, 0.02 * dy + half * dx, 0],
      [0.02 * dx + half * dy, 0.02 * dy - half * dx, 0],
      [0.02 * dx + reach * dx, 0.02 * dy + reach * dy, height],
      base,
      base,
      tip,
    );
  }
}

// A thin stem triangle and a flat four-triangle head (white below tone 0.5, yellow above) with a golden centre.
function emitDaisy(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const headHeight = range(random, 0.17, 0.24);
  const headX = range(random, -0.03, 0.03);
  const headY = range(random, -0.03, 0.03);
  const stemBase = paletteColor("daisy", "base", prop.tone);
  const stemTip = paletteColor("daisy", "tip", prop.tone);
  writer.tri([-0.006, 0, 0], [0.006, 0, 0], [headX, headY, headHeight], stemBase, stemBase, stemTip);

  const petals = paletteColor("daisy", "accent", prop.tone < 0.5 ? 0 : 1);
  const centre = cachedColor("#c9a43c");
  const radius = range(random, 0.045, 0.06);
  const phase = random() * Math.PI;
  const tilt = range(random, -0.02, 0.02);

  for (let index = 0; index < 4; index += 1) {
    const a = phase + (index * Math.PI) / 2;
    const b = phase + ((index + 1) * Math.PI) / 2;
    writer.tri(
      [headX, headY, headHeight + 0.012],
      [headX + radius * Math.cos(a), headY + radius * Math.sin(a), headHeight + tilt * Math.cos(a)],
      [headX + radius * Math.cos(b), headY + radius * Math.sin(b), headHeight + tilt * Math.cos(b)],
      centre,
      petals,
      petals,
    );
  }
}

// Four arched fronds: a wide lower triangle rising from the foot and a drooping tip triangle.
function emitFern(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  for (let index = 0; index < 4; index += 1) {
    const angle = ((index + random() * 0.5) / 4) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const midReach = range(random, 0.07, 0.1);
    const midHeight = range(random, 0.11, 0.16);
    const tipReach = midReach + range(random, 0.08, 0.11);
    const tipHeight = midHeight - range(random, 0.02, 0.06);
    const half = range(random, 0.025, 0.04);
    const base = paletteColor("fern", "base", prop.tone);
    const mid = paletteColor("fern", "base", Math.min(1, prop.tone + 0.3), 1.25);
    const tip = paletteColor("fern", "tip", prop.tone);
    const left: Vec3 = [midReach * dx - half * dy, midReach * dy + half * dx, midHeight];
    const right: Vec3 = [midReach * dx + half * dy, midReach * dy - half * dx, midHeight];
    writer.tri([0.015 * dx, 0.015 * dy, 0], left, right, base, mid, mid);
    writer.tri(left, right, [tipReach * dx, tipReach * dy, tipHeight], mid, mid, tip);
  }
}

// A pale three-sided stem and a five-sided cone cap.
function emitMushroom(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const stemHeight = range(random, 0.07, 0.1);
  const stemRadius = range(random, 0.018, 0.026);
  const capRadius = range(random, 0.055, 0.08);
  const capHeight = stemHeight + range(random, 0.045, 0.07);
  const stemColor = paletteColor("mushroom", "base", prop.tone);
  const stemShade = stemColor.clone().multiplyScalar(0.85);
  const capEdge = paletteColor("mushroom", "accent", prop.tone);
  const capTop = paletteColor("mushroom", "tip", prop.tone);
  const phase = random() * Math.PI * 2;

  for (let index = 0; index < 3; index += 1) {
    const a = phase + (index / 3) * Math.PI * 2;
    const b = phase + ((index + 1) / 3) * Math.PI * 2;
    const a0: Vec3 = [stemRadius * Math.cos(a), stemRadius * Math.sin(a), 0];
    const b0: Vec3 = [stemRadius * Math.cos(b), stemRadius * Math.sin(b), 0];
    const a1: Vec3 = [stemRadius * Math.cos(a), stemRadius * Math.sin(a), stemHeight];
    const b1: Vec3 = [stemRadius * Math.cos(b), stemRadius * Math.sin(b), stemHeight];
    writer.tri(a0, b0, b1, stemShade, stemShade, stemColor);
    writer.tri(a0, b1, a1, stemShade, stemColor, stemColor);
  }

  const lean = range(random, -0.01, 0.01);

  for (let index = 0; index < 5; index += 1) {
    const a = phase + (index / 5) * Math.PI * 2;
    const b = phase + ((index + 1) / 5) * Math.PI * 2;
    writer.tri(
      [lean, lean, capHeight],
      [capRadius * Math.cos(a), capRadius * Math.sin(a), stemHeight],
      [capRadius * Math.cos(b), capRadius * Math.sin(b), stemHeight],
      capTop,
      capEdge,
      capEdge,
    );
  }
}

// A thin dark quad lying on the ground at 1 cm.
function emitTwig(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const halfLength = range(random, 0.12, 0.17);
  const halfWidth = range(random, 0.008, 0.013);
  const skew = range(random, -0.03, 0.03);
  const height = 0.01 / writer.scale;
  const dark = paletteColor("twig", "base", prop.tone);
  const light = paletteColor("twig", "tip", prop.tone);
  const a: Vec3 = [-halfLength, -halfWidth, height];
  const b: Vec3 = [halfLength, -halfWidth + skew, height];
  const c: Vec3 = [halfLength, halfWidth + skew, height];
  const d: Vec3 = [-halfLength, halfWidth, height];
  writer.tri(a, b, c, dark, light, light);
  writer.tri(a, c, d, dark, light, dark);
}

interface RockSpec {
  readonly sides: number;
  readonly minRadius: number;
  readonly maxRadius: number;
  /** Apex height as a multiple of the radius. */
  readonly heightRatio: number;
  /** Relative size of the random displacement of each vertex. */
  readonly jitter: number;
  /** Highest height of the ground ring, meters: the rock is half sunk in the ground. */
  readonly sink: number;
}

// The upper half of a squashed, jittered bipyramid; flat shaded, each face a little lighter or darker.
function emitRock(writer: SceneryWriter, prop: SceneryProp, random: () => number, spec: RockSpec): void {
  const radius = range(random, spec.minRadius, spec.maxRadius);
  const squash = range(random, 0.8, 1);
  const ring: Vec3[] = [];

  for (let index = 0; index < spec.sides; index += 1) {
    const angle = (index / spec.sides) * Math.PI * 2 + (random() - 0.5) * spec.jitter;
    const reach = radius * (1 + (random() - 0.5) * spec.jitter * 2);
    ring.push([reach * Math.cos(angle), reach * squash * Math.sin(angle), random() * spec.sink]);
  }

  const apex: Vec3 = [
    radius * (random() - 0.5) * spec.jitter,
    radius * (random() - 0.5) * spec.jitter,
    radius * spec.heightRatio * range(random, 0.85, 1.15),
  ];

  for (let index = 0; index < spec.sides; index += 1) {
    const shade = range(random, 0.88, 1.1);
    const foot = paletteColor(prop.kind, "base", prop.tone, shade);
    const top = paletteColor(prop.kind, "tip", prop.tone, shade);
    writer.tri(ring[index], ring[(index + 1) % spec.sides], apex, foot, foot, top);
  }
}

// A low five-leaf rosette: each leaf a triangle from a small base ring up and out to a pale, slightly pink tip.
function emitSucculent(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const phase = random() * Math.PI * 2;

  for (let index = 0; index < 5; index += 1) {
    const angle = phase + (index / 5) * Math.PI * 2;
    const reach = range(random, 0.09, 0.12);
    const height = range(random, 0.05, 0.09);
    const spread = 0.38;
    const base = paletteColor("succulent", "base", prop.tone);
    const tip = paletteColor("succulent", "tip", prop.tone).lerp(paletteColor("succulent", "accent", prop.tone), 0.4);
    writer.tri(
      [0.02 * Math.cos(angle - spread), 0.02 * Math.sin(angle - spread), 0.02],
      [0.02 * Math.cos(angle + spread), 0.02 * Math.sin(angle + spread), 0.02],
      [reach * Math.cos(angle), reach * Math.sin(angle), height],
      base,
      base,
      tip,
    );
  }
}

// A low dark half-octahedron with two lighter blades poking out of the top.
function emitShrub(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const radius = range(random, 0.12, 0.18);
  const ring: Vec3[] = [];

  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + (random() - 0.5) * 0.4;
    ring.push([radius * (0.85 + 0.3 * random()) * Math.cos(angle), radius * (0.85 + 0.3 * random()) * Math.sin(angle), random() * 0.02]);
  }

  const apex: Vec3 = [range(random, -0.03, 0.03), range(random, -0.03, 0.03), range(random, 0.11, 0.16)];

  for (let index = 0; index < 4; index += 1) {
    const shade = range(random, 0.85, 1.12);
    writer.tri(
      ring[index],
      ring[(index + 1) % 4],
      apex,
      paletteColor("shrub", "base", prop.tone, shade),
      paletteColor("shrub", "base", prop.tone, shade),
      paletteColor("shrub", "tip", prop.tone, shade),
    );
  }

  for (let index = 0; index < 2; index += 1) {
    const angle = random() * Math.PI * 2;
    const reach = range(random, 0.03, 0.07);
    const height = apex[2] + range(random, 0.1, 0.17);
    const half = 0.015;
    const base = paletteColor("shrub", "tip", prop.tone);
    const tip = paletteColor("shrub", "accent", prop.tone);
    writer.tri(
      [apex[0] - half * Math.sin(angle), apex[1] + half * Math.cos(angle), apex[2] - 0.02],
      [apex[0] + half * Math.sin(angle), apex[1] - half * Math.cos(angle), apex[2] - 0.02],
      [apex[0] + reach * Math.cos(angle), apex[1] + reach * Math.sin(angle), height],
      base,
      base,
      tip,
    );
  }
}

// A low six-sided dome: white on top, faintly blue where the sides meet the ground.
function emitSnowMound(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const radius = range(random, 0.14, 0.22);
  const height = range(random, 0.07, 0.11);
  const phase = random() * Math.PI;
  const apex: Vec3 = [range(random, -0.02, 0.02), range(random, -0.02, 0.02), height];
  const top = paletteColor("snow-mound", "tip", prop.tone);

  for (let index = 0; index < 6; index += 1) {
    const a = phase + (index / 6) * Math.PI * 2;
    const b = phase + ((index + 1) / 6) * Math.PI * 2;
    const shade = paletteColor("snow-mound", "base", prop.tone).lerp(paletteColor("snow-mound", "accent", prop.tone), 0.25 + 0.5 * random());
    writer.tri(
      [radius * Math.cos(a), radius * Math.sin(a), 0.005],
      [radius * Math.cos(b), radius * Math.sin(b), 0.005],
      apex,
      shade,
      shade,
      top,
    );
  }
}

// A thin four-sided pale-blue spike, leaning a little.
function emitIceCrystal(writer: SceneryWriter, prop: SceneryProp, random: () => number): void {
  const height = range(random, 0.18, 0.3);
  const radius = range(random, 0.025, 0.04);
  const leanAngle = random() * Math.PI * 2;
  const lean = range(random, 0, 0.05);
  const apex: Vec3 = [lean * Math.cos(leanAngle), lean * Math.sin(leanAngle), height];
  const foot = paletteColor("ice-crystal", "base", prop.tone);
  const top = paletteColor("ice-crystal", "tip", prop.tone);
  const phase = random() * Math.PI;

  for (let index = 0; index < 4; index += 1) {
    const a = phase + (index * Math.PI) / 2;
    const b = phase + ((index + 1) * Math.PI) / 2;
    writer.tri(
      [radius * Math.cos(a), radius * Math.sin(a), 0],
      [radius * Math.cos(b), radius * Math.sin(b), 0],
      apex,
      foot,
      foot,
      top,
    );
  }
}
