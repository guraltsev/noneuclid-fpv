/**
 * Face themes (design 018 section 9.1): what stands on a face. Each theme has generators for one major landmark (6 to 11 m), minor ones
 * (1.5 to 4 m) and small props (0.4 to 1.5 m); a generator takes a seeded random source and the face's palette and returns parts
 * (`landmarkParts.ts`) built at their final size, so no two landmarks of a theme are the same but all of a theme share a silhouette family.
 *
 * Pure and deterministic. Layer rule: imports only sibling modules.
 */
import type { FacePalette } from "./facePalettes";
import type { LandmarkPart, MotionKind, PartMotion, PartPose, Vec3 } from "./landmarkParts";

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

/** A palette role a part can take. */
export type Role = keyof Pick<FacePalette, "primary" | "secondary" | "accent" | "dark" | "light" | "glow">;

/** A full turn, radians. */
export const TAU = Math.PI * 2;

/** A random number from `low` to `high`. */
export function between(random: () => number, low: number, high: number): number {
  return low + (high - low) * random();
}

/** A random whole number from `low` to `high`, both included. */
export function integer(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/** A random item of `items`. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** A part list under construction, with one helper per shape; colours are palette roles or hex strings. */
export class Kit {
  readonly parts: LandmarkPart[] = [];

  constructor(
    readonly random: () => number,
    readonly palette: FacePalette,
  ) {}

  /** The motion given to every part added while it is set (see {@link Kit.moving}). */
  private motion: PartMotion | undefined;

  private add(part: LandmarkPart): void {
    this.parts.push(this.motion ? { ...part, motion: this.motion } : part);
  }

  /** Adds the parts `emit` makes with `motion`, so they move together (design 018 section 9.9). */
  moving(motion: PartMotion, emit: () => void): this {
    const saved = this.motion;
    this.motion = motion;
    emit();
    this.motion = saved;
    return this;
  }

  color(role: Role | string): string {
    return role.startsWith("#") ? role : this.palette[role as Role];
  }

  box(at: Vec3, sx: number, sy: number, sz: number, role: Role | string, pose?: PartPose, extra: { glow?: boolean; collide?: boolean } = {}): this {
    this.add({ shape: "box", at, sx, sy, sz, color: this.color(role), pose, ...extra });
    return this;
  }

  prism(at: Vec3, sides: number, r0: number, r1: number, h: number, role: Role | string, pose?: PartPose, extra: { phase?: number; glow?: boolean; collide?: boolean } = {}): this {
    this.add({ shape: "prism", at, sides, r0, r1, h, color: this.color(role), pose, ...extra });
    return this;
  }

  ball(at: Vec3, rx: number, ry: number, rz: number, role: Role | string, extra: { longitudes?: number; latitudes?: number; wobble?: number; glow?: boolean; collide?: boolean; pose?: PartPose } = {}): this {
    const { pose, ...rest } = extra;
    this.add({ shape: "ball", at, rx, ry, rz, color: this.color(role), pose, wobbleSeed: Math.floor(this.random() * 1e9), ...rest });
    return this;
  }

  ring(at: Vec3, radius: number, tube: number, role: Role | string, pose?: PartPose, extra: { start?: number; arc?: number; segments?: number; tubeSides?: number; glow?: boolean } = {}): this {
    this.add({ shape: "ring", at, radius, tube, color: this.color(role), pose, ...extra });
    return this;
  }

  star(at: Vec3, points: number, outer: number, inner: number, thickness: number, role: Role | string, pose?: PartPose): this {
    this.add({ shape: "star", at, points, outer, inner, thickness, color: this.color(role), pose });
    return this;
  }

  strut(from: Vec3, to: Vec3, radius: number, role: Role | string, extra: { glow?: boolean; collide?: boolean } = {}): this {
    this.add({ shape: "strut", at: [0, 0, 0], from, to, radius, color: this.color(role), ...extra });
    return this;
  }

  /** A gable roof (triangular prism along `u`, turned by `yaw`) with its eaves at `at`, `width` across and `length` long; the ridge is 0.87 `width` up. */
  gable(at: Vec3, width: number, length: number, role: Role | string, yaw = 0): this {
    // A 3-sided prism lying along u: radius r puts the apex 1.5 r above the base line, which is 1.732 r wide and 0.5 r below the axis.
    const r = width / Math.sqrt(3);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const shift = -length / 2;
    this.add({
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

/**
 * A motion that rests and now and then turns by a step (design 018 section 9.9): about `axis` through `pivot`, by `stepLow` to `stepHigh`
 * radians in the direction `sign`, every 5 to 13 seconds, each turn taking 1.2 to 3 seconds, at a random phase.
 */
export function occasionalTurn(random: () => number, pivot: Vec3, axis: Vec3, sign: number, stepLow = 0.5, stepHigh = 1.3): PartMotion {
  const period = between(random, 5, 13);
  return { pivot, axis, step: sign * between(random, stepLow, stepHigh), period, move: between(random, 1.2, 3), phase: random() * period };
}

/** A motion that turns steadily about `axis` through `pivot` at `radiansPerSecond` (signed), at a random phase. */
export function steadyTurn(random: () => number, pivot: Vec3, axis: Vec3, radiansPerSecond: number): PartMotion {
  const period = 10;
  return { pivot, axis, step: radiansPerSecond * period, period, move: period, phase: random() * period };
}

/**
 * A constant gentle oscillation (design 018 section 9.9): `kind` by up to `amplitude` (radians, meters or change of scale) either way,
 * about or along `axis` through `pivot`, once every `periodLow` to `periodHigh` seconds, at a random phase.
 */
export function sway(random: () => number, kind: MotionKind, pivot: Vec3, axis: Vec3, amplitude: number, periodLow = 3, periodHigh = 6): PartMotion {
  const period = between(random, periodLow, periodHigh);
  return { kind, schedule: "sway", pivot, axis, step: amplitude, period, move: period, phase: random() * period };
}

/**
 * A pulse: now and then `kind` goes out to `amount` over `move` seconds, holds 1.5 to 4 seconds and comes back, then rests; once every
 * `periodLow` to `periodHigh` seconds, at a random phase (drawers, flowers, doors, a lamp's sudden bow).
 */
export function pulse(random: () => number, kind: MotionKind, pivot: Vec3, axis: Vec3, amount: number, move: number, periodLow = 9, periodHigh = 18): PartMotion {
  const period = between(random, periodLow, periodHigh);
  const hold = Math.min(between(random, 1.5, 4), Math.max(0, period - 2 * move - 1));
  return { kind, schedule: "pulse", pivot, axis, step: amount, period, move, hold, phase: random() * period };
}

/** A random horizontal unit vector. */
export function horizontalAxis(random: () => number): Vec3 {
  const angle = random() * TAU;
  return [Math.cos(angle), Math.sin(angle), 0];
}

/** Runs `emit` on a fresh kit and returns the parts it made. */
export function build(random: () => number, palette: FacePalette, emit: (kit: Kit) => void): readonly LandmarkPart[] {
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
    const stone = () =>
      kit.ball([u, v, z + rz], radius * between(random, 0.9, 1.15), radius * between(random, 0.8, 1.05), rz, pick(random, roles), {
        longitudes: 8,
        latitudes: 4,
        wobble: 0.08,
        pose: { yaw: random() * TAU },
      });
    // The top stone rocks a little on the one below; the others sit still.
    if (index === count - 1) {
      kit.moving(sway(random, "turn", [u, v, z], horizontalAxis(random), 0.05, 4, 7), stone);
    } else {
      stone();
    }
    // Stones overlap a little, so the wobble never opens a gap between them.
    z += rz * 1.7;
    u += between(random, -0.18, 0.18) * radius;
    v += between(random, -0.18, 0.18) * radius;
    radius *= between(random, 0.72, 0.95);
  }

  return z;
}

/** A house: walls, gable roof, a door on its -v side and a few windows; `yaw` turns it. */
export function house(kit: Kit, at: Vec3, width: number, depth: number, wall: number, yaw: number): void {
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

/** A bench: seat, back and four legs, `length` long, facing -v after `yaw`. */
export function bench(kit: Kit, at: Vec3, length: number, yaw: number): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number, w: number): Vec3 => [at[0] + u * cos - v * sin, at[1] + u * sin + v * cos, at[2] + w];
  kit.box(local(0, 0, 0.42), length, 0.45, 0.08, "primary", { yaw });
  // The backrest stands on the seat's back edge and is held by the back legs, which run up through the seat.
  kit.box(local(0, 0.19, 0.6), length, 0.07, 0.36, "primary", { yaw });

  for (const u of [-0.42, 0.42]) {
    kit.strut(local(u * length, -0.17, 0), local(u * length, -0.17, 0.42), 0.04, "dark");
    kit.strut(local(u * length, 0.17, 0), local(u * length, 0.19, 0.96), 0.04, "dark");
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

/** A bicycle along `u` with wheels of radius `r`: frame, saddle and handlebar, its parts sized with the wheels. */
export function bicycle(kit: Kit, r: number): void {
  const gap = r * 2.3;
  const tube = Math.max(0.02, r * 0.07);
  wheel(kit, [-gap / 2, 0, r], r, 8, 0, "dark", "light");
  wheel(kit, [gap / 2, 0, r], r, 8, 0, "dark", "light");
  const crank: Vec3 = [0, 0, r];
  const seat: Vec3 = [-r * 0.35, 0, r * 2.0];
  const head: Vec3 = [gap / 2 - r * 0.35, 0, r * 2.05];
  polyline(kit, [[-gap / 2, 0, r], crank, seat, [-gap / 2, 0, r]], tube, "primary");
  polyline(kit, [crank, head, [gap / 2, 0, r]], tube, "primary");
  kit.strut(seat, head, tube, "primary");
  kit.box([seat[0], 0, seat[2] + tube], r * 0.55, r * 0.25, r * 0.11, "dark");
  // The stem carries the handlebar up from the head of the frame.
  kit.strut(head, [head[0] - tube, 0, head[2] + r * 0.28], tube * 0.8, "dark");
  kit.strut([head[0] - tube, -r * 0.5, head[2] + r * 0.28], [head[0] - tube, r * 0.5, head[2] + r * 0.28], tube * 0.8, "dark");
}

// A gear standing in the u-w plane turned by `yaw`: a toothed disc with a hub.
// With `spin` (radians per second, signed), the gear turns steadily about its own axle; a gear with more teeth turns slower.
function gear(kit: Kit, at: Vec3, radius: number, teeth: number, thickness: number, yaw: number, role: Role, spin = 0): void {
  const emit = () => {
    kit.star(at, teeth, radius, radius * 0.86, thickness, role, { yaw });
    kit.prism([at[0], at[1], at[2]], 8, radius * 0.22, radius * 0.22, thickness * 1.6, "dark", { yaw, roll: Math.PI / 2 });
  };

  if (spin === 0) {
    emit();
    return;
  }

  kit.moving(steadyTurn(kit.random, at, [-Math.sin(yaw), Math.cos(yaw), 0], (spin * 12) / teeth), emit);
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

/** A polyline of struts through `points`. */
export function polyline(kit: Kit, points: readonly Vec3[], radius: number, role: Role): void {
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
  // The stalk leans by turning about v; its top, where the cap sits, is where the turn carries it.
  const tilt = lean * 0.3;
  const top: Vec3 = [at[0] + Math.sin(tilt) * height, at[1], at[2] + Math.cos(tilt) * height];
  const capHeight = capRadius * between(random, 0.35, 0.55);
  kit.prism(at, 7, capRadius * 0.24, capRadius * 0.17, height, "light", { pitch: tilt });
  kit.ball(top, capRadius, capRadius, capHeight, "primary", { longitudes: 10, latitudes: 4 });
  kit.ring([top[0], top[1], top[2] - capRadius * 0.05], capRadius * 0.7, capRadius * 0.12, "dark", { roll: Math.PI / 2 }, { segments: 10, tubeSides: 3 });
  const spots = integer(random, 3, 6);

  for (let index = 0; index < spots; index += 1) {
    const angle = random() * TAU;
    const reach = between(random, 0.3, 0.75) * capRadius;
    // On the cap's surface, sunk a little into it.
    kit.ball([top[0] + Math.cos(angle) * reach, top[1] + Math.sin(angle) * reach, top[2] + capHeight * (1 - (reach / capRadius) ** 2) ** 0.5 - capRadius * 0.02], capRadius * 0.13, capRadius * 0.13, capRadius * 0.07, "light", {
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
      // The big stone sinks onto the small one (its wobble may shrink it by 12 percent) and rocks on it.
      kit.moving(sway(kit.random, "turn", [0, 0, 0.45], horizontalAxis(kit.random), 0.04, 4, 7), () =>
        kit.ball([0, 0, 0.45 + 0.9 * 0.82], 1.3, 1.0, 0.9, "primary", { wobble: 0.12, longitudes: 10 }),
      );
    }),
  ],
  prop: [
    generator("pebble pair", (kit) => {
      kit.ball([0, 0, 0.25], 0.5, 0.4, 0.25, "light", { wobble: 0.1 });
      kit.ball([0.1, 0, 0.6], 0.3, 0.26, 0.18, "primary", { wobble: 0.1 });
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
      // The pennant flutters about its pole.
      kit.moving(sway(random, "turn", [0, 0, height], [0, 0, 1], 0.35, 2.5, 4.5), () => kit.box([0.35, 0, height + width * 1.1 + 1.0], 0.7, 0.04, 0.4, "accent"));
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
        const base: Vec3 = [Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0];
        // Something inside breathes.
        kit.moving(sway(kit.random, "grow", base, [0, 0, 1], 0.05, 2.5, 4.5), () => kit.ball([base[0], base[1], 0.32], 0.22, 0.22, 0.32, "light"));
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
        const centre: Vec3 = [face[0] + cos * 0.07, face[1] + sin * 0.07, face[2]];
        // Turning by a negative angle about the outward normal is clockwise as seen from outside. The minute hand ticks every few
        // seconds; the hour hand creeps round once in twelve minutes.
        const outward: Vec3 = [cos, sin, 0];
        const tickPeriod = between(random, 2, 4);
        kit.moving(steadyTurn(random, centre, outward, -TAU / 720), () => kit.strut(centre, tip(hourAngle, 0.45), 0.04, "dark", { collide: false }));
        kit.moving({ pivot: centre, axis: outward, step: -TAU / 60, period: tickPeriod, move: 0.25, phase: random() * tickPeriod }, () =>
          kit.strut(centre, tip(minuteAngle, 0.7), 0.03, "dark", { collide: false }),
        );
      }

      gear(kit, [1.0 + 0.12, 0, height * 0.45], 0.9, 12, 0.2, Math.PI / 2, "accent", 0.35);
      gear(kit, [1.0 + 0.12, 0.7, height * 0.45 - 1.25], 0.6, 9, 0.2, Math.PI / 2, "secondary", -0.35);
    }),
    generator("gear tree", (kit) => {
      const { random } = kit;
      const height = between(random, 6.5, 8);
      kit.prism([0, 0, 0], 6, 0.25, 0.2, height, "dark");
      let z = 1.6;
      let side = 1;
      let gears = 0;

      // At most four gears, so the tree stays inside its triangle budget.
      while (z < height - 0.5 && gears < 4) {
        gears += 1;
        const radius = between(random, 0.8, 1.5);
        const yaw = random() * Math.PI;
        gear(kit, [Math.cos(yaw + Math.PI / 2) * 0.25 * side, Math.sin(yaw + Math.PI / 2) * 0.25 * side, z], radius, integer(random, 9, 16), 0.22, yaw, pick(random, ["primary", "secondary", "accent"] as const), 0.3 * side);
        z += radius * 1.3;
        side = -side;
      }
    }),
  ],
  minor: [
    generator("standing gear", (kit) => {
      const radius = between(kit.random, 1.2, 1.7);
      gear(kit, [0, 0, radius + 0.3], radius, integer(kit.random, 10, 16), 0.3, 0, "primary", kit.random() < 0.5 ? 0.25 : -0.25);
      // The A-frame meets the end of the axle, which runs from the gear towards -v.
      kit.strut([-0.8, -0.4, 0], [0, -0.4, radius + 0.3], 0.07, "dark");
      kit.strut([0.8, -0.4, 0], [0, -0.4, radius + 0.3], 0.07, "dark");
    }),
    generator("bicycle", (kit) => bicycle(kit, between(kit.random, 0.6, 0.72))),
  ],
  prop: [
    generator("fallen gear", (kit) => {
      const radius = between(kit.random, 0.4, 0.7);
      kit.star([0, 0, 0.08], integer(kit.random, 8, 12), radius, radius * 0.86, 0.15, "secondary", { roll: Math.PI / 2 });
      kit.prism([0, 0, 0], 8, radius * 0.22, radius * 0.22, 0.24, "dark");
    }),
    generator("pocket watch", (kit) => {
      // Face and rim lean back alike: the face's axis and the rim's normal are both (0, cos 0.3, sin 0.3).
      const normal: Vec3 = [0, Math.cos(0.3), Math.sin(0.3)];
      const up: Vec3 = [0, -Math.sin(0.3), Math.cos(0.3)];
      kit.prism([0, -normal[1] * 0.05, 0.55 - normal[2] * 0.05], 12, 0.5, 0.5, 0.1, "light", { roll: 0.3 - Math.PI / 2 });
      kit.ring([0, 0, 0.55], 0.5, 0.05, "accent", { roll: 0.3 }, { segments: 12, tubeSides: 3 });
      const centre: Vec3 = [0, normal[1] * 0.07, 0.55 + normal[2] * 0.07];
      kit.moving({ pivot: centre, axis: normal, step: -TAU / 60, period: 1.5, move: 0.15, phase: kit.random() * 1.5 }, () =>
        kit.strut(centre, [0, centre[1] + up[1] * 0.38, centre[2] + up[2] * 0.38], 0.02, "dark", { collide: false }),
      );
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
      // Now and then the upper arm, the shade and the bulb bow suddenly about the elbow, hold, and straighten again. The elbow's axis is
      // the horizontal one across the arm; a negative turn about it carries the wrist down and outwards.
      kit.moving(pulse(random, "turn", elbow, [-dir[1], dir[0], 0], -between(random, 0.35, 0.6), between(random, 0.3, 0.5), 12, 22), () => {
        kit.strut(elbow, wrist, 0.12, "primary");
        kit.ball(wrist, 0.25, 0.25, 0.25, "dark");
        // The shade hangs off the wrist and points down and out.
        kit.prism([wrist[0] - dir[0] * 0.3, wrist[1] - dir[1] * 0.3, wrist[2] - 0.2], 10, 0.35, 1.3, 1.6, "accent", { yaw: yaw + Math.PI, pitch: Math.PI * 0.8 });
        kit.ball([wrist[0] - dir[0] * 1.2, wrist[1] - dir[1] * 1.2, wrist[2] - 1.0], 0.45, 0.45, 0.45, "glow", { glow: true });
      });
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
        // Each crooked post turns about its foot now and then to look elsewhere: some slowly, some with a sudden jerk.
        const quick = random() < 0.4;
        kit.moving({ ...occasionalTurn(random, base, [0, 0, 1], index % 2 === 0 ? 1 : -1, 0.6, 1.4), move: quick ? 0.4 : between(random, 1.2, 2.2) }, () => {
          polyline(kit, [base, [base[0], base[1], height * 0.7], top], 0.09, "dark");
          lampHead(kit, [top[0], top[1], top[2] - 0.2], 0.55, pick(random, ["primary", "accent"] as const));
        });
      }
    }),
  ],
  minor: [
    generator("street lamp", (kit) => {
      const height = between(kit.random, 3.0, 3.9);
      kit.prism([0, 0, 0], 6, 0.18, 0.08, height, "dark");
      // The arm and its lamp turn round the post now and then.
      kit.moving(occasionalTurn(kit.random, [0, 0, height], [0, 0, 1], kit.random() < 0.5 ? 1 : -1, 0.8, 1.6), () => {
        kit.strut([0, 0, height], [0.7, 0, height + 0.15], 0.05, "dark");
        lampHead(kit, [0.7, 0, height], 0.35, "primary");
      });
    }),
    generator("floor lamp", (kit) => {
      const height = between(kit.random, 2.2, 3.0);
      kit.prism([0, 0, 0], 8, 0.45, 0.4, 0.1, "dark");
      kit.strut([0, 0, 0.1], [0, 0, height], 0.05, "dark");
      // The shade and bulb rock gently on the top of the post.
      kit.moving(sway(kit.random, "turn", [0, 0, height - 0.3], horizontalAxis(kit.random), 0.07, 4, 7), () => {
        kit.prism([0, 0, height - 0.3], 8, 0.6, 0.35, 0.6, "secondary");
        kit.ball([0, 0, height - 0.1], 0.18, 0.18, 0.18, "glow", { glow: true, longitudes: 6, latitudes: 3 });
      });
    }),
  ],
  prop: [
    generator("lantern", (kit) => {
      kit.box([0, 0, 0], 0.35, 0.35, 0.08, "dark");
      // The flame flickers.
      kit.moving(sway(kit.random, "grow", [0, 0, 0.12], [0, 0, 1], 0.12, 0.9, 1.5), () =>
        kit.ball([0, 0, 0.3], 0.14, 0.14, 0.2, "glow", { glow: true, longitudes: 6, latitudes: 3 }),
      );
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
        const wick: Vec3 = [Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, height];
        kit.moving(sway(kit.random, "grow", wick, [0, 0, 1], 0.2, 0.6, 1.2), () => kit.prism(wick, 4, 0.04, 0, 0.1, "glow", undefined, { glow: true }));
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
  // The door turns about its hinge on the left post. It wavers in a draught, or now and then swings wide open and back.
  const doorYaw = yaw - ajar;
  const hinge = local(-width / 2, 0, 0);
  const { random } = kit;
  const motion = random() < 0.5 ? sway(random, "turn", hinge, [0, 0, 1], between(random, 0.08, 0.15), 4, 7) : pulse(random, "turn", hinge, [0, 0, 1], -between(random, 0.5, 0.9), 1.2, 12, 20);
  kit.moving(motion, () => {
    kit.box([hinge[0] + (Math.cos(doorYaw) * width) / 2, hinge[1] + (Math.sin(doorYaw) * width) / 2, 0], width, 0.08, height, "primary", { yaw: doorYaw });
    kit.ball([hinge[0] + Math.cos(doorYaw) * width * 0.85 - Math.sin(doorYaw) * 0.08, hinge[1] + Math.sin(doorYaw) * width * 0.85 + Math.cos(doorYaw) * 0.08, height * 0.48], 0.06, 0.06, 0.06, "accent", { longitudes: 5, latitudes: 3 });
  });
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
      // The lid turns about its back edge (u through (0, 0.45, 0.1)): lifting its front is a turn by -open about +u. The handle sits on
      // its front edge. Now and then it lifts further and drops back.
      const hinge: Vec3 = [0, 0.45, 0.1];
      const onLid = (y: number, z: number): Vec3 => [0, hinge[1] + y * Math.cos(open) + z * Math.sin(open), hinge[2] - y * Math.sin(open) + z * Math.cos(open)];
      kit.moving(pulse(kit.random, "turn", hinge, [1, 0, 0], -between(kit.random, 0.4, 0.8), 0.6, 8, 16), () => {
        kit.box(onLid(-0.45, 0), 0.95, 0.9, 0.06, "primary", { roll: -open }, { collide: false });
        kit.ring(onLid(-0.8, 0.08), 0.1, 0.02, "accent", { roll: Math.PI / 2 - open }, { segments: 8, tubeSides: 3 });
      });
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
        // The branch starts on the stalk, which runs from the ground to the kink and on to the top.
        const z = height - index * 0.9;
        const from: Vec3 = z >= kink[2] ? [kink[0] * ((height - z) / (height - kink[2])), kink[1] * ((height - z) / (height - kink[2])), z] : [kink[0] * (z / kink[2]), kink[1] * (z / kink[2]), z];
        const length = between(random, 1.6, 2.6);
        const end: Vec3 = [Math.cos(angle) * length, Math.sin(angle) * length, from[2] - between(random, 0.3, 1.2)];
        const role = pick(random, ["primary", "secondary", "accent", "light"] as const);
        const item = index % 3;
        // Each branch swings round the stalk now and then, in its own direction and time.
        kit.moving(occasionalTurn(random, from, [0, 0, 1], index % 2 === 0 ? 1 : -1, 0.4, 1.1), () => {
          kit.strut(from, end, 0.04, "dark");

          if (item === 0) {
            kit.prism(end, 10, 0.6, 0.6, 0.08, role, { yaw: angle, pitch: Math.PI / 2 });
          } else if (item === 1) {
            kit.ring(end, 0.5, 0.14, role, { yaw: angle + Math.PI / 2 }, { start: 0.6, arc: Math.PI * 1.3, segments: 9, tubeSides: 3 });
          } else {
            kit.star(end, 5, 0.6, 0.26, 0.1, role, { yaw: angle + Math.PI / 2 });
          }
        });
      }
    }),
  ],
  minor: [
    generator("disc stalk", (kit) => {
      const height = between(kit.random, 2.4, 3.6);
      kit.strut([0, 0, 0], [0.3, 0, height], 0.05, "dark");
      kit.moving(sway(kit.random, "turn", [0.3, 0, height], [0, 0, 1], 0.5, 5, 9), () =>
        kit.prism([0.3, 0, height], 10, 0.55, 0.55, 0.08, pick(kit.random, ["primary", "accent"] as const), { pitch: Math.PI / 2 }),
      );
    }),
    generator("moon pole", (kit) => {
      const height = between(kit.random, 2.4, 3.4);
      kit.strut([0, 0, 0], [0, 0, height], 0.05, "dark");
      // The crescent's arc runs through its lowest point, which rests on the pole; it turns to and fro about the pole.
      kit.moving(sway(kit.random, "turn", [0, 0, height], [0, 0, 1], 0.5, 6, 9), () =>
        kit.ring([0, 0, height + 0.4], 0.45, 0.14, "secondary", undefined, { start: Math.PI / 2 + 0.4, arc: Math.PI * 1.2, segments: 9, tubeSides: 3 }),
      );
    }),
  ],
  prop: [
    generator("blob", (kit) => kit.ball([0, 0, 0.4], 0.6, 0.45, 0.4, pick(kit.random, ["primary", "accent", "dark"] as const), { wobble: 0.25 })),
    generator("star stick", (kit) => {
      kit.strut([0, 0, 0], [0, 0, 1.12], 0.03, "dark");
      kit.moving(sway(kit.random, "turn", [0, 0, 1.2], [0, 0, 1], 0.4, 4, 7), () => kit.star([0, 0, 1.2], 5, 0.3, 0.13, 0.06, "accent"));
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
        const bottom = 0.15 + (index + 0.15) * (height - 0.2) / drawers;
        const tall = (height - 0.4) / drawers;
        // Each drawer now and then slides part way out and back; its body, hidden in the chest at rest, comes out with it.
        kit.moving(pulse(kit.random, "slide", [0, 0, 0], [0, -1, 0], between(kit.random, 0.25, 0.45), between(kit.random, 0.6, 1.0), 8, 18), () => {
          kit.box([0, -0.15, bottom + 0.03], 1.5, 0.6, tall - 0.06, "dark", undefined, { collide: false });
          kit.box([0, -0.46, bottom], 1.6, 0.04, tall, "primary", undefined, { collide: false });
          kit.ball([0, -0.5, 0.15 + (index + 0.6) * (height - 0.2) / drawers], 0.07, 0.07, 0.07, "accent", { longitudes: 5, latitudes: 3 });
        });
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
      // Both puffballs breathe, out of step.
      kit.moving(sway(kit.random, "grow", [0, 0, 0], [0, 0, 1], 0.05, 3, 5), () => kit.ball([0, 0, 0.8], 0.9, 0.9, 0.8, "light", { longitudes: 9, latitudes: 4 }));
      kit.moving(sway(kit.random, "grow", [1.1, 0.2, 0], [0, 0, 1], 0.06, 3, 5), () => kit.ball([1.1, 0.2, 0.5], 0.55, 0.55, 0.5, "secondary", { longitudes: 8, latitudes: 4 }));
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
    const bottom = z;
    // Each piece turns about the pole now and then, its own way.
    kit.moving(occasionalTurn(random, [0, 0, bottom], [0, 0, 1], index % 2 === 0 ? 1 : -1, 0.4, 1.2), () => {
      if (kind === 0) {
        kit.box([0, 0, bottom], size, size, size, role, { yaw: random() * 0.5 });
      } else if (kind === 1) {
        kit.ball([0, 0, bottom + size * 0.5], size * 0.6, size * 0.6, size * 0.5, role, { longitudes: 8, latitudes: 4 });
      } else if (kind === 2) {
        kit.prism([0, 0, bottom], 6, size * 0.6, size * 0.35, size, role);
      } else {
        kit.prism([0, 0, bottom], 4, size * 0.75, size * 0.75, size * 0.5, role, undefined, { phase: Math.PI / 4 });
        kit.box([0, 0, bottom + size * 0.1], size * 2.4, size * 0.2, size * 0.3, role);
      }
    });
    z += kind === 3 ? size * 0.5 : size;

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
        const ring = () =>
          kit.ring([0, 0, centre], radius * (1 - index * 0.08), 0.07, pick(random, ["primary", "secondary", "light"] as const), { yaw: random() * TAU, roll: Math.PI / 2 + (index - 1) * 0.6 + random() * 0.3 }, { segments: 18, tubeSides: 3 });
        // The rings drift round the vertical at different speeds and directions.
        kit.moving(steadyTurn(random, [0, 0, centre], [0, 0, 1], (index % 2 === 0 ? 1 : -1) * between(random, 0.08, 0.2)), ring);
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
          const centre: Vec3 = [base[0], base[1], height];
          kit.moving(sway(random, "turn", centre, horizontalAxis(random), 0.15, 5, 9), () =>
            kit.ring(centre, size * 1.7, 0.05, "light", { roll: Math.PI / 2 + between(random, -0.4, 0.4) }, { segments: 14, tubeSides: 3 }),
          );
        }
      }
    }),
  ],
  minor: [
    generator("ringed planet", (kit) => {
      const height = between(kit.random, 2.2, 3.4);
      kit.strut([0, 0, 0], [0, 0, height - 0.6], 0.05, "dark");
      kit.ball([0, 0, height], 0.6, 0.6, 0.6, "primary", { longitudes: 9, latitudes: 4 });
      kit.moving(sway(kit.random, "turn", [0, 0, height], horizontalAxis(kit.random), 0.15, 5, 9), () =>
        kit.ring([0, 0, height], 1.0, 0.05, "accent", { roll: Math.PI / 2 + 0.35 }, { segments: 14, tubeSides: 3 }),
      );
    }),
    generator("floating rings", (kit) => {
      for (let index = 0; index < 3; index += 1) {
        // Each ring bobs up and down, out of step with the others.
        kit.moving(sway(kit.random, "slide", [0, 0, 0], [0, 0, 1], between(kit.random, 0.1, 0.2), 4, 7), () =>
          kit.ring([0, 0, 1.4 + index * 0.9], 0.9 - index * 0.2, 0.08, pick(kit.random, ["primary", "secondary", "accent"] as const), { roll: Math.PI / 2 + between(kit.random, -0.3, 0.3) }, { segments: 14, tubeSides: 3 }),
        );
      }
    }),
  ],
  prop: [
    generator("globe", (kit) => {
      kit.prism([0, 0, 0], 6, 0.25, 0.1, 0.5, "dark");
      kit.moving(steadyTurn(kit.random, [0, 0, 0.8], [0, 0, 1], 0.4), () => kit.ball([0, 0, 0.8], 0.32, 0.32, 0.32, "secondary", { longitudes: 8, latitudes: 4 }));
    }),
    generator("meteorite", (kit) => kit.ball([0, 0, 0.3], 0.5, 0.4, 0.35, "dark", { wobble: 0.3 })),
  ],
};

// A flag hanging from `top` on a pole, `yaw` away from it; it flutters to and fro about the pole.
function flag(kit: Kit, top: Vec3, length: number, height: number, yaw: number, role: Role): void {
  kit.moving(sway(kit.random, "turn", top, [0, 0, 1], between(kit.random, 0.25, 0.45), 2.5, 4.5), () =>
    kit.box([top[0] + (Math.cos(yaw) * length) / 2, top[1] + (Math.sin(yaw) * length) / 2, top[2] - height], length, 0.04, height, role, { yaw }),
  );
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
        // Kite, string and tail sway together about the anchor, across the wind.
        kit.moving(sway(random, "turn", [0, 0, 0.6], [-Math.sin(angle), Math.cos(angle), 0], between(random, 0.05, 0.09), 5, 9), () => {
          kit.prism(at, 4, 1.1, 1.1, 0.05, pick(random, ["primary", "secondary", "accent"] as const), { yaw: angle, pitch: Math.PI / 2 - 0.4 });
          kit.strut([0, 0, 0.6], at, 0.015, "light", { collide: false });
          polyline(kit, [at, [at[0], at[1], at[2] - 1.2], [at[0] + 0.3, at[1], at[2] - 2.0]], 0.02, "accent");
        });
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
      kit.moving(sway(kit.random, "turn", [0, 0, height - 0.2], [0, 0, 1], 0.5, 4, 7), () =>
        kit.prism([0, 0, height - 0.2], 8, 0.3, 0.15, 1.4, "accent", { yaw: kit.random() * TAU, pitch: Math.PI / 2 + 0.25 }),
      );
    }),
  ],
  prop: [
    generator("pennant stake", (kit) => {
      kit.strut([0, 0, 0], [0, 0, 1.1], 0.025, "dark");
      kit.moving(sway(kit.random, "turn", [0, 0, 0.7], [0, 0, 1], 0.4, 2.5, 4.5), () => kit.prism([0, 0, 0.7], 3, 0.25, 0, 0.4, "accent", { pitch: Math.PI / 2 }));
    }),
  ],
};


