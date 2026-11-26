/**
 * Face themes (design 018 section 9.1): what stands on a face. Each theme has generators for one major landmark (6 to 11 m), minor ones
 * (1.5 to 4 m) and small props (0.4 to 1.5 m); a generator takes a seeded random source and the face's palette and returns parts
 * (`landmarkParts.ts`) built at their final size, so no two landmarks of a theme are the same but all of a theme share a silhouette family.
 *
 * Pure and deterministic. Layer rule: imports only sibling modules.
 */
import type { FacePalette } from "./facePalettes";
import type { LandmarkPart, PartPose, Vec3 } from "./landmarkParts";

/** Size class of a generated landmark. */
export type LandmarkRole = "major" | "minor" | "prop";

/** What a generator gets. */
export interface GeneratorContext {
  readonly random: () => number;
  readonly palette: FacePalette;
}

/** A named generator: the name is shown in debugging and kept on the placement. */
export interface LandmarkGenerator {
  readonly name: string;
  readonly build: (context: GeneratorContext) => readonly LandmarkPart[];
}

/** A theme: its name and its generators per role. */
export interface FaceTheme {
  readonly id: string;
  /** One line for people: what the face is. */
  readonly title: string;
  readonly major: readonly LandmarkGenerator[];
  readonly minor: readonly LandmarkGenerator[];
  readonly prop: readonly LandmarkGenerator[];
}

// --- small helpers -----------------------------------------------------------------------------------------------------------------------

type Role = keyof Pick<FacePalette, "primary" | "secondary" | "accent" | "dark" | "light" | "glow">;

const TAU = Math.PI * 2;

function between(random: () => number, low: number, high: number): number {
  return low + (high - low) * random();
}

function integer(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** A part list under construction, with one helper per shape; colours are palette roles or hex strings. */
class Kit {
  readonly parts: LandmarkPart[] = [];

  constructor(
    readonly random: () => number,
    readonly palette: FacePalette,
  ) {}

  color(role: Role | string): string {
    return role.startsWith("#") ? role : this.palette[role as Role];
  }

  box(at: Vec3, sx: number, sy: number, sz: number, role: Role | string, pose?: PartPose, extra: { glow?: boolean; collide?: boolean } = {}): this {
    this.parts.push({ shape: "box", at, sx, sy, sz, color: this.color(role), pose, ...extra });
    return this;
  }

  prism(at: Vec3, sides: number, r0: number, r1: number, h: number, role: Role | string, pose?: PartPose, extra: { phase?: number; glow?: boolean; collide?: boolean } = {}): this {
    this.parts.push({ shape: "prism", at, sides, r0, r1, h, color: this.color(role), pose, ...extra });
    return this;
  }

  ball(at: Vec3, rx: number, ry: number, rz: number, role: Role | string, extra: { longitudes?: number; latitudes?: number; wobble?: number; glow?: boolean; pose?: PartPose } = {}): this {
    const { pose, ...rest } = extra;
    this.parts.push({ shape: "ball", at, rx, ry, rz, color: this.color(role), pose, wobbleSeed: Math.floor(this.random() * 1e9), ...rest });
    return this;
  }

  ring(at: Vec3, radius: number, tube: number, role: Role | string, pose?: PartPose, extra: { start?: number; arc?: number; segments?: number; tubeSides?: number; glow?: boolean } = {}): this {
    this.parts.push({ shape: "ring", at, radius, tube, color: this.color(role), pose, ...extra });
    return this;
  }

  star(at: Vec3, points: number, outer: number, inner: number, thickness: number, role: Role | string, pose?: PartPose): this {
    this.parts.push({ shape: "star", at, points, outer, inner, thickness, color: this.color(role), pose });
    return this;
  }

  strut(from: Vec3, to: Vec3, radius: number, role: Role | string, extra: { glow?: boolean; collide?: boolean } = {}): this {
    this.parts.push({ shape: "strut", at: [0, 0, 0], from, to, radius, color: this.color(role), ...extra });
    return this;
  }

  /** A gable roof (triangular prism along `u`, turned by `yaw`) with its eaves at `at`, `width` across and `length` long; the ridge is 0.87 `width` up. */
  gable(at: Vec3, width: number, length: number, role: Role | string, yaw = 0): this {
    // A 3-sided prism lying along u: radius r puts the apex 1.5 r above the base line, which is 1.732 r wide and 0.5 r below the axis.
    const r = width / Math.sqrt(3);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const shift = -length / 2;
    this.parts.push({
      shape: "prism",
      at: [at[0] + shift * cos, at[1] + shift * sin, at[2] + r * 0.5],
      sides: 3,
      r0: r,
      r1: r,
      h: length,
      phase: Math.PI,
      color: this.color(role),
      pose: { yaw, pitch: Math.PI / 2 },
    });
    return this;
  }
}

function build(random: () => number, palette: FacePalette, emit: (kit: Kit) => void): readonly LandmarkPart[] {
  const kit = new Kit(random, palette);
  emit(kit);
  return kit.parts;
}

function generator(name: string, emit: (kit: Kit) => void): LandmarkGenerator {
  return { name, build: ({ random, palette }) => build(random, palette, emit) };
}

// A stack of smooth stones, from radius `base` up, each a little smaller and a little off centre; returns the height reached.
function stoneStack(kit: Kit, at: Vec3, count: number, base: number, roles: readonly Role[]): number {
  const { random } = kit;
  let z = at[2];
  let radius = base;
  let u = at[0];
  let v = at[1];

  for (let index = 0; index < count; index += 1) {
    const rz = radius * between(random, 0.42, 0.62);
    kit.ball([u, v, z + rz], radius * between(random, 0.9, 1.15), radius * between(random, 0.8, 1.05), rz, pick(random, roles), {
      longitudes: 8,
      latitudes: 4,
      wobble: 0.08,
      pose: { yaw: random() * TAU },
    });
    z += rz * 1.85;
    u += between(random, -0.18, 0.18) * radius;
    v += between(random, -0.18, 0.18) * radius;
    radius *= between(random, 0.72, 0.95);
  }

  return z;
}

// A house: walls, gable roof, a door and a few windows. `yaw` turns it; returns nothing.
function house(kit: Kit, at: Vec3, width: number, depth: number, wall: number, yaw: number): void {
  const { random } = kit;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number, w: number): Vec3 => [at[0] + u * cos - v * sin, at[1] + u * sin + v * cos, at[2] + w];
  kit.box(at, width, depth, wall, pick(random, ["light", "secondary"] as const), { yaw });
  kit.gable(local(0, 0, wall), depth * 1.12, width * 1.08, "primary", yaw);
  kit.box(local(between(random, -0.25, 0.25) * width, -depth / 2 - 0.02, 0), Math.min(0.9, width * 0.25), 0.08, Math.min(1.9, wall * 0.7), "dark", { yaw });
  const windows = integer(random, 1, 2);

  for (let index = 0; index < windows; index += 1) {
    const u = (index - (windows - 1) / 2) * width * 0.45;
    const lit = random() < 0.5;
    kit.box(local(u, depth / 2 + 0.02, wall * 0.5), 0.55, 0.08, 0.6, lit ? "glow" : "dark", { yaw }, { glow: lit });
  }
}