/**
 * The stacked cone tiers of a fir from `top` (the top of the trunk) up. Each tier turns about the trunk now and then, at its own pace and
 * in the opposite direction to the one below (design 018 section 9.9); `twist` turns each tier's facets a little more than the last.
 */
export function firTiers(kit: Kit, top: Vec3, height: number, layers: number, twist: number): void {
  for (let index = 0; index < layers; index += 1) {
    const radius = height * (0.28 - index * 0.05);
    const base: Vec3 = [top[0], top[1], top[2] + index * height * 0.15];
    kit.moving(occasionalTurn(kit.random, base, [0, 0, 1], index % 2 === 0 ? 1 : -1, 0.35, 1.0), () =>
      kit.prism(base, 7, radius, 0, height * 0.32, index % 2 === 0 ? "primary" : "secondary", twist === 0 ? undefined : { yaw: index * twist }),
    );
  }
}

/**
 * A flower: a stem from `base` up `height` meters and a bloom of `petals` points; now and then it sinks into the ground (or its pot) and rises
 * again (design 018 section 9.9).
 */
export function flower(kit: Kit, base: Vec3, height: number, petals: number, size: number): void {
  const { random } = kit;
  kit.moving(pulse(random, "slide", base, [0, 0, 1], -(height + size + 0.05), between(random, 0.8, 1.5), 10, 24), () => {
    kit.strut(base, [base[0], base[1], base[2] + height], 0.015, "dark", { collide: false });
    kit.star([base[0], base[1], base[2] + height], petals, size, size * 0.42, 0.03, pick(random, ["accent", "light", "secondary"] as const), { roll: Math.PI / 2 });
  });
}