// A bench: seat, back and four legs, `length` long, facing -v after `yaw`.
function bench(kit: Kit, at: Vec3, length: number, yaw: number): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number, w: number): Vec3 => [at[0] + u * cos - v * sin, at[1] + u * sin + v * cos, at[2] + w];
  kit.box(local(0, 0, 0.42), length, 0.45, 0.08, "primary", { yaw });
  kit.box(local(0, 0.22, 0.55), length, 0.07, 0.4, "primary", { yaw });

  for (const u of [-0.42, 0.42]) {
    for (const v of [-0.17, 0.17]) {
      kit.strut(local(u * length, v, 0), local(u * length, v, 0.42), 0.04, "dark");
    }
  }
}

// A wheel: rim, hub and `spokes` spokes, standing in the u-w plane turned by `yaw`, centre at `at`.
function wheel(kit: Kit, at: Vec3, radius: number, spokes: number, yaw: number, rimRole: Role, spokeRole: Role): void {
  kit.ring(at, radius, Math.max(0.03, radius * 0.06), rimRole, { yaw }, { segments: 14, tubeSides: 3 });
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * TAU;
    const du = Math.cos(angle) * radius;
    const dw = Math.sin(angle) * radius;
    kit.strut(at, [at[0] + du * cos, at[1] + du * sin, at[2] + dw], Math.max(0.015, radius * 0.02), spokeRole, { collide: false });
  }
}

// A gear standing in the u-w plane turned by `yaw`: a toothed disc with a hub.
function gear(kit: Kit, at: Vec3, radius: number, teeth: number, thickness: number, yaw: number, role: Role): void {
  kit.star(at, teeth, radius, radius * 0.86, thickness, role, { yaw });
  kit.prism([at[0], at[1], at[2]], 8, radius * 0.22, radius * 0.22, thickness * 1.6, "dark", { yaw, roll: Math.PI / 2 });
}

// A jointed leg from the hip up to a knee and down to the foot.
function leg(kit: Kit, hip: Vec3, knee: Vec3, foot: Vec3, radius: number, role: Role): void {
  kit.strut(hip, knee, radius, role);
  kit.strut(knee, foot, radius * 0.8, role);
}

// A lamp head: a glowing bulb under a shade cone opening downwards.
function lampHead(kit: Kit, at: Vec3, shadeRadius: number, role: Role): void {
  kit.prism([at[0], at[1], at[2] - shadeRadius * 0.15], 8, shadeRadius, shadeRadius * 0.35, shadeRadius * 0.8, role);
  kit.ball([at[0], at[1], at[2]], shadeRadius * 0.38, shadeRadius * 0.38, shadeRadius * 0.38, "glow", { glow: true, longitudes: 6, latitudes: 3 });
}

// A polyline of struts through `points`.
function polyline(kit: Kit, points: readonly Vec3[], radius: number, role: Role): void {
  for (let index = 0; index + 1 < points.length; index += 1) {
    kit.strut(points[index], points[index + 1], radius, role);
  }
}

// A column: base block, n-sided shaft, capital block; returns the top height.
function column(kit: Kit, at: Vec3, radius: number, height: number, role: Role, capRole: Role): number {
  kit.box(at, radius * 2.6, radius * 2.6, radius * 0.6, capRole);
  kit.prism([at[0], at[1], at[2] + radius * 0.6], 8, radius, radius * 0.88, height - radius * 1.2, role);
  kit.box([at[0], at[1], at[2] + height - radius * 0.6], radius * 2.6, radius * 2.6, radius * 0.6, capRole);
  return at[2] + height;
}

// A mushroom: stalk, cap and spots.
function mushroom(kit: Kit, at: Vec3, height: number, capRadius: number, lean: number): void {
  const { random } = kit;
  const top: Vec3 = [at[0] + lean * height * 0.3, at[1], at[2] + height];
  kit.prism(at, 7, capRadius * 0.24, capRadius * 0.17, height, "light", { pitch: lean * 0.3 });
  kit.ball(top, capRadius, capRadius, capRadius * between(random, 0.35, 0.55), "primary", { longitudes: 10, latitudes: 4 });
  kit.ring([top[0], top[1], top[2] - capRadius * 0.05], capRadius * 0.7, capRadius * 0.12, "dark", { roll: Math.PI / 2 }, { segments: 10, tubeSides: 3 });
  const spots = integer(random, 3, 6);

  for (let index = 0; index < spots; index += 1) {
    const angle = random() * TAU;
    const reach = between(random, 0.3, 0.75) * capRadius;
    kit.ball([top[0] + Math.cos(angle) * reach, top[1] + Math.sin(angle) * reach, top[2] + capRadius * 0.38 * (1 - (reach / capRadius) ** 2) ** 0.5], capRadius * 0.13, capRadius * 0.13, capRadius * 0.07, "light", {
      longitudes: 5,
      latitudes: 3,
    });
  }
}

// A hexagonal crystal with a pointed tip, tilted.
function crystal(kit: Kit, at: Vec3, radius: number, height: number, tilt: number, yaw: number, role: Role): void {
  const pose = { yaw, pitch: tilt };
  kit.prism(at, 6, radius, radius * 0.9, height * 0.78, role, pose);
  const reach = height * 0.78;
  const top: Vec3 = [at[0] + Math.cos(yaw) * Math.sin(tilt) * reach, at[1] + Math.sin(yaw) * Math.sin(tilt) * reach, at[2] + Math.cos(tilt) * reach];
  kit.prism(top, 6, radius * 0.9, 0, height * 0.22, "light", pose);
}

// --- the themes --------------------------------------------------------------------------------------------------------------------------

const cairns: FaceTheme = {
  id: "cairns",
  title: "Stacked stones",
  major: [
    generator("cairn", (kit) => {
      stoneStack(kit, [0, 0, 0], integer(kit.random, 7, 10), between(kit.random, 1.4, 1.8), ["primary", "dark", "light", "secondary"]);
    }),
    generator("twin cairns", (kit) => {
      stoneStack(kit, [-1.6, 0, 0], integer(kit.random, 7, 9), 1.5, ["primary", "dark", "light"]);
      stoneStack(kit, [1.8, 0.3, 0], integer(kit.random, 3, 5), 1.1, ["secondary", "dark", "light"]);
    }),
  ],
  minor: [
    generator("small cairn", (kit) => {
      stoneStack(kit, [0, 0, 0], integer(kit.random, 3, 5), between(kit.random, 0.55, 0.75), ["primary", "dark", "light"]);
    }),
    generator("balanced rock", (kit) => {
      kit.ball([0, 0, 0.25], 0.3, 0.3, 0.25, "dark", { wobble: 0.1 });
      kit.ball([0, 0, 0.5 + 0.9], 1.3, 1.0, 0.9, "primary", { wobble: 0.12, longitudes: 10 });
    }),
  ],
  prop: [
    generator("pebble pair", (kit) => {
      kit.ball([0, 0, 0.25], 0.5, 0.4, 0.25, "light", { wobble: 0.1 });
      kit.ball([0.1, 0, 0.68], 0.3, 0.26, 0.18, "primary", { wobble: 0.1 });
    }),
    generator("flat stone", (kit) => {
      kit.ball([0, 0, 0.12], 0.7, 0.5, 0.12, pick(kit.random, ["dark", "secondary"] as const), { wobble: 0.15 });
    }),
  ],
};