/** A tree: a leaning trunk and a crown of one to three overlapping balls (round) or stacked cones (pointed). */
export function tree(kit: Kit, at: Vec3, height: number, pointed: boolean, leafBalls?: number): void {
  const { random } = kit;
  const lean: Vec3 = [between(random, -0.3, 0.3), between(random, -0.3, 0.3), 0];
  const top: Vec3 = [at[0] + lean[0], at[1] + lean[1], at[2] + height * 0.45];
  kit.strut(at, top, Math.max(0.1, height * 0.035), "dark");

  if (pointed) {
    firTiers(kit, top, height, integer(random, 2, 4), 0);
    return;
  }

  // The first ball of the crown sits on the trunk, which runs up into it; the others overlap it, a little off to the side.
  const crown = height * between(random, 0.22, 0.3);
  const centre: Vec3 = [top[0], top[1], top[2] + crown * 0.55];
  kit.strut(top, [centre[0], centre[1], centre[2]], Math.max(0.08, height * 0.028), "dark");
  const blobs = integer(random, 1, 3);
  for (let index = 0; index < blobs; index += 1) {
    const radius = index === 0 ? crown : crown * between(random, 0.7, 0.9);
    const angle = random() * TAU;
    const off = index === 0 ? 0 : crown * between(random, 0.25, 0.45);
    kit.ball([centre[0] + Math.cos(angle) * off, centre[1] + Math.sin(angle) * off, centre[2] + index * crown * 0.45], radius, radius, radius * 0.85, index % 2 === 0 ? "primary" : "secondary", {
      longitudes: 8,
      latitudes: 4,
      wobble: 0.12,
    });
  }

  // Small leaf balls on the crown's surface now and then shrink away to nothing and grow back (design 018 section 9.9).
  const leaves = leafBalls ?? integer(random, 2, 4);
  for (let index = 0; index < leaves; index += 1) {
    const angle = random() * TAU;
    const rise = between(random, -0.2, 0.8);
    const radius = crown * between(random, 0.3, 0.45);
    const at: Vec3 = [centre[0] + Math.cos(angle) * crown * 0.85, centre[1] + Math.sin(angle) * crown * 0.85, centre[2] + rise * crown * 0.6];
    kit.moving(pulse(random, "grow", at, [0, 0, 1], -1, between(random, 1.4, 2.4), 9, 20), () =>
      kit.ball(at, radius, radius, radius * 0.85, pick(random, ["primary", "secondary"] as const), { longitudes: 6, latitudes: 4, wobble: 0.15 }),
    );
  }
}

const grove: FaceTheme = {
  id: "grove",
  title: "Groves, topiary and flowers",
  major: [
    generator("great tree", (kit) => tree(kit, [0, 0, 0], between(kit.random, 7.5, 9.5), kit.random() < 0.5)),
    generator("copse", (kit) => {
      const count = integer(kit.random, 3, 4);
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU + kit.random();
        // A copse keeps one leaf ball per tree, to stay inside its triangle budget.
        tree(kit, [Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0], between(kit.random, 5.5, 8), kit.random() < 0.5, 1);
      }
    }),
  ],
  minor: [
    generator("small tree", (kit) => tree(kit, [0, 0, 0], between(kit.random, 2.6, 4.2), kit.random() < 0.5)),
    generator("topiary", (kit) => {
      kit.prism([0, 0, 0], 8, 0.55, 0.65, 0.7, "secondary");
      kit.strut([0, 0, 0.7], [0, 0, 1.4], 0.06, "dark");
      kit.ball([0, 0, 1.9], 0.6, 0.6, 0.6, "primary", { longitudes: 9, latitudes: 4 });
      kit.ball([0, 0, 2.85], 0.4, 0.4, 0.4, "primary", { longitudes: 8, latitudes: 4 });
    }),
  ],
  prop: [
    generator("flower bed", (kit) => {
      const count = integer(kit.random, 4, 6);
      for (let index = 0; index < count; index += 1) {
        const angle = kit.random() * TAU;
        const reach = between(kit.random, 0, 0.45);
        const height = between(kit.random, 0.35, 0.7);
        const base: Vec3 = [Math.cos(angle) * reach, Math.sin(angle) * reach, 0];
        flower(kit, base, height, 4, 0.12);
      }
    }),
    generator("shrub", (kit) => kit.ball([0, 0, 0.35], 0.5, 0.45, 0.4, "primary", { wobble: 0.2 })),
  ],
};