const village: FaceTheme = {
  id: "village",
  title: "Houses, towers and benches",
  major: [
    generator("town tower", (kit) => {
      const { random } = kit;
      const height = between(random, 5.5, 7.2);
      const width = between(random, 1.8, 2.4);
      kit.box([0, 0, 0], width, width, height, "light");
      kit.box([0, 0, height], width * 1.15, width * 1.15, 0.3, "secondary");
      kit.prism([0, 0, height + 0.3], 4, width * 0.95, 0, width * 1.1, "primary", undefined, { phase: Math.PI / 4 });
      const floors = Math.floor(height / 2.1);

      for (let floor = 0; floor < floors; floor += 1) {
        for (const [u, v, yaw] of [[0, -width / 2 - 0.02, 0], [width / 2 + 0.02, 0, Math.PI / 2]] as const) {
          const lit = random() < 0.3;
          kit.box([u, v, 1.4 + floor * 2.1], 0.45, 0.08, 0.8, lit ? "glow" : "dark", { yaw }, { glow: lit });
        }
      }

      kit.strut([0, 0, height + 0.3 + width * 1.1], [0, 0, height + 0.3 + width * 1.1 + 1.2], 0.04, "dark");
      kit.box([0.35, 0, height + width * 1.1 + 1.0], 0.7, 0.04, 0.4, "accent");
    }),
    generator("hamlet", (kit) => {
      const { random } = kit;
      house(kit, [-1.8, 0, 0], 3.2, 2.6, 2.6, random() * 0.4);
      house(kit, [1.9, 0.6, 0], 2.6, 2.4, 3.4, Math.PI / 2 + random() * 0.4);
      kit.box([0.2, -1.2, 0], 1.6, 1.6, 5.2, "secondary");
      kit.prism([0.2, -1.2, 5.2], 4, 1.25, 0, 1.6, "primary", undefined, { phase: Math.PI / 4 });
    }),
  ],
  minor: [
    generator("house", (kit) => house(kit, [0, 0, 0], between(kit.random, 2.4, 3.4), between(kit.random, 2.0, 2.4), between(kit.random, 2.1, 2.6), 0)),
    generator("well", (kit) => {
      kit.prism([0, 0, 0], 10, 0.9, 0.9, 0.8, "light");
      kit.strut([-0.8, 0, 0.8], [-0.8, 0, 2.2], 0.07, "dark");
      kit.strut([0.8, 0, 0.8], [0.8, 0, 2.2], 0.07, "dark");
      kit.gable([0, 0, 2.2], 1.4, 2.0, "primary", 0);
    }),
  ],
  prop: [
    generator("bench", (kit) => bench(kit, [0, 0, 0], between(kit.random, 1.4, 2.0), 0)),
    generator("fence", (kit) => {
      const posts = integer(kit.random, 3, 5);

      for (let index = 0; index < posts; index += 1) {
        kit.box([(index - (posts - 1) / 2) * 0.9, 0, 0], 0.12, 0.12, 1.0, "light");
      }

      kit.box([0, 0, 0.45], (posts - 1) * 0.9 + 0.2, 0.06, 0.1, "primary");
      kit.box([0, 0, 0.8], (posts - 1) * 0.9 + 0.2, 0.06, 0.1, "primary");
    }),
  ],
};

const striders: FaceTheme = {
  id: "striders",
  title: "Long-legged striders",
  major: [
    generator("great spider", (kit) => {
      const { random } = kit;
      const legs = integer(random, 6, 8);
      const bodyHeight = between(random, 5.5, 7.5);
      const reach = between(random, 3.8, 4.6);
      kit.ball([0, 0, bodyHeight], 1.3, 1.0, 0.8, "primary", { longitudes: 10, latitudes: 5 });
      kit.ball([1.4, 0, bodyHeight + 0.2], 0.6, 0.55, 0.5, "secondary");
      kit.ball([1.95, 0.2, bodyHeight + 0.35], 0.1, 0.1, 0.1, "glow", { glow: true, longitudes: 5, latitudes: 3 });
      kit.ball([1.95, -0.2, bodyHeight + 0.35], 0.1, 0.1, 0.1, "glow", { glow: true, longitudes: 5, latitudes: 3 });

      for (let index = 0; index < legs; index += 1) {
        const angle = ((index + 0.5) / legs) * TAU;
        const hip: Vec3 = [Math.cos(angle) * 0.9, Math.sin(angle) * 0.7, bodyHeight];
        const knee: Vec3 = [Math.cos(angle) * reach * 0.55, Math.sin(angle) * reach * 0.55, bodyHeight + between(random, 1.4, 2.4)];
        const foot: Vec3 = [Math.cos(angle) * reach, Math.sin(angle) * reach, 0];
        leg(kit, hip, knee, foot, 0.09, "dark");
      }
    }),
    generator("stilt walker", (kit) => {
      const { random } = kit;
      const height = between(random, 7.5, 9.5);
      kit.ball([0, 0, height], 1.0, 1.0, 0.7, "primary", { longitudes: 9, latitudes: 4 });
      kit.prism([0, 0, height + 0.5], 6, 0.5, 0, 1.0, "accent");

      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * TAU + random() * 0.3;
        const knee: Vec3 = [Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, height * 0.55];
        leg(kit, [Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, height - 0.4], knee, [Math.cos(angle) * 2.2, Math.sin(angle) * 2.2, 0], 0.07, "dark");
      }
    }),
  ],
  minor: [
    generator("small spider", (kit) => {
      const { random } = kit;
      const bodyHeight = between(random, 1.4, 2.2);
      kit.ball([0, 0, bodyHeight], 0.5, 0.4, 0.32, "primary", { longitudes: 8, latitudes: 4 });

      for (let index = 0; index < 6; index += 1) {
        const angle = ((index + 0.5) / 6) * TAU;
        leg(kit, [Math.cos(angle) * 0.3, Math.sin(angle) * 0.25, bodyHeight], [Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, bodyHeight + 0.7], [Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, 0], 0.04, "dark");
      }
    }),
    generator("tripod", (kit) => {
      const height = between(kit.random, 2.8, 3.8);
      kit.ball([0, 0, height], 0.55, 0.55, 0.4, "secondary");

      for (let index = 0; index < 3; index += 1) {
        const angle = (index / 3) * TAU;
        kit.strut([0, 0, height], [Math.cos(angle) * 1.1, Math.sin(angle) * 1.1, 0], 0.05, "dark");
      }
    }),
  ],
  prop: [
    generator("eggs", (kit) => {
      const count = integer(kit.random, 2, 4);

      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU;
        kit.ball([Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0.32], 0.22, 0.22, 0.32, "light");
      }
    }),
  ],
};