// A cloud resting on the ground: a cluster of flattened puffs in the palette's light colour, drifting slowly to and fro. It does not
// block the player: one walks through it.
function groundCloud(kit: Kit, at: Vec3, length: number, puffs: number): void {
  const { random } = kit;
  const along = horizontalAxis(random);
  kit.moving(sway(random, "slide", at, along, between(random, 0.25, 0.5), 10, 16), () => {
    for (let index = 0; index < puffs; index += 1) {
      const t = puffs === 1 ? 0 : index / (puffs - 1) - 0.5;
      const radius = length * between(random, 0.18, 0.28);
      const side = between(random, -0.3, 0.3) * length;
      const centre: Vec3 = [at[0] + along[0] * t * length - along[1] * side, at[1] + along[1] * t * length + along[0] * side, at[2] + radius * between(random, 0.25, 0.55)];
      kit.ball(centre, radius, radius * between(random, 0.7, 1), radius * between(random, 0.45, 0.65), "light", { longitudes: 8, latitudes: 4, wobble: 0.15, collide: false });
    }
  });
}

// A boulder hovering with its centre at `at`, bobbing slowly up and down.
function floatingBoulder(kit: Kit, at: Vec3, radius: number): void {
  const { random } = kit;
  kit.moving(sway(random, "slide", at, [0, 0, 1], between(random, 0.15, 0.35), 5, 9), () =>
    kit.ball(at, radius * between(random, 0.9, 1.15), radius * between(random, 0.8, 1.05), radius * between(random, 0.7, 0.9), pick(random, ["primary", "dark", "secondary"] as const), {
      longitudes: 9,
      latitudes: 5,
      wobble: 0.22,
      pose: { yaw: random() * TAU },
    }),
  );
}

const drift: FaceTheme = {
  id: "drift",
  title: "Floating boulders over clouds on the ground",
  major: [
    generator("floating boulders", (kit) => {
      const { random } = kit;
      const count = integer(random, 3, 5);
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * TAU + random();
        const reach = between(random, 0.6, 2.4);
        floatingBoulder(kit, [Math.cos(angle) * reach, Math.sin(angle) * reach, between(random, 2.2, 7)], between(random, 0.7, 1.4));
      }
      groundCloud(kit, [0, 0, 0], between(random, 4, 5.5), integer(random, 4, 6));
    }),
    generator("cloud field", (kit) => {
      const { random } = kit;
      groundCloud(kit, [-1.4, 0.4, 0], between(random, 3, 4), integer(random, 3, 5));
      groundCloud(kit, [1.6, -0.6, 0], between(random, 3, 4), integer(random, 3, 5));
      floatingBoulder(kit, [0, 0, between(random, 5, 7)], between(random, 1.2, 1.8));
      floatingBoulder(kit, [between(random, -1, 1), between(random, -1, 1), between(random, 2.5, 3.5)], between(random, 0.5, 0.8));
    }),
  ],
  minor: [
    generator("boulder pair", (kit) => {
      const { random } = kit;
      floatingBoulder(kit, [0, 0, between(random, 1.6, 2.6)], between(random, 0.5, 0.8));
      floatingBoulder(kit, [between(random, 0.6, 1.0), between(random, -0.5, 0.5), between(random, 2.8, 3.6)], between(random, 0.3, 0.5));
    }),
    generator("cloud bank", (kit) => {
      const { random } = kit;
      groundCloud(kit, [0, 0, 0], between(random, 3, 4.2), integer(random, 4, 6));
      // A second layer of puffs on top makes the bank tall enough to see across the face.
      groundCloud(kit, [0, 0, 0.95], between(random, 1.8, 2.4), 2);
    }),
  ],
  prop: [
    generator("small floater", (kit) => floatingBoulder(kit, [0, 0, between(kit.random, 0.9, 1.2)], between(kit.random, 0.18, 0.3))),
    generator("cloud puff", (kit) => groundCloud(kit, [0, 0, 0], between(kit.random, 1.0, 1.6), integer(kit.random, 2, 3))),
  ],
};

/** Every theme, in a fixed order; the assignment draws from it. */
export const faceThemes: readonly FaceTheme[] = [cairns, village, striders, clockwork, lamplight, thresholds, mobiles, parlour, crystals, ruins, fungi, totems, orbits, kites, grove, drift];

/** The theme with the given id. */
export function faceThemeById(id: string): FaceTheme {
  const theme = faceThemes.find((entry) => entry.id === id);

  if (!theme) {
    throw new Error(`no face theme "${id}"`);
  }

  return theme;
}