const clockwork: FaceTheme = {
  id: "clockwork",
  title: "Clocks, gears and bicycles",
  major: [
    generator("clock tower", (kit) => {
      const { random } = kit;
      const height = between(random, 6.5, 8.5);
      kit.box([0, 0, 0], 2.0, 2.0, height, "primary");
      kit.prism([0, 0, height], 4, 1.6, 0, 1.4, "dark", undefined, { phase: Math.PI / 4 });

      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const cos = Math.cos(yaw - Math.PI / 2);
        const sin = Math.sin(yaw - Math.PI / 2);
        const face: Vec3 = [cos * 1.04, sin * 1.04, height - 1.0];
        kit.prism(face, 12, 0.8, 0.8, 0.06, "light", { yaw: yaw - Math.PI / 2, pitch: Math.PI / 2 });
        const hourAngle = random() * TAU;
        const minuteAngle = random() * TAU;
        const tip = (angle: number, length: number): Vec3 => [face[0] + cos * 0.07 + -sin * Math.cos(angle) * length, face[1] + sin * 0.07 + cos * Math.cos(angle) * length, face[2] + Math.sin(angle) * length];
        kit.strut([face[0] + cos * 0.07, face[1] + sin * 0.07, face[2]], tip(hourAngle, 0.45), 0.04, "dark", { collide: false });
        kit.strut([face[0] + cos * 0.07, face[1] + sin * 0.07, face[2]], tip(minuteAngle, 0.7), 0.03, "dark", { collide: false });
      }

      gear(kit, [1.0 + 0.12, 0, height * 0.45], 0.9, 12, 0.2, Math.PI / 2, "accent");
      gear(kit, [1.0 + 0.12, 0.7, height * 0.45 - 1.25], 0.6, 9, 0.2, Math.PI / 2, "secondary");
    }),
    generator("gear tree", (kit) => {
      const { random } = kit;
      const height = between(random, 6.5, 8);
      kit.prism([0, 0, 0], 6, 0.25, 0.2, height, "dark");
      let z = 1.6;
      let side = 1;

      while (z < height - 0.5) {
        const radius = between(random, 0.8, 1.5);
        const yaw = random() * Math.PI;
        gear(kit, [Math.cos(yaw + Math.PI / 2) * 0.25 * side, Math.sin(yaw + Math.PI / 2) * 0.25 * side, z], radius, integer(random, 9, 16), 0.22, yaw, pick(random, ["primary", "secondary", "accent"] as const));
        z += radius * 1.3;
        side = -side;
      }
    }),
  ],
  minor: [
    generator("standing gear", (kit) => {
      const radius = between(kit.random, 1.2, 1.7);
      gear(kit, [0, 0, radius + 0.3], radius, integer(kit.random, 10, 16), 0.3, 0, "primary");
      kit.strut([-0.8, 0.3, 0], [0, 0.3, radius + 0.3], 0.07, "dark");
      kit.strut([0.8, 0.3, 0], [0, 0.3, radius + 0.3], 0.07, "dark");
    }),
    generator("big bicycle", (kit) => {
      const r = between(kit.random, 0.9, 1.2);
      const gap = r * 2.3;
      wheel(kit, [-gap / 2, 0, r], r, 8, 0, "dark", "light");
      wheel(kit, [gap / 2, 0, r], r, 8, 0, "dark", "light");
      const crank: Vec3 = [0, 0, r];
      const seat: Vec3 = [-r * 0.35, 0, r * 2.0];
      const head: Vec3 = [gap / 2 - r * 0.35, 0, r * 2.05];
      polyline(kit, [[-gap / 2, 0, r], crank, seat, [-gap / 2, 0, r]], 0.05, "primary");
      polyline(kit, [crank, head, [gap / 2, 0, r]], 0.05, "primary");
      kit.strut(seat, head, 0.05, "primary");
      kit.box([seat[0], 0, seat[2] + 0.05], 0.4, 0.18, 0.08, "dark");
      kit.strut([head[0] - 0.05, -0.35, head[2] + 0.2], [head[0] - 0.05, 0.35, head[2] + 0.2], 0.04, "dark");
    }),
  ],
  prop: [
    generator("fallen gear", (kit) => {
      const radius = between(kit.random, 0.4, 0.7);
      kit.star([0, 0, 0.08], integer(kit.random, 8, 12), radius, radius * 0.86, 0.15, "secondary", { roll: Math.PI / 2 });
      kit.prism([0, 0, 0], 8, radius * 0.22, radius * 0.22, 0.24, "dark");
    }),
    generator("pocket watch", (kit) => {
      kit.prism([0, 0, 0.55], 12, 0.5, 0.5, 0.1, "light", { pitch: Math.PI / 2 - 0.3 });
      kit.ring([0, 0, 0.55], 0.5, 0.05, "accent", { roll: 0.3 }, { segments: 12, tubeSides: 3 });
    }),
  ],
};

const lamplight: FaceTheme = {
  id: "lamplight",
  title: "Lamp posts and giant desk lamps",
  major: [
    generator("giant desk lamp", (kit) => {
      const { random } = kit;
      const yaw = random() * TAU;
      const dir: Vec3 = [Math.cos(yaw), Math.sin(yaw), 0];
      kit.prism([0, 0, 0], 12, 1.6, 1.4, 0.35, "dark");
      const elbow: Vec3 = [dir[0] * 1.4, dir[1] * 1.4, between(random, 4.0, 5.0)];
      const wrist: Vec3 = [dir[0] * -0.8, dir[1] * -0.8, between(random, 7.0, 8.5)];
      kit.strut([0, 0, 0.35], elbow, 0.12, "primary");
      kit.strut([dir[1] * 0.25, -dir[0] * 0.25, 0.35], [elbow[0] + dir[1] * 0.25, elbow[1] - dir[0] * 0.25, elbow[2]], 0.05, "primary");
      kit.ball(elbow, 0.25, 0.25, 0.25, "dark");
      kit.strut(elbow, wrist, 0.12, "primary");
      kit.ball(wrist, 0.25, 0.25, 0.25, "dark");
      // The shade hangs off the wrist and points down and out.
      kit.prism([wrist[0] - dir[0] * 0.3, wrist[1] - dir[1] * 0.3, wrist[2] - 0.2], 10, 0.35, 1.3, 1.6, "accent", { yaw: yaw + Math.PI, pitch: Math.PI * 0.8 });
      kit.ball([wrist[0] - dir[0] * 1.2, wrist[1] - dir[1] * 1.2, wrist[2] - 1.0], 0.45, 0.45, 0.45, "glow", { glow: true });
    }),
    generator("lamp grove", (kit) => {
      const { random } = kit;
      const posts = integer(random, 3, 4);

      for (let index = 0; index < posts; index += 1) {
        const angle = (index / posts) * TAU + random();
        const base: Vec3 = [Math.cos(angle) * 1.6, Math.sin(angle) * 1.6, 0];
        const height = between(random, 5, 8);
        const bend = random() * TAU;
        const top: Vec3 = [base[0] + Math.cos(bend) * 0.8, base[1] + Math.sin(bend) * 0.8, height];
        polyline(kit, [base, [base[0], base[1], height * 0.7], top], 0.09, "dark");
        lampHead(kit, [top[0], top[1], top[2] - 0.2], 0.55, pick(random, ["primary", "accent"] as const));
      }
    }),
  ],
  minor: [
    generator("street lamp", (kit) => {
      const height = between(kit.random, 3.0, 3.9);
      kit.prism([0, 0, 0], 6, 0.18, 0.08, height, "dark");
      kit.strut([0, 0, height], [0.7, 0, height + 0.15], 0.05, "dark");
      lampHead(kit, [0.7, 0, height], 0.35, "primary");
    }),
    generator("floor lamp", (kit) => {
      const height = between(kit.random, 2.2, 3.0);
      kit.prism([0, 0, 0], 8, 0.45, 0.4, 0.1, "dark");
      kit.strut([0, 0, 0.1], [0, 0, height], 0.05, "dark");
      kit.prism([0, 0, height - 0.3], 8, 0.6, 0.35, 0.6, "secondary");
      kit.ball([0, 0, height - 0.1], 0.18, 0.18, 0.18, "glow", { glow: true, longitudes: 6, latitudes: 3 });
    }),
  ],
  prop: [
    generator("lantern", (kit) => {
      kit.box([0, 0, 0], 0.35, 0.35, 0.08, "dark");
      kit.ball([0, 0, 0.3], 0.14, 0.14, 0.2, "glow", { glow: true, longitudes: 6, latitudes: 3 });
      kit.prism([0, 0, 0.52], 4, 0.3, 0, 0.25, "dark", undefined, { phase: Math.PI / 4 });
      for (const [u, v] of [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15], [-0.15, 0.15]]) {
        kit.strut([u, v, 0.08], [u, v, 0.52], 0.015, "dark", { collide: false });
      }
    }),
    generator("candles", (kit) => {
      const count = integer(kit.random, 2, 4);

      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU;
        const height = between(kit.random, 0.3, 0.7);
        kit.prism([Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0], 6, 0.07, 0.07, height, "light");
        kit.prism([Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, height], 4, 0.04, 0, 0.1, "glow", undefined, { glow: true });
      }
    }),
  ],
};

function archParts(kit: Kit, at: Vec3, clear: number, springHeight: number, thickness: number, yaw: number, role: Role, archRole: Role): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const half = clear / 2 + thickness / 2;

  for (const side of [-1, 1]) {
    kit.box([at[0] + side * half * cos, at[1] + side * half * sin, at[2]], thickness, thickness, springHeight, role, { yaw });
  }

  kit.ring([at[0], at[1], at[2] + springHeight], half, thickness / 2, archRole, { yaw }, { start: 0, arc: Math.PI, segments: 8, tubeSides: 4 });
}

function doorFrame(kit: Kit, at: Vec3, width: number, height: number, yaw: number, ajar: number): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number, w: number): Vec3 => [at[0] + u * cos - v * sin, at[1] + u * sin + v * cos, at[2] + w];
  kit.box(local(-width / 2 - 0.1, 0, 0), 0.2, 0.25, height + 0.2, "light", { yaw });
  kit.box(local(width / 2 + 0.1, 0, 0), 0.2, 0.25, height + 0.2, "light", { yaw });
  kit.box(local(0, 0, height), width + 0.4, 0.25, 0.2, "light", { yaw });
  // The door turns about its hinge on the left post.
  const doorYaw = yaw - ajar;
  const hinge = local(-width / 2, 0, 0);
  kit.box([hinge[0] + (Math.cos(doorYaw) * width) / 2, hinge[1] + (Math.sin(doorYaw) * width) / 2, 0], width, 0.08, height, "primary", { yaw: doorYaw });
  kit.ball([hinge[0] + Math.cos(doorYaw) * width * 0.85 - Math.sin(doorYaw) * 0.08, hinge[1] + Math.sin(doorYaw) * width * 0.85 + Math.cos(doorYaw) * 0.08, height * 0.48], 0.06, 0.06, 0.06, "accent", { longitudes: 5, latitudes: 3 });
}

const thresholds: FaceTheme = {
  id: "thresholds",
  title: "Arches, doorways and hatches",
  major: [
    generator("great gate", (kit) => {
      const { random } = kit;
      const clear = between(random, 3.2, 4.2);
      archParts(kit, [0, 0, 0], clear, between(random, 4.0, 5.5), 0.9, 0, "primary", "secondary");
      doorFrame(kit, [0, 0, 0], 1.0, 2.1, 0, between(random, 0.4, 1.1));
    }),
    generator("stair to nowhere", (kit) => {
      const { random } = kit;
      const steps = integer(random, 9, 12);
      const rise = between(random, 0.5, 0.6);

      for (let index = 0; index < steps; index += 1) {
        kit.box([(index - steps / 2) * 0.55, 0, 0], 0.55, 1.6, rise * (index + 1), index % 2 === 0 ? "primary" : "secondary");
      }

      doorFrame(kit, [(steps / 2 - 0.5) * 0.55, 0, rise * steps], 0.9, 2.0, Math.PI / 2, between(random, 0.3, 1.2));
    }),
  ],
  minor: [
    generator("doorway", (kit) => doorFrame(kit, [0, 0, 0], between(kit.random, 0.9, 1.2), between(kit.random, 2.0, 2.6), 0, between(kit.random, 0.2, 1.4))),
    generator("arch", (kit) => archParts(kit, [0, 0, 0], between(kit.random, 1.2, 1.8), between(kit.random, 1.6, 2.4), 0.4, 0, "primary", "light")),
    generator("ring portal", (kit) => {
      const radius = between(kit.random, 1.2, 1.6);
      kit.ring([0, 0, radius + 0.25], radius, 0.18, "accent", undefined, { segments: 16, tubeSides: 4 });
      kit.box([0, 0, 0], 0.8, 0.5, 0.3, "dark");
    }),
  ],
  prop: [
    generator("hatch", (kit) => {
      const open = between(kit.random, 0.4, 1.3);
      kit.box([0, 0, 0], 1.1, 1.1, 0.08, "dark", undefined, { collide: false });
      kit.box([0, 0, 0.06], 0.9, 0.9, 0.02, "#050505", undefined, { collide: false });
      // The lid turns about its back edge.
      kit.box([0, 0.5 - Math.cos(open) * 0.45, 0.1 + Math.sin(open) * 0.45], 0.95, 0.9, 0.06, "primary", { roll: open }, { collide: false });
      kit.ring([0, 0.5 - Math.cos(open) * 0.75, 0.1 + Math.sin(open) * 0.78], 0.1, 0.02, "accent", { roll: open }, { segments: 8, tubeSides: 3 });
    }),
    generator("step", (kit) => {
      kit.box([0, 0, 0], 1.0, 0.6, 0.25, "secondary");
      kit.box([0, 0.15, 0.25], 1.0, 0.3, 0.25, "secondary");
    }),
  ],
};

const mobiles: FaceTheme = {
  id: "mobiles",
  title: "Stalks with discs, moons and stars",
  major: [
    generator("great mobile", (kit) => {
      const { random } = kit;
      const height = between(random, 6.5, 9);
      const kink: Vec3 = [between(random, -0.6, 0.6), between(random, -0.6, 0.6), height * 0.55];
      polyline(kit, [[0, 0, 0], kink, [0, 0, height]], 0.08, "dark");
      const branches = integer(random, 3, 5);

      for (let index = 0; index < branches; index += 1) {
        const angle = (index / branches) * TAU + random();
        const from: Vec3 = [0, 0, height - index * 0.9];
        const length = between(random, 1.6, 2.6);
        const end: Vec3 = [Math.cos(angle) * length, Math.sin(angle) * length, from[2] - between(random, 0.3, 1.2)];
        kit.strut(from, end, 0.04, "dark");
        const role = pick(random, ["primary", "secondary", "accent", "light"] as const);
        const item = index % 3;

        if (item === 0) {
          kit.prism(end, 10, 0.6, 0.6, 0.08, role, { yaw: angle, pitch: Math.PI / 2 });
        } else if (item === 1) {
          kit.ring(end, 0.5, 0.14, role, { yaw: angle + Math.PI / 2 }, { start: 0.6, arc: Math.PI * 1.3, segments: 9, tubeSides: 3 });
        } else {
          kit.star(end, 5, 0.6, 0.26, 0.1, role, { yaw: angle + Math.PI / 2 });
        }
      }
    }),
  ],
  minor: [
    generator("disc stalk", (kit) => {
      const height = between(kit.random, 2.4, 3.6);
      kit.strut([0, 0, 0], [0.3, 0, height], 0.05, "dark");
      kit.prism([0.3, 0, height], 10, 0.55, 0.55, 0.08, pick(kit.random, ["primary", "accent"] as const), { pitch: Math.PI / 2 });
    }),
    generator("moon pole", (kit) => {
      const height = between(kit.random, 2.4, 3.4);
      kit.strut([0, 0, 0], [0, 0, height], 0.05, "dark");
      kit.ring([0, 0, height + 0.4], 0.45, 0.14, "secondary", undefined, { start: -0.3, arc: Math.PI * 1.2, segments: 9, tubeSides: 3 });
    }),
  ],
  prop: [
    generator("blob", (kit) => kit.ball([0, 0, 0.4], 0.6, 0.45, 0.4, pick(kit.random, ["primary", "accent", "dark"] as const), { wobble: 0.25 })),
    generator("star stick", (kit) => {
      kit.strut([0, 0, 0], [0, 0, 1.0], 0.03, "dark");
      kit.star([0, 0, 1.2], 5, 0.3, 0.13, 0.06, "accent");
    }),
  ],
};

function chair(kit: Kit, at: Vec3, seatHeight: number, size: number, yaw: number, role: Role, legRole: Role): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number, w: number): Vec3 => [at[0] + u * cos - v * sin, at[1] + u * sin + v * cos, at[2] + w];
  const half = size / 2;

  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    kit.box(local(u * half * 0.85, v * half * 0.85, 0), size * 0.1, size * 0.1, seatHeight, legRole, { yaw });
  }

  kit.box(local(0, 0, seatHeight), size, size, size * 0.1, role, { yaw });
  kit.box(local(0, half * 0.92, seatHeight + size * 0.1), size, size * 0.08, size * 1.1, role, { yaw });
}

const parlour: FaceTheme = {
  id: "parlour",
  title: "Giant furniture",
  major: [
    generator("giant chair", (kit) => chair(kit, [0, 0, 0], between(kit.random, 3.5, 4.5), between(kit.random, 3.0, 3.6), kit.random() * TAU, "primary", "dark")),
    generator("wardrobe", (kit) => {
      const { random } = kit;
      const height = between(random, 6.5, 8);
      const width = between(random, 3.0, 3.8);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        kit.prism([u * (width / 2 - 0.2), v * 0.7, 0], 6, 0.15, 0.1, 0.6, "dark");
      }
      kit.box([0, 0, 0.6], width, 1.8, height - 0.6, "primary");
      kit.box([0, 0, height], width + 0.3, 2.0, 0.3, "secondary");
      kit.box([0, -0.92, 1.0], 0.06, 0.04, height - 1.8, "dark");
      kit.ball([-0.3, -0.95, height * 0.5], 0.12, 0.12, 0.12, "accent");
      kit.ball([0.3, -0.95, height * 0.5], 0.12, 0.12, 0.12, "accent");
    }),
  ],
  minor: [
    generator("table", (kit) => {
      const height = between(kit.random, 1.6, 2.2);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        kit.box([u * 1.0, v * 0.6, 0], 0.15, 0.15, height, "dark");
      }
      kit.box([0, 0, height], 2.4, 1.6, 0.15, "primary");
      kit.prism([0.4, 0.1, height + 0.15], 8, 0.2, 0.3, 0.6, "accent");
    }),
    generator("chest of drawers", (kit) => {
      const height = between(kit.random, 1.8, 2.6);
      kit.box([0, 0, 0], 1.8, 0.9, height, "secondary");
      const drawers = 3;
      for (let index = 0; index < drawers; index += 1) {
        kit.box([0, -0.46, 0.15 + (index + 0.15) * (height - 0.2) / drawers], 1.6, 0.04, (height - 0.4) / drawers, "primary");
        kit.ball([0, -0.5, 0.15 + (index + 0.6) * (height - 0.2) / drawers], 0.07, 0.07, 0.07, "accent", { longitudes: 5, latitudes: 3 });
      }
    }),
  ],
  prop: [
    generator("stool", (kit) => {
      kit.prism([0, 0, 0.6], 10, 0.35, 0.35, 0.08, "primary");
      for (let index = 0; index < 3; index += 1) {
        const angle = (index / 3) * TAU;
        kit.strut([Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0], [Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0.6], 0.03, "dark");
      }
    }),
    generator("teacup", (kit) => {
      kit.prism([0, 0, 0], 10, 0.25, 0.4, 0.45, "light");
      kit.ring([0.42, 0, 0.25], 0.13, 0.03, "light", undefined, { start: -Math.PI / 2, arc: Math.PI, segments: 6, tubeSides: 3 });
      kit.prism([0, 0, 0], 10, 0.55, 0.55, 0.03, "accent", undefined, { collide: false });
    }),
    generator("books", (kit) => {
      let z = 0;
      const count = integer(kit.random, 3, 5);
      for (let index = 0; index < count; index += 1) {
        const thick = between(kit.random, 0.08, 0.16);
        kit.box([0, 0, z], 0.6, 0.45, thick, pick(kit.random, ["primary", "secondary", "accent", "dark"] as const), { yaw: between(kit.random, -0.3, 0.3) });
        z += thick;
      }
    }),
  ],
};

const crystals: FaceTheme = {
  id: "crystals",
  title: "Crystal clusters",
  major: [
    generator("crystal cluster", (kit) => {
      const { random } = kit;
      crystal(kit, [0, 0, 0], 0.9, between(random, 7.5, 10), 0.05, 0, "primary");
      const count = integer(random, 5, 8);

      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU + random() * 0.5;
        crystal(kit, [Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0], between(random, 0.4, 0.7), between(random, 3, 6.5), between(random, 0.25, 0.6), angle, pick(random, ["primary", "secondary", "light"] as const));
      }
    }),
  ],
  minor: [
    generator("small cluster", (kit) => {
      const count = integer(kit.random, 3, 5);
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU;
        crystal(kit, [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0], between(kit.random, 0.2, 0.35), between(kit.random, 1.6, 3.4), between(kit.random, 0.1, 0.5), angle, pick(kit.random, ["primary", "secondary"] as const));
      }
    }),
    generator("leaning shard", (kit) => crystal(kit, [0, 0, 0], 0.45, between(kit.random, 2.8, 3.8), between(kit.random, 0.2, 0.45), kit.random() * TAU, "secondary")),
  ],
  prop: [
    generator("geode", (kit) => {
      kit.ball([0, 0, 0.25], 0.5, 0.45, 0.3, "dark", { wobble: 0.15 });
      for (let index = 0; index < 3; index += 1) {
        crystal(kit, [between(kit.random, -0.2, 0.2), between(kit.random, -0.2, 0.2), 0.35], 0.08, 0.5, between(kit.random, 0, 0.5), kit.random() * TAU, "light");
      }
    }),
    generator("shard", (kit) => crystal(kit, [0, 0, 0], 0.15, between(kit.random, 0.6, 1.1), between(kit.random, 0, 0.4), kit.random() * TAU, "primary")),
  ],
};

const ruins: FaceTheme = {
  id: "ruins",
  title: "Ruined colonnades",
  major: [
    generator("colonnade", (kit) => {
      const { random } = kit;
      const count = integer(random, 4, 6);
      const pitch = 2.0;
      const height = between(random, 6, 7.5);
      const broken = new Set([integer(random, 0, count - 1)]);
      const standing: number[] = [];

      for (let index = 0; index < count; index += 1) {
        const u = (index - (count - 1) / 2) * pitch;

        if (broken.has(index)) {
          column(kit, [u, 0, 0], 0.45, between(random, 1.2, 2.6), "light", "secondary");
          kit.prism([u + 0.8, 1.4, 0.45], 8, 0.45, 0.45, 2.2, "light", { yaw: random() * TAU, pitch: Math.PI / 2 }, { collide: false });
        } else {
          column(kit, [u, 0, 0], 0.45, height, "light", "secondary");
          standing.push(u);
        }
      }

      // The lintel spans the longest run of standing columns.
      if (standing.length >= 2) {
        const from = standing[0];
        const to = standing[standing.length - 1];
        kit.box([(from + to) / 2, 0, height], to - from + 1.2, 1.3, 0.7, "primary");
      }
    }),
    generator("ruined portico", (kit) => {
      const { random } = kit;
      const height = between(random, 6, 7.5);
      column(kit, [-1.4, 0, 0], 0.5, height, "light", "secondary");
      column(kit, [1.4, 0, 0], 0.5, height, "light", "secondary");
      kit.box([0, 0, height], 4.2, 1.4, 0.7, "primary");
      kit.gable([0, 0, height + 0.7], 1.5, 4.4, "secondary", 0);
      column(kit, [0.4, -1.8, 0], 0.4, between(random, 1.0, 2.2), "light", "secondary");
    }),
  ],
  minor: [
    generator("broken column", (kit) => column(kit, [0, 0, 0], 0.4, between(kit.random, 1.8, 3.6), "light", "secondary")),
    generator("fallen drums", (kit) => {
      kit.prism([0, 0, 0.45], 8, 0.45, 0.45, 1.2, "light", { pitch: Math.PI / 2 });
      kit.prism([1.4, 0.3, 0.45], 8, 0.45, 0.45, 1.0, "light", { yaw: 0.4, pitch: Math.PI / 2 });
      column(kit, [-1.2, -0.6, 0], 0.4, 1.7, "light", "secondary");
    }),
  ],
  prop: [
    generator("capital", (kit) => kit.box([0, 0, 0], 0.9, 0.9, 0.35, "secondary", { yaw: kit.random() * TAU })),
    generator("drum", (kit) => kit.prism([0, 0, 0], 8, 0.4, 0.4, 0.5, "light")),
  ],
};

const fungi: FaceTheme = {
  id: "fungi",
  title: "Giant mushrooms",
  major: [
    generator("great mushroom", (kit) => {
      const { random } = kit;
      mushroom(kit, [0, 0, 0], between(random, 5.5, 7.5), between(random, 2.6, 3.4), between(random, -0.4, 0.4));
      mushroom(kit, [2.2, 0.8, 0], between(random, 2.0, 3.0), between(random, 0.9, 1.3), 0.5);
    }),
  ],
  minor: [
    generator("mushroom", (kit) => mushroom(kit, [0, 0, 0], between(kit.random, 1.6, 3.2), between(kit.random, 0.8, 1.4), between(kit.random, -0.6, 0.6))),
    generator("puffballs", (kit) => {
      kit.ball([0, 0, 0.8], 0.9, 0.9, 0.8, "light", { longitudes: 9, latitudes: 4 });
      kit.ball([1.1, 0.2, 0.5], 0.55, 0.55, 0.5, "secondary", { longitudes: 8, latitudes: 4 });
    }),
  ],
  prop: [
    generator("toadstool", (kit) => mushroom(kit, [0, 0, 0], between(kit.random, 0.4, 0.8), between(kit.random, 0.25, 0.45), between(kit.random, -0.5, 0.5))),
  ],
};

function totemPole(kit: Kit, height: number, width: number): void {
  const { random } = kit;
  let z = 0;
  let index = 0;

  while (z < height - width * 0.6) {
    const role = (["primary", "secondary", "accent", "dark", "light"] as const)[index % 5];
    const size = width * between(random, 0.8, 1.15);
    const kind = integer(random, 0, 3);

    if (kind === 0) {
      kit.box([0, 0, z], size, size, size, role, { yaw: random() * 0.5 });
      z += size;
    } else if (kind === 1) {
      kit.ball([0, 0, z + size * 0.5], size * 0.6, size * 0.6, size * 0.5, role, { longitudes: 8, latitudes: 4 });
      z += size;
    } else if (kind === 2) {
      kit.prism([0, 0, z], 6, size * 0.6, size * 0.35, size, role);
      z += size;
    } else {
      kit.prism([0, 0, z], 4, size * 0.75, size * 0.75, size * 0.5, role, undefined, { phase: Math.PI / 4 });
      kit.box([0, 0, z + size * 0.1], size * 2.4, size * 0.2, size * 0.3, role);
      z += size * 0.5;
    }

    index += 1;
  }

  kit.prism([0, 0, z], 4, width * 0.6, 0, width, "accent", undefined, { phase: Math.PI / 4 });
}

const totems: FaceTheme = {
  id: "totems",
  title: "Totem poles of stacked shapes",
  major: [
    generator("totem", (kit) => totemPole(kit, between(kit.random, 7, 9.5), between(kit.random, 1.0, 1.4))),
  ],
  minor: [generator("small totem", (kit) => totemPole(kit, between(kit.random, 2.2, 3.6), between(kit.random, 0.5, 0.7)))],
  prop: [
    generator("cube pair", (kit) => {
      kit.box([0, 0, 0], 0.5, 0.5, 0.5, "primary", { yaw: kit.random() });
      kit.box([0, 0, 0.5], 0.35, 0.35, 0.35, "accent", { yaw: kit.random() });
    }),
    generator("cone", (kit) => kit.prism([0, 0, 0], 6, 0.35, 0, 0.9, pick(kit.random, ["secondary", "accent"] as const))),
  ],
};

const orbits: FaceTheme = {
  id: "orbits",
  title: "Armillaries and planets",
  major: [
    generator("armillary", (kit) => {
      const { random } = kit;
      const centre = between(random, 4.5, 5.5);
      const radius = between(random, 2.0, 2.6);
      kit.prism([0, 0, 0], 8, 0.9, 0.5, 1.0, "dark");
      kit.strut([0, 0, 1.0], [0, 0, centre - radius * 0.3], 0.12, "dark");
      kit.ball([0, 0, centre], radius * 0.35, radius * 0.35, radius * 0.35, "accent", { longitudes: 10, latitudes: 5 });

      for (let index = 0; index < 3; index += 1) {
        kit.ring([0, 0, centre], radius * (1 - index * 0.08), 0.07, pick(random, ["primary", "secondary", "light"] as const), { yaw: random() * TAU, roll: Math.PI / 2 + (index - 1) * 0.6 + random() * 0.3 }, { segments: 18, tubeSides: 3 });
      }
    }),
    generator("planet stalks", (kit) => {
      const { random } = kit;
      const count = integer(random, 3, 4);

      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU + random();
        const base: Vec3 = [Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, 0];
        const height = between(random, 4, 8);
        const size = between(random, 0.5, 1.1);
        kit.strut(base, [base[0], base[1], height - size], 0.06, "dark");
        kit.ball([base[0], base[1], height], size, size, size, pick(random, ["primary", "secondary", "accent", "light"] as const), { longitudes: 9, latitudes: 4 });
        if (random() < 0.6) {
          kit.ring([base[0], base[1], height], size * 1.7, 0.05, "light", { roll: Math.PI / 2 + between(random, -0.4, 0.4) }, { segments: 14, tubeSides: 3 });
        }
      }
    }),
  ],
  minor: [
    generator("ringed planet", (kit) => {
      const height = between(kit.random, 2.2, 3.4);
      kit.strut([0, 0, 0], [0, 0, height - 0.6], 0.05, "dark");
      kit.ball([0, 0, height], 0.6, 0.6, 0.6, "primary", { longitudes: 9, latitudes: 4 });
      kit.ring([0, 0, height], 1.0, 0.05, "accent", { roll: Math.PI / 2 + 0.35 }, { segments: 14, tubeSides: 3 });
    }),
    generator("floating rings", (kit) => {
      for (let index = 0; index < 3; index += 1) {
        kit.ring([0, 0, 1.4 + index * 0.9], 0.9 - index * 0.2, 0.08, pick(kit.random, ["primary", "secondary", "accent"] as const), { roll: Math.PI / 2 + between(kit.random, -0.3, 0.3) }, { segments: 14, tubeSides: 3 });
      }
    }),
  ],
  prop: [
    generator("globe", (kit) => {
      kit.prism([0, 0, 0], 6, 0.25, 0.1, 0.5, "dark");
      kit.ball([0, 0, 0.8], 0.32, 0.32, 0.32, "secondary", { longitudes: 8, latitudes: 4 });
    }),
    generator("meteorite", (kit) => kit.ball([0, 0, 0.3], 0.5, 0.4, 0.35, "dark", { wobble: 0.3 })),
  ],
};

function flag(kit: Kit, top: Vec3, length: number, height: number, yaw: number, role: Role): void {
  kit.box([top[0] + (Math.cos(yaw) * length) / 2, top[1] + (Math.sin(yaw) * length) / 2, top[2] - height], length, 0.04, height, role, { yaw });
}

const kites: FaceTheme = {
  id: "kites",
  title: "Masts, flags and kites",
  major: [
    generator("mast", (kit) => {
      const { random } = kit;
      const height = between(random, 8, 10);
      kit.prism([0, 0, 0], 6, 0.2, 0.1, height, "dark");
      const flags = integer(random, 3, 5);

      for (let index = 0; index < flags; index += 1) {
        flag(kit, [0, 0, height - index * 1.1], between(random, 1.2, 2.2), 0.7, random() * TAU, pick(random, ["primary", "secondary", "accent", "light"] as const));
      }

      // Bunting to three stakes.
      for (let index = 0; index < 3; index += 1) {
        const angle = (index / 3) * TAU + random();
        const stake: Vec3 = [Math.cos(angle) * 3.6, Math.sin(angle) * 3.6, 0.4];
        kit.strut([0, 0, height * 0.7], stake, 0.025, "light", { collide: false });
        kit.box([stake[0], stake[1], 0], 0.12, 0.12, 0.5, "dark");
        for (let pennant = 1; pennant < 5; pennant += 1) {
          const t = pennant / 5;
          const at: Vec3 = [stake[0] * t, stake[1] * t, height * 0.7 + (0.4 - height * 0.7) * t];
          kit.prism(at, 3, 0.25, 0, 0.45, pennant % 2 === 0 ? "accent" : "primary", { pitch: Math.PI }, { collide: false });
        }
      }
    }),
    generator("kite flight", (kit) => {
      const { random } = kit;
      kit.box([0, 0, 0], 0.4, 0.4, 0.6, "dark");
      const count = integer(random, 2, 3);

      for (let index = 0; index < count; index += 1) {
        const angle = random() * TAU;
        const at: Vec3 = [Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, between(random, 6, 9)];
        kit.prism(at, 4, 1.1, 1.1, 0.05, pick(random, ["primary", "secondary", "accent"] as const), { yaw: angle, pitch: Math.PI / 2 - 0.4 });
        kit.strut([0, 0, 0.6], at, 0.015, "light", { collide: false });
        polyline(kit, [at, [at[0], at[1], at[2] - 1.2], [at[0] + 0.3, at[1], at[2] - 2.0]], 0.02, "accent");
      }
    }),
  ],
  minor: [
    generator("flag pole", (kit) => {
      const height = between(kit.random, 2.8, 3.8);
      kit.strut([0, 0, 0], [0, 0, height], 0.05, "dark");
      flag(kit, [0, 0, height], 1.2, 0.7, kit.random() * TAU, pick(kit.random, ["primary", "accent"] as const));
    }),
    generator("windsock", (kit) => {
      const height = between(kit.random, 2.6, 3.4);
      kit.strut([0, 0, 0], [0, 0, height], 0.05, "dark");
      kit.prism([0, 0, height - 0.2], 8, 0.3, 0.15, 1.4, "accent", { yaw: kit.random() * TAU, pitch: Math.PI / 2 + 0.25 });
    }),
  ],
  prop: [
    generator("pennant stake", (kit) => {
      kit.strut([0, 0, 0], [0, 0, 1.1], 0.025, "dark");
      kit.prism([0, 0, 0.7], 3, 0.25, 0, 0.4, "accent", { pitch: Math.PI / 2 });
    }),
  ],
};

/** Every theme, in a fixed order; the assignment draws from it. */
export const faceThemes: readonly FaceTheme[] = [cairns, village, striders, clockwork, lamplight, thresholds, mobiles, parlour, crystals, ruins, fungi, totems, orbits, kites];

/** The theme with the given id. */
export function faceThemeById(id: string): FaceTheme {
  const theme = faceThemes.find((entry) => entry.id === id);

  if (!theme) {
    throw new Error(`no face theme "${id}"`);
  }

  return theme;
}
